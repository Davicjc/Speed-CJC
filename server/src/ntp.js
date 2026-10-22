import dgram from 'node:dgram';
import dns from 'node:dns/promises';
import { performance } from 'node:perf_hooks';

// Cliente SNTP (RFC 4330) usado pra saber a hora certa sem depender do
// relógio do sistema — que nesta VM nem tem NTP configurado. A checagem de
// "relógio do seu aparelho" compara o celular do cliente com ESTA hora, então
// ela precisa estar certa de verdade, não "a hora que o servidor acha".
//
// Base de tempo monotônica (timeOrigin + performance.now()): se alguém mexer
// no relógio do sistema com o processo rodando, nada aqui pula.

const NTP_EPOCH_OFFSET = 2208988800; // segundos entre 1900-01-01 e 1970-01-01
const monoNow = () => performance.timeOrigin + performance.now();

function readTimestamp(buf, off) {
    const secs = buf.readUInt32BE(off);
    const frac = buf.readUInt32BE(off + 4);
    return (secs - NTP_EPOCH_OFFSET) * 1000 + (frac / 2 ** 32) * 1000;
}
function writeTimestamp(buf, off, ms) {
    const secs = Math.floor(ms / 1000) + NTP_EPOCH_OFFSET;
    const frac = Math.round(((ms % 1000) / 1000) * 2 ** 32) >>> 0;
    buf.writeUInt32BE(secs >>> 0, off);
    buf.writeUInt32BE(frac, off + 4);
}

function queryOnce(address, family, timeoutMs = 1500) {
    return new Promise((resolve, reject) => {
        const sock = dgram.createSocket(family === 6 ? 'udp6' : 'udp4');
        const pkt = Buffer.alloc(48);
        pkt[0] = 0x23; // LI=0, versão 4, modo 3 (cliente)
        const t1 = monoNow();
        writeTimestamp(pkt, 40, t1);
        const timer = setTimeout(() => { sock.close(); reject(new Error('timeout')); }, timeoutMs);
        sock.once('error', (e) => { clearTimeout(timer); sock.close(); reject(e); });
        sock.once('message', (msg) => {
            const t4 = monoNow();
            clearTimeout(timer);
            sock.close();
            if (msg.length < 48) return reject(new Error('resposta curta'));
            const li = msg[0] >> 6;
            const mode = msg[0] & 7;
            const stratum = msg[1];
            if (mode !== 4 || stratum === 0 || stratum > 15 || li === 3) return reject(new Error('servidor não sincronizado'));
            // O servidor tem que devolver nosso transmit timestamp no campo originate.
            if (Math.abs(readTimestamp(msg, 24) - t1) > 1) return reject(new Error('resposta não corresponde'));
            const t2 = readTimestamp(msg, 32);
            const t3 = readTimestamp(msg, 40);
            const offset = ((t2 - t1) + (t3 - t4)) / 2;
            const delay = (t4 - t1) - (t3 - t2);
            if (delay < 0 || delay > 1000) return reject(new Error('atraso inválido'));
            resolve({ offset, delay, stratum });
        });
        sock.send(pkt, 123, address);
    });
}

async function queryServer(host) {
    const { address, family } = await dns.lookup(host);
    let best = null;
    for (let i = 0; i < 4; i++) {
        try {
            const s = await queryOnce(address, family);
            if (!best || s.delay < best.delay) best = s;
        } catch { /* tenta de novo */ }
        await new Promise(r => setTimeout(r, 200));
    }
    if (!best) throw new Error(`sem resposta de ${host}`);
    return { host, ...best };
}

const median = (arr) => {
    const s = [...arr].sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export function createClock(servers, log = console) {
    let offset = null;      // hora certa = monoNow() + offset
    let lastSync = 0;
    let lastSamples = [];

    async function sync() {
        const results = await Promise.allSettled(servers.map(queryServer));
        const ok = results.filter(r => r.status === 'fulfilled').map(r => r.value);
        if (!ok.length) {
            log.warn('[ntp] nenhum servidor NTP respondeu; mantendo a última sincronização');
            return;
        }
        offset = median(ok.map(s => s.offset));
        lastSync = Date.now();
        lastSamples = ok.map(s => ({ host: s.host, delayMs: +s.delay.toFixed(2), stratum: s.stratum }));
        const sysError = (monoNow() + offset) - Date.now();
        log.info(`[ntp] sincronizado com ${ok.length} servidor(es); relógio do sistema ${sysError >= 0 ? 'atrasado' : 'adiantado'} ${Math.abs(sysError).toFixed(1)} ms`);
    }

    const timer = setInterval(() => sync().catch(() => {}), 10 * 60_000);
    timer.unref();

    return {
        sync,
        get synced() { return offset != null && Date.now() - lastSync < 45 * 60_000; },
        /** Hora UTC certa em ms (com fração), ou null se nunca sincronizou. */
        now() { return offset == null ? null : monoNow() + offset; },
        status() {
            return {
                synced: this.synced,
                lastSync: lastSync || null,
                systemClockErrorMs: offset == null ? null : +((monoNow() + offset) - Date.now()).toFixed(1),
                servers: lastSamples,
            };
        },
        stop() { clearInterval(timer); },
    };
}
