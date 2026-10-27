import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';

const TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.webmanifest': 'application/manifest+json; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.woff2': 'font/woff2',
};
const COMPRESSIBLE = new Set(['.html', '.css', '.js', '.mjs', '.json', '.svg', '.webmanifest', '.txt']);
const gzCache = new Map();

// Páginas com endereço "limpo" (sem .html)
export const PAGES = {
    '/': 'index.html',
    '/entrar': 'entrar.html',
    '/cadastro': 'entrar.html',
    '/painel': 'painel.html',
    '/tecnico': 'tecnico.html',
    '/admin': 'admin.html',
    '/como-medimos': 'como-medimos.html',
    '/privacidade': 'privacidade.html',
    '/termos': 'termos.html',
};

/**
 * Serve só o que é do site: nunca a pasta do servidor, .git, .claude,
 * arquivos .md etc. que moram na mesma pasta do projeto.
 */
export function resolvePublic(root, urlPath) {
    let rel;
    try { rel = decodeURIComponent(urlPath); } catch { return null; }
    const allowed = ['/favicon.ico', '/robots.txt', '/site.webmanifest'].includes(rel) || /^\/(css|js|assets|vendor)\/[\w\-./]+$/.test(rel);
    if (!allowed || rel.includes('..') || rel.includes('\0')) return null;
    const abs = path.join(root, rel);
    return abs.startsWith(root + path.sep) ? abs : null;
}

export async function serveFile(req, res, abs, { cacheControl, headers: extra = {}, status = 200 } = {}) {
    let st;
    try {
        st = await fsp.stat(abs);
        if (!st.isFile()) throw new Error('não é arquivo');
    } catch {
        return false;
    }
    const ext = path.extname(abs).toLowerCase();
    const type = TYPES[ext] || 'application/octet-stream';
    const etag = `W/"${st.size.toString(36)}-${Math.floor(st.mtimeMs).toString(36)}"`;
    const cc = cacheControl || (ext === '.html' || ext === '.js' || ext === '.css' ? 'no-cache' : 'public, max-age=604800');
    const headers = { ...extra, 'Content-Type': type, 'Cache-Control': cc, ETag: etag, 'Last-Modified': st.mtime.toUTCString(), 'Accept-Ranges': 'bytes', Vary: 'Accept-Encoding' };

    if (status === 200 && req.headers['if-none-match'] === etag) {
        res.writeHead(304, headers);
        res.end();
        return true;
    }

    // Range: Safari/iOS não toca <video> sem suporte a Range.
    const range = req.headers.range;
    if (range && status === 200) {
        const m = /^bytes=(\d*)-(\d*)$/.exec(range);
        let start = m && m[1] !== '' ? Number(m[1]) : null;
        let end = m && m[2] !== '' ? Number(m[2]) : null;
        if (start == null && end != null) { start = Math.max(0, st.size - end); end = st.size - 1; }
        if (end == null || end >= st.size) end = st.size - 1;
        if (!m || start == null || start > end) {
            res.writeHead(416, { 'Content-Range': `bytes */${st.size}` });
            res.end();
            return true;
        }
        res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1 });
        if (req.method === 'HEAD') { res.end(); return true; }
        fs.createReadStream(abs, { start, end }).pipe(res);
        return true;
    }

    if (COMPRESSIBLE.has(ext) && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
        const key = `${abs}:${st.mtimeMs}`;
        let gz = gzCache.get(key);
        if (!gz) {
            gz = zlib.gzipSync(await fsp.readFile(abs), { level: 9 });
            gzCache.set(key, gz);
            if (gzCache.size > 300) gzCache.delete(gzCache.keys().next().value);
        }
        res.writeHead(status, { ...headers, 'Content-Encoding': 'gzip', 'Content-Length': gz.length });
        res.end(req.method === 'HEAD' ? undefined : gz);
        return true;
    }

    res.writeHead(status, { ...headers, 'Content-Length': st.size });
    if (req.method === 'HEAD') { res.end(); return true; }
    fs.createReadStream(abs).pipe(res);
    return true;
}
