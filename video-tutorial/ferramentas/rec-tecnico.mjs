import { DatabaseSync } from 'node:sqlite';
import { abrir, cena, clicar, digitar, marcar, limpar, mover, rolarAte, rolarPara, verNaTela, espera, falas, B, W } from './tut-lib.mjs';
const SENHA = process.env.TUT_SENHA || 'Demo2026speed';
const F = falas();
const alvo = (id, extra = 0.8) => F[id] + extra;
const so = process.argv.slice(2);
const quer = (id) => !so.length || so.includes(id);
// protocolo do atendimento de exemplo com problema (criado pelo semear.mjs)
const PROTO = (() => { const db = new DatabaseSync(process.env.TUT_DB || W + '/demo-data/speedcjc.db', { readOnly: true }); const t = db.prepare("SELECT protocol, data FROM tests WHERE origem = 'tecnico' ORDER BY created_at").all().find((r) => /Patrícia/.test(r.data)); return t ? t.protocol : ''; })();
const ateModo = (p, m, ms) => p.waitForFunction((m) => document.querySelector('#velo')?.dataset.modo === m, { timeout: ms }, m).catch(() => console.log('  (tempo esgotado esperando', m, ')'));

const { b, p } = await abrir({ geo: [-18.9020, -48.2710] });
// entra como técnico, fora da gravação
await p.goto(B + '/entrar', { waitUntil: 'networkidle2' });
await p.type('#e-email', 'roberto@exemplo.com.br'); await p.type('#e-senha', SENHA);
await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), p.click('#form-entrar button[type="submit"]')]);
await p.goto(B + '/tecnico', { waitUntil: 'networkidle2' }); await espera(1500);

if (quer('t01')) await cena(p, 't01', alvo('t01'), async (em) => {
  await em(0.6); await marcar(p, '.selo-tecnico', 'Área técnica');
  await em(3.6); await marcar(p, '#velo', 'Todas as medidas, sem filtro');
  await em(7.2); await limpar(p);
});
if (quer('t02')) { await p.goto(B + '/', { waitUntil: 'networkidle2' }); await espera(1000); }
if (quer('t02')) await cena(p, 't02', alvo('t02'), async (em) => {
  await em(0.6); await marcar(p, 'header a[href="/tecnico"]', 'Técnico, no menu');
  await em(2.4); await limpar(p); await clicar(p, 'header a[href="/tecnico"]');
  await p.waitForSelector('#atendimento', { timeout: 10000 }).catch(() => {});
  await em(5.0); await marcar(p, '.selo-tecnico', 'Tema próprio, grafite e laranja');
  await em(8.6); await limpar(p);
});
if (quer('t03')) await cena(p, 't03', alvo('t03', 1.0), async (em) => {
  const aberto = await p.$eval('#atendimento', (e) => e.open).catch(() => true);
  if (!aberto) await clicar(p, '#atendimento summary');
  await em(0.3); await marcar(p, '#atendimento', 'Dados do atendimento');
  await em(0.9); await digitar(p, '#at-cliente', 'Clara Souza — contrato 4521', { atraso: 38 });
  await em(3.4); await digitar(p, '#at-plano', '500', { atraso: 60 });
  await em(4.4); await digitar(p, '#at-obs', 'Teste no cabo, roteador da sala', { atraso: 32 });
  await em(7.9); await limpar(p);
});
if (quer('t04')) await cena(p, 't04', alvo('t04', 0.6), async (em) => {
  await em(0.4); await marcar(p, '#modos', 'Diagnóstico completo, já marcado');
  await em(2.6); await limpar(p); await clicar(p, '#iniciar');
});
if (quer('t05')) { await ateModo(p, 'fim', 160000); await espera(4000); await p.evaluate(() => scrollTo(0, 0)); await espera(500); }
if (quer('t05')) await cena(p, 't05', alvo('t05'), async (em) => {
  await em(0.4); await marcar(p, '#r-titulo', 'Resultado direto, com base no plano');
  await em(3.2); await verNaTela(p, '#leituras', { margem: 300 }); await marcar(p, '#leituras', 'Verde, amarelo ou vermelho');
  await em(7.2); await limpar(p);
});
if (quer('t06')) await cena(p, 't06', alvo('t06'), async (em) => {
  await em(0.3); await verNaTela(p, '#r-salvo', { margem: 400 }); await marcar(p, '#r-salvo', 'Guardado com o atendimento');
  await em(3.2); await rolarAte(p, '#d-curva', { margem: 140 }); await marcar(p, '#d-curva', 'Curva de velocidade');
  await em(5.8); await rolarAte(p, '#d-medidas', { margem: 200, ms: 900 }); await marcar(p, '#d-medidas', 'Latência detalhada');
  await em(8.4); await limpar(p);
});
if (quer('t07')) await cena(p, 't07', alvo('t07', 1.4), async (em) => {
  await em(0.2); await rolarAte(p, '#testes-tec', { margem: 100, ms: 1100 });
  await em(1.4); await marcar(p, '#filtros-tec', 'Busque por protocolo, nome ou e-mail');
  await em(2.8); await digitar(p, '#busca-tec', PROTO, { atraso: 45 });
  await em(5.8); await marcar(p, '#linhas-tec', 'Testes de todos os clientes');
  await em(8.6); await limpar(p);
});
if (quer('t08')) await cena(p, 't08', alvo('t08'), async (em) => {
  await em(0.3); await clicar(p, '#linhas-tec tr.clicavel');
  await p.waitForSelector('dialog[open] [data-diag="nat"] .diag-linha', { timeout: 10000 }).catch(() => {});
  await em(2.0); await rolarAte(p, 'dialog[open] [data-diag="nat"]', { ms: 900 });
  await em(3.0); await marcar(p, 'dialog[open] [data-diag="nat"]', 'Roteador e NAT');
  await em(8.2); await limpar(p);
});
if (quer('t09')) await cena(p, 't09', alvo('t09'), async (em) => {
  await em(0.3); await marcar(p, 'dialog[open] [data-diag="nat"] .diag-linha:nth-of-type(2)', 'Duplo NAT: dois roteadores');
  await em(3.8); await marcar(p, 'dialog[open] [data-diag="nat"] .diag-linha:nth-of-type(1)', 'NAT estrito');
  await em(7.4); await limpar(p);
});
if (quer('t10')) await cena(p, 't10', alvo('t10'), async (em) => {
  await em(0.3); await rolarAte(p, 'dialog[open] [data-diag="mtu"]', { ms: 900 });
  await em(1.3); await marcar(p, 'dialog[open] [data-diag="mtu"]', 'MTU e MSS');
  await em(5.2); await marcar(p, 'dialog[open] [data-diag="mtu"] .diag-explica', 'O que ajustar');
  await em(10.6); await limpar(p);
});
if (quer('t11')) await cena(p, 't11', alvo('t11'), async (em) => {
  await em(0.3); await rolarAte(p, 'dialog[open] [data-diag="rota"]', { ms: 900 });
  await em(1.3); await marcar(p, 'dialog[open] [data-diag="rota"] table', 'Cada salto até o cliente');
  await em(7.6); await limpar(p);
});
// regravar só o envio: abre o atendimento de exemplo fora da gravação
if (so.length && quer('t12') && !quer('t08')) {
  await p.evaluate(() => document.querySelector('#busca-tec').scrollIntoView({ block: 'center' }));
  await p.type('#busca-tec', PROTO); await espera(2500);
  await p.click('#linhas-tec tr.clicavel'); await p.waitForSelector('dialog[open] [data-zap-enviar]', { timeout: 10000 }); await espera(1200);
}
// WhatsApp de mentira só para a demonstração (o servidor de teste não tem WhatsApp conectado)
if (quer('t12')) {
  await p.setRequestInterception(true);
  p.on('request', (r) => {
    const u = r.url();
    if (u.endsWith('/api/tecnico/zap') && r.method() === 'GET') return r.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ pronto: true, estado: 'conectado', destinos: [{ jid: '120363000000000001@g.us', nome: 'Suporte Técnico', tipo: 'grupo' }, { jid: '553499990000@s.whatsapp.net', nome: 'Supervisor de campo', tipo: 'contato' }], padrao: '120363000000000001@g.us' }) });
    if (u.endsWith('/api/tecnico/zap/enviar')) return setTimeout(() => r.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, destino: 'Suporte Técnico', fotos: 2 }) }), 1200);
    r.continue();
  });
}
if (quer('t12')) await cena(p, 't12', alvo('t12'), async (em) => {
  await em(0.3); await rolarAte(p, 'dialog[open] [data-zap-enviar]', { ms: 900 });
  await em(1.4); await marcar(p, 'dialog[open] [data-zap-enviar]', 'Enviar para o Zap');
  await em(2.8); await limpar(p); await clicar(p, 'dialog[open] [data-zap-enviar]');
  await p.waitForSelector('#zap-cliente', { timeout: 8000 }).catch(() => {});
  await em(4.4); await marcar(p, '.zap-local', 'Com ou sem localização');
  await em(6.4); await marcar(p, '.zap-campos', 'Dados do cliente, já preenchidos');
  await em(8.8); await limpar(p);
});
if (quer('t13')) await cena(p, 't13', alvo('t13', 1.6), async (em) => {
  await em(0.3); await marcar(p, '#zap-destino', 'Escolha o grupo');
  await em(2.0); await limpar(p);
  const [fc] = await Promise.all([p.waitForFileChooser({ timeout: 8000 }), clicar(p, '.zap-escolher')]);
  await fc.accept([W + '/fotos/foto1.jpg', W + '/fotos/foto2.jpg']);
  await p.waitForFunction(() => document.querySelectorAll('#zap-fotos img').length === 2 && [...document.querySelectorAll('#zap-fotos img')].every((i) => i.complete && i.naturalWidth > 0), { timeout: 10000 }).catch(() => console.log('  (miniaturas não apareceram)'));
  await em(3.4); await marcar(p, '#zap-fotos', 'Até 6 fotos do atendimento');
  await em(5.2); await limpar(p); await clicar(p, '#zap-enviar');
});
if (quer('t14')) await cena(p, 't14', alvo('t14'), async (em) => {
  await em(1.0); await p.keyboard.press('Escape');
  await em(1.6); await rolarPara(p, 0, 900);
  await em(2.8); await marcar(p, '#r-salvo', 'Visita registrada com protocolo');
  await em(6.8); await limpar(p);
});
await b.close();
