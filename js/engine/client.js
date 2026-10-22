/**
 * SpeedEngine — ponte entre a interface e o motor de medição.
 * Tudo que envolve tempo fino (ping, jitter, banda) roda no Web Worker
 * (js/engine/net-worker.js). Aqui ficam só: chamadas HTTP simples ao
 * servidor e o teste de perda UDP — WebRTC não existe dentro de workers.
 */
window.SpeedEngine = (function () {
    'use strict';

    const WORKER_URL = 'js/engine/net-worker.js?v=2026092204';
    let worker = null;
    let config = null;
    let connectInfo = null;
    let nextId = 1;
    const calls = new Map();
    const eventHandlers = new Set();

    function ensureWorker() {
        if (worker) return worker;
        worker = new Worker(WORKER_URL);
        worker.onmessage = (ev) => {
            const { id, type, data, error } = ev.data;
            if (type === 'event') { eventHandlers.forEach((h) => h(data)); return; }
            const c = calls.get(id);
            if (!c) return;
            if (type === 'progress') { if (c.onProgress) c.onProgress(data); return; }
            calls.delete(id);
            if (type === 'result') c.resolve(data); else c.reject(new Error(error));
        };
        worker.onerror = () => {
            calls.forEach((c) => c.reject(new Error('O motor de medição parou inesperadamente')));
            calls.clear();
            worker = null;
            connectInfo = null;
        };
        return worker;
    }

    function call(cmd, args, onProgress) {
        const w = ensureWorker();
        const id = nextId++;
        return new Promise((resolve, reject) => {
            calls.set(id, { resolve, reject, onProgress });
            w.postMessage({ id, cmd, args });
        });
    }

    async function getJson(path, opts) {
        const res = await fetch(path, { cache: 'no-store', ...opts });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `O servidor respondeu ${res.status}`);
        return data;
    }

    /** Conecta (config + WebSocket do worker). Reaproveita a conexão se já existe. */
    async function prepare() {
        if (!config) config = await getJson('api/config');
        if (!connectInfo) {
            const wsUrl = new URL('ws', location.href);
            wsUrl.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
            connectInfo = await call('connect', { url: wsUrl.href });
        }
        return { config, connection: connectInfo };
    }
    eventHandlers.add((e) => { if (e.type === 'disconnected') connectInfo = null; });

    const originBase = () => new URL('.', location.href).href.replace(/\/$/, '');

    // ---------------- perda de pacotes via UDP (WebRTC) ----------------
    function waitIceGathering(pc, timeoutMs) {
        if (pc.iceGatheringState === 'complete') return Promise.resolve();
        return new Promise((resolve) => {
            const t = setTimeout(resolve, timeoutMs);
            pc.addEventListener('icegatheringstatechange', () => {
                if (pc.iceGatheringState === 'complete') { clearTimeout(t); resolve(); }
            });
        });
    }

    /**
     * Rajada de pacotes UDP numerados por um DataChannel sem retransmissão;
     * o servidor devolve cada um que chegar. Perda = o que não voltou
     * (ida + volta). Sem truque: pacote perdido fica perdido.
     */
    async function measureUdpLoss({ packets = 200, intervalMs = 20, onProgress } = {}) {
        if (!window.RTCPeerConnection) return { ok: false, reason: 'navegador sem suporte a WebRTC' };
        const pc = new RTCPeerConnection({ iceServers: [] });
        try {
            const dc = pc.createDataChannel('loss', { ordered: false, maxRetransmits: 0 });
            await pc.setLocalDescription(await pc.createOffer());
            await waitIceGathering(pc, 2500);
            let answer;
            try {
                answer = await getJson('api/rtc/offer', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ type: 'offer', sdp: pc.localDescription.sdp }),
                });
            } catch (e) {
                return { ok: false, reason: e.message };
            }
            await pc.setRemoteDescription(answer);

            const opened = await new Promise((resolve) => {
                if (dc.readyState === 'open') return resolve(true);
                const t = setTimeout(() => resolve(false), 7000);
                dc.onopen = () => { clearTimeout(t); resolve(true); };
            });
            if (!opened) return { ok: false, reason: 'UDP bloqueado ou filtrado na sua rede' };

            const sentAt = new Array(packets);
            const rtts = [];
            dc.onmessage = (ev) => {
                const i = Number(ev.data);
                if (Number.isInteger(i) && sentAt[i] != null && sentAt[i] >= 0) {
                    rtts.push(performance.now() - sentAt[i]);
                    sentAt[i] = -1; // conta cada pacote uma vez só
                }
            };
            for (let i = 0; i < packets; i++) {
                sentAt[i] = performance.now();
                try { dc.send(String(i)); } catch { /* canal caiu: conta como perdido */ }
                if (onProgress && i % 10 === 0) onProgress({ sent: i + 1, received: rtts.length, total: packets });
                await new Promise((r) => setTimeout(r, intervalMs));
            }
            await new Promise((r) => setTimeout(r, 1500)); // tempo pros últimos voltarem
            const received = rtts.length;
            const sorted = [...rtts].sort((a, b) => a - b);
            let jit = 0;
            for (let i = 1; i < rtts.length; i++) jit += Math.abs(rtts[i] - rtts[i - 1]);
            return {
                ok: true,
                sent: packets,
                received,
                loss: ((packets - received) / packets) * 100,
                udpPing: sorted.length ? sorted[sorted.length >> 1] : null,
                udpJitter: rtts.length > 1 ? jit / (rtts.length - 1) : null,
            };
        } catch (e) {
            return { ok: false, reason: 'não foi possível abrir o canal UDP' };
        } finally {
            pc.close();
        }
    }

    // ---------------- NAT: tipo de mapeamento (STUN) ----------------
    /**
     * Pergunta o "endereço visto de fora" a DOIS servidores STUN públicos. O
     * navegador manda as duas perguntas pela MESMA porta local:
     *  - se as duas respostas trazem a mesma porta -> NAT normal (cone);
     *  - se trazem portas diferentes -> NAT simétrico: o roteador troca a
     *    porta a cada destino. É o que quebra jogos online, chamadas de vídeo,
     *    câmeras e acesso remoto — e é típico de CGNAT/duplo NAT.
     * Sem servidor nosso no meio: é o próprio navegador falando com o STUN.
     */
    async function natMapping({ timeoutMs = 6000 } = {}) {
        if (!window.RTCPeerConnection) return { ok: false, reason: 'navegador sem suporte a WebRTC' };
        const pc = new RTCPeerConnection({
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
            ],
        });
        try {
            const mapped = [];
            const hostCandidates = [];
            let done;
            const finished = new Promise((r) => { done = r; });
            pc.onicecandidate = (e) => {
                if (!e.candidate) return done();
                const c = e.candidate;
                if (c.type === 'srflx' && c.address) mapped.push({ address: c.address, port: c.port, localPort: c.relatedPort });
                if (c.type === 'host' && c.port) hostCandidates.push({ port: c.port });
            };
            pc.createDataChannel('nat');
            await pc.setLocalDescription(await pc.createOffer());
            await Promise.race([finished, new Promise((r) => setTimeout(r, timeoutMs))]);

            if (!mapped.length) return { ok: false, reason: 'nenhum servidor STUN respondeu (UDP bloqueado?)' };

            // IPv6 não passa por NAT: só o IPv4 conta pro tipo de NAT.
            const v6 = mapped.filter(m => m.address.includes(':'));
            const v4 = mapped.filter(m => !m.address.includes(':'));
            // o navegador junta respostas iguais: se os dois STUN devolveram o
            // MESMO endereço:porta, sobra um candidato só (NAT normal). Dois ou
            // mais candidatos = cada destino recebeu uma porta diferente = simétrico.
            const unicos = [...new Set(v4.map(m => m.address + ':' + m.port))];
            const hostPorts = hostCandidates.map(h => h.port);

            if (!v4.length) {
                return { ok: true, tipo: 'sem NAT (IPv6 direto)', publicIpv6: v6[0] && v6[0].address, mappings: mapped.length };
            }
            return {
                ok: true,
                tipo: unicos.length >= 2 ? 'simétrico' : 'normal',
                publicIpv4: v4[0].address,
                publicIpv6: v6[0] && v6[0].address,
                mappings: unicos.length,
                // porta pública igual à local: o roteador não remapeia (bom pra jogos)
                portaPreservada: hostPorts.includes(v4[0].port),
            };
        } catch (e) {
            return { ok: false, reason: 'não foi possível consultar o STUN' };
        } finally {
            pc.close();
        }
    }

    /**
     * Diagnóstico do servidor (TTL + rota + faixa do IP). O servidor precisa
     * ver pacotes deste cliente durante a medição, então mandamos tráfego leve
     * em paralelo enquanto ele captura.
     */
    async function natServerCheck({ noiseMs = 3200 } = {}) {
        let parar = false;
        const ruido = (async () => {
            while (!parar) {
                await fetch('api/time', { cache: 'no-store' }).catch(() => {});
                await new Promise((r) => setTimeout(r, 150));
            }
        })();
        const limite = setTimeout(() => { parar = true; }, noiseMs);
        try {
            return await getJson('api/nat');
        } finally {
            parar = true;
            clearTimeout(limite);
            await ruido.catch(() => {});
        }
    }

    return {
        prepare,
        get config() { return config; },
        onEvent(h) { eventHandlers.add(h); return () => eventHandlers.delete(h); },

        ping: (opts, onSample) => call('ping', opts, onSample),
        pingBurst: (opts) => call('pingBurst', opts),
        clock: () => call('clock'),
        acquireSlot: (onQueue) => call('slot', {}, onQueue),
        releaseSlot: (token) => call('release', { token }),
        download: (opts, onProgress) => call('download', { base: originBase(), ...opts }, onProgress),
        upload: (opts, onProgress) => call('upload', { base: originBase(), ...opts }, onProgress),
        abort: () => (worker ? call('abort') : Promise.resolve()),

        measureUdpLoss,
        natMapping,
        natServerCheck,
        whoami: () => getJson('api/whoami'),
        trace: () => getJson('api/trace'),
        saveResult: (payload) => getJson('api/results', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        }),
    };
})();
