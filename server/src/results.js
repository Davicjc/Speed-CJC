import { median } from './util.js';

// Validação e conferência do resultado que o navegador envia no fim do teste.

const err = (status, message) => Object.assign(new Error(message), { status });
const num = (v, max) => (v == null ? null : (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max ? +v : undefined));
const text = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const round = (v, d = 2) => (v == null ? null : Math.round(v * 10 ** d) / 10 ** d);

export const MODES = ['rapido', 'completo'];

export function validateResult(body) {
    if (!body || typeof body !== 'object') throw err(400, 'resultado vazio');
    if (!MODES.includes(body.mode)) throw err(400, 'modo de teste inválido');
    const out = {
        mode: body.mode,
        download: num(body.download, 100_000),
        upload: num(body.upload, 100_000),
        ping: num(body.ping, 60_000),
        jitter: num(body.jitter, 60_000),
        loss: num(body.loss, 100),
        bufferbloat: num(body.bufferbloat, 60_000),
        pingMin: num(body.pingMin, 60_000),
        pingMax: num(body.pingMax, 60_000),
        dlWindowMs: num(body.dlWindowMs, 120_000),
    };
    for (const [k, v] of Object.entries(out)) if (v === undefined) throw err(400, `valor inválido em ${k}`);
    if (out.download == null && out.upload == null && out.ping == null) throw err(400, 'nenhuma medida no resultado');

    const ll = body.loadedLatency && typeof body.loadedLatency === 'object' ? body.loadedLatency : {};
    out.loadedLatency = { download: num(ll.download, 60_000) ?? null, upload: num(ll.upload, 60_000) ?? null };

    // localização do aparelho: só existe se a pessoa autorizou no navegador
    const g = body.location;
    out.location = null;
    if (g && typeof g === 'object') {
        const lat = Number(g.lat), lng = Number(g.lng), acc = Number(g.accuracy);
        if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0)) {
            out.location = { lat: round(lat, 5), lng: round(lng, 5), accuracy: Number.isFinite(acc) && acc >= 0 ? Math.round(Math.min(acc, 100_000)) : null };
        }
    }

    const d = body.device && typeof body.device === 'object' ? body.device : {};
    out.device = {
        type: text(d.type, 20), os: text(d.os, 40), osVersion: text(d.osVersion, 20),
        browser: text(d.browser, 40), browserVersion: text(d.browserVersion, 20), model: text(d.model, 60),
        cores: num(d.cores, 512) ?? null, ram: num(d.ram, 1024) ?? null, screen: text(d.screen, 30),
    };
    const c = body.connection && typeof body.connection === 'object' ? body.connection : {};
    out.connection = {
        type: text(c.type, 20), effectiveType: text(c.effectiveType, 10),
        downlink: num(c.downlink, 100_000) ?? null, rtt: num(c.rtt, 60_000) ?? null,
    };

    if (body.advanced != null) {
        if (typeof body.advanced !== 'object') throw err(400, 'diagnóstico inválido');
        if (JSON.stringify(body.advanced).length > 24 * 1024) throw err(413, 'diagnóstico grande demais');
        out.advanced = body.advanced;
    } else out.advanced = null;

    out.connId = typeof body.connId === 'string' ? body.connId.slice(0, 32) : null;
    return out;
}

/**
 * Confere o resultado do navegador contra o que o servidor mediu na mesma
 * conexão. O upload do servidor é a fonte da verdade (substitui o enviado);
 * o download não pode ser maior do que os bytes que o servidor entregou.
 */
export function verifyAgainstServer(r, m) {
    if (!m) return { verified: false, reason: 'sem medição correspondente no servidor' };
    const out = { verified: true, dlServedBytes: m.dlServed, uploadsMeasured: m.uploads.length };
    const fail = (reason) => { out.verified = false; out.reason = out.reason || reason; };

    if (r.upload != null) {
        if (!m.uploads.length) fail('upload sem medição no servidor');
        else {
            // o upload do teste é o último medido (a etapa IPv4/IPv6 só baixa)
            const serverUl = m.uploads[m.uploads.length - 1].mbps;
            if (Math.abs(serverUl - r.upload) > Math.max(0.5, serverUl * 0.01)) out.uploadFromClient = r.upload;
            r.upload = serverUl;
        }
    }
    if (r.download != null) {
        const win = Number(r.dlWindowMs);
        const claimedBytes = Number.isFinite(win) && win > 0 ? (r.download * win * 1000) / 8 : null;
        if (m.dlServed <= 0) fail('download sem bytes entregues pelo servidor');
        else if (claimedBytes != null && claimedBytes > m.dlServed * 1.05) fail('download maior do que o servidor entregou');
    }
    if (r.ping == null && r.download == null) fail('teste incompleto');
    out.medianUpload = m.uploads.length ? median(m.uploads.map(u => u.mbps)) : null;
    return out;
}

// ---------- cadastro ----------
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function validateSignup(b) {
    if (!b || typeof b !== 'object') throw err(400, 'cadastro vazio');
    if (b.website) throw err(400, 'cadastro recusado'); // campo invisível: só robô preenche
    const name = String(b.name || '').replace(/\s+/g, ' ').trim();
    if (name.length < 2 || name.length > 80 || !/\p{L}/u.test(name)) throw err(400, 'Informe seu nome (de 2 a 80 letras).');
    const email = validateEmail(b.email);
    const password = validatePassword(b.password, email);
    if (b.terms !== true) throw err(400, 'É preciso aceitar os termos de uso e a política de privacidade.');
    return { name, email, password, ...validateProfilePatch(b) };
}

export function validateEmail(v) {
    const email = String(v || '').trim().toLowerCase();
    if (email.length > 254 || !EMAIL_RE.test(email)) throw err(400, 'Informe um e-mail válido.');
    return email;
}

export function validatePassword(v, email = '') {
    const password = String(v || '');
    if (password.length < 8) throw err(400, 'A senha precisa ter pelo menos 8 caracteres.');
    if (password.length > 128) throw err(400, 'A senha pode ter no máximo 128 caracteres.');
    if (!/\p{L}/u.test(password) || !/\d/.test(password)) throw err(400, 'Use letras e números na senha.');
    const local = String(email).split('@')[0];
    if (local.length >= 4 && password.toLowerCase().includes(local)) throw err(400, 'A senha não pode conter o seu e-mail.');
    return password;
}

/** Telefone brasileiro com DDD -> +55DDNNNNNNNN (ou null). */
export function normalizePhone(v) {
    if (v == null || v === '') return null;
    let d = String(v).replace(/\D/g, '');
    if (d.startsWith('55') && d.length >= 12) d = d.slice(2);
    if (d.startsWith('0')) d = d.slice(1);
    if (d.length !== 10 && d.length !== 11) throw err(400, 'Informe o telefone com DDD (10 ou 11 dígitos).');
    return '+55' + d;
}

export function validateProfilePatch(b, { withName = false } = {}) {
    const out = {};
    if (withName && b.name !== undefined) {
        const name = String(b.name || '').replace(/\s+/g, ' ').trim();
        if (name.length < 2 || name.length > 80 || !/\p{L}/u.test(name)) throw err(400, 'Informe seu nome (de 2 a 80 letras).');
        out.name = name;
    }
    if (b.phone !== undefined) out.phone = normalizePhone(b.phone);
    if (b.city !== undefined) {
        const city = String(b.city || '').replace(/\s+/g, ' ').trim();
        if (city.length > 80) throw err(400, 'Cidade muito longa.');
        out.city = city || null;
    }
    if (b.planMbps !== undefined) {
        if (b.planMbps === null || b.planMbps === '') out.planMbps = null;
        else {
            const n = Number(b.planMbps);
            if (!Number.isFinite(n) || n < 1 || n > 100_000) throw err(400, 'Velocidade do plano inválida (em Mbps).');
            out.planMbps = Math.round(n);
        }
    }
    return out;
}
