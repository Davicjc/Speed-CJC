import crypto from 'node:crypto';
import net from 'node:net';

/**
 * O pedido veio do proxy reverso (Caddy) nesta mesma máquina? Só nesse caso
 * os cabeçalhos X-Forwarded-* valem: quem acessa a porta do Node direto não
 * consegue forjar o próprio IP mandando um X-Forwarded-For inventado.
 */
export function fromLocalProxy(req) {
    const a = req.socket.remoteAddress || '';
    return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
}

/** IP do cliente, normalizado (tira o prefixo ::ffff: de IPv4 mapeado). */
export function clientIp(req, trustProxy) {
    let ip = req.socket.remoteAddress || '';
    if (trustProxy && fromLocalProxy(req)) {
        const fwd = req.headers['x-forwarded-for'];
        // o último da lista é o que o nosso proxy acrescentou (o resto veio do cliente)
        if (typeof fwd === 'string' && fwd.trim()) ip = fwd.split(',').map(s => s.trim()).filter(Boolean).pop() || ip;
    }
    if (ip.startsWith('::ffff:') && net.isIPv4(ip.slice(7))) ip = ip.slice(7);
    return ip;
}

export function ipFamily(ip) {
    return net.isIPv4(ip) ? 'IPv4' : net.isIPv6(ip) ? 'IPv6' : null;
}

export function isPrivateIp(ip) {
    if (net.isIPv4(ip)) {
        const [a, b] = ip.split('.').map(Number);
        return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
            || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254);
    }
    const l = ip.toLowerCase();
    return l === '::1' || l.startsWith('fc') || l.startsWith('fd') || l.startsWith('fe80');
}

const B62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
export function randomId(len = 10) {
    const bytes = crypto.randomBytes(len * 2);
    let out = '';
    for (let i = 0; out.length < len && i < bytes.length; i++) {
        if (bytes[i] < 248) out += B62[bytes[i] % 62]; // 248 = 4*62, evita viés de módulo
    }
    return out.length === len ? out : randomId(len);
}

export function sendJson(res, status, body, extraHeaders = {}) {
    const data = JSON.stringify(body);
    res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(data),
        'Cache-Control': 'no-store',
        ...extraHeaders,
    });
    res.end(data);
}

export function readJsonBody(req, limit = 64 * 1024) {
    return new Promise((resolve, reject) => {
        let size = 0;
        const chunks = [];
        req.on('data', (c) => {
            size += c.length;
            if (size > limit) { reject(Object.assign(new Error('corpo grande demais'), { status: 413 })); req.destroy(); return; }
            chunks.push(c);
        });
        req.on('end', () => {
            try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
            catch { reject(Object.assign(new Error('JSON inválido'), { status: 400 })); }
        });
        req.on('error', reject);
    });
}

/**
 * Limitador por chave (normalmente IP) em janela deslizante. Generoso de
 * propósito: com CGNAT (comum no Brasil) muita gente sai pelo mesmo IP.
 */
export function createRateLimiter({ max, windowMs }) {
    const hits = new Map();
    const timer = setInterval(() => {
        const cutoff = Date.now() - windowMs;
        for (const [k, arr] of hits) {
            while (arr.length && arr[0] < cutoff) arr.shift();
            if (!arr.length) hits.delete(k);
        }
    }, 60_000);
    timer.unref();
    return {
        take(key) {
            const now = Date.now();
            let arr = hits.get(key);
            if (!arr) hits.set(key, (arr = []));
            while (arr.length && arr[0] < now - windowMs) arr.shift();
            if (arr.length >= max) return false;
            arr.push(now);
            return true;
        },
    };
}

export const median = (arr) => {
    if (!arr.length) return null;
    const s = [...arr].sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
