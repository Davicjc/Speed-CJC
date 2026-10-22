import crypto from 'node:crypto';
import { performance } from 'node:perf_hooks';

// Vagas de medição de banda. Download/upload competem pelo mesmo link do
// servidor: se 30 pessoas medirem ao mesmo tempo, cada uma vê 1/30 da banda
// e o número dela fica errado (menor do que a conexão dela entrega). Por isso
// só N testes de banda rodam juntos; os demais esperam numa fila — com a
// posição mostrada na tela — em vez de receberem um resultado falso.
//
// O upload é medido AQUI, no lado que recebe os bytes (como fazem Ookla e
// afins): o progresso do XHR no navegador conta o que foi entregue ao sistema
// operacional do cliente, não o que chegou de fato — superestima no começo.

const BUCKET_MS = 50;
const now = () => performance.now();

class Session {
    constructor(token, owner, ttlMs) {
        this.token = token;
        this.owner = owner;
        this.grantedAt = Date.now();
        this.expiresAt = Date.now() + ttlMs;
        this.ul = null;
        this.dlBytes = 0;
    }

    ulReset() {
        this.ul = { start: null, last: null, total: 0, buckets: new Map(), endAt: null };
    }

    ulAdd(n) {
        if (!this.ul) this.ulReset();
        const ul = this.ul;
        if (ul.endAt != null) return;
        const t = now();
        if (ul.start == null) ul.start = t;
        ul.last = t;
        ul.total += n;
        const b = Math.floor((t - ul.start) / BUCKET_MS);
        ul.buckets.set(b, (ul.buckets.get(b) || 0) + n);
    }

    /** bytes/ms recebidos numa janela [fromMs, toMs] relativa ao 1º byte. */
    ulBytesBetween(fromMs, toMs) {
        let bytes = 0;
        for (const [b, n] of this.ul.buckets) {
            const t = b * BUCKET_MS;
            if (t >= fromMs && t < toMs) bytes += n;
        }
        return bytes;
    }

    ulSnapshot() {
        const ul = this.ul;
        if (!ul || ul.start == null) return { bytes: 0, elapsedMs: 0, mbpsNow: 0 };
        const elapsed = ul.last - ul.start;
        const win = 1000;
        const recent = this.ulBytesBetween(Math.max(0, elapsed - win), elapsed + BUCKET_MS);
        const span = Math.min(win, elapsed + BUCKET_MS);
        return { bytes: ul.total, elapsedMs: elapsed, mbpsNow: span > 0 ? (recent * 8) / (span * 1000) : 0 };
    }

    ulFinish(graceMs) {
        const ul = this.ul;
        if (!ul || ul.start == null) return null;
        ul.endAt = now();
        const end = Math.min(ul.last, ul.endAt) - ul.start;
        const from = Math.min(graceMs, Math.max(0, end - 1000)); // conexão curta: ainda mede algo honesto
        const windowMs = end - from;
        if (windowMs <= 0) return null;
        const bytes = this.ulBytesBetween(from, end + BUCKET_MS);
        return { mbps: (bytes * 8) / (windowMs * 1000), bytes, windowMs: Math.round(windowMs), totalBytes: ul.total };
    }
}

export function createSlotManager({ max, ttlMs, log = console }) {
    const active = new Map();   // token -> Session
    const queue = [];           // { owner, resolve }
    let served = 0;

    function broadcastQueue() {
        queue.forEach((q, i) => {
            q.notify({ type: 'slot-wait', position: i + 1, active: active.size, max });
        });
    }

    function grant(owner, notify) {
        const token = crypto.randomBytes(18).toString('base64url');
        const s = new Session(token, owner, ttlMs);
        active.set(token, s);
        served++;
        notify({ type: 'slot-granted', token, ttlMs });
        return s;
    }

    function pump() {
        while (active.size < max && queue.length) {
            const q = queue.shift();
            grant(q.owner, q.notify);
        }
        broadcastQueue();
    }

    function release(token) {
        if (active.delete(token)) pump();
    }

    const sweeper = setInterval(() => {
        const t = Date.now();
        for (const [token, s] of active) {
            if (s.expiresAt < t) { log.warn('[slots] vaga expirada sem liberar, recolhendo'); release(token); }
        }
    }, 5000);
    sweeper.unref();

    return {
        request(owner, notify) {
            if (queue.some(q => q.owner === owner)) return;
            if (active.size < max && !queue.length) { grant(owner, notify); return; }
            queue.push({ owner, notify });
            broadcastQueue();
        },
        release(token, owner) {
            const s = active.get(token);
            if (s && (!owner || s.owner === owner)) release(token);
        },
        dropOwner(owner) {
            const qi = queue.findIndex(q => q.owner === owner);
            if (qi >= 0) queue.splice(qi, 1);
            for (const [token, s] of active) if (s.owner === owner) active.delete(token);
            pump();
        },
        get(token) {
            const s = token && active.get(token);
            return s && s.expiresAt >= Date.now() ? s : null;
        },
        stats() { return { active: active.size, queued: queue.length, max, served }; },
    };
}
