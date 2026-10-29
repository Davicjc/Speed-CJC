// Orquestra um teste completo: latência → download → upload → estabilidade
// (→ diagnóstico, no modo completo). Cada etapa avisa a página por eventos;
// o resultado final é o que vai para o servidor conferir e guardar.

import * as M from './motor.js';

const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

const SERVICOS = [
    { key: 'google', label: 'Google' },
    { key: 'whatsapp', label: 'WhatsApp' },
    { key: 'instagram', label: 'Instagram' },
    { key: 'facebook', label: 'Facebook' },
    { key: 'tiktok', label: 'TikTok' },
    { key: 'govbr', label: 'gov.br' },
    { key: 'cloudflare', label: 'Cloudflare' },
];
const STREAMING = [
    { key: 'youtube', label: 'YouTube' },
    { key: 'netflix', label: 'Netflix' },
    { key: 'globoplay', label: 'Globoplay' },
    { key: 'primevideo', label: 'Prime Video' },
    { key: 'disney', label: 'Disney+' },
    { key: 'max', label: 'HBO Max' },
    { key: 'spotify', label: 'Spotify' },
    { key: 'twitch', label: 'Twitch' },
];
const IPTV = [
    { key: 'clarotv', label: 'Claro TV+' },
    { key: 'skymais', label: 'SKY+' },
    { key: 'watch', label: 'Watch Brasil' },
    { key: 'zapping', label: 'Zapping' },
    { key: 'pluto', label: 'Pluto TV' },
    { key: 'samsungtv', label: 'Samsung TV Plus' },
];
const BANCOS = [
    { key: 'pix', label: 'PIX (Banco Central)' },
    { key: 'caixa', label: 'Caixa' },
    { key: 'bb', label: 'Banco do Brasil' },
    { key: 'itau', label: 'Itaú' },
    { key: 'bradesco', label: 'Bradesco' },
    { key: 'santander', label: 'Santander' },
    { key: 'nubank', label: 'Nubank' },
    { key: 'inter', label: 'Inter' },
];

async function fila(tarefas, simultaneas, aoTerminar) {
    const out = new Array(tarefas.length);
    let i = 0;
    async function trabalhador() {
        while (i < tarefas.length) {
            const k = i++;
            out[k] = await tarefas[k]().catch(() => null);
            aoTerminar && aoTerminar(out[k], k);
        }
    }
    await Promise.all(Array.from({ length: Math.min(simultaneas, tarefas.length) }, trabalhador));
    return out;
}

function comPrazo(url, ms) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    return fetch(url, { cache: 'no-store', credentials: 'omit', signal: ctrl.signal }).finally(() => clearTimeout(t));
}

/** Alcance IPv4/IPv6 por endereços que só existem numa das famílias. */
async function alcanceProtocolos(config) {
    const sondar = async (base) => {
        if (!base) return null;
        if (location.protocol === 'https:' && base.startsWith('http://')) return null;
        if (/^https?:\/\/\[/.test(base)) return null; // IPv6 por número: o navegador bloqueia; precisa de nome DNS só-IPv6
        try {
            const r = await comPrazo(base + '/api/whoami', 4000);
            return r.ok ? await r.json() : false;
        } catch { return false; }
    };
    const [v4, v6] = await Promise.all([sondar(config.ipv4Base), sondar(config.ipv6Base)]);
    return { v4, v6 };
}

/**
 * eventos: {
 *   etapa(nome), valor(tipo, valor, progresso?), status(texto), diag(chave, dados), amostra(tipo, mbps)
 * }
 */
export async function executarTeste({ modo = 'rapido', eventos, sinal }) {
    const ev = { etapa() {}, valor() {}, status() {}, diag() {}, amostra() {}, ...eventos };
    const r = {
        mode: modo, download: null, upload: null, ping: null, jitter: null, loss: null, bufferbloat: null,
        pingMin: null, pingMax: null, dlWindowMs: null, loadedLatency: { download: null, upload: null },
        advanced: null, erros: [],
    };
    const cancelou = () => { if (sinal && sinal.aborted) throw new DOMException('Teste interrompido', 'AbortError'); };
    const ouvirCancelamento = () => { M.abortar(); };
    if (sinal) sinal.addEventListener('abort', ouvirCancelamento, { once: true });

    try {
        ev.status('Conectando ao servidor da Audicom…');
        const { config } = await M.preparar();
        cancelou();

        // 1. latência em repouso (antes da banda: é a referência do bufferbloat)
        ev.etapa('ping');
        ev.status('Medindo a latência…');
        const p = await M.ping({ count: 30, warmup: 5, gapMs: 40 }, (s) => {
            ev.valor('ping', s.ping, s.done / s.total);
            if (s.jitter != null) ev.valor('jitter', s.jitter);
        });
        Object.assign(r, { ping: p.ping, jitter: p.jitter, pingMin: p.min, pingMax: p.max });
        ev.valor('ping', p.ping, 1);
        ev.valor('jitter', p.jitter, 1);
        cancelou();

        // 2 e 3. banda — com vaga no servidor, para ninguém dividir o link com outro teste
        ev.status('Reservando o servidor para o seu teste…');
        const vaga = await M.pegarVaga((q) => ev.status(q.position === 1
            ? 'O servidor está ocupado com outros testes. Você é o próximo da fila…'
            : `O servidor está ocupado com outros testes. Você é o ${q.position}º da fila…`));
        let reach = null;
        try {
            cancelou();
            ev.etapa('download');
            ev.status('Medindo o download…');
            try {
                const dl = await M.download({ token: vaga.token }, (x) => { ev.valor('download', x.mbps, x.progress); ev.amostra('download', x.mbps); });
                Object.assign(r, { download: dl.mbps, dlWindowMs: dl.windowMs });
                r.loadedLatency.download = dl.loadedPing;
                ev.valor('download', dl.mbps, 1);
            } catch (e) { cancelou(); r.erros.push('download: ' + e.message); }

            cancelou();
            await pausa(400); // deixa as filas da rede esvaziarem antes do upload
            ev.etapa('upload');
            ev.status('Medindo o upload…');
            try {
                const ul = await M.upload({ token: vaga.token }, (x) => { ev.valor('upload', x.mbps, x.progress); ev.amostra('upload', x.mbps); });
                r.upload = ul.mbps;
                r.loadedLatency.upload = ul.loadedPing;
                ev.valor('upload', ul.mbps, 1);
            } catch (e) { cancelou(); r.erros.push('upload: ' + e.message); }

            // modo completo: download separado por IPv4 e IPv6 (mesma vaga)
            if (modo === 'completo') {
                cancelou();
                ev.status('Conferindo IPv4 e IPv6…');
                const [alcance, eu] = await Promise.all([alcanceProtocolos(config), M.quemSouEu().catch(() => null)]);
                reach = alcance;
                const prot = {};
                for (const [chave, base, ok] of [['ipv4', config.ipv4Base, reach.v4], ['ipv6', config.ipv6Base, reach.v6]]) {
                    prot[chave] = { alcance: ok === null ? null : !!ok, ip: ok && ok.ip ? ok.ip : null, mbps: null };
                    if (!ok) continue;
                    try {
                        ev.status(`Medindo o download por ${chave === 'ipv4' ? 'IPv4' : 'IPv6'}…`);
                        const x = await M.download({ base, token: vaga.token, durationMs: 6000, graceMs: 1500, streams: 4, loaded: false }, () => {});
                        prot[chave].mbps = x.mbps;
                    } catch { prot[chave].mbps = null; }
                }
                // a versão do protocolo desta conexão já foi medida no teste principal
                const atual = eu && eu.family === 'IPv6' ? 'ipv6' : eu && eu.family === 'IPv4' ? 'ipv4' : null;
                if (atual && !(prot[atual].alcance && prot[atual].mbps != null)) {
                    prot[atual] = { alcance: true, ip: eu.ip || prot[atual].ip, mbps: r.download, principal: true };
                }
                ev.diag('protocolos', prot);
                r.advanced = { ...(r.advanced || {}), protocolos: prot };
            }
        } finally {
            M.liberarVaga(vaga.token).catch(() => {});
        }
        if (r.download == null && r.upload == null) throw new Error(r.erros[0] ? r.erros[0].replace(/^\w+: /, '') : 'Não foi possível medir a velocidade.');

        const pior = Math.max(r.loadedLatency.download ?? -Infinity, r.loadedLatency.upload ?? -Infinity);
        if (r.ping != null && Number.isFinite(pior)) {
            r.bufferbloat = Math.max(0, pior - r.ping);
            ev.valor('bufferbloat', r.bufferbloat, 1);
        }

        // 4. estabilidade: perda de pacotes real, por UDP
        cancelou();
        ev.etapa('estabilidade');
        ev.status('Medindo a estabilidade: enviando pacotes…');
        const udp = await M.perdaUdp({ progresso: (x) => ev.status(`Medindo a estabilidade: ${x.enviados} de ${x.total} pacotes enviados…`) });
        r.loss = udp.ok ? udp.perda : null;
        if (!udp.ok) r.erros.push('perda: ' + udp.motivo);
        ev.valor('perda', r.loss, 1);

        // 5. diagnóstico (modo completo)
        if (modo === 'completo') {
            cancelou();
            ev.etapa('diagnostico');
            ev.status('Fazendo o diagnóstico da sua rede…');
            r.advanced = { ...(r.advanced || {}), ...(await diagnostico(ev, cancelou)) };
        }
        ev.status('');
        return r;
    } finally {
        if (sinal) sinal.removeEventListener('abort', ouvirCancelamento);
    }
}

async function diagnostico(ev, cancelou) {
    const out = {};
    // relógio do aparelho (rápido, pelo WebSocket)
    try {
        const c = await M.relogio();
        out.relogio = c.synced ? { offsetS: c.offsetMs / 1000, incertezaS: c.uncertaintyMs / 1000 } : null;
    } catch { out.relogio = null; }
    ev.diag('relogio', out.relogio);
    cancelou();

    const tarefaNat = (async () => {
        const [servidor, mapa] = await Promise.all([M.natNoServidor().catch((e) => ({ erro: e.message })), M.tipoDeNat()]);
        out.nat = {
            tipo: mapa.ok ? mapa.tipo : null,
            motivoTipo: mapa.ok ? null : mapa.motivo,
            cgnat: !!servidor.cgnat,
            duploNat: servidor.doubleNat || null,
            motivo: servidor.reason || servidor.erro || null,
            roteadoresInternos: servidor.innerRouters ?? null,
            ipPrivado: !!servidor.privateIp,
            metodo: servidor.metodo || null,
            saltosAteServidor: servidor.routersBetween ?? null,
            ipServidor: servidor.ip || null,
            ipStun: mapa.ipv4 || null,
            ipMuda: !!mapa.ipMuda,
        };
        // a internet vê outro IP que o servidor: o servidor enxerga o cliente por dentro da
        // rede (IP da operadora) ou o NAT usa IPs diferentes para cada destino
        out.nat.ipsDiferentes = !!(out.nat.ipServidor && out.nat.ipStun && !out.nat.ipServidor.includes(':') && out.nat.ipServidor !== out.nat.ipStun);
        ev.diag('nat', out.nat);
        try {
            const t = await M.rota();
            out.rota = (t.hops || []).slice(0, 30).map((h) => ({ hop: h.hop, host: h.host, perda: h.lossPct, media: h.avgMs }));
        } catch (e) { out.rota = null; out.rotaErro = e.message; }
        ev.diag('rota', out.rota);
    })();

    const tarefaServicos = (async () => {
        let urls = {};
        try { urls = (await M.plataformas()).targets || {}; } catch { urls = {}; }
        const medir = (lista, chave) => {
            const res = lista.map((s) => ({ ...s, ms: null }));
            return fila(lista.map((s, i) => async () => {
                const x = await M.latenciaAte(urls[s.key]);
                res[i] = { ...s, ms: x.ms, indisponivel: !!x.indisponivel };
                return res[i];
            }), 3, () => ev.diag(chave, res.slice())).then(() => res);
        };
        out.servicos = await medir(SERVICOS, 'servicos');
        out.streaming = await medir(STREAMING, 'streaming');
        out.iptv = await medir(IPTV, 'iptv');
        out.bancos = await medir(BANCOS, 'bancos');
    })();

    const tarefaMtu = (async () => {
        try { out.mtu = await M.mtu(); } catch (e) { out.mtu = { motivo: e.message }; }
        ev.diag('mtu', out.mtu);
    })();

    await Promise.all([tarefaNat, tarefaServicos, tarefaMtu]);
    return out;
}
