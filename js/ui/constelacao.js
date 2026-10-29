// Fundo de constelação (a "rede"). Durante o teste, pacotes
// de luz percorrem as ligações: no download convergem para o velocímetro, no
// upload saem dele. A quantidade acompanha a velocidade medida.
//
// Desenho leve: pausa com a aba escondida, reduz a densidade em aparelhos
// lentos e fica parado para quem pediu menos movimento no sistema.

const CORES = { download: [70, 224, 140], upload: [122, 162, 247] };
// cor da rede (linhas e nós) vem do tema da página: --constelacao: "r, g, b"
const corDaRede = () => (getComputedStyle(document.body).getPropertyValue('--constelacao').trim() || '70, 224, 140');

let estado = null;

export function iniciarConstelacao() {
    if (estado) return estado.api;
    let fundo = document.querySelector('.fundo');
    if (!fundo) {
        fundo = document.createElement('div');
        fundo.className = 'fundo';
        fundo.setAttribute('aria-hidden', 'true');
        document.body.prepend(fundo);
    }
    const canvas = document.createElement('canvas');
    fundo.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    const calmo = matchMedia('(prefers-reduced-motion: reduce)');
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);

    let W = 0, H = 0, nos = [], pacotes = [], ultimo = 0, acumulado = 0, raf = 0;
    let fluxo = { modo: null, intensidade: 0, alvo: null };
    let lentos = 0;
    const DIST = 170;

    function dimensionar() {
        W = window.innerWidth;
        H = window.innerHeight;
        canvas.width = Math.round(W * dpr);
        canvas.height = Math.round(H * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const alvo = Math.round(Math.min(95, Math.max(26, (W * H) / 21000)));
        while (nos.length < alvo) nos.push(novoNo());
        nos.length = alvo;
        if (calmo.matches) desenhar(0);
    }

    function novoNo() {
        const v = 0.06 + Math.random() * 0.1;
        const ang = Math.random() * Math.PI * 2;
        return {
            x: Math.random() * W, y: Math.random() * H,
            vx: Math.cos(ang) * v, vy: Math.sin(ang) * v,
            r: Math.random() < 0.12 ? 1.9 + Math.random() * 0.8 : 0.9 + Math.random() * 0.9,
            brilho: Math.random() < 0.12 ? 1 : 0.55 + Math.random() * 0.3,
        };
    }

    function centroAlvo() {
        const el = fluxo.alvo;
        if (!el) return { x: W / 2, y: H * 0.42 };
        const r = el.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }

    function soltarPacote() {
        const c = centroAlvo();
        // escolhe uma ligação que aponte para o velocímetro (download) ou para fora dele (upload)
        for (let tent = 0; tent < 12; tent++) {
            const a = nos[(Math.random() * nos.length) | 0];
            let melhor = null, melhorGanho = 0;
            for (const b of nos) {
                if (b === a) continue;
                const d = Math.hypot(a.x - b.x, a.y - b.y);
                if (d > DIST || d < 20) continue;
                const da = Math.hypot(a.x - c.x, a.y - c.y), db = Math.hypot(b.x - c.x, b.y - c.y);
                const ganho = fluxo.modo === 'download' ? da - db : db - da;
                if (ganho > melhorGanho) { melhorGanho = ganho; melhor = b; }
            }
            if (melhor) {
                pacotes.push({ de: a, para: melhor, t: 0, vel: 0.9 + Math.random() * 0.9 + fluxo.intensidade * 1.2, cor: CORES[fluxo.modo] || CORES.download, saltos: 0 });
                return;
            }
        }
    }

    function avancarPacote(p) {
        // ao chegar, segue para o próximo nó na mesma direção (até 4 saltos)
        const c = centroAlvo();
        const a = p.para;
        let melhor = null, melhorGanho = 4;
        for (const b of nos) {
            if (b === a || b === p.de) continue;
            const d = Math.hypot(a.x - b.x, a.y - b.y);
            if (d > DIST) continue;
            const da = Math.hypot(a.x - c.x, a.y - c.y), db = Math.hypot(b.x - c.x, b.y - c.y);
            const ganho = p.cor === CORES.upload ? db - da : da - db;
            if (ganho > melhorGanho) { melhorGanho = ganho; melhor = b; }
        }
        if (!melhor || p.saltos >= 4) return false;
        p.de = a; p.para = melhor; p.t = 0; p.saltos++;
        return true;
    }

    const rede = corDaRede();
    function desenhar(dt) {
        ctx.clearRect(0, 0, W, H);
        const mover = !calmo.matches;
        if (mover) {
            for (const n of nos) {
                n.x += n.vx * dt * 0.06; n.y += n.vy * dt * 0.06;
                if (n.x < -20) n.x = W + 20; else if (n.x > W + 20) n.x = -20;
                if (n.y < -20) n.y = H + 20; else if (n.y > H + 20) n.y = -20;
            }
        }
        // ligações
        ctx.lineWidth = 0.7;
        for (let i = 0; i < nos.length; i++) {
            const a = nos[i];
            for (let j = i + 1; j < nos.length; j++) {
                const b = nos[j];
                const dx = a.x - b.x, dy = a.y - b.y;
                const d2 = dx * dx + dy * dy;
                if (d2 > DIST * DIST) continue;
                const al = (1 - Math.sqrt(d2) / DIST) * 0.22;
                ctx.strokeStyle = `rgba(${rede}, ${al})`;
                ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
            }
        }
        // nós
        for (const n of nos) {
            ctx.fillStyle = n.brilho === 1 ? 'rgba(232, 255, 242, 0.85)' : `rgba(${rede}, ${Math.min(1, n.brilho + 0.1)})`;
            ctx.beginPath(); ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2); ctx.fill();
        }
        // pacotes
        if (mover && fluxo.modo) {
            acumulado += dt * (0.004 + fluxo.intensidade * 0.05);
            while (acumulado >= 1 && pacotes.length < 160) { soltarPacote(); acumulado -= 1; }
        }
        for (let i = pacotes.length - 1; i >= 0; i--) {
            const p = pacotes[i];
            const len = Math.hypot(p.para.x - p.de.x, p.para.y - p.de.y) || 1;
            p.t += (p.vel * dt * 0.12) / len;
            if (p.t >= 1 && !avancarPacote(p)) { pacotes.splice(i, 1); continue; }
            const x = p.de.x + (p.para.x - p.de.x) * Math.min(p.t, 1);
            const y = p.de.y + (p.para.y - p.de.y) * Math.min(p.t, 1);
            const tx = p.de.x + (p.para.x - p.de.x) * Math.max(0, p.t - 18 / len);
            const ty = p.de.y + (p.para.y - p.de.y) * Math.max(0, p.t - 18 / len);
            const [r, g, b] = p.cor;
            const grad = ctx.createLinearGradient(tx, ty, x, y);
            grad.addColorStop(0, `rgba(${r},${g},${b},0)`);
            grad.addColorStop(1, `rgba(${r},${g},${b},0.9)`);
            ctx.strokeStyle = grad;
            ctx.lineWidth = 1.6;
            ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(x, y); ctx.stroke();
            ctx.fillStyle = `rgba(${r},${g},${b},1)`;
            ctx.beginPath(); ctx.arc(x, y, 1.7, 0, Math.PI * 2); ctx.fill();
        }
    }

    function quadro(t) {
        raf = 0;
        if (document.hidden || calmo.matches) return;
        const dt = ultimo ? Math.min(64, t - ultimo) : 16;
        ultimo = t;
        // aparelho sofrendo (menos de ~30 quadros/s por um tempo): menos nós
        if (dt > 34) { if (++lentos > 90 && nos.length > 24) { nos.length = Math.round(nos.length * 0.75); lentos = 0; } } else if (lentos > 0) lentos--;
        desenhar(dt);
        raf = requestAnimationFrame(quadro);
    }
    const ligar = () => { if (!raf && !document.hidden && !calmo.matches) { ultimo = 0; raf = requestAnimationFrame(quadro); } };

    window.addEventListener('resize', dimensionar);
    document.addEventListener('visibilitychange', ligar);
    calmo.addEventListener?.('change', () => { dimensionar(); ligar(); });
    dimensionar();
    ligar();

    const api = {
        /** modo: 'download' | 'upload' | null; intensidade 0..1; alvo: elemento para onde o fluxo converge. */
        fluxo(modo, intensidade = 0, alvo = null) {
            fluxo = { modo, intensidade: Math.max(0, Math.min(1, intensidade)), alvo: alvo || fluxo.alvo };
            if (!modo) acumulado = 0;
        },
    };
    estado = { api };
    return api;
}

export function constelacao() { return estado ? estado.api : null; }
