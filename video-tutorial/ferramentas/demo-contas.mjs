import puppeteer from 'puppeteer-core';
const SENHA = process.env.TUT_SENHA || 'Demo2026speed';
const B = process.env.TUT_URL || 'http://localhost:8098';
const b = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-gpu'] });
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
async function nova() { const c = await b.createBrowserContext(); const p = await c.newPage(); await p.evaluateOnNewDocument(() => { try { localStorage.setItem('speedcjc.cookies', 'recusado'); localStorage.setItem('speedcjc.app', '{"r":"instalado","em":1}'); } catch {} }); await p.setViewport({ width: 1366, height: 900 }); return p; }
// cadastros
for (const [nome, email, tel] of [['Roberto Lima', 'roberto@exemplo.com.br', '(34) 99876-5432'], ['Clara Souza', 'clara@exemplo.com.br', '(34) 99123-4567']]) {
  const p = await nova();
  await p.goto(B + '/entrar', { waitUntil: 'networkidle2' });
  await p.click('#aba-criar'); await espera(300);
  await p.type('#c-nome', nome); await p.type('#c-email', email); await p.type('#c-tel', tel);
  await p.type('#c-senha', SENHA); await p.type('#c-senha2', SENHA);
  await p.click('#c-termos');
  await p.click('.captcha-pow');
  await p.waitForFunction(() => document.querySelector('.captcha-pow')?.dataset.estado === 'ok', { timeout: 90000 }).catch(() => {});
  console.log('  captcha:', await p.evaluate(() => document.querySelector('.captcha-pow')?.dataset.estado));
  await espera(800);
  await Promise.all([p.waitForNetworkIdle().catch(() => {}), p.click('#form-criar button[type="submit"]')]);
  await espera(2500);
  console.log(nome, '→', p.url(), '|', (await p.evaluate(() => (document.querySelector('#form-criar .erro-form:not([hidden])')?.textContent || '').trim())) || 'ok');
}
await b.close();
