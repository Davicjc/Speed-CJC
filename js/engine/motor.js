/**
 * Motor de medição — ponte entre a página e o Web Worker (net-worker.js).
 * Tudo que envolve tempo fino (ping, jitter, banda) roda no worker, longe da
 * animação da tela. Aqui ficam as chamadas HTTP simples e o teste de perda
 * por UDP (WebRTC não existe dentro de workers).
 */

const WORKER_URL = '/js/engine/net-worker.js?v=2';
let worker = null;
let config = null;
let conexao = null;
let proximo = 1;
const chamadas = new Map();
const ouvintes = new Set();

function garantirWorker() {
    if (worker) return worker;
    worker = new Worker(WORKER_URL);
    worker.onmessage = (ev) => {
        const { id, type, data, error } = ev.data;
        if (type === 'event') { ouvintes.forEach((h) => h(data)); return; }
        const c = chamadas.get(id);
        if (!c) return;
        if (type === 'progress') { if (c.progresso) c.progresso(data); return; }
        chamadas.delete(id);
        if (type === 'result') c.resolve(data); else c.reject(new Error(error));
    };
    worker.onerror = () => {
        chamadas.forEach((c) => c.reject(new Error('O motor de medição parou inesperadamente')));
        chamadas.clear();
        worker = null;
        conexao = null;
    };
    return worker;
}

function chamar(cmd, args, progresso) {
    const w = garantirWorker();
    const id = proximo++;
    return new Promise((resolve, reject) => {
        chamadas.set(id, { resolve, reject, progresso });
        w.postMessage({ id, cmd, args });
    });
}

async function getJson(caminho, opts) {
    const res = await fetch(caminho, { cache: 'no-store', ...opts });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `O servidor respondeu ${res.status}`);
    return data;
}

ouvintes.add((e) => { if (e.type === 'disconnected') conexao = null; });

/** Conecta (configuração + WebSocket do worker). Reaproveita a conexão se já existe. */
export async function preparar() {
    if (!config) config = await getJson('/api/config');
    if (!conexao) {
        const url = new URL('/ws', location.href);
        url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
        conexao = await chamar('connect', { url: url.href });
    }
    return { config, conexao };
}

export const ping = (opts, porAmostra) => chamar('ping', opts, porAmostra);
export const relogio = () => chamar('clock');
export const pegarVaga = (naFila) => chamar('slot', {}, naFila);
export const liberarVaga = (token) => chamar('release', { token });
export const download = (opts, progresso) => chamar('download', { base: location.origin, ...opts }, progresso);
export const upload = (opts, progresso) => chamar('upload', { base: location.origin, ...opts }, progresso);
export const abortar = () => (worker ? chamar('abort').catch(() => {}) : Promise.resolve());
export const quemSouEu = () => getJson('/api/whoami');
export const rota = () => getJson('/api/trace');
export const plataformas = () => getJson('/api/platforms');

function esperarIce(pc, ms) {
    if (pc.iceGatheringState === 'complete') return Promise.resolve();
    return new Promise((resolve) => {
        const t = setTimeout(resolve, ms);
        pc.addEventListener('icegatheringstatechange', () => { if (pc.iceGatheringState === 'complete') { clearTimeout(t); resolve(); } });
    });
}

/**
 * Perda de pacotes: rajada de pacotes UDP numerados por um DataChannel sem
 * retransmissão; o servidor devolve cada um que chegar. Perda = o que não
 * voltou (ida + volta).
 */
export async function perdaUdp({ pacotes = 200, intervaloMs = 20, progresso } = {}) {
    if (!window.RTCPeerConnection) return { ok: false, motivo: 'navegador sem suporte a WebRTC' };
    const pc = new RTCPeerConnection({ iceServers: [] });
    try {
        const dc = pc.createDataChannel('loss', { ordered: false, maxRetransmits: 0 });
        await pc.setLocalDescription(await pc.createOffer());
        await esperarIce(pc, 2500);
        let resposta;
        try {
            resposta = await getJson('/api/rtc/offer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'offer', sdp: pc.localDescription.sdp }) });
        } catch (e) { return { ok: false, motivo: e.message }; }
        await pc.setRemoteDescription(resposta);
        const aberto = await new Promise((resolve) => {
            if (dc.readyState === 'open') return resolve(true);
            const t = setTimeout(() => resolve(false), 7000);
            dc.onopen = () => { clearTimeout(t); resolve(true); };
        });
        if (!aberto) return { ok: false, motivo: 'UDP bloqueado ou filtrado na sua rede' };

        const enviadoEm = new Array(pacotes);
        const rtts = [];
        dc.onmessage = (ev) => {
            const i = Number(ev.data);
            if (Number.isInteger(i) && enviadoEm[i] != null && enviadoEm[i] >= 0) {
                rtts.push(performance.now() - enviadoEm[i]);
                enviadoEm[i] = -1;
            }
        };
        for (let i = 0; i < pacotes; i++) {
            enviadoEm[i] = performance.now();
            try { dc.send(String(i)); } catch { /* canal caiu: conta como perdido */ }
            if (progresso && i % 10 === 0) progresso({ enviados: i + 1, recebidos: rtts.length, total: pacotes });
            await new Promise((r) => setTimeout(r, intervaloMs));
        }
        await new Promise((r) => setTimeout(r, 1500));
        const recebidos = rtts.length;
        return { ok: true, enviados: pacotes, recebidos, perda: ((pacotes - recebidos) / pacotes) * 100 };
    } catch {
        return { ok: false, motivo: 'não foi possível abrir o canal UDP' };
    } finally {
        pc.close();
    }
}

/**
 * Tipo de NAT pelo STUN: pergunta o endereço visto de fora a dois servidores
 * pela MESMA porta local. Portas diferentes nas respostas = NAT simétrico
 * (quebra jogos, chamadas e acesso remoto; típico de CGNAT/duplo NAT).
 */
export async function tipoDeNat({ timeoutMs = 6000 } = {}) {
    if (!window.RTCPeerConnection) return { ok: false, motivo: 'navegador sem suporte a WebRTC' };
    const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }] });
    try {
        const mapeados = [];
        let fim;
        const terminou = new Promise((r) => { fim = r; });
        pc.onicecandidate = (e) => {
            if (!e.candidate) return fim();
            const c = e.candidate;
            if (c.type === 'srflx' && c.address) mapeados.push({ address: c.address, port: c.port });
        };
        pc.createDataChannel('nat');
        await pc.setLocalDescription(await pc.createOffer());
        await Promise.race([terminou, new Promise((r) => setTimeout(r, timeoutMs))]);
        if (!mapeados.length) return { ok: false, motivo: 'nenhum servidor STUN respondeu (UDP bloqueado?)' };
        const v4 = mapeados.filter((m) => !m.address.includes(':'));
        const v6 = mapeados.filter((m) => m.address.includes(':'));
        if (!v4.length) return { ok: true, tipo: 'sem NAT (IPv6 direto)', ipv6: v6[0] && v6[0].address };
        const unicos = [...new Set(v4.map((m) => m.address + ':' + m.port))];
        return { ok: true, tipo: unicos.length >= 2 ? 'simétrico' : 'normal', ipv4: v4[0].address, ipv6: v6[0] && v6[0].address };
    } catch {
        return { ok: false, motivo: 'não foi possível consultar o STUN' };
    } finally {
        pc.close();
    }
}

/** Diagnóstico do lado do servidor (TTL + rota + faixa do IP). Manda tráfego leve enquanto ele captura. */
export async function natNoServidor({ ruidoMs = 3200 } = {}) {
    let parar = false;
    const ruido = (async () => {
        while (!parar) {
            await fetch('/api/time', { cache: 'no-store' }).catch(() => {});
            await new Promise((r) => setTimeout(r, 150));
        }
    })();
    const limite = setTimeout(() => { parar = true; }, ruidoMs);
    try {
        return await getJson('/api/nat');
    } finally {
        parar = true;
        clearTimeout(limite);
        await ruido.catch(() => {});
    }
}

/**
 * Tempo até a borda (CDN) de uma plataforma: o 1º pedido paga DNS + TLS; os
 * seguintes reaproveitam a conexão e medem ida e volta. Fica o menor.
 * Sem parâmetro na URL de propósito (faria o CDN ir buscar na origem).
 */
function pedidoCronometrado(url, timeoutMs) {
    return new Promise((resolve) => {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), timeoutMs);
        const t0 = performance.now();
        fetch(url, { mode: 'no-cors', cache: 'no-store', credentials: 'omit', signal: ctrl.signal })
            .then(() => { clearTimeout(t); resolve(performance.now() - t0); })
            .catch(() => { clearTimeout(t); resolve(null); });
    });
}
export async function latenciaAte(url, timeoutMs = 4000) {
    if (!url) return { ms: null, indisponivel: true };
    const tempos = [];
    for (let i = 0; i < 4; i++) {
        const ms = await pedidoCronometrado(url, timeoutMs);
        if (ms == null) break;
        tempos.push(ms);
    }
    if (!tempos.length) return { ms: null };
    const quentes = tempos.length > 1 ? tempos.slice(1) : tempos;
    return { ms: Math.round(Math.min(...quentes)) };
}

/** Grava o resultado (com login, vai para a conta: o cookie de sessão segue junto). */
export async function salvarResultado(payload) {
    const { conexao: c } = await preparar();
    const res = await fetch('/api/results', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-Audicom': '1' },
        body: JSON.stringify({ ...payload, connId: c && c.connId }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || 'não foi possível salvar'), { status: res.status, code: data.code });
    return data;
}
