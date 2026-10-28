import { WebSocketServer } from 'ws';
import { clientIp, ipFamily, randomId } from './util.js';

// Um WebSocket por teste, aberto dentro do Web Worker do cliente:
//  - "p…"  -> eco imediato, byte a byte (ping/jitter/latência sob carga)
//  - JSON  -> hora certa (NTP), fila de vagas, progresso do upload medido aqui
// Mensagens de ping não passam por JSON.parse de propósito: cada microssegundo
// gasto aqui entraria no ping medido.

const MAX_PER_IP = 40;
// Vagas por CONEXÃO (não por IP: numa empresa todo mundo sai pelo mesmo IP).
// A persistência pega uma vaga por minuto e o navegador para sozinho em 4 min;
// este teto segura um cliente modificado ou uma aba que ficou rodando à toa.
const MAX_SLOTS_PER_CONN = 10;
const SLOT_WINDOW_MS = 10 * 60_000;

export function attachWebSocket(server, { slots, clock, measurements, trustProxy, authn = null, cotas = null, log = console }) {
    const wss = new WebSocketServer({ noServer: true, maxPayload: 8 * 1024, perMessageDeflate: false });
    const perIp = new Map();

    server.on('upgrade', (req, socket, head) => {
        if (!req.url.startsWith('/ws')) { socket.destroy(); return; }
        const ip = clientIp(req, trustProxy);
        if ((perIp.get(ip) || 0) >= MAX_PER_IP) {
            socket.write('HTTP/1.1 429 Too Many Requests\r\n\r\n');
            socket.destroy();
            return;
        }
        wss.handleUpgrade(req, socket, head, (ws) => {
            socket.setNoDelay(true);
            wss.emit('connection', ws, req, ip);
        });
    });

    wss.on('connection', (ws, req, ip) => {
        perIp.set(ip, (perIp.get(ip) || 0) + 1);
        ws.isAlive = true;
        const ulTimers = new Map();
        const send = (obj) => { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); };
        // identifica esta conexão no registro de medições (conferência do resultado final)
        const connId = randomId(12);
        measurements.open(connId, ip);
        const myTokens = new Set();
        const slotTimes = [];
        // quem está logado não tem cota diária; sem login, a cota vale por aparelho e por IP
        const logado = !!(authn && authn.optionalUser(req, ip));
        let aparelho = null;
        const notify = (m) => {
            if (m.type === 'slot-granted') {
                myTokens.add(m.token);
                if (!logado && cotas) cotas.contar(ip, aparelho);
            }
            send(m);
        };
        const creditDownload = (token) => {
            const s = slots.get(token);
            if (s && s.owner === ws) { measurements.addDownloadBytes(connId, s.dlBytes); s.dlBytes = 0; }
        };

        ws.on('pong', () => { ws.isAlive = true; });

        ws.on('message', (data, isBinary) => {
            if (!isBinary && data.length && data[0] === 0x70 /* 'p' */) {
                ws.send(data, { binary: false });
                return;
            }
            let msg;
            try { msg = JSON.parse(data.toString()); } catch { return; }
            switch (msg.type) {
                case 'hello':
                    send({ type: 'hello', ip, family: ipFamily(ip), connId });
                    break;
                case 'time':
                    send({ type: 'time', c: msg.c, s: clock.now(), synced: clock.synced });
                    break;
                case 'slot-request': {
                    const now = Date.now();
                    while (slotTimes.length && slotTimes[0] < now - SLOT_WINDOW_MS) slotTimes.shift();
                    if (slotTimes.length >= MAX_SLOTS_PER_CONN) {
                        log.warn(`[slots] ${ip} pediu vaga demais nesta conexão; recusando`);
                        return send({ type: 'slot-denied', reason: 'Muitos testes seguidos nesta sessão — recarregue a página para testar de novo.' });
                    }
                    if (!logado && cotas) {
                        aparelho = typeof msg.aparelho === 'string' ? msg.aparelho.slice(0, 64) : null;
                        if (!cotas.pode(ip, aparelho)) {
                            return send({ type: 'slot-denied', code: 'limite', reason: `Você já fez ${cotas.porAparelho} testes hoje sem conta. Entre ou crie sua conta gratuita para continuar testando.` });
                        }
                    }
                    slotTimes.push(now);
                    slots.request(ws, notify);
                    break;
                }
                case 'slot-release':
                    creditDownload(msg.token);
                    myTokens.delete(msg.token);
                    slots.release(msg.token, ws);
                    stopUl(msg.token);
                    break;
                case 'ul-begin': {
                    const s = slots.get(msg.token);
                    if (!s || s.owner !== ws) return send({ type: 'error', error: 'vaga inválida' });
                    s.ulReset();
                    stopUl(msg.token);
                    ulTimers.set(msg.token, setInterval(() => send({ type: 'ul-progress', ...s.ulSnapshot() }), 200));
                    break;
                }
                case 'ul-end': {
                    const s = slots.get(msg.token);
                    stopUl(msg.token);
                    if (!s || s.owner !== ws) return send({ type: 'ul-result', error: 'vaga inválida' });
                    const grace = Math.min(Math.max(Number(msg.graceMs) || 0, 0), 10_000);
                    const result = s.ulFinish(grace);
                    if (result) measurements.addUpload(connId, result);
                    send({ type: 'ul-result', ...(result || { error: 'nenhum byte recebido' }) });
                    break;
                }
                default:
                    break;
            }
        });

        function stopUl(token) {
            const t = ulTimers.get(token);
            if (t) { clearInterval(t); ulTimers.delete(token); }
        }

        ws.on('close', () => {
            for (const t of ulTimers.values()) clearInterval(t);
            for (const t of myTokens) creditDownload(t);
            slots.dropOwner(ws);
            measurements.close(connId);
            const n = (perIp.get(ip) || 1) - 1;
            if (n <= 0) perIp.delete(ip); else perIp.set(ip, n);
        });
        ws.on('error', () => {});
    });

    const heartbeat = setInterval(() => {
        for (const ws of wss.clients) {
            if (!ws.isAlive) { ws.terminate(); continue; }
            ws.isAlive = false;
            ws.ping();
        }
    }, 30_000);
    heartbeat.unref();

    return { get clients() { return wss.clients.size; }, close() { clearInterval(heartbeat); wss.close(); } };
}
