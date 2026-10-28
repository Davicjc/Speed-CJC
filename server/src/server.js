import dns from 'node:dns/promises';
import fsp from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import zlib from 'node:zlib';

import { createAuthn } from './authn.js';
import { createCaptcha } from './captcha.js';
import { config } from './config.js';
import { createBackups, openDatabase } from './db.js';
import { createGeocoder } from './geo.js';
import { lookupIsp } from './isp.js';
import { createMailer } from './mail.js';
import { createMeasurementLog } from './measurements.js';
import { analyzeNat } from './nat.js';
import { createClock } from './ntp.js';
import { createPlatformTargets } from './platforms.js';
import { createEventHub, createPresence } from './presence.js';
import { renderResultPage } from './result-page.js';
import { validateResult, verifyAgainstServer } from './results.js';
import { handleAccount } from './routes-account.js';
import { createAdminRoutes } from './routes-admin.js';
import { createTecnicoRoutes } from './routes-tecnico.js';
import { createSessions } from './sessions.js';
import { createSlotManager } from './slots.js';
import { PAGES, resolvePublic, serveFile } from './static.js';
import { createTestsStore } from './tests-store.js';
import { createTracer } from './trace.js';
import { CORS, handleDownload, handleUpload } from './transfer.js';
import { createUsers } from './users.js';
import { clientIp, createRateLimiter, fromLocalProxy, ipFamily, isPrivateIp, readJsonBody, sendJson } from './util.js';
import { createRtcResponder } from './webrtc.js';
import { attachWebSocket } from './ws.js';

const log = {
    info: (...a) => console.log(new Date().toISOString(), ...a),
    warn: (...a) => console.warn(new Date().toISOString(), ...a),
    error: (...a) => console.error(new Date().toISOString(), ...a),
};

const FOOTER_ORIGIN = 'https://recursos.cjc.pics';

// ---------- serviços ----------
const db = openDatabase(config.dbFile, log);
const backups = createBackups({ db, dataDir: config.dataDir, dias: config.backupDays, log });
const mailer = createMailer(config.mail, { log });
if (mailer.enabled) mailer.verificar();
const users = createUsers({ db, mailEnabled: mailer.enabled, log });
const sessions = createSessions({ db, sessionDays: config.sessionDays, log });
const store = createTestsStore({ db, log });
const authn = createAuthn({ sessions, users, log });
const captcha = createCaptcha({ dataDir: config.dataDir, turnstileSiteKey: config.captcha.turnstileSiteKey, turnstileSecret: config.captcha.turnstileSecret, powMax: config.captcha.powMax, log });
const geo = createGeocoder({ provider: config.geocoder, url: config.nominatimUrl, userAgent: `audicom-speedtest/2.0 (${config.publicUrl || config.support.site}; ${config.support.email})`, log });
const hub = createEventHub({ log });
const presence = createPresence({ onChange: (items) => hub.publish('presence', { items }) });
const clock = createClock(config.ntpServers, log);
const slots = createSlotManager({ max: config.maxConcurrentTests, ttlMs: config.slotTtlMs, log });
const rtc = createRtcResponder({ udpPort: config.udpPort, publicIPv4: config.publicIPv4, maxPeers: config.maxPeers, log });
const tracer = createTracer({ maxConcurrent: config.maxTraces, log });
const measurements = createMeasurementLog();
const platforms = createPlatformTargets({ log });
platforms.check().catch((e) => log.warn('[plataformas] checagem inicial falhou:', e.message));

const limits = {
    results: createRateLimiter({ max: 120, windowMs: 60 * 60_000 }),
    rtc: createRateLimiter({ max: 120, windowMs: 60 * 60_000 }),
    trace: createRateLimiter({ max: 60, windowMs: 60 * 60_000 }),
    nat: createRateLimiter({ max: 40, windowMs: 60 * 60_000 }),
    signup: createRateLimiter({ max: config.signupPerHour, windowMs: 60 * 60_000 }),
    captcha: createRateLimiter({ max: 40, windowMs: 10 * 60_000 }),
    claim: createRateLimiter({ max: 40, windowMs: 60 * 60_000 }),
    presence: createRateLimiter({ max: 12, windowMs: 60_000 }),
    me: createRateLimiter({ max: 400, windowMs: 10 * 60_000 }),
    admin: createRateLimiter({ max: 1500, windowMs: 10 * 60_000 }),
    publicResult: createRateLimiter({ max: 300, windowMs: 10 * 60_000 }),
    loginIp: createRateLimiter({ max: 30, windowMs: 15 * 60_000 }),
    codigos: createRateLimiter({ max: 30, windowMs: 15 * 60_000 }),
    reenvio: createRateLimiter({ max: 3, windowMs: 60 * 60_000 }),
    esqueci: createRateLimiter({ max: 10, windowMs: 60 * 60_000 }),
    esqueciEmail: createRateLimiter({ max: 3, windowMs: 60 * 60_000 }),
};

const ctx = { config, db, users, sessions, store, authn, captcha, mailer, backups, geo, hub, presence, clock, slots, rtc, platforms, limits, lookupIsp, isHttps, siteOrigin, log };
const handleAdmin = createAdminRoutes(ctx);
const handleTecnico = createTecnicoRoutes({ authn, store, users });

const err = (status, message, code) => Object.assign(new Error(message), { status, code });

// ---------- utilidades de requisição ----------
function isHttps(req) {
    if (req.socket.encrypted) return true;
    return config.trustProxy && fromLocalProxy(req) && /^https$/i.test(String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim());
}
function siteOrigin(req) {
    if (config.publicUrl) return config.publicUrl.replace(/\/$/, '');
    let host = String(req.headers['x-forwarded-host'] && config.trustProxy && fromLocalProxy(req) ? req.headers['x-forwarded-host'] : req.headers.host || 'localhost').split(',')[0].trim();
    // vai parar no HTML (endereço canônico, prévia): só nome, IPv4 ou [IPv6], com porta opcional
    if (!/^([A-Za-z0-9.-]+|\[[0-9A-Fa-f:.]+\])(:\d{1,5})?$/.test(host)) host = 'localhost';
    return `${isHttps(req) ? 'https' : 'http'}://${host}`;
}

/**
 * Endereço para o teste de alcance IPv4/IPv6. Em HTTPS o navegador bloqueia
 * chamada http:// vinda de página https:// (conteúdo misto) — por isso o
 * esquema acompanha o da página e, no ideal, IPV4_BASE_URL e IPV6_BASE_URL
 * apontam para nomes DNS só-A e só-AAAA.
 */
function baseUrl(family, req) {
    const fixed = family === 'IPv6' ? config.ipv6Base : config.ipv4Base;
    if (fixed) return fixed.replace(/\/$/, '');
    const addr = family === 'IPv6' ? config.publicIPv6 : config.publicIPv4;
    if (!addr) return null;
    const proto = req && isHttps(req) ? 'https' : 'http';
    const porta = proto === 'https' ? (config.publicPort === 443 ? '' : ':' + config.publicPort)
        : (config.publicPort === 80 ? '' : ':' + config.publicPort);
    const host = family === 'IPv6' ? `[${addr}]` : addr;
    return `${proto}://${host}${porta}`;
}

const originOf = (u) => { try { return new URL(u).origin; } catch { return null; } };

// ---------- páginas: endereço do site, prévia e estatísticas ----------
// A administração e o /tecnico (ferramentas internas) ficam fora das estatísticas.
const comEstatistica = (page) => Boolean(config.gaId) && page !== 'admin' && page !== 'tecnico';

function tagsEstatistica(page) {
    if (!comEstatistica(page)) return '';
    return `<link rel="preconnect" href="https://www.googletagmanager.com">
<script async src="https://www.googletagmanager.com/gtag/js?id=${config.gaId}"></script>
<script src="/js/analytics.js" data-ga="${config.gaId}"></script>
`;
}

/**
 * Página HTML pronta: troca {{ORIGEM}} pelo endereço do site (canônico, prévia,
 * dados estruturados) e acrescenta o Google Analytics, se configurado.
 * Guardada em memória já comprimida.
 */
const paginasProntas = new Map();
async function paginaPronta(arquivo, page, req) {
    const abs = path.join(config.staticDir, arquivo);
    const st = await fsp.stat(abs);
    const origem = siteOrigin(req);
    const chave = `${arquivo}:${st.mtimeMs}:${origem}`;
    let p = paginasProntas.get(chave);
    if (!p) {
        const html = (await fsp.readFile(abs, 'utf8'))
            .replaceAll('{{ORIGEM}}', origem)
            .replace('content="/assets/og.png"', `content="${origem}/assets/og.png"`)
            .replace('</head>', `${tagsEstatistica(page)}</head>`);
        p = { html: Buffer.from(html), gz: zlib.gzipSync(html, { level: 9 }) };
        paginasProntas.set(chave, p);
        if (paginasProntas.size > 60) paginasProntas.delete(paginasProntas.keys().next().value);
    }
    return p;
}

function enviarPagina(req, res, p, headers, status = 200) {
    const gz = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
    const corpo = gz ? p.gz : p.html;
    res.writeHead(status, { ...headers, 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', Vary: 'Accept-Encoding', 'Content-Length': corpo.length, ...(gz ? { 'Content-Encoding': 'gzip' } : {}) });
    res.end(req.method === 'HEAD' ? undefined : corpo);
}

/** Páginas que o Google deve encontrar (as de conta e administração ficam de fora). */
const NO_MAPA = [['/', 'index.html', '1.0', 'weekly'], ['/como-medimos', 'como-medimos.html', '0.8', 'monthly'], ['/privacidade', 'privacidade.html', '0.3', 'yearly'], ['/termos', 'termos.html', '0.3', 'yearly'], ['/tree', 'tree.html', '0.3', 'monthly']];

async function mapaDoSite(req) {
    const origem = siteOrigin(req);
    const urls = await Promise.all(NO_MAPA.map(async ([caminho, arquivo, prioridade, freq]) => {
        const st = await fsp.stat(path.join(config.staticDir, arquivo)).catch(() => null);
        return `  <url><loc>${origem}${caminho}</loc>${st ? `<lastmod>${st.mtime.toISOString().slice(0, 10)}</lastmod>` : ''}<changefreq>${freq}</changefreq><priority>${prioridade}</priority></url>`;
    }));
    return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}

const robots = (req) => `User-agent: *
Allow: /
Disallow: /api/
Disallow: /admin
Disallow: /painel
Disallow: /tecnico

Sitemap: ${siteOrigin(req)}/sitemap.xml
`;

/** Política de segurança de conteúdo: libera só o que cada página usa. */
function securityHeaders(req, page) {
    const host = req.headers.host || 'localhost';
    const https = isHttps(req);
    const connect = new Set(["'self'", `${https ? 'wss' : 'ws'}://${host}`]);
    const scripts = new Set(["'self'", FOOTER_ORIGIN]);
    const frames = new Set();
    const imgs = new Set(["'self'", 'data:', 'blob:']);
    if (page === 'teste' || page === 'tecnico') {
        // IPv6 literal ([2804:…]) não é aceito em CSP: só nome DNS (v6.seu-dominio)
        for (const b of [baseUrl('IPv4', req), baseUrl('IPv6', req)]) { const o = b && originOf(b); if (o && !o.includes('[')) connect.add(o); }
        for (const u of Object.values(platforms.list().targets || {})) { const o = u && originOf(u); if (o) connect.add(o); }
    }
    if (page === 'entrar' && captcha.provider === 'turnstile') {
        scripts.add('https://challenges.cloudflare.com');
        frames.add('https://challenges.cloudflare.com');
        connect.add('https://challenges.cloudflare.com');
    }
    if (comEstatistica(page)) {
        // Google Analytics 4 (lista oficial de domínios do GA4 para CSP)
        scripts.add('https://*.googletagmanager.com');
        for (const o of ['https://*.google-analytics.com', 'https://*.googletagmanager.com']) imgs.add(o);
        for (const o of ['https://*.google-analytics.com', 'https://*.analytics.google.com', 'https://*.googletagmanager.com']) connect.add(o);
    }
    if (page === 'painel' || page === 'admin' || page === 'tecnico') {
        const tiles = config.map.tiles.replace('{s}', 'a');
        const o = originOf(tiles.replace(/\{[^}]+\}/g, '0'));
        if (o) {
            imgs.add(o);
            if (config.map.tiles.includes('{s}')) imgs.add(o.replace('://a.', '://*.'));
        }
    }
    const csp = [
        "default-src 'self'",
        `script-src ${[...scripts].join(' ')}`,
        // 'unsafe-inline' só em estilos: o selo do rodapé e o mapa aplicam estilo pelo JS
        "style-src 'self' 'unsafe-inline'",
        "font-src 'self'",
        `img-src ${[...imgs].join(' ')}`,
        `connect-src ${[...connect].join(' ')}`,
        `frame-src ${frames.size ? [...frames].join(' ') : "'none'"}`,
        "worker-src 'self'",
        "manifest-src 'self'",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'self'",
        "frame-ancestors 'none'",
    ];
    if (https) csp.push('upgrade-insecure-requests');
    const h = {
        'Content-Security-Policy': csp.join('; '),
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
        'X-Frame-Options': 'DENY',
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Permissions-Policy': 'geolocation=(self), camera=(), microphone=(), payment=(), usb=()',
    };
    if (https) h['Strict-Transport-Security'] = 'max-age=31536000';
    return h;
}

// ---------- rotas de medição e públicas ----------
async function handleApi(req, res, url, ip) {
    const p = url.pathname;
    const m = req.method;

    if (m === 'OPTIONS') { res.writeHead(204, CORS); res.end(); return; }
    if (p === '/api/download' && m === 'GET') return handleDownload(req, res, url, slots, config.maxTransferBytes);
    if (p === '/api/upload' && m === 'POST') return handleUpload(req, res, url, slots, config.maxTransferBytes);

    if (p === '/api/config' && m === 'GET') {
        return sendJson(res, 200, {
            serverName: config.serverName,
            serverLocation: config.serverLocation,
            ipv4Base: baseUrl('IPv4', req),
            ipv6Base: baseUrl('IPv6', req),
            clock: clock.status(),
            maxConcurrentTests: config.maxConcurrentTests,
            accounts: true,
            mail: mailer.enabled,
            captcha: captcha.publicConfig(),
            map: config.map,
            support: config.support,
        });
    }

    if (p === '/api/whoami' && m === 'GET') {
        const info = await lookupIsp(ip);
        return sendJson(res, 200, { ip, family: ipFamily(ip), ...info }, CORS);
    }
    if (p === '/api/platforms' && m === 'GET') return sendJson(res, 200, platforms.list());
    if (p === '/api/time' && m === 'GET') return sendJson(res, 200, { s: clock.now(), synced: clock.synced }, CORS);

    if (p === '/api/rtc/offer' && m === 'POST') {
        if (!limits.rtc.take(ip)) throw err(429, 'muitas tentativas, aguarde um pouco');
        const body = await readJsonBody(req, 16 * 1024);
        if (body.type !== 'offer' || typeof body.sdp !== 'string') throw err(400, 'oferta inválida');
        return sendJson(res, 200, await rtc.answer(body.sdp));
    }
    if (p === '/api/trace' && m === 'GET') {
        if (!limits.trace.take(ip)) throw err(429, 'muitas tentativas, aguarde um pouco');
        return sendJson(res, 200, await tracer.trace(ip));
    }
    if (p === '/api/nat' && m === 'GET') {
        if (!limits.nat.take(ip)) throw err(429, 'muitas tentativas, aguarde um pouco');
        const trace = await tracer.trace(ip).catch(() => null);
        return sendJson(res, 200, await analyzeNat(ip, trace), CORS);
    }

    if (p === '/api/results' && m === 'POST') {
        if (!limits.results.take(ip)) throw err(429, 'Muitos resultados enviados. Aguarde um pouco.');
        const body = await readJsonBody(req, 64 * 1024);
        const r = validateResult(body);
        const who = authn.optionalUser(req, ip);
        const mlog = r.connId ? measurements.take(r.connId, ip) : null;
        const verification = verifyAgainstServer(r, mlog);

        const isp = await lookupIsp(ip);
        let place = null;
        let location = null;
        if (r.location) {
            const address = await geo.reverse(r.location.lat, r.location.lng);
            location = { ...r.location, source: 'aparelho', address: address || null };
            if (address) place = { label: address.label, district: address.district, city: address.city, region: address.region, source: 'aparelho' };
        }
        if (!place && isp.city) place = { label: `${isp.city}${isp.region ? ' - ' + isp.region : ''}`, district: null, city: isp.city, region: isp.region, source: 'ip' };

        // teste da página técnica só conta como técnico vindo de técnico ou administrador
        const tecnico = r.origem === 'tecnico' && who && users.isTecnico(who.profile);
        const doc = {
            mode: r.mode,
            origem: tecnico ? 'tecnico' : 'cliente',
            atendimento: tecnico ? r.atendimento : null,
            download: r.download, upload: r.upload, ping: r.ping, jitter: r.jitter, loss: r.loss, bufferbloat: r.bufferbloat,
            pingMin: r.pingMin, pingMax: r.pingMax, loadedLatency: r.loadedLatency, dlWindowMs: r.dlWindowMs,
            verified: verification.verified, verification,
            uid: who ? who.profile.id : null,
            ip, ipFamily: ipFamily(ip), isp: isp.isp, asn: isp.asn,
            ipLocation: { city: isp.city, region: isp.region, country: isp.country },
            location, place,
            device: r.device, connection: r.connection, advanced: r.advanced, curve: r.curve,
            userAgent: String(req.headers['user-agent'] || '').slice(0, 300),
            server: { name: config.serverName, location: config.serverLocation },
        };
        const saved = store.save(doc);
        hub.publish('test', store.summary({ ...doc, id: saved.id, protocol: saved.protocol, createdAt: saved.createdAt, user: who ? { name: who.profile.name, email: who.profile.email } : null }));
        log.info(`[resultado] ${saved.protocol} ${r.mode} ↓${r.download?.toFixed(1) ?? '–'} ↑${r.upload?.toFixed(1) ?? '–'} ping ${r.ping?.toFixed(1) ?? '–'} ${who ? who.profile.email : 'sem conta'}${verification.verified ? '' : ' [NÃO CONFERIDO: ' + verification.reason + ']'}`);
        return sendJson(res, 201, {
            id: saved.id, protocol: saved.protocol, path: `/r/${saved.id}`,
            verified: verification.verified, upload: r.upload,
            saved: who ? 'account' : 'anonymous', claimToken: saved.claimToken, place,
        });
    }

    const rm = /^\/api\/results\/([0-9A-Za-z]{15})$/.exec(p);
    if (rm && m === 'GET') {
        if (!limits.publicResult.take(ip)) throw err(429, 'muitas consultas');
        const t = store.get(rm[1]);
        if (!t) throw err(404, 'resultado não encontrado');
        return sendJson(res, 200, publicResult(t));
    }

    if (p === '/api/health' && m === 'GET') {
        return sendJson(res, 200, {
            ok: true, uptimeS: Math.round(process.uptime()), tests: slots.stats(), udpPeers: rtc.open, clock: clock.status(),
            accounts: { ready: true, users: users.counts().users, admins: users.counts().admins },
            mail: mailer.enabled ? mailer.estado : 'desligado',
            captcha: captcha.provider,
        });
    }

    // O Caddy pergunta aqui antes de pedir um certificado sob demanda: só os
    // nomes do próprio site (PUBLIC_URL, v4., v6.) ganham certificado.
    if (p === '/api/tls-ask' && m === 'GET') {
        const nomes = new Set([config.publicUrl, config.ipv4Base, config.ipv6Base].filter(Boolean).map((u) => new URL(u).hostname.toLowerCase()));
        const pedido = String(url.searchParams.get('domain') || '').toLowerCase();
        res.writeHead(nomes.has(pedido) ? 200 : 404, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
        return res.end();
    }

    if (await handleAccount(ctx, req, res, url, ip)) return;
    if (await handleAdmin(req, res, url, ip)) return;
    if (await handleTecnico(req, res, url, ip)) return;
    throw err(404, 'rota não encontrada');
}

/** O que um link público de resultado mostra: nada de nome, IP ou coordenada. */
function publicResult(t) {
    return {
        id: t.id, protocol: t.protocol, createdAt: t.createdAt, mode: t.mode,
        download: t.download, upload: t.upload, ping: t.ping, jitter: t.jitter, loss: t.loss, bufferbloat: t.bufferbloat,
        verified: !!t.verified, isp: t.isp || null,
        city: t.place && t.place.city ? `${t.place.city}${t.place.region ? ' - ' + t.place.region : ''}` : null,
        server: t.server || null,
        device: t.device ? { type: t.device.type || null } : null,
    };
}

// Proteção contra CSRF: pedidos que mudam algo precisam vir deste site. O
// cookie de sessão já é SameSite=Lax; isto é a segunda camada. Ficam de fora
// os pedidos da medição (o upload vai também para os nomes v4./v6.).
const SEM_CONFERENCIA_ORIGEM = new Set(['/api/upload', '/api/rtc/offer']);
function mesmaOrigem(req) {
    if (req.headers['x-audicom'] === '1') return true;
    const sfs = req.headers['sec-fetch-site'];
    if (sfs) return sfs === 'same-origin' || sfs === 'none';
    const o = req.headers.origin;
    if (o) { try { return new URL(o).host === req.headers.host; } catch { return false; } }
    return true; // sem cabeçalhos de navegador (curl, testes): não há cookie de outro site para abusar
}

async function handle(req, res) {
    const url = new URL(req.url, 'http://x');
    const ip = clientIp(req, config.trustProxy);

    try {
        if (url.pathname.startsWith('/api/')) {
            if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !SEM_CONFERENCIA_ORIGEM.has(url.pathname) && !mesmaOrigem(req)) {
                log.warn(`[segurança] pedido de outro site recusado: ${req.method} ${url.pathname} (origem ${req.headers.origin || '?'}, ${ip})`);
                throw err(403, 'Pedido recusado: ele não veio deste site.', 'origem');
            }
            return await handleApi(req, res, url, ip);
        }
        if (req.method !== 'GET' && req.method !== 'HEAD') throw err(405, 'método não permitido');

        // endereço antigo com barra no fim ou .html: manda pro endereço limpo
        const clean = url.pathname.replace(/\.html$/, '').replace(/(.)\/$/, '$1');
        if (clean !== url.pathname && (PAGES[clean] || clean === '/index')) {
            res.writeHead(301, { Location: (clean === '/index' ? '/' : clean) + url.search });
            return res.end();
        }

        const rp = /^\/r\/([0-9A-Za-z]{15})$/.exec(url.pathname);
        if (rp) {
            const t = store.get(rp[1]);
            const html = renderResultPage(t ? publicResult(t) : null, siteOrigin(req)).replace('</head>', `${tagsEstatistica('resultado')}</head>`);
            res.writeHead(t ? 200 : 404, { ...securityHeaders(req, 'resultado'), 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
            return res.end(req.method === 'HEAD' ? undefined : html);
        }

        if (url.pathname === '/robots.txt') {
            res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600', 'X-Content-Type-Options': 'nosniff' });
            return res.end(req.method === 'HEAD' ? undefined : robots(req));
        }
        if (url.pathname === '/sitemap.xml') {
            const xml = await mapaDoSite(req);
            res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600', 'X-Content-Type-Options': 'nosniff' });
            return res.end(req.method === 'HEAD' ? undefined : xml);
        }

        const page = PAGES[url.pathname];
        if (page) {
            const name = page.replace('.html', '').replace('index', 'teste');
            return enviarPagina(req, res, await paginaPronta(page, name, req), securityHeaders(req, name));
        }

        const abs = resolvePublic(config.staticDir, url.pathname);
        if (abs && await serveFile(req, res, abs, { headers: { 'X-Content-Type-Options': 'nosniff' } })) return;

        const p404 = await paginaPronta('404.html', '404', req).catch(() => null);
        if (p404) return enviarPagina(req, res, p404, securityHeaders(req, '404'), 404);
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Não encontrado');
    } catch (e) {
        const status = e.status || 500;
        if (status >= 500 && !e.code) log.error('[erro]', req.method, url.pathname, e);
        const body = { error: status >= 500 && !e.status ? 'Erro interno. Tente de novo em instantes.' : e.message };
        if (e.code) body.code = e.code;
        if (!res.headersSent) sendJson(res, status, body, url.pathname.startsWith('/api/') ? CORS : {});
        else res.destroy();
    }
}

// ---------- inicialização ----------
const server = http.createServer(handle);
server.keepAliveTimeout = 10_000;
server.headersTimeout = 15_000;
server.requestTimeout = 120_000;

attachWebSocket(server, { slots, clock, measurements, trustProxy: config.trustProxy, log });

await Promise.race([clock.sync().catch(() => {}), new Promise(r => setTimeout(r, 5000))]);

server.listen({ port: config.port, host: config.host, ipv6Only: false }, () => {
    log.info(`[audicom-speedtest] ouvindo em ${config.host}:${config.port} (TCP) — UDP ${config.udpPort} para perda de pacotes`);
    log.info(`[audicom-speedtest] teste IPv4 via ${baseUrl('IPv4', null) || '(indisponível)'} · IPv6 via ${baseUrl('IPv6', null) || '(indisponível)'}`);
    const donos = db.all("SELECT email FROM users WHERE role = 'owner'").map((r) => r.email);
    log.info(`[audicom-speedtest] banco: ${config.dbFile} · e-mail: ${mailer.enabled ? 'ligado' : 'desligado (links de senha pelo painel)'} · captcha: ${captcha.provider}`);
    log.info(`[audicom-speedtest] donos: ${donos.join(', ') || 'nenhum ainda — crie com: cd server && npm run admin -- dono SEU@EMAIL'}`);
});

// Retenção: testes feitos sem conta são apagados depois de ANON_RETENTION_DAYS.
function purge() {
    try {
        const n = store.purgeAnonymous(config.anonRetentionDays);
        if (n) log.info(`[retenção] ${n} teste(s) sem conta com mais de ${config.anonRetentionDays} dias apagado(s)`);
    } catch (e) { log.warn('[retenção] falhou:', e.message); }
}
setTimeout(purge, 5 * 60_000).unref();
setInterval(purge, 24 * 60 * 60_000).unref();

// Sem PUBLIC_IPV4 no .env, o IP público anunciado no teste de perda (UDP) é o
// do domínio no DNS: é para ele que o roteador encaminha a UDP. Conferido a
// cada 10 min, então trocar o DNS não exige reiniciar o serviço.
async function ipDoDominio() {
    try {
        const [ip] = await dns.resolve4(new URL(config.publicUrl).hostname);
        if (!ip || isPrivateIp(ip) || ip === config.publicIPv4) return;
        log.info(`[rede] IP público do domínio no DNS: ${ip} (anunciado no teste de perda de pacotes)`);
        config.publicIPv4 = ip;
        rtc.setPublicIPv4(ip);
    } catch (e) { log.warn('[rede] não foi possível ler o IP do domínio no DNS:', e.code || e.message); }
}
if (config.publicIPv4FromDns) {
    ipDoDominio();
    setInterval(ipDoDominio, 10 * 60_000).unref();
}

function shutdown(sig) {
    log.info(`[audicom-speedtest] ${sig} recebido, encerrando…`);
    server.close();
    rtc.shutdown();
    clock.stop();
    platforms.stop();
    setTimeout(() => { try { db.close(); } catch { /* ok */ } process.exit(0); }, 1500).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
