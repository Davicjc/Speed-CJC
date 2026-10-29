// Ferramentas de gravação do tutorial: cursor animado, destaque e cenas gravadas.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
// pasta de trabalho (gravações, vozes, banco de demonstração) e endereço do servidor de demonstração
export const W = process.env.TUT_DIR || fileURLToPath(new URL('../trabalho', import.meta.url));
export const B = process.env.TUT_URL || 'http://localhost:8098';
export const G = W + '/gravacoes';
export const espera = (ms) => new Promise((r) => setTimeout(r, ms));
export const duracao = (arq) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', arq]).toString().trim());

const SOBREPOSICAO = `(() => {
  if (window.__tut) return;
  const pronto = () => {
    if (document.getElementById('tut-cursor')) return;
    const st = document.createElement('style');
    st.textContent = \`#tut-cursor{position:fixed;left:0;top:0;width:34px;height:34px;z-index:2147483647;pointer-events:none;will-change:transform;filter:drop-shadow(0 4px 8px rgba(0,0,0,.55))}
#tut-marca{position:fixed;z-index:2147483645;pointer-events:none;border:3px solid #FFC93C;border-radius:14px;box-shadow:0 0 0 9999px rgba(2,6,20,.38),0 0 26px rgba(255,201,60,.55);opacity:0;transition:opacity .35s}
#tut-rotulo{position:fixed;z-index:2147483646;pointer-events:none;background:#FFC93C;color:#1d1500;font:700 22px/1.2 Inter,system-ui,sans-serif;padding:9px 16px;border-radius:10px;box-shadow:0 10px 28px rgba(0,0,0,.45);opacity:0;transition:opacity .3s;white-space:nowrap}
.tut-onda{position:fixed;z-index:2147483646;pointer-events:none;width:46px;height:46px;margin:-23px 0 0 -23px;border-radius:50%;border:4px solid #FFC93C;animation:tut-onda .55s ease-out forwards}
@keyframes tut-onda{from{transform:scale(.3);opacity:1}to{transform:scale(1.7);opacity:0}}\`;
    document.head.appendChild(st);
    const c = document.createElement('div'); c.id = 'tut-cursor';
    c.innerHTML = '<svg viewBox="0 0 24 24" width="34" height="34"><path d="M4 2.5v17.2l4.6-4.3 3.1 6.9 3-1.3-3.1-6.8 6.3-.5z" fill="#fff" stroke="#0b1020" stroke-width="1.4" stroke-linejoin="round"/></svg>';
    document.body.appendChild(c);
    const m = document.createElement('div'); m.id = 'tut-marca'; document.body.appendChild(m);
    const r = document.createElement('div'); r.id = 'tut-rotulo'; document.body.appendChild(r);
    const pos = JSON.parse(sessionStorage.getItem('tut-pos') || '{"x":1200,"y":700}');
    window.__tut.x = pos.x; window.__tut.y = pos.y; window.__tut.pintar();
  };
  window.__tut = {
    x: 1200, y: 700, alvo: null, rotulo: '', lado: 'baixo',
    pintar() { const c = document.getElementById('tut-cursor'); if (c) c.style.transform = 'translate(' + (this.x - 4) + 'px,' + (this.y - 3) + 'px)'; sessionStorage.setItem('tut-pos', JSON.stringify({ x: this.x, y: this.y })); },
    ir(x, y, ms) { return new Promise((ok) => { const x0 = this.x, y0 = this.y, t0 = performance.now(); const passo = (t) => { const k = Math.min(1, (t - t0) / ms); const e = k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2; this.x = x0 + (x - x0) * e; this.y = y0 + (y - y0) * e; this.pintar(); if (k < 1) requestAnimationFrame(passo); else ok(); }; requestAnimationFrame(passo); }); },
    clique() { const o = document.createElement('div'); o.className = 'tut-onda'; o.style.left = this.x + 'px'; o.style.top = this.y + 'px'; document.body.appendChild(o); setTimeout(() => o.remove(), 700); },
    marcar(sel, rotulo, lado) { this.alvo = sel; this.rotulo = rotulo || ''; this.lado = lado || 'baixo'; const r = document.getElementById('tut-rotulo'); if (r) { r.textContent = this.rotulo; r.style.display = this.rotulo ? '' : 'none'; } },
    limpar() { this.alvo = null; },
    rolar(y, ms) { return new Promise((ok) => { const y0 = scrollY, t0 = performance.now(); const passo = (t) => { const k = Math.min(1, (t - t0) / ms); const e = k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2; scrollTo(0, y0 + (y - y0) * e); if (k < 1) requestAnimationFrame(passo); else ok(); }; requestAnimationFrame(passo); }); },
    rolarEm(sel, y, ms) { const el = document.querySelector(sel); if (!el) return Promise.resolve(); return new Promise((ok) => { const y0 = el.scrollTop, t0 = performance.now(); const passo = (t) => { const k = Math.min(1, (t - t0) / ms); const e = k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2; el.scrollTop = y0 + (y - y0) * e; if (k < 1) requestAnimationFrame(passo); else ok(); }; requestAnimationFrame(passo); }); },
  };
  const laco = () => {
    const abertos = document.querySelectorAll('dialog[open]');
    const casa = abertos.length ? abertos[abertos.length - 1] : document.body;
    for (const id of ['tut-marca', 'tut-rotulo', 'tut-cursor']) { const el = document.getElementById(id); if (el && el.parentNode !== casa) casa.appendChild(el); }
    const m = document.getElementById('tut-marca'), r = document.getElementById('tut-rotulo');
    if (m && r) {
      const el = window.__tut.alvo && document.querySelector(window.__tut.alvo);
      if (el) { const b = el.getBoundingClientRect(); const f = 8; m.style.left = (b.left - f) + 'px'; m.style.top = (b.top - f) + 'px'; m.style.width = (b.width + 2 * f) + 'px'; m.style.height = (b.height + 2 * f) + 'px'; m.style.opacity = 1;
        r.style.opacity = window.__tut.rotulo ? 1 : 0; const rw = r.offsetWidth, rh = r.offsetHeight; let lx = Math.max(16, Math.min(innerWidth - rw - 16, b.left)); let ly = window.__tut.lado === 'cima' ? b.top - f - rh - 12 : b.bottom + f + 12; if (ly + rh > innerHeight - 10) ly = b.top - f - rh - 12; if (ly < 10) ly = Math.min(innerHeight - rh - 10, b.bottom + f + 12); r.style.left = lx + 'px'; r.style.top = ly + 'px'; }
      else { m.style.opacity = 0; r.style.opacity = 0; }
    }
    requestAnimationFrame(laco);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { pronto(); laco(); }); else { pronto(); laco(); }
})();`;

const MAQUIAGEM = `(() => {
  const trocas = [[/Rede local \\(sem passar pela internet\\)/g, 'Minha Operadora'], [/^::1$/g, '203.0.113.47'], [/\\b::1\\b/g, '203.0.113.47'], [/^Rede interna$/g, 'Santa Mônica, Uberlândia - MG']];
  const trocar = (n) => { let t = n.nodeValue, o = t; for (const [re, v] of trocas) t = t.replace(re, v); if (t !== o) n.nodeValue = t; };
  const varrer = (raiz) => { const w = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) trocar(n); };
  const ligar = () => { varrer(document.body); new MutationObserver((ms) => { for (const m of ms) { if (m.type === 'characterData') trocar(m.target); else m.addedNodes.forEach((n) => n.nodeType === 3 ? trocar(n) : n.nodeType === 1 && varrer(n)); } }).observe(document.body, { subtree: true, childList: true, characterData: true }); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ligar); else ligar();
})();`;

export async function abrir({ local = {}, geo, limite = true, maquiar = true } = {}) {
  const b = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--window-size=1920,1080', '--force-device-scale-factor=1'] });
  const ctx = b.defaultBrowserContext();
  await ctx.overridePermissions(B, ['geolocation', 'clipboard-read', 'clipboard-write']);
  const p = await b.newPage();
  await p.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
  const base = { 'speedcjc.cookies': 'recusado', 'speedcjc.app': '{"r":"instalado","em":1}', 'speedcjc.local': '"nao"', 'speedcjc.local-perguntado': String(Date.now()), ...local };
  await p.evaluateOnNewDocument((base) => { try { if (!sessionStorage.getItem('tut-base')) { for (const [k, v] of Object.entries(base)) if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); sessionStorage.setItem('tut-base', '1'); } } catch {} }, base);
  await p.evaluateOnNewDocument(SOBREPOSICAO);
  if (maquiar) await p.evaluateOnNewDocument(MAQUIAGEM);
  if (geo) await p.setGeolocation({ latitude: geo[0], longitude: geo[1], accuracy: 20 });
  if (limite) { const cdp = await p.createCDPSession(); await cdp.send('Network.enable'); await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 9, downloadThroughput: 500e6 / 8, uploadThroughput: 250e6 / 8 }); }
  return { b, p };
}

// ---------- ações ----------
export async function centro(p, sel) {
  return p.evaluate((sel) => { const el = document.querySelector(sel); if (!el) return null; const b = el.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + Math.min(b.height / 2, 40), topo: b.top, alto: b.height }; }, sel);
}
export async function verNaTela(p, sel, { ms = 900, margem = 160 } = {}) {
  const c = await centro(p, sel); if (!c) return;
  const naJanela = await p.evaluate((sel) => !!document.querySelector(sel)?.closest('dialog'), sel);
  if (naJanela) { if (c.topo < 90 || c.topo + Math.min(c.alto, 400) > 1000) { await p.evaluate((sel) => document.querySelector(sel).scrollIntoView({ behavior: 'smooth', block: 'center' }), sel); await espera(700); } return; }
  if (c.topo < margem || c.topo + Math.min(c.alto, 500) > 1080 - 80) {
    const y = await p.evaluate((sel, margem) => scrollY + document.querySelector(sel).getBoundingClientRect().top - margem, sel, margem);
    await p.evaluate((y, ms) => window.__tut.rolar(Math.max(0, y), ms), y, ms);
  }
}
export async function mover(p, sel, ms = 750) {
  const c = typeof sel === 'string' ? await centro(p, sel) : sel; if (!c) return;
  await p.evaluate((x, y, ms) => window.__tut.ir(x, y, ms), c.x, c.y, ms);
}
export async function clicar(p, sel, { ms = 750, rolar = true } = {}) {
  if (rolar) await verNaTela(p, sel);
  await mover(p, sel, ms); await espera(120);
  await p.evaluate(() => window.__tut.clique());
  await p.click(sel).catch((e) => console.log('  (clique falhou em', sel, e.message, ')'));
}
export async function digitar(p, sel, texto, { atraso = 55 } = {}) { await clicar(p, sel); await espera(150); await p.type(sel, texto, { delay: atraso }); }
export const marcar = (p, sel, rotulo, lado) => p.evaluate((s, r, l) => window.__tut.marcar(s, r, l), sel, rotulo || '', lado || 'baixo');
export const limpar = (p) => p.evaluate(() => window.__tut.limpar());
export const rolarPara = (p, y, ms = 900) => p.evaluate((y, ms) => window.__tut.rolar(y, ms), y, ms);
export async function rolarAte(p, sel, { margem = 140, ms = 1000 } = {}) {
  if (await p.evaluate((sel) => !!document.querySelector(sel)?.closest('dialog'), sel)) { await p.evaluate((sel) => document.querySelector(sel).scrollIntoView({ behavior: 'smooth', block: 'start' }), sel); await espera(ms); return; }
  const y = await p.evaluate((sel, m) => { const el = document.querySelector(sel); return el ? scrollY + el.getBoundingClientRect().top - m : null; }, sel, margem);
  if (y != null) await rolarPara(p, Math.max(0, y), ms);
}

// ---------- gravação: quadros do Chrome com o horário de cada um ----------
export async function gravador(p, dir) {
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const cdp = await p.createCDPSession();
  const quadros = []; let n = 0;
  cdp.on('Page.screencastFrame', (f) => {
    const arq = `${dir}/q${String(n++).padStart(6, '0')}.jpg`;
    fs.writeFileSync(arq, Buffer.from(f.data, 'base64'));
    quadros.push({ arq, t: f.metadata.timestamp });
    cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 90, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
  const t0 = Date.now() / 1000;
  return {
    async parar(saida) {
      const tfim = Date.now() / 1000;
      await cdp.send('Page.stopScreencast').catch(() => {});
      await espera(200);
      if (!quadros.length) throw new Error('nenhum quadro');
      const linhas = [];
      quadros.forEach((q, i) => {
        const ini = i === 0 ? t0 : q.t;
        const prox = i + 1 < quadros.length ? quadros[i + 1].t : tfim;
        linhas.push(`file '${q.arq}'`, `duration ${Math.max(0.001, prox - ini).toFixed(4)}`);
      });
      linhas.push(`file '${quadros[quadros.length - 1].arq}'`);
      fs.writeFileSync(`${dir}/lista.txt`, linhas.join('\n'));
      execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', `${dir}/lista.txt`, '-vf', 'fps=30,scale=1920:1080:flags=lanczos,format=yuv420p', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '17', '-movflags', '+faststart', saida]);
      fs.rmSync(dir, { recursive: true, force: true });
      return { duracao: tfim - t0, quadros: quadros.length };
    },
  };
}

// ---------- uma cena ----------
export async function cena(p, id, alvoS, acoes, { depois } = {}) {
  const arq = `${G}/${id}.mp4`;
  const rec = await gravador(p, `${G}/_q-${id}`);
  const t0 = Date.now();
  const em = (s) => { const r = s * 1000 - (Date.now() - t0); return r > 0 ? espera(r) : Promise.resolve(); };
  try { await acoes(em); } catch (e) { console.log('  ERRO na cena', id, e.message); }
  await em(alvoS);
  const info = await rec.parar(arq);
  const meta = { id, gravado: info.duracao, quadros: info.quadros, arquivo: duracao(arq), url: p.url().replace(B, '') };
  fs.writeFileSync(`${G}/${id}.json`, JSON.stringify(meta));
  console.log(`  ${id}: alvo ${alvoS.toFixed(1)}s, gravado ${info.duracao.toFixed(1)}s (${info.quadros} quadros), arquivo ${meta.arquivo.toFixed(1)}s, ${meta.url}`);
  if (depois) await depois();
  return meta;
}
export function falas() {
  return Object.fromEntries(fs.readdirSync(W + '/voz-cenas').filter((f) => f.endsWith('.wav')).map((f) => [f.slice(0, -4), duracao(`${W}/voz-cenas/${f}`)]));
}
