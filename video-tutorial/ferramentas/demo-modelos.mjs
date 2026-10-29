import puppeteer from 'puppeteer-core';
const SENHA = process.env.TUT_SENHA || 'Demo2026speed';
const B = process.env.TUT_URL || 'http://localhost:8098';
const b = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-gpu'] });
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
async function sessao(email, { lat, lng } = {}) {
  const c = await b.createBrowserContext();
  await c.overridePermissions(B, ['geolocation']);
  const p = await c.newPage();
  await p.evaluateOnNewDocument(() => { try { localStorage.setItem('speedcjc.cookies', 'recusado'); localStorage.setItem('speedcjc.app', '{"r":"instalado","em":1}'); localStorage.setItem('speedcjc.local', '"sim"'); localStorage.setItem('speedcjc.local-perguntado', String(Date.now())); } catch {} });
  if (lat) await p.setGeolocation({ latitude: lat, longitude: lng, accuracy: 25 });
  const cdp = await p.createCDPSession(); await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 9, downloadThroughput: 520e6 / 8, uploadThroughput: 260e6 / 8 });
  await p.setViewport({ width: 1600, height: 1000 });
  await p.goto(B + '/entrar', { waitUntil: 'networkidle2' });
  await p.type('#e-email', email); await p.type('#e-senha', SENHA);
  await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), p.click('#form-entrar button[type="submit"]')]);
  return p;
}
async function testar(p, url, modo, antes) {
  await p.goto(B + url, { waitUntil: 'networkidle2' }); await espera(800);
  if (antes) await antes(p);
  await p.click(`#modos button[data-modo="${modo}"]`);
  await p.click('#iniciar');
  await p.waitForFunction(() => document.querySelector('#velo').dataset.modo === 'fim', { timeout: 240000 });
  await espera(modo === 'completo' ? 4000 : 2500);
  console.log(url, modo, '→', await p.evaluate(() => [document.querySelector('#v-download')?.textContent, document.querySelector('#v-upload')?.textContent, document.querySelector('#r-quando')?.textContent].join(' | ')));
}
const clara = await sessao('clara@exemplo.com.br', { lat: -18.9186, lng: -48.2560 });
await testar(clara, '/', 'rapido');
await testar(clara, '/', 'completo');
const roberto = await sessao('roberto@exemplo.com.br', { lat: -18.9020, lng: -48.2710 });
await testar(roberto, '/tecnico', 'completo', async (p) => {
  const aberto = await p.$eval('#atendimento', (e) => e.open).catch(() => true);
  if (!aberto) await p.click('#atendimento summary');
  await p.type('#at-cliente', 'Clara Souza — contrato 4521'); await p.type('#at-plano', '300'); await p.type('#at-obs', 'Teste no cabo, roteador da sala');
});
await b.close();
