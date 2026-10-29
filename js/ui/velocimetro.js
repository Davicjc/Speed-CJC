// Velocímetro: arco de 270° com a "luz de horizonte" do site da Audicom.
// Parado, um crescente de luz contorna a borda; no teste, o arco de valor
// acende na cor da etapa (download ciano, upload violeta).

const NS = 'http://www.w3.org/2000/svg';
const CX = 200, CY = 200, R = 160;
const INICIO = 135, VARREDURA = 270;
// Escala que cresce: começa em 50 e, quando a velocidade passa do topo, sobe
// para a próxima. O ponteiro fica sempre da metade do arco para cima, então
// quem testa vê o arco cheio em vez de um risquinho no começo de uma escala de 1G.
const ESCALAS = [
    [0, 10, 20, 30, 40, 50],
    [0, 20, 40, 60, 80, 100],
    [0, 50, 100, 150, 200],
    [0, 50, 100, 150, 200, 250, 300],
    [0, 100, 200, 300, 400, 500],
    [0, 100, 200, 300, 400, 500, 600, 700],
    [0, 200, 400, 600, 800, 1000],
    [0, 300, 600, 900, 1200, 1500],
    [0, 500, 1000, 1500, 2000, 2500],
    [0, 1000, 2000, 3000, 4000, 5000],
    [0, 2000, 4000, 6000, 8000, 10000],
];

const rad = (g) => (g * Math.PI) / 180;
const ponto = (ang, r = R) => [CX + r * Math.cos(rad(ang)), CY + r * Math.sin(rad(ang))];

function arco(a0, a1, r = R) {
    const [x0, y0] = ponto(a0, r);
    const [x1, y1] = ponto(a1, r);
    const grande = a1 - a0 > 180 ? 1 : 0;
    return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${grande} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

function el(nome, attrs = {}, pai) {
    const e = document.createElementNS(NS, nome);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    if (pai) pai.appendChild(e);
    return e;
}

// cores do arco vêm do tema da página (variáveis --velo-*), com o azul da marca como padrão
const cor = (nome, padrao) => getComputedStyle(document.body).getPropertyValue(nome).trim() || padrao;

export function criarVelocimetro(alvo) {
    let nivel = 0;
    let escala = ESCALAS[0];
    const svg = el('svg', { viewBox: '0 0 400 400', class: 'velo-svg', role: 'img', 'aria-hidden': 'true' });
    const defs = el('defs', {}, svg);
    const gradDl = el('linearGradient', { id: 'grad-dl', x1: '0', y1: '1', x2: '1', y2: '0' }, defs);
    el('stop', { offset: '0', 'stop-color': cor('--velo-dl-1', '#1B3FD8') }, gradDl);
    el('stop', { offset: '1', 'stop-color': cor('--velo-dl-2', '#00D4FF') }, gradDl);
    const gradUl = el('linearGradient', { id: 'grad-ul', x1: '0', y1: '1', x2: '1', y2: '0' }, defs);
    el('stop', { offset: '0', 'stop-color': cor('--velo-ul-1', '#2B3FD8') }, gradUl);
    el('stop', { offset: '1', 'stop-color': cor('--velo-ul-2', '#A08BFF') }, gradUl);
    const gradHz = el('linearGradient', { id: 'grad-hz', x1: '0', y1: '0', x2: '1', y2: '1' }, defs);
    el('stop', { offset: '0', 'stop-color': '#7FA2FF', 'stop-opacity': '0' }, gradHz);
    el('stop', { offset: '0.55', 'stop-color': '#E6EEFF', 'stop-opacity': '1' }, gradHz);
    el('stop', { offset: '1', 'stop-color': '#7FA2FF', 'stop-opacity': '0' }, gradHz);
    const brilho = el('filter', { id: 'brilho', x: '-30%', y: '-30%', width: '160%', height: '160%' }, defs);
    el('feGaussianBlur', { stdDeviation: '7' }, brilho);
    const fundoDisco = el('radialGradient', { id: 'disco', cx: '50%', cy: '45%', r: '55%' }, defs);
    el('stop', { offset: '0', 'stop-color': cor('--velo-disco', '#0E2463'), 'stop-opacity': '0.85' }, fundoDisco);
    el('stop', { offset: '1', 'stop-color': cor('--navy-800', '#081535'), 'stop-opacity': '0' }, fundoDisco);

    el('circle', { cx: CX, cy: CY, r: 182, fill: 'url(#disco)' }, svg);
    el('circle', { cx: CX, cy: CY, r: 182, fill: 'none', stroke: 'rgba(244,246,249,0.06)', 'stroke-width': '1' }, svg);

    // luz de horizonte (crescente na borda inferior esquerda)
    const horizonte = el('g', { class: 'velo-horizonte' }, svg);
    el('path', { d: arco(70, 230, 182), fill: 'none', stroke: 'url(#grad-hz)', 'stroke-width': '10', filter: 'url(#brilho)', opacity: '0.7' }, horizonte);
    el('path', { d: arco(70, 230, 182), fill: 'none', stroke: 'url(#grad-hz)', 'stroke-width': '2.2', 'stroke-linecap': 'round' }, horizonte);

    // trilho e marcas
    el('path', { d: arco(INICIO, INICIO + VARREDURA), fill: 'none', stroke: 'rgba(244,246,249,0.08)', 'stroke-width': '14', 'stroke-linecap': 'round', class: 'velo-trilho' }, svg);
    const marcas = el('g', { class: 'velo-marcas' }, svg);

    // valor
    const brilhoValor = el('path', { d: '', fill: 'none', stroke: 'url(#grad-dl)', 'stroke-width': '18', 'stroke-linecap': 'round', filter: 'url(#brilho)', opacity: '0.55' }, svg);
    const valorArco = el('path', { d: '', fill: 'none', stroke: 'url(#grad-dl)', 'stroke-width': '14', 'stroke-linecap': 'round' }, svg);
    const ponta = el('circle', { cx: 0, cy: 0, r: '6', fill: '#fff', opacity: '0' }, svg);

    function desenharMarcas() {
        marcas.innerHTML = '';
        escala.forEach((v, i) => {
            const ang = INICIO + (VARREDURA * i) / (escala.length - 1);
            const [x0, y0] = ponto(ang, 142);
            const [x1, y1] = ponto(ang, 134);
            el('line', { x1: x0, y1: y0, x2: x1, y2: y1, stroke: 'rgba(244,246,249,0.28)', 'stroke-width': '1.5', 'stroke-linecap': 'round' }, marcas);
            const [tx, ty] = ponto(ang, 116);
            const t = el('text', { x: tx, y: ty + 4, 'text-anchor': 'middle', class: 'velo-marca-texto' }, marcas);
            t.textContent = v >= 1000 ? (v / 1000) + 'G' : String(v);
        });
    }
    desenharMarcas();

    function fracao(v) {
        if (!(v > 0)) return 0;
        const s = escala;
        if (v >= s[s.length - 1]) return 1;
        for (let i = 1; i < s.length; i++) {
            if (v <= s[i]) return (i - 1 + (v - s[i - 1]) / (s[i] - s[i - 1])) / (s.length - 1);
        }
        return 1;
    }

    alvo.prepend(svg);

    let atual = 0, destino = 0, raf = 0, modo = 'ocioso';
    const calmo = matchMedia('(prefers-reduced-motion: reduce)').matches;

    function pintar() {
        const f = fracao(atual);
        if (f <= 0.001) {
            valorArco.setAttribute('d', '');
            brilhoValor.setAttribute('d', '');
            ponta.setAttribute('opacity', '0');
            return;
        }
        const fim = INICIO + VARREDURA * f;
        const d = arco(INICIO, Math.max(INICIO + 0.5, fim));
        valorArco.setAttribute('d', d);
        brilhoValor.setAttribute('d', d);
        const [px, py] = ponto(fim);
        ponta.setAttribute('cx', px.toFixed(2));
        ponta.setAttribute('cy', py.toFixed(2));
        ponta.setAttribute('opacity', '1');
    }

    function animar() {
        raf = 0;
        const dif = destino - atual;
        if (Math.abs(dif) < Math.max(0.01, destino * 0.001) || calmo) { atual = destino; pintar(); return; }
        atual += dif * 0.14;
        pintar();
        raf = requestAnimationFrame(animar);
    }

    return {
        /** 'ocioso' | 'ping' | 'download' | 'upload' | 'fim' */
        modo(m) {
            modo = m;
            alvo.dataset.modo = m;
            const grad = m === 'upload' ? 'url(#grad-ul)' : 'url(#grad-dl)';
            valorArco.setAttribute('stroke', grad);
            brilhoValor.setAttribute('stroke', grad);
            // cada etapa começa na escala de 50 (o upload costuma ser menor que o download)
            if (m === 'download' || m === 'upload' || m === 'fim') this.reiniciarEscala();
            if (m === 'ocioso' || m === 'ping') this.valor(0, true);
        },
        get modoAtual() { return modo; },
        valor(v, imediato = false) {
            let n = nivel;
            while (v > ESCALAS[n][ESCALAS[n].length - 1] && n < ESCALAS.length - 1) n++;
            if (n !== nivel) { nivel = n; escala = ESCALAS[n]; desenharMarcas(); }
            destino = Math.max(0, v || 0);
            if (imediato) { atual = destino; pintar(); return; }
            if (!raf) raf = requestAnimationFrame(animar);
        },
        reiniciarEscala() { if (nivel !== 0) { nivel = 0; escala = ESCALAS[0]; atual = Math.min(atual, 50); desenharMarcas(); pintar(); } },
    };
}
