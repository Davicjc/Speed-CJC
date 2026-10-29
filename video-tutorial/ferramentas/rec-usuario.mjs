import { abrir, cena, clicar, digitar, marcar, limpar, mover, rolarAte, rolarPara, verNaTela, espera, falas, B } from './tut-lib.mjs';
const SENHA = process.env.TUT_SENHA || 'Demo2026speed';
const F = falas();
const alvo = (id, extra = 0.8) => F[id] + extra;
const so = process.argv.slice(2);
const quer = (id) => !so.length || so.includes(id);
const modo = (p) => p.evaluate(() => document.querySelector('#velo')?.dataset.modo);
const ateModo = (p, m, ms) => p.waitForFunction((m) => document.querySelector('#velo')?.dataset.modo === m, { timeout: ms }, m).catch(() => console.log('  (tempo esgotado esperando', m, ')'));

const { b, p } = await abrir({ geo: [-18.9186, -48.2560] });
await p.goto(B + '/', { waitUntil: 'networkidle2' }); await espera(1500);
// regravar só cenas do painel: entra como a Clara fora da gravação
if (so.length && !so.includes('u16') && so.some((id) => id >= 'u17' && id <= 'u20')) {
  await p.goto(B + '/entrar', { waitUntil: 'networkidle2' });
  await p.type('#e-email', 'clara@exemplo.com.br'); await p.type('#e-senha', SENHA);
  await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), p.click('#form-entrar button[type="submit"]')]);
}

if (quer('u01')) await cena(p, 'u01', alvo('u01'), async (em) => {
  await em(1.2); await marcar(p, '#velo', 'O velocímetro');
  await em(4.2); await marcar(p, 'a[href="/painel"]', 'Seu histórico fica aqui');
  await em(7.6); await limpar(p);
});
if (quer('u02')) await cena(p, 'u02', alvo('u02'), async (em) => {
  await em(0.5); await marcar(p, '#modos', 'Escolha o tipo de teste');
  await em(1.6); await mover(p, '#modos button[data-modo="rapido"]');
  await em(4.6); await clicar(p, '#modos button[data-modo="completo"]');
  await em(8.2); await clicar(p, '#modos button[data-modo="rapido"]');
  await em(9.8); await limpar(p);
});
if (quer('u03')) await cena(p, 'u03', alvo('u03'), async (em) => {
  await em(0.4); await marcar(p, '#local-chave', 'Localização do aparelho (opcional)');
  await em(2.6); await clicar(p, '#usar-local');
  await em(6.6); await limpar(p);
});
if (quer('u04')) await cena(p, 'u04', alvo('u04', 0.6), async (em) => {
  await em(0.4); await marcar(p, '#iniciar', 'Clique em Iniciar');
  await em(1.9); await limpar(p); await clicar(p, '#iniciar');
});
if (quer('u05')) await cena(p, 'u05', alvo('u05', 0.4), async (em) => {
  if ((await modo(p)) !== 'download') await ateModo(p, 'download', 15000);
  await em(0.6); await marcar(p, '#velo', 'A escala cresce com a velocidade');
  await em(6.5); await limpar(p);
  await ateModo(p, 'upload', 20000);
});
if (quer('u06')) await cena(p, 'u06', alvo('u06', 0.4), async (em) => {
  await em(0.5); await marcar(p, '#etapas', 'Upload e estabilidade');
  await em(6.0); await limpar(p);
  await ateModo(p, 'fim', 40000); await espera(600);
});
if (quer('u07')) await cena(p, 'u07', alvo('u07'), async (em) => {
  await em(0.4); await marcar(p, '#velo', 'Concluído!');
  await em(3.4); await verNaTela(p, '.resultado-acoes', { margem: 300 }); await marcar(p, '.resultado-acoes', 'Testar de novo, copiar ou enviar');
  await em(7.6); await limpar(p);
});
if (quer('u08')) await cena(p, 'u08', alvo('u08'), async (em) => {
  await em(0.3); await rolarAte(p, '#r-titulo', { margem: 120 });
  await em(1.0); await marcar(p, '#r-titulo', 'Resumo em linguagem simples');
  await em(4.0); await verNaTela(p, '#r-usos'); await marcar(p, '#r-usos', 'O que a conexão aguenta');
  await em(8.8); await limpar(p);
});
if (quer('u09')) await cena(p, 'u09', alvo('u09'), async (em) => {
  await em(0.3); await rolarAte(p, '#leituras', { margem: 260 });
  await em(1.2); await marcar(p, '#leituras', 'As medidas, cada uma com avaliação');
  await em(7.6); await limpar(p);
});
if (quer('u10')) await cena(p, 'u10', alvo('u10'), async (em) => {
  await em(0.4); await verNaTela(p, '#conexao', { margem: 400 }); await marcar(p, '#conexao', 'Operadora e servidor');
  await em(3.6); await rolarAte(p, '#r-quando', { margem: 160 }); await marcar(p, '#r-quando', 'Protocolo: o suporte acha o seu teste');
  await em(7.4); await limpar(p);
});
if (quer('u11')) await cena(p, 'u11', alvo('u11'), async (em) => {
  await em(0.4); await marcar(p, '#copiar', 'Copiar o relatório');
  await em(1.6); await clicar(p, '#copiar');
  await em(3.6); await marcar(p, '#whatsapp', 'Enviar no WhatsApp'); await mover(p, '#whatsapp');
  await em(6.8); await limpar(p);
});
// diagnóstico completo: página nova, fora da gravação
if (quer('u12')) { await p.goto(B + '/', { waitUntil: 'networkidle2' }); await espera(1200); }
if (quer('u12')) await cena(p, 'u12', alvo('u12', 0.4), async (em) => {
  await em(0.6); await clicar(p, '#modos button[data-modo="completo"]');
  await em(2.2); await marcar(p, '#modos', 'Diagnóstico completo');
  await em(4.4); await limpar(p); await clicar(p, '#iniciar');
});
if (quer('u13')) { await ateModo(p, 'fim', 150000); await espera(4000); }
if (quer('u13')) await cena(p, 'u13', alvo('u13', 1.0), async (em) => {
  await em(0.2); await rolarAte(p, '#d-protocolos', { margem: 140, ms: 900 }); await marcar(p, '#d-protocolos', 'IPv4 e IPv6');
  await em(1.9); await verNaTela(p, '#d-servicos'); await marcar(p, '#d-servicos', 'Aplicativos');
  await em(3.4); await rolarAte(p, '#d-streaming', { margem: 160, ms: 700 }); await marcar(p, '#d-streaming', 'Streaming');
  await em(4.8); await verNaTela(p, '#d-iptv'); await marcar(p, '#d-iptv', 'TV ao vivo');
  await em(6.0); await rolarAte(p, '#d-bancos', { margem: 160, ms: 700 }); await marcar(p, '#d-bancos', 'Bancos e PIX');
  await em(8.0); await limpar(p);
});
if (quer('u14')) await cena(p, 'u14', alvo('u14'), async (em) => {
  await em(0.3); await rolarAte(p, '#d-relogio', { margem: 220 }); await marcar(p, '#d-relogio', 'Relógio do aparelho');
  await em(6.6); await limpar(p);
});
if (quer('u15')) await cena(p, 'u15', alvo('u15', 1.2), async (em) => {
  await em(0.3); await rolarPara(p, 0, 600);
  await em(1.0); await clicar(p, 'a[href="/entrar"]'); await p.waitForSelector('#aba-criar', { visible: true, timeout: 10000 }).catch(() => {});
  await em(2.0); await clicar(p, '#aba-criar');
  await em(2.6); await digitar(p, '#c-nome', 'Clara Souza', { atraso: 45 });
  await em(3.6); await marcar(p, '#c-nome-ajuda', 'Nome completo do titular, igual ao contrato');
  await em(5.2); await digitar(p, '#c-email', 'clara@exemplo.com.br', { atraso: 35 });
  await em(7.4); await limpar(p);
});
if (quer('u16')) await cena(p, 'u16', alvo('u16', 1.6), async (em) => {
  await em(0.3); await clicar(p, '#aba-entrar');
  await em(1.0); await digitar(p, '#e-email', 'clara@exemplo.com.br', { atraso: 35 });
  await em(2.4); await digitar(p, '#e-senha', SENHA, { atraso: 35 });
  await em(3.8); await marcar(p, '#form-entrar button[type="submit"]', 'Entrar');
  await em(4.6); await limpar(p); await clicar(p, '#form-entrar button[type="submit"]');
  await p.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {});
});
if (quer('u17')) { if (!p.url().includes('/painel')) await p.goto(B + '/painel', { waitUntil: 'networkidle2' }); await espera(1500); }
if (quer('u17')) await cena(p, 'u17', alvo('u17'), async (em) => {
  await em(0.5); await marcar(p, '#indicadores', 'Médias do período e o seu plano');
  await em(3.4); await marcar(p, '#g-tempo', 'Velocidade ao longo do tempo');
  await em(6.0); await marcar(p, '#ultimos', 'Últimos testes');
  await em(8.4); await limpar(p);
});
if (quer('u18')) await cena(p, 'u18', alvo('u18'), async (em) => {
  await em(0.3); await rolarAte(p, '#mapa', { margem: 200 }); await marcar(p, '#mapa', 'Onde você testou');
  await em(3.0); await verNaTela(p, '#g-hora'); await marcar(p, '#g-hora', 'Seu melhor horário');
  await em(6.2); await limpar(p);
});
if (quer('u19')) await cena(p, 'u19', alvo('u19', 1.4), async (em) => {
  await em(0.2); await rolarPara(p, 0, 700);
  await em(1.0); await clicar(p, '#t-historico');
  await em(2.2); await marcar(p, '#h-linhas', 'Todos os seus testes');
  await em(3.8); await limpar(p); await clicar(p, '#h-linhas tr.clicavel');
  await em(6.0); await p.evaluate(() => document.querySelector('dialog[open] #det-curva')?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
});
if (quer('u20')) await cena(p, 'u20', alvo('u20'), async (em) => {
  await em(0.2); await p.keyboard.press('Escape');
  await em(0.8); await clicar(p, '#t-conta');
  await em(1.8); await marcar(p, '#form-dados', 'Cadastro e plano contratado');
  await em(4.2); await verNaTela(p, '#form-senha'); await marcar(p, '#form-senha', 'Trocar a senha');
  await em(5.6); await verNaTela(p, '#sessoes'); await marcar(p, '#sessoes', 'Aparelhos conectados');
  await em(7.2); await verNaTela(p, '#baixar-dados'); await marcar(p, '#baixar-dados', 'Baixar ou excluir os seus dados');
  await em(9.2); await limpar(p);
});
if (quer('u21')) { await p.evaluate(() => { localStorage.removeItem('speedcjc.app'); sessionStorage.removeItem('speedcjc.app'); }); await p.goto(B + '/', { waitUntil: 'networkidle2' }); }
if (quer('u21')) await cena(p, 'u21', 10.6, async (em) => {
  await p.waitForSelector('dialog.app-convite[open]', { timeout: 12000 }).catch(() => console.log('  (convite não apareceu)'));
  await em(7.4); await mover(p, 'dialog.app-convite [data-r]');
});
if (quer('u22')) await cena(p, 'u22', alvo('u22'), async (em) => {
  await em(0.3); await p.keyboard.press('Escape');
  await em(1.2); await marcar(p, 'a[href="/painel"]', 'Com conta: tudo guardado no painel');
  await em(5.0); await marcar(p, '#iniciar', 'Teste à vontade');
  await em(8.6); await limpar(p);
});
await b.close();
