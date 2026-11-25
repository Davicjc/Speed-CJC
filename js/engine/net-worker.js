/* Motor de medição — roda num Web Worker (thread própria).
 *
 * Por que num worker: o ping é medido com performance.now() no momento em
 * que o eco chega. Na thread principal, esse momento atrasa sempre que a
 * interface está ocupada (animação de fase, partículas, layout) — e esse
 * atraso viraria "ping" e "jitter" falsos. Aqui dentro nada disputa o tempo.
 *
 * Metodologia (referências: LibreSpeed speedtest_worker.js, metodologia
 * pública do teste da Cloudflare e RFC 3550 §6.4.1 para jitter):
 *  - Ping: WebSocket persistente (sem custo de handshake HTTP por amostra),
 *    aquecimento descartado, amostras sequenciais; ping = mediana.
 *  - Jitter: média das diferenças absolutas entre pings consecutivos.
 *  - Download: vários fluxos HTTP em paralelo, bytes contados à medida que
 *    CHEGAM ao navegador; os primeiros segundos (rampa do TCP) não entram
 *    na conta final.
 *  - Upload: vários envios em paralelo, mas a velocidade vem do SERVIDOR,
 *    que conta o que de fato chegou (o progresso do XHR conta o que saiu da
 *    aplicação pro sistema operacional, e superestima no começo).
 *  - Latência sob carga: pings contínuos durante download e upload —
 *    a diferença pro ping em repouso é o bufferbloat.
 */
'use strict';

let ws = null;
let wsReady = null;
let seq = 0;
const pendingPings = new Map();
const jsonWaiters = [];
const listeners = new Set();
const now = () => performance.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function median(a) {
    if (!a.length) return null;
    const s = [...a].sort((x, y) => x - y);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function jitterOf(a) {
    if (a.length < 2) return null;
    let sum = 0;
    for (let i = 1; i < a.length; i++) sum += Math.abs(a[i] - a[i - 1]);
    return sum / (a.length - 1);
}

// ---------------- WebSocket ----------------
function connect(url) {
    if (wsReady) return wsReady;
    wsReady = new Promise((resolve, reject) => {
        const sock = new WebSocket(url);
        const fail = setTimeout(() => { sock.close(); wsReady = null; reject(new Error('O servidor de teste não respondeu')); }, 8000);
        sock.onopen = () => {
            clearTimeout(fail);
            ws = sock;
            sendJson({ type: 'hello' });
            waitJson('hello', 5000).then(resolve, reject);
        };
        sock.onerror = () => { clearTimeout(fail); wsReady = null; reject(new Error('Não foi possível conectar ao servidor de teste')); };
        sock.onclose = () => {
            ws = null;
            wsReady = null;
            for (const p of pendingPings.values()) { clearTimeout(p.timer); p.resolve(null); }
            pendingPings.clear();
            emitEvent({ type: 'disconnected' });
        };
        sock.onmessage = (ev) => {
            const t = now();
            const d = ev.data;
            if (typeof d === 'string' && d.charCodeAt(0) === 112 /* p */) {
                const p = pendingPings.get(d);
                if (p) { pendingPings.delete(d); clearTimeout(p.timer); p.resolve(t - p.t0); }
                return;
            }
            let msg;
            try { msg = JSON.parse(d); } catch { return; }
            for (let i = 0; i < jsonWaiters.length; i++) {
                if (jsonWaiters[i].type === msg.type) { const w = jsonWaiters.splice(i, 1)[0]; clearTimeout(w.timer); w.resolve(msg); break; }
            }
            for (const l of listeners) l(msg);
        };
    });
    return wsReady;
}

function sendJson(obj) {
    if (!ws || ws.readyState !== 1) throw new Error('Conexão com o servidor perdida');
    ws.send(JSON.stringify(obj));
}
function waitJson(type, timeoutMs) {
    return new Promise((resolve, reject) => {
        const w = { type, resolve, timer: setTimeout(() => { jsonWaiters.splice(jsonWaiters.indexOf(w), 1); reject(new Error('O servidor demorou para responder')); }, timeoutMs) };
        jsonWaiters.push(w);
    });
}

/** Um ping: resolve com o RTT em ms, ou null se não voltou em timeoutMs. */
function pingOnce(timeoutMs = 2000) {
    if (!ws || ws.readyState !== 1) return Promise.resolve(null);
    const key = 'p' + (++seq);
    return new Promise((resolve) => {
        const timer = setTimeout(() => { pendingPings.delete(key); resolve(null); }, timeoutMs);
        pendingPings.set(key, { t0: now(), resolve, timer });
        ws.send(key);
    });
}

// ---------------- comandos ----------------
async function cmdPing({ count = 25, warmup = 5, gapMs = 40 }, progress) {
    const samples = [];
    let lost = 0;
    for (let i = 0; i < warmup; i++) { await pingOnce(); await sleep(gapMs); }
    for (let i = 0; i < count; i++) {
        const rtt = await pingOnce();
        if (rtt == null) lost++;
        else {
            samples.push(rtt);
            progress({ rtt, ping: median(samples), jitter: jitterOf(samples), done: i + 1, total: count });
        }
        await sleep(gapMs);
    }
    if (!samples.length) throw new Error('Nenhum ping voltou do servidor');
    return { ping: median(samples), min: Math.min(...samples), max: Math.max(...samples), jitter: jitterOf(samples) ?? 0, samples, lost };
}

async function cmdPingBurst({ count = 5, gapMs = 100, timeoutMs = 2000 }) {
    const rtts = [];
    let timeouts = 0;
    for (let i = 0; i < count; i++) {
        const rtt = await pingOnce(timeoutMs);
        if (rtt == null) timeouts++; else rtts.push(rtt);
        if (i < count - 1) await sleep(gapMs);
    }
    return { rtts, timeouts };
}

/** Relógio: 8 trocas estilo NTP, fica a de menor RTT (menos incerteza). */
async function cmdClock() {
    let best = null;
    for (let i = 0; i < 8; i++) {
        // Date.now() de propósito: é o relógio que os apps do aparelho usam
        // (banco, autenticação), inclusive se alguém o mudou com a página aberta.
        const c = Date.now();
        const t0 = now();
        sendJson({ type: 'time', c });
        const r = await waitJson('time', 3000);
        const rtt = now() - t0;
        if (!r.synced || r.s == null) return { synced: false };
        const offset = (c + rtt / 2) - r.s; // positivo = aparelho adiantado
        if (!best || rtt < best.rtt) best = { rtt, offset };
        await sleep(30);
    }
    return { synced: true, offsetMs: best.offset, uncertaintyMs: best.rtt / 2 };
}

async function cmdSlot({ aparelho } = {}, progress) {
    let denied = null;
    const onQueue = (m) => {
        if (m.type === 'slot-wait') progress({ position: m.position, active: m.active, max: m.max });
        if (m.type === 'slot-denied') denied = m;
    };
    listeners.add(onQueue);
    try {
        sendJson({ type: 'slot-request', aparelho });
        const g = await Promise.race([
            waitJson('slot-granted', 10 * 60_000),
            // o servidor pode recusar (limite de vagas por conexão): não adianta esperar
            new Promise((_r, reject) => {
                const t = setInterval(() => {
                    if (!denied) return;
                    clearInterval(t);
                    reject(Object.assign(new Error(denied.reason || 'Limite de testes nesta sessão'), { code: denied.code || null }));
                }, 100);
                setTimeout(() => clearInterval(t), 10 * 60_000);
            }),
        ]);
        return { token: g.token, ttlMs: g.ttlMs };
    } finally {
        listeners.delete(onQueue);
    }
}

function cmdRelease({ token }) {
    try { sendJson({ type: 'slot-release', token }); } catch { /* conexão já caiu: o servidor libera sozinho */ }
    return {};
}

/** Pings contínuos em paralelo a um teste de banda (latência sob carga). */
function startLoadedPings(intervalMs = 200) {
    const samples = [];
    let running = true;
    (async () => {
        while (running) {
            const rtt = await pingOnce(3000);
            if (!running) break;
            if (rtt != null) samples.push(rtt);
            await sleep(intervalMs);
        }
    })();
    return { stop() { running = false; return samples; } };
}

let activeAbort = null;

async function cmdDownload({ base, token, durationMs = 10000, graceMs = 2000, streams = 6, loaded = true, firstByteTimeoutMs = 6000 }, progress) {
    const ctrl = new AbortController();
    activeAbort = ctrl;
    const t0 = now();
    let total = 0;
    let firstByteAt = null;
    const marks = [];  // [t, total]
    const lp = loaded ? startLoadedPings() : null;
    const url = () => `${base}/api/download?bytes=${64 * 1024 * 1024}&t=${encodeURIComponent(token)}&r=${Math.random().toString(36).slice(2)}`;

    const stream = async () => {
        while (!ctrl.signal.aborted) {
            const res = await fetch(url(), { cache: 'no-store', signal: ctrl.signal, credentials: 'omit' });
            if (!res.ok) throw new Error(res.status === 403 ? 'A vaga de teste expirou' : `Servidor respondeu ${res.status}`);
            const reader = res.body.getReader();
            for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                if (firstByteAt == null) firstByteAt = now();
                total += value.byteLength;
            }
        }
    };
    const workers = Array.from({ length: streams }, () => stream().catch((e) => { if (!ctrl.signal.aborted) throw e; }));

    let failure = null;
    Promise.all(workers).catch((e) => { failure = e; ctrl.abort(); });

    // amostragem de 100 ms para o velocímetro e para o cálculo final
    while (!ctrl.signal.aborted) {
        await sleep(100);
        const t = now() - t0;
        marks.push([t, total]);
        if (firstByteAt == null && t > firstByteTimeoutMs) { failure = new Error('O servidor não enviou dados'); break; }
        const win = marks.filter((m) => m[0] >= t - 1000);
        const inst = win.length > 1 ? ((win[win.length - 1][1] - win[0][1]) * 8) / ((win[win.length - 1][0] - win[0][0]) * 1000) : 0;
        progress({ mbps: inst, progress: Math.min(1, t / durationMs) });
        if (t >= durationMs) break;
    }
    ctrl.abort();
    activeAbort = null;
    const loadedSamples = lp ? lp.stop() : [];
    if (failure && total === 0) throw failure;

    // janela de medição: do fim do período de aquecimento até o fim
    const end = marks[marks.length - 1];
    const startIdx = marks.findIndex((m) => m[0] >= graceMs);
    const start = startIdx > 0 ? marks[startIdx] : marks[0];
    const bytes = end[1] - start[1];
    const ms = end[0] - start[0];
    return {
        mbps: ms > 0 ? (bytes * 8) / (ms * 1000) : 0,
        bytes: total,
        windowMs: Math.round(ms),
        loadedPing: median(loadedSamples),
        loadedSamples: loadedSamples.length,
    };
}

// Tamanhos progressivos de envio (256 KiB até 8 MiB):
//  - Cada faixa usa um Blob simples de parte única (em vez de 16 partes repetidas em XHR),
//    enviado por fetch(): no Chromium evita a cópia pesada de Uint8Array por IPC (atinge
//    múltiplos Gbps), e no Safari/WebKit evita o bug do XHR+Blob em Web Worker.
//  - Se algum navegador ainda mandar corpo vazio (bytes === 0), cai automaticamente para
//    o Uint8Array puro na hora, sem ficar em loop vazio.
//  - Começar pequeno e crescer conforme a velocidade real evita entupir a fila do roteador
//    (bufferbloat/colapso TCP) em redes móveis ou congestionadas, e satura links de 500M–1G+.
const UPLOAD_SIZES = [256 * 1024, 512 * 1024, 1024 * 1024, 2 * 1024 * 1024, 4 * 1024 * 1024, 8 * 1024 * 1024];
const uploadRawChunks = new Map();
const uploadBlobChunks = new Map();
function uploadChunk(size, raw = false) {
    if (!raw) {
        const cached = uploadBlobChunks.get(size);
        if (cached) return cached;
    }
    let buf = uploadRawChunks.get(size);
    if (!buf) {
        buf = new Uint8Array(size);
        for (let i = 0; i < size; i += 65536) {
            crypto.getRandomValues(buf.subarray(i, Math.min(i + 65536, size)));
        }
        uploadRawChunks.set(size, buf);
    }
    if (raw) return buf;
    const blob = new Blob([buf]);
    uploadBlobChunks.set(size, blob);
    return blob;
}

async function cmdUpload({ base, token, durationMs = 10000, graceMs = 3000, streams = 4, loaded = true }, progress) {
    const ctrl = new AbortController();
    activeAbort = ctrl;
    let serverMbpsNow = 0;
    let serverBytes = 0;
    const onProg = (m) => { if (m.type === 'ul-progress') { serverMbpsNow = m.mbpsNow; serverBytes = m.bytes; } };
    listeners.add(onProg);

    // Espera o servidor zerar os contadores antes do 1º POST (elimina corrida entre WS e HTTP).
    sendJson({ type: 'ul-begin', token, durationMs });
    await waitJson('ul-ready', 1500).catch(() => {});

    const lp = loaded ? startLoadedPings() : null;
    let failure = null;
    let stopping = false;
    let tier = 0;
    let activeStreams = 0;
    let useRawBody = false;
    let zeroBodyHits = 0;
    const maxStreams = Math.max(1, Math.min(streams, 6));
    const timers = [];

    const runStream = async () => {
        while (!stopping && !ctrl.signal.aborted) {
            const size = UPLOAD_SIZES[tier];
            const body = uploadChunk(size, useRawBody);
            const url = `${base}/api/upload?t=${encodeURIComponent(token)}&r=${Math.random().toString(36).slice(2)}`;
            const reqT0 = now();
            try {
                const res = await fetch(url, {
                    method: 'POST',
                    body,
                    cache: 'no-store',
                    credentials: 'omit',
                    signal: ctrl.signal,
                });
                if (res.status === 403) {
                    failure = new Error('A vaga de teste expirou');
                    stopping = true;
                    ctrl.abort();
                    return;
                }
                if (!res.ok) { await sleep(200); continue; }
                const data = await res.json().catch(() => null);
                if (data && data.bytes === 0) {
                    zeroBodyHits++;
                    // fallback automático: se o navegador descartou o Blob, muda para Uint8Array puro
                    if (!useRawBody) { useRawBody = true; continue; }
                    await sleep(200);
                    continue;
                }
                const dt = now() - reqT0;
                // Ajusta o tamanho do bloco à velocidade real confirmada pelo servidor:
                // envio rápido (< 600 ms) sobe o bloco; envio demorado (> 2500 ms) reduz.
                if (size === UPLOAD_SIZES[tier] && dt < 600 && tier < UPLOAD_SIZES.length - 1) tier++;
                else if (size === UPLOAD_SIZES[tier] && dt > 2500 && tier > 0) tier--;
                // Só abre mais fluxos paralelos quando o link responde sem engasgar.
                if (dt < 800 && activeStreams < maxStreams) spawnStream();
            } catch {
                if (ctrl.signal.aborted || stopping) return;
                await sleep(200);
            }
        }
    };

    const spawnStream = () => {
        if (stopping || ctrl.signal.aborted || activeStreams >= maxStreams) return;
        activeStreams++;
        runStream();
    };

    // Inicia com 2 fluxos escalonados (evita colisão no slow-start TCP) e sobe até maxStreams conforme a banda.
    spawnStream();
    if (maxStreams >= 2) timers.push(setTimeout(spawnStream, 100));
    timers.push(setTimeout(() => {
        if (stopping || ctrl.signal.aborted || serverMbpsNow < 15 || activeStreams >= maxStreams) return;
        const falta = maxStreams - activeStreams;
        for (let i = 0; i < falta; i++) timers.push(setTimeout(spawnStream, i * 100));
    }, 1000));

    const t0 = now();
    while (!ctrl.signal.aborted) {
        await sleep(200);
        const t = now() - t0;
        progress({ mbps: serverMbpsNow, progress: Math.min(1, t / durationMs) });
        if (t > 6000 && serverBytes === 0) {
            failure = new Error(zeroBodyHits > 0
                ? 'O navegador enviou os pacotes vazios ao servidor'
                : 'O servidor não recebeu dados do envio');
            break;
        }
        if (t >= durationMs) break;
    }

    for (const id of timers) clearTimeout(id);
    const abortedExternally = ctrl.signal.aborted && !failure;
    stopping = true;
    activeAbort = null;
    const loadedSamples = lp ? lp.stop() : [];
    listeners.delete(onProg);

    if (failure || abortedExternally) {
        ctrl.abort();
        try { sendJson({ type: 'ul-end', token, graceMs }); } catch { /* ok */ }
        throw failure || new DOMException('Teste interrompido', 'AbortError');
    }

    // Pede o fechamento no servidor ANTES de abortar os POSTs: o servidor congela o
    // relógio ainda em fluxo cheio (sem cauda vazia diluindo a média). Se o link estiver
    // com bufferbloat e a resposta não voltar em 600 ms, aborta os envios para destravar o WS.
    sendJson({ type: 'ul-end', token, graceMs });
    const abortFallback = setTimeout(() => ctrl.abort(), 600);
    let r;
    try {
        r = await waitJson('ul-result', 12000);
    } finally {
        clearTimeout(abortFallback);
        ctrl.abort();
    }
    if (r.error) throw new Error('O servidor não conseguiu medir o envio');
    return { mbps: r.mbps, bytes: r.totalBytes, windowMs: r.windowMs, loadedPing: median(loadedSamples), loadedSamples: loadedSamples.length };
}

function emitEvent(data) { postMessage({ id: null, type: 'event', data }); }

const COMMANDS = {
    connect: ({ url }) => connect(url),
    ping: cmdPing,
    pingBurst: cmdPingBurst,
    clock: cmdClock,
    slot: cmdSlot,
    release: cmdRelease,
    download: cmdDownload,
    upload: cmdUpload,
    abort: () => { if (activeAbort) activeAbort.abort(); return {}; },
};

onmessage = async (ev) => {
    const { id, cmd, args } = ev.data;
    const fn = COMMANDS[cmd];
    if (!fn) return postMessage({ id, type: 'error', error: `comando desconhecido: ${cmd}` });
    try {
        const data = await fn(args || {}, (p) => postMessage({ id, type: 'progress', data: p }));
        postMessage({ id, type: 'result', data });
    } catch (e) {
        postMessage({ id, type: 'error', error: e && e.message ? e.message : String(e), code: (e && e.code) || null });
    }
};
