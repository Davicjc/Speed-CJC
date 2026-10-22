// Quem está com o site aberto AGORA (logado). O navegador manda um "sinal de
// vida" a cada 30 s; sem sinal por 75 s, a pessoa sai da lista. Fica só na
// memória do servidor — é um retrato do momento, não um histórico.

const TIMEOUT_MS = 75_000;

export function createPresence({ onChange = () => {} } = {}) {
    const online = new Map(); // uid -> info

    function emit() { onChange(list()); }

    const sweeper = setInterval(() => {
        const cutoff = Date.now() - TIMEOUT_MS;
        let changed = false;
        for (const [uid, p] of online) if (p.lastSeen < cutoff) { online.delete(uid); changed = true; }
        if (changed) emit();
    }, 10_000);
    sweeper.unref();

    function list() {
        return [...online.values()].sort((a, b) => b.lastSeen - a.lastSeen);
    }

    return {
        beat(uid, info) {
            const prev = online.get(uid);
            const next = {
                uid,
                name: info.name || null,
                email: info.email || null,
                admin: !!info.admin,
                page: info.page || null,
                state: info.state || 'online',
                ip: info.ip || null,
                city: info.city || null,
                isp: info.isp || null,
                device: info.device || null,
                since: prev ? prev.since : Date.now(),
                lastSeen: Date.now(),
            };
            online.set(uid, next);
            if (!prev || prev.page !== next.page || prev.state !== next.state) emit();
        },
        bye(uid) {
            if (online.delete(uid)) emit();
        },
        list,
        get count() { return online.size; },
        isOnline: (uid) => online.has(uid),
    };
}

/**
 * Canal ao vivo do painel de administração (Server-Sent Events). Cada admin
 * conectado recebe na hora: teste novo, cadastro novo e mudança em quem está
 * online. A conexão fecha quando o token de login expira; o navegador
 * reconecta com um token novo.
 */
export function createEventHub({ log = console } = {}) {
    const clients = new Set();

    const keepAlive = setInterval(() => {
        for (const c of clients) c.res.write(': ok\n\n');
    }, 25_000);
    keepAlive.unref();

    return {
        subscribe(req, res, { user, expiresAt, initial = [] }) {
            res.writeHead(200, {
                'Content-Type': 'text/event-stream; charset=utf-8',
                'Cache-Control': 'no-store, no-transform',
                Connection: 'keep-alive',
                'X-Accel-Buffering': 'no',
            });
            res.write('retry: 4000\n\n');
            const client = { res, user };
            clients.add(client);
            for (const [type, data] of initial) res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
            const ttl = Math.max(5_000, expiresAt * 1000 - Date.now());
            const timer = setTimeout(() => { res.write('event: reauth\ndata: {}\n\n'); res.end(); }, ttl);
            const close = () => { clearTimeout(timer); clients.delete(client); };
            req.on('close', close);
            res.on('error', close);
        },
        publish(type, data) {
            if (!clients.size) return;
            const msg = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
            for (const c of clients) {
                try { c.res.write(msg); } catch (e) { log.warn('[ao vivo] falha ao enviar:', e.message); }
            }
        },
        get size() { return clients.size; },
    };
}
