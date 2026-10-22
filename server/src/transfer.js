import crypto from 'node:crypto';
import { sendJson } from './util.js';

// 8 MiB de bytes aleatórios gerados uma vez: incompressíveis (nenhum proxy ou
// modem "acelera" o teste comprimindo zeros) e sem custo de CPU por cliente.
const POOL = crypto.randomFillSync(Buffer.allocUnsafe(8 * 1024 * 1024));
const CHUNK = 1024 * 1024;

export const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '600',
};

export function handleDownload(req, res, url, slots, maxBytes) {
    const session = slots.get(url.searchParams.get('t'));
    if (!session) return sendJson(res, 403, { error: 'vaga de teste inválida ou expirada' }, CORS);

    const requested = Number.parseInt(url.searchParams.get('bytes') || '', 10);
    const total = Number.isFinite(requested) ? Math.min(Math.max(requested, 1), maxBytes) : 25 * 1024 * 1024;

    res.writeHead(200, {
        ...CORS,
        'Content-Type': 'application/octet-stream',
        'Content-Length': total,
        'Cache-Control': 'no-store, no-transform',
        'X-Content-Type-Options': 'nosniff',
    });

    let remaining = total;
    let offset = crypto.randomInt(0, POOL.length - CHUNK);
    let closed = false;
    res.on('close', () => { closed = true; });

    const pump = () => {
        while (remaining > 0 && !closed) {
            const n = Math.min(CHUNK, remaining);
            if (offset + n > POOL.length) offset = 0;
            const ok = res.write(POOL.subarray(offset, offset + n));
            offset += n;
            remaining -= n;
            session.dlBytes += n;
            if (!ok) { res.once('drain', pump); return; }
        }
        if (!closed) res.end();
    };
    pump();
}

export function handleUpload(req, res, url, slots, maxBytes) {
    const session = slots.get(url.searchParams.get('t'));
    if (!session) {
        req.resume();
        return sendJson(res, 403, { error: 'vaga de teste inválida ou expirada' }, CORS);
    }
    let received = 0;
    req.on('data', (chunk) => {
        received += chunk.length;
        session.ulAdd(chunk.length);
        if (received > maxBytes) req.destroy();
    });
    req.on('end', () => sendJson(res, 200, { bytes: received }, CORS));
    req.on('error', () => {});
}
