import { abrir, cena, clicar, digitar, marcar, limpar, mover, rolarAte, rolarPara, verNaTela, espera, falas, B } from './tut-lib.mjs';
import { createRequire } from 'node:module';
const SENHA = process.env.TUT_SENHA || 'Demo2026speed';
const require = createRequire(new URL('../../server/package.json', import.meta.url));
const QR = require('qrcode');
const { PARTES_MSG } = await import(new URL('../../js/ui/relatorio.js', import.meta.url).href);
const F = falas();
const alvo = (id, extra = 0.8) => F[id] + extra;
const so = process.argv.slice(2);
const quer = (id) => !so.length || so.includes(id);

// WhatsApp de mentira só para a demonstração
const qr = await QR.toDataURL('https://exemplo.com.br/tutorial-whatsapp', { margin: 1, width: 480, color: { dark: '#081535', light: '#ffffff' } });
const GRUPOS = [{ jid: '120363000000000001@g.us', nome: 'Suporte Técnico', participantes: 14 }, { jid: '120363000000000002@g.us', nome: 'Instalações Uberlândia', participantes: 9 }, { jid: '120363000000000003@g.us', nome: 'Supervisão de campo', participantes: 5 }];
const zap = { estado: { estado: 'desligado', ativo: false }, destinos: [], padrao: null, ocultar: [] };
const resposta = () => ({ ...zap.estado, destinos: zap.destinos, padrao: zap.padrao, ocultar: zap.ocultar, partes: PARTES_MSG });

const { b, p } = await abrir({ limite: false });
await p.setRequestInterception(true);
p.on('request', (r) => {
  const u = new URL(r.url()); const m = r.method();
  const json = (o, atraso = 300) => setTimeout(() => r.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(o) }), atraso);
  if (u.pathname === '/api/admin/zap' && m === 'GET') return json(resposta(), 150);
  if (u.pathname === '/api/admin/zap/conectar') { zap.estado = { estado: 'qr', qr, ativo: true }; return json(zap.estado, 900); }
  if (u.pathname === '/api/admin/zap/grupos') return json({ grupos: GRUPOS }, 700);
  if (u.pathname === '/api/admin/zap/destinos') { const c = JSON.parse(r.postData() || '{}'); zap.destinos = c.destinos || []; zap.padrao = c.padrao; return json({ destinos: zap.destinos, padrao: zap.padrao }); }
  if (u.pathname === '/api/admin/zap/mensagem') { zap.ocultar = JSON.parse(r.postData() || '{}').ocultar || []; return json({ ocultar: zap.ocultar }); }
  r.continue();
});
await p.goto(B + '/entrar', { waitUntil: 'networkidle2' });
await p.type('#e-email', 'marcos@exemplo.com.br'); await p.type('#e-senha', SENHA);
await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), p.click('#form-entrar button[type="submit"]')]);
await p.goto(B + '/admin', { waitUntil: 'networkidle2' }); await espera(2000);

if (quer('a01')) await cena(p, 'a01', alvo('a01'), async (em) => {
  await em(0.6); await marcar(p, '#admin-nav', 'Menu da administração');
  await em(6.8); await limpar(p);
});
if (quer('a02')) await cena(p, 'a02', alvo('a02'), async (em) => {
  await em(0.4); await marcar(p, '#geral-indicadores', 'Números do período');
  await em(3.8); await marcar(p, '#g-dia', 'Testes por dia');
  await em(7.4); await limpar(p);
});
if (quer('a03')) await cena(p, 'a03', alvo('a03', 1.0), async (em) => {
  await em(0.3); await verNaTela(p, '#geral-isps', { margem: 200 }); await marcar(p, '#geral-isps', 'Operadoras');
  await em(2.0); await rolarAte(p, '#mapa', { margem: 160, ms: 900 }); await marcar(p, '#mapa', 'Onde os testes foram feitos');
  await em(4.2); await verNaTela(p, '#geral-horas', { margem: 260 }); await marcar(p, '#geral-horas', 'Horários de pico');
  await em(6.8); await limpar(p);
});
// outra pessoa testando agora (para a aba Ao vivo ter movimento)
let outro = null;
if (quer('a04')) {
  outro = await abrir({ geo: [-18.9128, -48.2755] });
  const q = outro.p;
  await q.goto(B + '/entrar', { waitUntil: 'networkidle2' });
  await q.type('#e-email', 'clara@exemplo.com.br'); await q.type('#e-senha', SENHA);
  await Promise.all([q.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), q.click('#form-entrar button[type="submit"]')]);
  await q.goto(B + '/', { waitUntil: 'networkidle2' }); await espera(800);
  await rolarPara(p, 0, 400); await espera(500);
  q.click('#iniciar');
}
if (quer('a04')) await cena(p, 'a04', alvo('a04', 1.2), async (em) => {
  await em(0.4); await clicar(p, '#admin-nav [data-v="vivo"]');
  await em(2.0); await marcar(p, '#vivo-online', 'Quem está no site agora');
  await em(4.2); await marcar(p, '#vivo-feed', 'Testes chegando na hora');
  await em(7.0); await limpar(p);
});
if (quer('a05')) await cena(p, 'a05', alvo('a05'), async (em) => {
  await em(0.4); await clicar(p, '#admin-nav [data-v="testes"]');
  await em(1.8); await marcar(p, '#testes-filtros', 'Busca e filtros');
  await em(4.6); await marcar(p, '#testes-csv', 'Baixar em planilha'); await mover(p, '#testes-csv');
  await em(7.6); await limpar(p);
});
if (quer('a06')) await cena(p, 'a06', alvo('a06', 1.6), async (em) => {
  await em(0.4); await clicar(p, '#testes-linhas tr.clicavel');
  await p.waitForSelector('dialog[open] [data-zap-enviar]', { timeout: 10000 }).catch(() => {});
  await em(2.6); await rolarAte(p, 'dialog[open] [data-zap-enviar]', { ms: 1000 });
  await em(3.8); await marcar(p, 'dialog[open] [data-zap-enviar]', 'Enviar para o WhatsApp da equipe');
  await em(6.6); await limpar(p);
});
if (quer('a07')) await cena(p, 'a07', alvo('a07', 1.4), async (em) => {
  await em(0.3); await p.keyboard.press('Escape');
  await em(0.8); await clicar(p, '#admin-nav [data-v="usuarios"]');
  await em(1.8); await digitar(p, '#u-q', 'Clara', { atraso: 70 }); await p.keyboard.press('Enter');
  await em(3.6); await clicar(p, '#usuarios-linhas tr.clicavel');
  await p.waitForSelector('dialog[open] [data-a="link"]', { timeout: 10000 }).catch(() => {});
  await em(5.4); await verNaTela(p, 'dialog[open] [data-a="link"]'); await marcar(p, 'dialog[open] [data-a="link"]', 'Link de nova senha');
  await em(7.8); await limpar(p);
});
if (quer('a08')) await cena(p, 'a08', alvo('a08'), async (em) => {
  await em(0.3); await verNaTela(p, 'dialog[open] [data-a="tecnico"]'); await marcar(p, 'dialog[open] [data-a="tecnico"]', 'Dar acesso técnico');
  await em(2.6); await verNaTela(p, 'dialog[open] [data-a="papel"]'); await marcar(p, 'dialog[open] [data-a="papel"]', 'Tornar administrador');
  await em(5.0); await verNaTela(p, 'dialog[open] [data-a="status"]'); await marcar(p, 'dialog[open] [data-a="status"]', 'Desativar a conta');
  await em(7.2); await limpar(p);
});
if (quer('a09')) await cena(p, 'a09', alvo('a09'), async (em) => {
  await em(0.3); await p.keyboard.press('Escape');
  await em(0.8); await clicar(p, '#admin-nav [data-v="admins"]');
  await em(2.0); await marcar(p, '#admins-linhas', 'Quem tem acesso especial');
  await em(4.0); await marcar(p, '#admins-form', 'Adicionar alguém pelo e-mail');
  await em(6.4); await limpar(p);
});
if (quer('a10')) await cena(p, 'a10', alvo('a10', 1.2), async (em) => {
  await em(0.3); await clicar(p, '#admin-nav [data-v="auditoria"]');
  await em(1.6); await marcar(p, '#auditoria-linhas', 'Quem fez, o quê e quando');
  await em(5.2); await limpar(p);
});
if (quer('a11')) await cena(p, 'a11', alvo('a11', 1.6), async (em) => {
  await em(0.3); await clicar(p, '#admin-nav [data-v="zap"]');
  await p.waitForSelector('[data-zap="conectar"]', { timeout: 8000 }).catch(() => {});
  await em(1.6); await marcar(p, '[data-zap="conectar"]', 'Conectar WhatsApp');
  await em(2.8); await limpar(p); await clicar(p, '[data-zap="conectar"]');
  await p.waitForSelector('.zap-qr img', { timeout: 10000 }).catch(() => {});
  await em(4.4); await marcar(p, '.zap-qr', 'Leia com o celular da empresa');
  await em(7.4); await limpar(p);
});
// celular leu o QR: agora está conectado
if (quer('a12')) zap.estado = { estado: 'conectado', ativo: true, conta: { numero: '553499887766', nome: 'Suporte' } };
if (quer('a12')) await cena(p, 'a12', alvo('a12', 2.2), async (em) => {
  await p.waitForSelector('[data-zap="grupos"]', { timeout: 9000 }).catch(() => {});
  await em(1.4); await clicar(p, '[data-zap="grupos"]');
  await p.waitForSelector('[data-zap="add-grupo"]', { timeout: 8000 }).catch(() => {});
  await em(3.0); await clicar(p, '[data-zap="add-grupo"]');
  await em(4.2); await verNaTela(p, '.zap-destinos', { margem: 220 }); await marcar(p, '.zap-destinos', 'Destinos permitidos (o marcado é o padrão)');
  await em(6.6); await limpar(p); await clicar(p, '[data-zap="salvar"]');
});
if (quer('a13')) await cena(p, 'a13', alvo('a13', 1.2), async (em) => {
  await em(0.3); await rolarAte(p, '.zap-partes', { margem: 240 });
  await em(1.2); await marcar(p, '.zap-partes', 'O que vai na mensagem');
  await em(2.8); await clicar(p, '[data-parte="rota"]');
  await em(4.2); await clicar(p, '[data-zap="salvar-msg"]');
  await em(6.4); await limpar(p);
});
if (quer('a14')) await cena(p, 'a14', alvo('a14'), async (em) => {
  await em(0.3); await rolarPara(p, 0, 600);
  await em(0.9); await clicar(p, '#admin-nav [data-v="sistema"]');
  await em(2.0); await marcar(p, '#sistema-estado', 'Saúde do servidor');
  await em(4.8); await verNaTela(p, '#sistema-plataformas'); await marcar(p, '#sistema-plataformas', 'Plataformas medidas');
  await em(8.0); await limpar(p);
});
if (quer('a16')) await cena(p, 'a16', alvo('a16', 1.4), async (em) => {
  await em(0.3); await rolarPara(p, 0, 500); await clicar(p, '#admin-nav [data-v="geral"]');
  await em(2.0); await marcar(p, 'header nav', 'Teste · Técnico · Administração');
  await em(6.4); await limpar(p);
});
if (outro) await outro.b.close();
await b.close();
