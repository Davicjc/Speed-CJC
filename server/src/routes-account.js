import { normalizeDeviceLabel } from './ua.js';
import { validateEmail, validatePassword, validateProfilePatch, validateSignup } from './results.js';
import { readJsonBody, sendJson } from './util.js';

// Rotas da conta de cada pessoa: cadastro (com captcha), entrar e sair,
// confirmação de e-mail, nova senha, perfil, sessões, histórico,
// exportação/exclusão dos dados (LGPD) e "sinal de vida" (quem está online).

const err = (status, message, code) => Object.assign(new Error(message), { status, code });
const PRAZO_CONFIRMACAO = 3 * 24 * 60 * 60_000;
const PRAZO_NOVA_SENHA = 60 * 60_000;

// tentativas de senha erradas por e-mail (além do limite por IP)
const errosPorEmail = new Map();
const JANELA_ERROS = 15 * 60_000;
function errosRecentes(email) {
    const lista = (errosPorEmail.get(email) || []).filter((t) => t > Date.now() - JANELA_ERROS);
    if (lista.length) errosPorEmail.set(email, lista); else errosPorEmail.delete(email);
    return lista.length;
}
function registrarErro(email) {
    const lista = (errosPorEmail.get(email) || []).filter((t) => t > Date.now() - JANELA_ERROS);
    lista.push(Date.now());
    errosPorEmail.set(email, lista);
}
setInterval(() => { for (const e of errosPorEmail.keys()) errosRecentes(e); }, 5 * 60_000).unref();

const mascarar = (email) => String(email).replace(/^(.)(.*)(.@.*)$/, (_, a, meio, b) => a + '*'.repeat(Math.max(1, Math.min(meio.length, 6))) + b);

export async function handleAccount(ctx, req, res, url, ip) {
    const { users, sessions, store, captcha, authn, presence, hub, limits, lookupIsp, mailer, isHttps, siteOrigin, log } = ctx;
    const p = url.pathname;
    const m = req.method;
    const seguro = isHttps(req);
    const linkPara = (caminho) => siteOrigin(req) + caminho;

    function me(profile) {
        return {
            profile: users.view(profile),
            emailVerified: !!profile.email_verified,
            isAdmin: users.isAdmin(profile),
            isOwner: users.isOwner(profile),
            isTecnico: users.isTecnico(profile),
            mail: mailer.enabled,
        };
    }

    async function entrarNaConta(u, { lembrar }) {
        const device = normalizeDeviceLabel(null, req.headers['user-agent']);
        const token = sessions.criar(u.id, { persistente: !!lembrar, ip, device });
        sessions.gravarCookie(res, token, { persistente: !!lembrar, seguro });
        const onde = await lookupIsp(ip).catch(() => ({}));
        users.touch(u.id, { ip, city: onde.city || null, device }, { login: true });
    }

    async function mandarConfirmacao(u) {
        if (!mailer.enabled || u.email_verified) return false;
        const codigo = sessions.criarCodigo(u.id, 'verify', PRAZO_CONFIRMACAO);
        try { await mailer.confirmacao(u, linkPara('/entrar?confirmar=' + codigo)); return true; } catch (e) {
            log.warn('[e-mail] confirmação não enviada:', e.message);
            return false;
        }
    }

    // ---------- captcha ----------
    if (p === '/api/captcha/challenge' && m === 'GET') {
        if (!limits.captcha.take(ip)) throw err(429, 'Muitas tentativas. Aguarde alguns minutos.');
        const c = captcha.challenge(ip);
        if (!c) throw err(404, 'captcha externo em uso');
        return sendJson(res, 200, c), true;
    }

    // ---------- cadastro ----------
    if (p === '/api/auth/signup' && m === 'POST') {
        if (!limits.signup.take(ip)) throw err(429, 'Muitos cadastros feitos a partir da sua rede. Tente de novo mais tarde.');
        const body = await readJsonBody(req, 8 * 1024);
        const data = validateSignup(body);
        if (users.getByEmail(data.email)) throw err(409, 'Já existe uma conta com este e-mail. Entre ou use "Esqueci minha senha".', 'exists');
        const cap = await captcha.verify(body.captcha, ip);
        if (!cap.ok) throw err(400, cap.reason, 'captcha');
        const u = await users.create({
            email: data.email, name: data.name, password: data.password, phone: data.phone ?? null, city: data.city ?? null,
            planMbps: data.planMbps ?? null, createdVia: 'site', captcha: captcha.provider, ip,
        });
        await entrarNaConta(u, { lembrar: body.lembrar !== false });
        const enviado = await mandarConfirmacao(u);
        hub.publish('signup', { uid: u.id, name: u.name, email: u.email, at: Date.now() });
        log.info(`[cadastro] nova conta ${u.email} (${ip}, captcha ${captcha.provider})`);
        return sendJson(res, 201, { ok: true, emailSent: enviado, ...me(users.get(u.id)) }), true;
    }

    // ---------- sessão atual (sem login responde normal, para não sujar o console) ----------
    if (p === '/api/auth/session' && m === 'GET') {
        const atual = authn.optionalUser(req, ip);
        return sendJson(res, 200, atual ? me(atual.profile) : { anonimo: true }), true;
    }

    // ---------- entrar / sair ----------
    if (p === '/api/auth/login' && m === 'POST') {
        const body = await readJsonBody(req, 4 * 1024);
        const email = String(body.email || '').trim().toLowerCase();
        const senha = String(body.password || '');
        if (!email || !senha) throw err(400, 'Informe o e-mail e a senha.');
        if (!limits.loginIp.take(ip)) throw err(429, 'Muitas tentativas a partir da sua rede. Espere alguns minutos.');
        if (errosRecentes(email) >= 8) throw err(429, 'Muitas tentativas para esta conta. Espere 15 minutos ou use "Esqueci minha senha".', 'bloqueado');
        const u = await users.checkLogin(email, senha.slice(0, 256));
        if (!u) {
            registrarErro(email);
            log.warn(`[login] senha errada para ${email} (${ip})`);
            throw err(401, 'E-mail ou senha incorretos.', 'credenciais');
        }
        if (u.disabled) throw err(403, 'Esta conta está desativada. Fale com o suporte.', 'disabled');
        errosPorEmail.delete(email);
        await entrarNaConta(u, { lembrar: !!body.lembrar });
        return sendJson(res, 200, me(users.get(u.id))), true;
    }

    if (p === '/api/auth/logout' && m === 'POST') {
        const atual = authn.atual(req, ip);
        if (atual) { sessions.encerrar(atual.token); presence.bye(atual.profile.id); }
        sessions.apagarCookie(res, seguro);
        return sendJson(res, 200, { ok: true }), true;
    }

    // ---------- confirmação de e-mail ----------
    if (p === '/api/auth/verify' && m === 'POST') {
        if (!limits.codigos.take(ip)) throw err(429, 'Muitas tentativas. Aguarde alguns minutos.');
        const body = await readJsonBody(req, 2 * 1024);
        const uid = sessions.usarCodigo(String(body.token || ''), 'verify');
        if (!uid) throw err(400, 'Este link de confirmação é inválido, já foi usado ou expirou. Peça um novo no seu painel.', 'codigo');
        users.update(uid, { emailVerified: true });
        log.info(`[contas] e-mail confirmado: ${users.get(uid).email}`);
        return sendJson(res, 200, { ok: true }), true;
    }
    if (p === '/api/auth/verify/resend' && m === 'POST') {
        const { profile } = authn.requireUser(req, ip);
        if (!mailer.enabled) throw err(400, 'O envio de e-mail não está ligado neste servidor.', 'mail_off');
        if (profile.email_verified) return sendJson(res, 200, { ok: true, already: true }), true;
        if (!limits.reenvio.take(profile.id)) throw err(429, 'Já enviamos alguns links. Espere um pouco e confira a caixa de spam.');
        if (!(await mandarConfirmacao(profile))) throw err(503, 'Não foi possível enviar o e-mail agora. Tente de novo mais tarde.');
        return sendJson(res, 200, { ok: true }), true;
    }

    // ---------- esqueci minha senha / nova senha ----------
    if (p === '/api/auth/forgot' && m === 'POST') {
        if (!mailer.enabled) throw err(400, 'Para criar uma nova senha, fale com o suporte: eles enviam um link para você.', 'mail_off');
        if (!limits.esqueci.take(ip)) throw err(429, 'Muitos pedidos a partir da sua rede. Espere alguns minutos.');
        const body = await readJsonBody(req, 2 * 1024);
        const email = validateEmail(body.email);
        const u = users.getByEmail(email);
        // a resposta é a mesma exista ou não a conta (não revela quem tem cadastro)
        if (u && !u.disabled && limits.esqueciEmail.take(email)) {
            const codigo = sessions.criarCodigo(u.id, 'reset', PRAZO_NOVA_SENHA);
            mailer.novaSenha(u, linkPara('/entrar?nova-senha=' + codigo)).catch((e) => log.warn('[e-mail] link de senha não enviado:', e.message));
        }
        return sendJson(res, 200, { ok: true }), true;
    }
    if (p === '/api/auth/reset' && m === 'GET') {
        if (!limits.codigos.take(ip)) throw err(429, 'Muitas tentativas. Aguarde alguns minutos.');
        const t = sessions.lerCodigo(url.searchParams.get('token'), 'reset');
        const u = t && users.get(t.user_id);
        if (!u) throw err(400, 'Este link para criar a senha é inválido, já foi usado ou expirou. Peça um novo.', 'codigo');
        return sendJson(res, 200, { email: mascarar(u.email) }), true;
    }
    if (p === '/api/auth/reset' && m === 'POST') {
        if (!limits.codigos.take(ip)) throw err(429, 'Muitas tentativas. Aguarde alguns minutos.');
        const body = await readJsonBody(req, 2 * 1024);
        const t = sessions.lerCodigo(String(body.token || ''), 'reset');
        const alvo = t && users.get(t.user_id);
        if (!alvo) throw err(400, 'Este link para criar a senha é inválido, já foi usado ou expirou. Peça um novo.', 'codigo');
        const senha = validatePassword(body.password, alvo.email);
        if (!sessions.usarCodigo(String(body.token), 'reset')) throw err(400, 'Este link já foi usado. Peça um novo.', 'codigo');
        await users.setPassword(alvo.id, senha);
        sessions.encerrarTodas(alvo.id); // quem tinha a senha antiga sai de todos os aparelhos
        errosPorEmail.delete(alvo.email.toLowerCase()); // senha nova: as tentativas erradas antigas não contam mais
        // link mandado por e-mail prova que a caixa de entrada é da pessoa
        if (!t.created_by && !alvo.email_verified) users.update(alvo.id, { emailVerified: true });
        log.info(`[contas] nova senha definida para ${alvo.email}${t.created_by ? ' (link gerado por ' + t.created_by + ')' : ''}`);
        return sendJson(res, 200, { ok: true, email: alvo.email }), true;
    }

    // ---------- confirmar a senha (ações sensíveis) ----------
    if (p === '/api/auth/reauth' && m === 'POST') {
        const { sess, profile } = authn.requireUser(req, ip);
        if (!limits.loginIp.take(ip)) throw err(429, 'Muitas tentativas. Espere alguns minutos.');
        const body = await readJsonBody(req, 2 * 1024);
        if (!(await users.checkPassword(profile, String(body.password || '').slice(0, 256)))) throw err(401, 'Senha incorreta.', 'credenciais');
        sessions.confirmouSenha(sess.id);
        return sendJson(res, 200, { ok: true }), true;
    }

    // ---------- sinal de vida ----------
    if (p === '/api/presence' && m === 'POST') {
        const { profile } = authn.requireUser(req, ip);
        if (!limits.presence.take(profile.id)) return sendJson(res, 429, { ok: false }), true;
        const body = await readJsonBody(req, 2 * 1024).catch(() => ({}));
        const where = await lookupIsp(ip);
        const device = normalizeDeviceLabel(body.device, req.headers['user-agent']);
        presence.beat(profile.id, {
            name: profile.name, email: profile.email, admin: users.isAdmin(profile),
            page: String(body.page || '').slice(0, 30) || null,
            state: ['online', 'testing', 'hidden'].includes(body.state) ? body.state : 'online',
            ip, city: where.city ? `${where.city}${where.region ? ' - ' + where.region : ''}` : null, isp: where.isp, device,
        });
        users.touch(profile.id, { ip, city: where.city || null, device });
        return sendJson(res, 200, { ok: true }), true;
    }

    // ---------- teste feito sem login -> conta ----------
    const cm = /^\/api\/results\/([0-9A-Za-z]{15})\/claim$/.exec(p);
    if (cm && m === 'POST') {
        if (!limits.claim.take(ip)) throw err(429, 'Muitas tentativas. Aguarde alguns minutos.');
        const { profile } = authn.requireUser(req, ip);
        const body = await readJsonBody(req, 2 * 1024);
        const r = store.claim(cm[1], String(body.token || ''), profile);
        if (!r.ok) throw err(400, r.reason);
        return sendJson(res, 200, { ok: true }), true;
    }

    if (p !== '/api/me' && !p.startsWith('/api/me/')) return false;

    // ---------- conta ----------
    const { sess, profile } = authn.requireUser(req, ip);
    if (!limits.me.take(profile.id)) throw err(429, 'Muitas consultas. Aguarde um pouco.');

    if (p === '/api/me' && m === 'GET') return sendJson(res, 200, me(profile)), true;

    if (p === '/api/me' && m === 'PATCH') {
        const body = await readJsonBody(req, 4 * 1024);
        const patch = validateProfilePatch(body, { withName: true });
        if (!Object.keys(patch).length) throw err(400, 'Nada para alterar.');
        return sendJson(res, 200, me(users.update(profile.id, patch))), true;
    }

    if (p === '/api/me/password' && m === 'POST') {
        const body = await readJsonBody(req, 2 * 1024);
        if (!limits.loginIp.take(ip)) throw err(429, 'Muitas tentativas. Espere alguns minutos.');
        if (!(await users.checkPassword(profile, String(body.current || '').slice(0, 256)))) throw err(401, 'A senha atual não confere.', 'credenciais');
        const nova = validatePassword(body.password, profile.email);
        await users.setPassword(profile.id, nova);
        const saiu = sessions.encerrarTodas(profile.id, sess.id); // os outros aparelhos precisam entrar de novo
        sessions.confirmouSenha(sess.id);
        log.info(`[contas] ${profile.email} trocou a senha (${saiu} outra(s) sessão(ões) encerrada(s))`);
        return sendJson(res, 200, { ok: true, sessoesEncerradas: saiu }), true;
    }

    if (p === '/api/me/sessions' && m === 'GET') {
        return sendJson(res, 200, {
            items: sessions.daPessoa(profile.id).map((s) => ({
                id: s.id.slice(0, 16), atual: s.id === sess.id, createdAt: s.created_at, lastSeenAt: s.last_seen_at,
                persistente: !!s.persistent, ip: s.ip, device: s.device,
            })),
        }), true;
    }
    const sm = /^\/api\/me\/sessions\/([0-9a-f]{16})$/.exec(p);
    if (sm && m === 'DELETE') {
        const alvo = sessions.daPessoa(profile.id).find((s) => s.id.startsWith(sm[1]));
        if (!alvo) throw err(404, 'Sessão não encontrada.');
        sessions.encerrarPorId(profile.id, alvo.id);
        if (alvo.id === sess.id) sessions.apagarCookie(res, seguro);
        return sendJson(res, 200, { ok: true }), true;
    }

    if (p === '/api/me/logout-all' && m === 'POST') {
        const n = sessions.encerrarTodas(profile.id);
        sessions.apagarCookie(res, seguro);
        presence.bye(profile.id);
        log.info(`[contas] ${profile.email} saiu de todos os aparelhos (${n} sessão(ões))`);
        return sendJson(res, 200, { ok: true }), true;
    }

    if (p === '/api/me' && m === 'DELETE') {
        authn.requireRecentLogin(sess, 5 * 60);
        if (users.isOwner(profile)) throw err(400, 'Esta é uma conta de dono do sistema. Para excluí-la, transfira antes com o comando "npm run admin" no servidor.');
        const n = store.deleteUserTests(profile.id);
        users.remove(profile.id);
        sessions.apagarCookie(res, seguro);
        presence.bye(profile.id);
        log.info(`[contas] ${profile.email} excluiu a própria conta (${n} teste(s) apagado(s))`);
        hub.publish('user-deleted', { uid: profile.id });
        return sendJson(res, 200, { deleted: true, tests: n }), true;
    }

    if (p === '/api/me/export' && m === 'GET') {
        // LGPD: portabilidade — tudo o que existe sobre a pessoa, num arquivo
        const tests = [];
        let after = null;
        do {
            const page = store.list({ uid: profile.id, after, limit: 1000 });
            for (const t of page.items) tests.push(store.get(t.id));
            after = page.next;
        } while (after);
        const data = {
            exportadoEm: new Date().toISOString(),
            perfil: users.view(profile),
            sessoes: sessions.daPessoa(profile.id).map((s) => ({ criadaEm: new Date(s.created_at).toISOString(), ultimoUso: new Date(s.last_seen_at).toISOString(), ip: s.ip, aparelho: s.device })),
            testes: tests,
        };
        res.writeHead(200, {
            'Content-Type': 'application/json; charset=utf-8',
            'Content-Disposition': `attachment; filename="meus-dados-${new Date().toISOString().slice(0, 10)}.json"`,
            'Cache-Control': 'no-store',
        });
        res.end(JSON.stringify(data, null, 2));
        return true;
    }

    if (p === '/api/me/tests' && m === 'GET') {
        const n = (k) => (url.searchParams.get(k) ? Number(url.searchParams.get(k)) : null);
        return sendJson(res, 200, store.list({ uid: profile.id, from: n('from'), to: n('to'), after: url.searchParams.get('after'), limit: n('limit') || 100 })), true;
    }

    const tm = /^\/api\/me\/tests\/([0-9A-Za-z]{15})$/.exec(p);
    if (tm) {
        const t = store.get(tm[1]);
        if (!t || t.uid !== profile.id) throw err(404, 'Teste não encontrado.');
        if (m === 'GET') return sendJson(res, 200, t), true;
        if (m === 'DELETE') { store.remove(tm[1]); return sendJson(res, 200, { deleted: true }), true; }
    }

    throw err(404, 'rota não encontrada');
}
