// Testes de segurança e das regras de conta/administração.
// Sobem um servidor próprio com banco temporário:  npm test
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, before, test } from 'node:test';
import { navegador, subirServidor } from './servidor.mjs';

let srv, BASE;
const est = {};
const A = { email: 'ana@teste.local', senha: 'Teste1234a', nome: 'Ana Teste' };
const B = { email: 'beto@teste.local', senha: 'Teste1234b', nome: 'Beto Teste' };
const DONO = { email: 'dono@teste.local', senha: 'Fibra2026x' };

before(async () => { srv = await subirServidor(); BASE = srv.base; });
after(() => srv && srv.parar());

async function resolverCaptcha() {
    const c = await (await fetch(`${BASE}/api/captcha/challenge`)).json();
    for (let n = 0; n <= c.maxnumber; n++) {
        if (crypto.createHash('sha256').update(c.salt + n).digest('hex') === c.challenge) {
            return Buffer.from(JSON.stringify({ ...c, number: n })).toString('base64');
        }
    }
    throw new Error('captcha sem solução');
}
const banco = () => new DatabaseSync(path.join(srv.dataDir, 'speedcjc.db'));
const codigoDoLink = (saida) => /nova-senha=([A-Za-z0-9_-]+)/.exec(saida)[1];

test('arquivos internos não são servidos', async () => {
    for (const p of ['/server/src/config.js', '/.git/config', '/docs/MANUAL.md', '/NOTAS-DESTA-MAQUINA.md', '/server/data/speedcjc.db', '/data/speedcjc.db', '/server/data/captcha.key',
        '/server/.env', '/.antigo/index.html', '/server/package.json', '/js/../server/src/server.js', '/%2e%2e/server/src/server.js']) {
        const r = await fetch(BASE + p);
        assert.equal(r.status, 404, `${p} deveria dar 404 (deu ${r.status})`);
    }
});

test('páginas saem com cabeçalhos de segurança', async () => {
    for (const p of ['/', '/entrar', '/painel', '/admin', '/privacidade']) {
        const r = await fetch(BASE + p);
        assert.equal(r.status, 200, p);
        const csp = r.headers.get('content-security-policy') || '';
        assert.match(csp, /frame-ancestors 'none'/, p);
        assert.match(csp, /object-src 'none'/, p);
        assert.doesNotMatch(csp, /script-src[^;]*'unsafe-inline'/, `${p} não pode liberar script inline`);
        assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    }
});

test('sem sessão (ou com cookie inventado) não entra em nada', async () => {
    const n = navegador(BASE);
    assert.equal((await n.get('/api/admin/overview')).status, 401);
    assert.equal((await n.get('/api/me')).status, 401);
    n.cookie = 'speedcjc_sessao=' + crypto.randomBytes(32).toString('base64url');
    assert.equal((await n.get('/api/me')).status, 401);
    assert.equal((await n.get('/api/admin/users')).status, 401);
});

test('pedido vindo de outro site é recusado (CSRF)', async () => {
    const r = await fetch(BASE + '/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://site-malicioso.example', 'Sec-Fetch-Site': 'cross-site' },
        body: JSON.stringify({ email: 'x@y.z', password: 'abc12345' }),
    });
    assert.equal(r.status, 403);
    assert.equal((await r.json()).code, 'origem');
});

test('cadastro exige captcha válido, uma vez só, e senha forte; e já entra na conta', async () => {
    const n = navegador(BASE);
    const base = { name: A.nome, email: A.email, password: A.senha, terms: true };
    let r = await n.post('/api/auth/signup', base);
    assert.equal(r.status, 400); assert.equal(r.body.code, 'captcha');
    r = await n.post('/api/auth/signup', { ...base, captcha: Buffer.from('{"salt":"x"}').toString('base64') });
    assert.equal(r.status, 400);
    r = await n.post('/api/auth/signup', { ...base, password: 'abcdefgh', captcha: 'x' });
    assert.equal(r.status, 400, 'senha sem número');
    r = await n.post('/api/auth/signup', { ...base, password: 'ana1234567', captcha: 'x' });
    assert.equal(r.status, 400, 'senha com o e-mail');
    r = await n.post('/api/auth/signup', { ...base, terms: false, captcha: 'x' });
    assert.equal(r.status, 400, 'sem aceitar os termos');
    r = await n.post('/api/auth/signup', { ...base, website: 'http://spam', captcha: 'x' });
    assert.equal(r.status, 400, 'campo armadilha preenchido');

    const cap = await resolverCaptcha();
    r = await n.post('/api/auth/signup', { ...base, phone: '(34) 99123-4567', captcha: cap });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.ok(n.cookie, 'cadastro já deixa a pessoa conectada');
    assert.match(r.headers.get('set-cookie'), /HttpOnly/);
    assert.match(r.headers.get('set-cookie'), /SameSite=Lax/);
    est.uidA = r.body.profile.uid;
    est.navA = n;

    const outro = navegador(BASE);
    r = await outro.post('/api/auth/signup', { name: B.nome, email: B.email, password: B.senha, terms: true, captcha: cap });
    assert.equal(r.status, 400, 'o mesmo captcha não vale duas vezes');
    r = await outro.post('/api/auth/signup', { ...base, captcha: await resolverCaptcha() });
    assert.equal(r.status, 409, 'e-mail repetido');
    r = await outro.post('/api/auth/signup', { name: B.nome, email: B.email, password: B.senha, terms: true, captcha: await resolverCaptcha() });
    assert.equal(r.status, 201);
    est.uidB = r.body.profile.uid;
    est.navB = outro;
});

test('senha fica embaralhada (scrypt) no banco, nunca em texto', () => {
    const db = banco();
    const u = db.prepare('SELECT password_hash FROM users WHERE email = ?').get(A.email);
    db.close();
    assert.match(u.password_hash, /^scrypt\$15\$8\$1\$/);
    assert.ok(!u.password_hash.includes(A.senha));
});

test('login: senha errada recusa; muitas tentativas bloqueiam a conta por um tempo', async () => {
    const n = navegador(BASE);
    let r = await n.post('/api/auth/login', { email: B.email, password: 'errada123' });
    assert.equal(r.status, 401);
    assert.equal(r.body.error, 'E-mail ou senha incorretos.');
    const inexistente = await n.post('/api/auth/login', { email: 'ninguem@teste.local', password: 'errada123' });
    assert.equal(inexistente.body.error, r.body.error, 'mesma mensagem: não revela quem tem conta');
    for (let i = 0; i < 8; i++) await n.post('/api/auth/login', { email: B.email, password: 'errada' + i + 'x' });
    r = await n.post('/api/auth/login', { email: B.email, password: B.senha });
    assert.equal(r.status, 429, 'bloqueado mesmo com a senha certa');
    assert.equal(r.body.code, 'bloqueado');
});

test('usuário comum vê o próprio perfil e não entra na administração', async () => {
    const n = est.navA;
    const me = await n.get('/api/me');
    assert.equal(me.status, 200);
    assert.equal(me.body.profile.email, A.email);
    assert.equal(me.body.profile.phone, '+5534991234567');
    assert.equal(me.body.isAdmin, false);
    for (const p of ['/api/admin/overview', '/api/admin/users', '/api/admin/tests', '/api/admin/audit', '/api/admin/system', '/api/admin/tests.csv']) {
        assert.equal((await n.get(p)).status, 403, p);
    }
    assert.equal((await n.post(`/api/admin/users/${est.uidB}/role`, { role: 'admin' })).status, 403);
    const p = await n.patch('/api/me', { name: 'Ana Souza', planMbps: 500, role: 'admin', owner: true });
    assert.equal(p.status, 200);
    assert.equal(p.body.profile.name, 'Ana Souza');
    assert.equal(p.body.profile.role, 'user', 'não dá para se promover pelo perfil');
});

test('teste com login vai para a conta; outra pessoa não enxerga', async () => {
    const r = await est.navA.post('/api/results', { mode: 'rapido', download: 300, upload: 150, ping: 9, jitter: 1, location: { lat: -18.91, lng: -48.27, accuracy: 20 } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.saved, 'account');
    est.testeA = r.body.id;
    const intruso = navegador(BASE);
    await intruso.post('/api/auth/login', { email: A.email, password: 'chute1234' });
    assert.equal((await est.navA.get('/api/me/tests/' + est.testeA)).status, 200);
    const s = await intruso.post('/api/auth/signup', { name: 'Carla', email: 'carla@teste.local', password: 'Teste1234c', terms: true, captcha: await resolverCaptcha() });
    assert.equal(s.status, 201);
    assert.equal((await intruso.get('/api/me/tests/' + est.testeA)).status, 404);
    assert.equal((await intruso.del('/api/me/tests/' + est.testeA)).status, 404);
    const pub = await (await fetch(`${BASE}/api/results/${est.testeA}`)).json();
    assert.equal(pub.ip, undefined, 'link público sem IP');
    assert.equal(pub.user, undefined, 'link público sem nome');
    est.navC = intruso;
});

test('teste sem login só vai para a conta com o código secreto', async () => {
    const anon = navegador(BASE);
    const r = await anon.post('/api/results', { mode: 'rapido', download: 80, upload: 40, ping: 12, jitter: 2 });
    assert.equal(r.status, 201);
    assert.equal((await est.navC.post(`/api/results/${r.body.id}/claim`, { token: 'x'.repeat(32) })).status, 400);
    assert.equal((await est.navC.post(`/api/results/${r.body.id}/claim`, { token: r.body.claimToken })).status, 200);
    assert.equal((await est.navA.post(`/api/results/${r.body.id}/claim`, { token: r.body.claimToken })).status, 400, 'já pertence a outra conta');
});

test('dono criado pelo terminal; admin dado pelo painel; dono protegido', async () => {
    const saida = srv.admin('dono', DONO.email, 'Dono Teste');
    assert.match(saida, /Conta de dono criada/);
    const dono = navegador(BASE);
    const ver = await dono.get('/api/auth/reset?token=' + codigoDoLink(saida));
    assert.equal(ver.status, 200);
    assert.match(ver.body.email, /\*/, 'e-mail aparece mascarado');
    assert.equal((await dono.post('/api/auth/reset', { token: codigoDoLink(saida), password: DONO.senha })).status, 200);
    assert.equal((await dono.post('/api/auth/reset', { token: codigoDoLink(saida), password: DONO.senha })).status, 400, 'link vale uma vez só');
    assert.equal((await dono.post('/api/auth/login', { email: DONO.email, password: DONO.senha, lembrar: true })).status, 200);
    est.dono = dono;
    const ov = await dono.get('/api/admin/overview');
    assert.equal(ov.status, 200, JSON.stringify(ov.body));
    assert.ok(ov.body.totals.users >= 3);

    assert.equal((await dono.post(`/api/admin/users/${est.uidA}/role`, { role: 'admin' })).status, 200);
    assert.equal((await est.navA.get('/api/admin/overview')).status, 200, 'virou admin na hora');
    const uidDono = (await dono.get('/api/me')).body.profile.uid;
    assert.equal((await est.navA.post(`/api/admin/users/${uidDono}/role`, { role: 'user' })).status, 403, 'ninguém rebaixa o dono pelo painel');
    assert.equal((await est.navA.del(`/api/admin/users/${uidDono}`)).status, 403, 'ninguém exclui o dono pelo painel');
    assert.equal((await est.navA.post(`/api/admin/users/${est.uidA}/role`, { role: 'user' })).status, 400, 'admin não mexe no próprio papel');
    assert.equal((await dono.post(`/api/admin/users/${est.uidA}/role`, { role: 'user' })).status, 200);
    assert.equal((await est.navA.get('/api/admin/overview')).status, 403, 'perdeu o acesso na hora');
});

test('acesso técnico: só técnico e admin usam o /tecnico; teste "técnico" de cliente comum vale como de cliente', async () => {
    assert.equal((await est.navC.get('/api/tecnico/tests')).status, 403, 'cliente comum não vê a lista técnica');
    const fingido = await est.navC.post('/api/results', { mode: 'rapido', download: 50, upload: 20, ping: 10, jitter: 1, origem: 'tecnico', atendimento: { cliente: 'Fulano', plano: 100 } });
    assert.equal(fingido.status, 201);

    assert.equal((await est.navB.post(`/api/admin/users/${est.uidB}/tecnico`, { tecnico: true })).status, 403, 'ninguém se dá acesso técnico');
    assert.equal((await est.dono.post(`/api/admin/users/${est.uidB}/tecnico`, { tecnico: true })).status, 200);
    const me = await est.navB.get('/api/auth/session');
    assert.equal(me.body.isTecnico, true);
    assert.equal(me.body.isAdmin, false, 'técnico não vira administrador');
    assert.equal((await est.navB.get('/api/admin/users')).status, 403, 'técnico não mexe em usuários');

    const tec = await est.navB.post('/api/results', { mode: 'completo', download: 480, upload: 240, ping: 6, jitter: 1, origem: 'tecnico', atendimento: { cliente: 'Cliente 123', plano: 500, obs: 'teste no cabo' } });
    assert.equal(tec.status, 201);
    const lista = await est.navB.get('/api/tecnico/tests?limit=50');
    assert.equal(lista.status, 200);
    const porId = Object.fromEntries(lista.body.items.map((t) => [t.id, t]));
    assert.equal(porId[fingido.body.id].origem, 'cliente', 'origem técnica de cliente comum é ignorada');
    assert.equal(porId[fingido.body.id].atendimento, null);
    assert.equal(porId[tec.body.id].origem, 'tecnico');
    assert.equal(porId[tec.body.id].atendimento.cliente, 'Cliente 123');
    assert.ok(porId[est.testeA], 'o técnico vê os testes de outros clientes');
    const so = await est.navB.get('/api/tecnico/tests?origem=tecnico');
    assert.ok(so.body.items.every((t) => t.origem === 'tecnico'));
    const det = await est.navB.get('/api/tecnico/tests/' + tec.body.id);
    assert.equal(det.body.atendimento.obs, 'teste no cabo');
    assert.equal((await est.navB.post('/api/tecnico/tests', {})).status, 405, 'lista técnica é só leitura');

    assert.match(srv.admin('sem-tecnico', B.email), /não tem mais acesso técnico/);
    assert.equal((await est.navB.get('/api/tecnico/tests')).status, 403, 'perde o acesso na hora');
    assert.equal((await est.dono.get('/api/tecnico/tests')).status, 200, 'administrador também usa o /tecnico');
});

test('WhatsApp: só admin conecta e escolhe destinos; técnico só envia para destino liberado, com foto de verdade', async () => {
    assert.equal((await est.navC.get('/api/tecnico/zap')).status, 403, 'cliente comum não vê o envio');
    assert.equal((await est.navC.post('/api/tecnico/zap/enviar', { teste: est.testeA })).status, 403);
    srv.admin('tecnico', B.email);
    assert.equal((await est.navB.get('/api/admin/zap')).status, 403, 'técnico não mexe na conexão');
    assert.equal((await est.navB.post('/api/admin/zap/destinos', { destinos: [] })).status, 403);

    const z = await est.dono.get('/api/admin/zap');
    assert.equal(z.status, 200);
    assert.equal(z.body.estado, 'desligado', 'nada liga sozinho');
    assert.equal((await est.dono.post('/api/admin/zap/destinos', { destinos: [{ jid: '5534999999999@c.us; drop', nome: 'x' }] })).status, 400, 'destino com formato estranho é recusado');
    const ok = await est.dono.post('/api/admin/zap/destinos', { destinos: [{ jid: '120363000000000000@g.us', nome: 'Suporte' }], padrao: '120363000000000000@g.us' });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.destinos[0].tipo, 'grupo');

    const info = await est.navB.get('/api/tecnico/zap');
    assert.equal(info.status, 200);
    assert.equal(info.body.pronto, false, 'desconectado: não está pronto');
    assert.equal((await est.navB.post('/api/tecnico/zap/enviar', { teste: est.testeA, destino: '5511988887777@s.whatsapp.net' })).status, 400, 'só destinos liberados');
    const naoFoto = Buffer.from('<script>alert(1)</script>').toString('base64');
    assert.equal((await est.navB.post('/api/tecnico/zap/enviar', { teste: est.testeA, destino: '120363000000000000@g.us', fotos: [{ imagem: naoFoto }] })).status, 400, 'arquivo que não é JPEG é recusado');
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 0xff, 0xd9]).toString('base64');
    const off = await est.navB.post('/api/tecnico/zap/enviar', { teste: est.testeA, destino: '120363000000000000@g.us', fotos: [{ imagem: jpeg }] });
    assert.equal(off.status, 503, 'desconectado: falha avisando, sem derrubar nada');
    assert.equal((await fetch(`${BASE}/api/health`)).status, 200, 'o site segue no ar');
    srv.admin('sem-tecnico', B.email);
});

test('ação sensível pede a senha de novo depois de 15 minutos', async () => {
    const db = banco();
    db.prepare('UPDATE sessions SET reauth_at = 0').run();
    db.close();
    let r = await est.dono.post(`/api/admin/users/${est.uidB}/role`, { role: 'admin' });
    assert.equal(r.status, 401);
    assert.equal(r.body.code, 'reauth');
    assert.equal((await est.dono.post('/api/auth/reauth', { password: 'errada123' })).status, 401);
    assert.equal((await est.dono.post('/api/auth/reauth', { password: DONO.senha })).status, 200);
    r = await est.dono.post(`/api/admin/users/${est.uidB}/role`, { role: 'admin' });
    assert.equal(r.status, 200);
    assert.equal((await est.dono.post(`/api/admin/users/${est.uidB}/role`, { role: 'user' })).status, 200);
});

test('conta desativada cai na hora e não consegue entrar', async () => {
    // o Beto está bloqueado por tentativas erradas: o admin manda um link de senha nova
    const link = await est.dono.post(`/api/admin/users/${est.uidB}/reset-link`, {});
    assert.equal(link.status, 200);
    const codigo = codigoDoLink(link.body.link);
    const b = navegador(BASE);
    assert.equal((await b.post('/api/auth/reset', { token: codigo, password: 'NovaSenha99' })).status, 200);
    assert.equal((await est.navB.get('/api/me')).status, 401, 'nova senha derruba as sessões antigas');
    B.senha = 'NovaSenha99';
    const login = await b.post('/api/auth/login', { email: B.email, password: B.senha });
    assert.equal(login.status, 200, 'a senha nova tira o bloqueio de tentativas');
    let r = await est.dono.post(`/api/admin/users/${est.uidB}/status`, { disabled: true });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal((await b.get('/api/me')).status, 401, 'sessão encerrada');
    r = await b.post('/api/auth/login', { email: B.email, password: B.senha });
    assert.equal(r.status, 403);
    assert.equal((await est.dono.post(`/api/admin/users/${est.uidB}/status`, { disabled: false })).status, 200);
    assert.equal((await b.post('/api/auth/login', { email: B.email, password: B.senha })).status, 200);
    est.navB = b;
});

test('sessões: a pessoa vê onde está conectada, encerra uma, e trocar a senha derruba as outras', async () => {
    const outra = navegador(BASE);
    assert.equal((await outra.post('/api/auth/login', { email: 'carla@teste.local', password: 'Teste1234c' })).status, 200);
    const lista = await est.navC.get('/api/me/sessions');
    assert.equal(lista.status, 200);
    assert.equal(lista.body.items.length, 2);
    const alheia = lista.body.items.find((s) => !s.atual);
    assert.equal((await est.navC.del('/api/me/sessions/' + alheia.id)).status, 200);
    assert.equal((await outra.get('/api/me')).status, 401, 'a sessão encerrada caiu');
    assert.equal((await outra.post('/api/auth/login', { email: 'carla@teste.local', password: 'Teste1234c' })).status, 200);
    let r = await est.navC.post('/api/me/password', { current: 'errada', password: 'OutraSenha77' });
    assert.equal(r.status, 401);
    r = await est.navC.post('/api/me/password', { current: 'Teste1234c', password: 'OutraSenha77' });
    assert.equal(r.status, 200);
    assert.equal(r.body.sessoesEncerradas, 1);
    assert.equal((await outra.get('/api/me')).status, 401);
    assert.equal((await est.navC.get('/api/me')).status, 200, 'quem trocou continua conectado');
});

test('quem está online aparece para o admin; auditoria registra; planilha sem fórmulas', async () => {
    assert.equal((await est.navB.post('/api/presence', { page: 'teste', state: 'testing', device: 'Teste automatizado' })).status, 200);
    const on = await est.dono.get('/api/admin/online');
    assert.ok(on.body.items.some((x) => x.uid === est.uidB && x.state === 'testing'));
    const aud = await est.dono.get('/api/admin/audit');
    const acoes = aud.body.items.map((x) => x.action);
    for (const a of ['deu acesso de administrador', 'tirou acesso de administrador', 'desativou conta', 'gerou link de nova senha', 'criou dono (pelo terminal)']) assert.ok(acoes.includes(a), a);

    await est.navC.patch('/api/me', { name: '=HYPERLINK("http://x")' }).catch(() => {});
    await est.navC.post('/api/results', { mode: 'rapido', download: 10, upload: 5, ping: 20, jitter: 1 });
    const csv = await est.dono.get('/api/admin/tests.csv');
    assert.equal(csv.status, 200);
    assert.match(csv.headers.get('content-type'), /text\/csv/);
    if (csv.texto.includes('HYPERLINK')) assert.ok(csv.texto.includes(`"'=HYPERLINK`), 'nome que parece fórmula vira texto');
});

test('excluir a própria conta pede a senha e apaga tudo', async () => {
    let r = await est.navA.del('/api/me');
    assert.equal(r.status, 401, 'a senha foi digitada há "muito tempo" (teste anterior)');
    assert.equal(r.body.code, 'reauth');
    assert.equal((await est.navA.post('/api/auth/reauth', { password: A.senha })).status, 200);
    r = await est.navA.del('/api/me');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal((await est.navA.get('/api/me')).status, 401);
    assert.equal((await fetch(`${BASE}/api/results/${est.testeA}`)).status, 404, 'o teste também sumiu');
    const db = banco();
    assert.equal(db.prepare('SELECT COUNT(*) n FROM users WHERE email = ?').get(A.email).n, 0);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM sessions WHERE user_id = ?').get(est.uidA).n, 0);
    db.close();
});
