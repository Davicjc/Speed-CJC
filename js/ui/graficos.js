// Gráficos em SVG puro: linhas (com mira e dica ao passar o mouse/dedo) e
// colunas. Traço de 2 px, grade discreta, rótulo só no fim de cada linha,
// legenda sempre que houver mais de uma série. Um eixo só.

import { esc } from '../core/util.js';

const NS = 'http://www.w3.org/2000/svg';
const el = (n, a = {}, pai) => { const e = document.createElementNS(NS, n); for (const [k, v] of Object.entries(a)) e.setAttribute(k, v); if (pai) pai.appendChild(e); return e; };

function passoBonito(max, alvo = 4) {
    if (!(max > 0)) return 1;
    const bruto = max / alvo;
    const pot = 10 ** Math.floor(Math.log10(bruto));
    const n = bruto / pot;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * pot;
}

function observar(alvo, desenhar) {
    let w = 0;
    const ro = new ResizeObserver(() => {
        const nw = alvo.clientWidth;
        if (nw && Math.abs(nw - w) > 2) { w = nw; desenhar(nw); }
    });
    ro.observe(alvo);
    const largura = alvo.clientWidth;
    if (largura) { w = largura; desenhar(largura); }
    return () => ro.disconnect();
}

function dica(alvo) {
    let d = alvo.querySelector('.dica');
    if (!d) { d = document.createElement('div'); d.className = 'dica'; d.hidden = true; alvo.appendChild(d); }
    return d;
}

/**
 * series: [{ nome, cor, pontos: [{x, y}], tracejado?, area? }]
 * x numérico (ex.: instante em ms ou índice). Pontos com y null criam lacunas.
 */
export function graficoLinhas(alvo, { series, altura = 220, formatoY = (v) => String(v), formatoEixo, formatoX = (v) => String(v), formatoDica, yMin = 0, rotuloFim = true, marcadores = false } = {}) {
    const fEixo = formatoEixo || formatoY;
    alvo.classList.add('grafico');
    alvo.style.height = altura + 'px';
    const todas = series.flatMap((s) => s.pontos.filter((p) => p.y != null));
    if (!todas.length) {
        alvo.innerHTML = '<div class="vazio" style="padding:24px"><span>Sem dados para mostrar.</span></div>';
        return () => {};
    }
    return observar(alvo, (W) => {
        alvo.querySelectorAll('svg').forEach((s) => s.remove());
        const H = altura;
        const m = { t: 12, r: rotuloFim ? 64 : 14, b: 26, l: 46 };
        const xs = todas.map((p) => p.x);
        const x0 = Math.min(...xs), x1 = Math.max(...xs);
        const yMax = Math.max(...todas.map((p) => p.y));
        const passo = passoBonito(yMax - yMin, 4);
        const topo = Math.max(passo, Math.ceil(yMax / passo) * passo);
        const X = (x) => m.l + (x1 === x0 ? (W - m.l - m.r) / 2 : ((x - x0) / (x1 - x0)) * (W - m.l - m.r));
        const Y = (y) => m.t + (1 - (y - yMin) / (topo - yMin || 1)) * (H - m.t - m.b);

        const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', 'aria-label': series.map((s) => s.nome).join(' e ') });
        const grade = el('g', { class: 'grade' }, svg);
        const eixo = el('g', { class: 'eixo' }, svg);
        for (let v = yMin; v <= topo + 1e-9; v += passo) {
            el('line', { x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v) }, grade);
            const t = el('text', { x: m.l - 8, y: Y(v) + 4, 'text-anchor': 'end' }, eixo);
            t.textContent = fEixo(v);
        }
        const nx = Math.max(2, Math.min(6, Math.floor((W - m.l - m.r) / 90)));
        const xsUnicos = [...new Set(xs)].sort((a, b) => a - b);
        for (let i = 0; i < nx; i++) {
            const x = x0 + ((x1 - x0) * i) / (nx - 1 || 1);
            const t = el('text', { x: X(x), y: H - 6, 'text-anchor': i === 0 ? 'start' : i === nx - 1 ? 'end' : 'middle' }, eixo);
            t.textContent = formatoX(x);
            if (x1 === x0) break;
        }

        for (const s of series) {
            const pts = s.pontos.filter((p) => p.y != null).sort((a, b) => a.x - b.x);
            if (!pts.length) continue;
            const d = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join(' ');
            if (s.area) {
                el('path', { d: `${d} L${X(pts[pts.length - 1].x).toFixed(1)},${Y(yMin)} L${X(pts[0].x).toFixed(1)},${Y(yMin)} Z`, fill: s.cor, class: 'area-serie' }, svg);
            }
            el('path', { d, class: 'linha-serie', stroke: s.cor, ...(s.tracejado ? { 'stroke-dasharray': '5 4' } : {}) }, svg);
            if (marcadores || pts.length === 1) {
                for (const p of pts) el('circle', { cx: X(p.x), cy: Y(p.y), r: 4, fill: s.cor, class: 'ponto-mira' }, svg);
            }
            if (rotuloFim) {
                const u = pts[pts.length - 1];
                el('circle', { cx: X(u.x), cy: Y(u.y), r: 4, fill: s.cor, class: 'ponto-mira' }, svg);
                const t = el('text', { x: X(u.x) + 9, y: Y(u.y) + 4, class: 'rotulo-fim' }, svg);
                t.textContent = formatoY(u.y);
            }
        }

        // camada de interação
        const mira = el('line', { class: 'mira', y1: m.t, y2: H - m.b, visibility: 'hidden' }, svg);
        const pontos = series.map((s) => el('circle', { r: 5, fill: s.cor, class: 'ponto-mira', visibility: 'hidden' }, svg));
        const area = el('rect', { x: m.l, y: 0, width: Math.max(1, W - m.l - m.r), height: H, fill: 'transparent' }, svg);
        const caixa = dica(alvo);
        const mover = (ev) => {
            const r = svg.getBoundingClientRect();
            const px = ev.clientX - r.left;
            let melhor = xsUnicos[0], dist = Infinity;
            for (const x of xsUnicos) { const dd = Math.abs(X(x) - px); if (dd < dist) { dist = dd; melhor = x; } }
            mira.setAttribute('x1', X(melhor)); mira.setAttribute('x2', X(melhor)); mira.setAttribute('visibility', 'visible');
            const linhas = [];
            series.forEach((s, i) => {
                const p = s.pontos.find((q) => q.x === melhor && q.y != null);
                if (p) {
                    pontos[i].setAttribute('cx', X(p.x)); pontos[i].setAttribute('cy', Y(p.y)); pontos[i].setAttribute('visibility', 'visible');
                    linhas.push(`<span class="lin"><i style="background:${s.cor}"></i>${esc(s.nome)}<b>${esc(formatoY(p.y))}</b></span>`);
                } else pontos[i].setAttribute('visibility', 'hidden');
            });
            caixa.innerHTML = `<strong>${esc(formatoDica ? formatoDica(melhor) : formatoX(melhor))}</strong>${linhas.join('')}`;
            caixa.hidden = false;
            const yTopo = Math.min(...series.map((s) => { const p = s.pontos.find((q) => q.x === melhor && q.y != null); return p ? Y(p.y) : H; }));
            caixa.style.left = Math.min(Math.max(X(melhor), 80), W - 80) + 'px';
            caixa.style.top = Math.max(yTopo, 40) + 'px';
        };
        const sair = () => { mira.setAttribute('visibility', 'hidden'); pontos.forEach((p) => p.setAttribute('visibility', 'hidden')); caixa.hidden = true; };
        area.addEventListener('pointermove', mover);
        area.addEventListener('pointerdown', mover);
        area.addEventListener('pointerleave', sair);
        alvo.prepend(svg);
    });
}

/** Colunas: itens [{ x: rótulo curto, y, dica? }]. Uma série, uma cor. */
export function graficoColunas(alvo, { itens, cor = 'var(--serie-volume)', altura = 200, formatoY = (v) => String(v), formatoEixo, formatoDica } = {}) {
    const fEixo = formatoEixo || formatoY;
    alvo.classList.add('grafico');
    alvo.style.height = altura + 'px';
    if (!itens.length) { alvo.innerHTML = '<div class="vazio" style="padding:24px"><span>Sem dados no período.</span></div>'; return () => {}; }
    return observar(alvo, (W) => {
        alvo.querySelectorAll('svg').forEach((s) => s.remove());
        const H = altura;
        const m = { t: 12, r: 8, b: 26, l: 40 };
        const yMax = Math.max(...itens.map((i) => i.y || 0));
        const passo = passoBonito(yMax, 4);
        const topo = Math.max(passo, Math.ceil(yMax / passo) * passo);
        const Y = (y) => m.t + (1 - y / topo) * (H - m.t - m.b);
        const banda = (W - m.l - m.r) / itens.length;
        const larg = Math.max(2, Math.min(24, banda - 2));
        const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img' });
        const grade = el('g', { class: 'grade' }, svg);
        const eixo = el('g', { class: 'eixo' }, svg);
        for (let v = 0; v <= topo + 1e-9; v += passo) {
            el('line', { x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v) }, grade);
            const t = el('text', { x: m.l - 8, y: Y(v) + 4, 'text-anchor': 'end' }, eixo);
            t.textContent = fEixo(v);
        }
        const cada = Math.ceil(itens.length / Math.max(2, Math.floor((W - m.l - m.r) / 54)));
        const caixa = dica(alvo);
        itens.forEach((it, i) => {
            const cx = m.l + banda * i + banda / 2;
            const y = it.y || 0;
            if (y > 0) {
                const h = Math.max(2, Y(0) - Y(y));
                const r = Math.min(4, larg / 2, h);
                const x = cx - larg / 2, yt = Y(0) - h;
                // ponta arredondada (4 px) e base reta, como pede a especificação
                const d = `M${x},${Y(0)} L${x},${yt + r} Q${x},${yt} ${x + r},${yt} L${x + larg - r},${yt} Q${x + larg},${yt} ${x + larg},${yt + r} L${x + larg},${Y(0)} Z`;
                el('path', { d, fill: cor, class: 'barra' }, svg);
            }
            if (i % cada === 0) {
                const t = el('text', { x: cx, y: H - 6, 'text-anchor': 'middle' }, eixo);
                t.textContent = it.x;
            }
            const alvoHover = el('rect', { x: m.l + banda * i, y: m.t, width: banda, height: H - m.t - m.b, fill: 'transparent' }, svg);
            const mostrar = () => {
                caixa.innerHTML = formatoDica ? formatoDica(it) : `<strong>${esc(it.x)}</strong>${esc(formatoY(y))}`;
                caixa.hidden = false;
                caixa.style.left = Math.min(Math.max(cx, 70), W - 70) + 'px';
                caixa.style.top = Math.max(Y(y), 40) + 'px';
            };
            alvoHover.addEventListener('pointerenter', mostrar);
            alvoHover.addEventListener('pointerdown', mostrar);
            alvoHover.addEventListener('pointerleave', () => { caixa.hidden = true; });
        });
        alvo.prepend(svg);
    });
}

/** Barras horizontais em HTML (tempo até serviços, ranking de operadoras). */
export function barrasHorizontais(alvo, itens, { formato = (v) => String(v), maximo, cor = 'var(--serie-download)', nivel } = {}) {
    const max = maximo || Math.max(1, ...itens.map((i) => i.valor || 0));
    alvo.innerHTML = `<ul class="barras-h">${itens.map((i) => {
        const pct = i.valor == null ? 0 : Math.max(2, (i.valor / max) * 100);
        const n = nivel ? nivel(i.valor) : null;
        return `<li><span class="bh-nome">${esc(i.nome)}</span>
            <span class="bh-trilho"><span class="bh-barra" style="width:${pct}%;background:${cor}"></span></span>
            <span class="bh-valor num">${i.valor == null ? esc(i.vazio || '–') : esc(formato(i.valor))}</span>
            ${n ? `<span class="selo ${n.nivel}">${esc(n.rotulo)}</span>` : ''}</li>`;
    }).join('')}</ul>`;
}
