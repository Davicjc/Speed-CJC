import fs from 'node:fs';
import { isId } from './ids.js';
import { MODES, validateEmail } from './results.js';
import { readJsonBody, sendJson } from './util.js';

// Painel de administração. Toda rota aqui exige login de administrador
// (ver authn.js). Ações que mudam o acesso de alguém pedem a senha de novo
// (se faz mais de 15 min que ela foi digitada) e ficam na auditoria.

const err = (status, message, code) => Object.assign(new Error(message), { status, code });
const PRAZO_LINK_ADMIN = 3 * 24 * 60 * 60_000;

function cached(ms, fn) {
    let at = 0, value = null;
    const get = () => {
        if (value && Date.now() - at < ms) return value;
        value = fn();
        at = Date.now();
        return value;
    };
    get.reset = () => { at = 0; };
    return get;
}

const diaSP = (ms) => new Date(ms - 3 * 3600_000).toISOString().slice(0, 10);

export function createAdminRoutes(ctx) {
    const { db, users, sessions, store, authn, presence, hub, limits, slots, rtc, clock, platforms, captcha, mailer, backups, config, siteOrigin, log } = ctx;

    const overview = cached(10_000, () => {
        const dias = 30;
        const o = store.overview(dias);
        const porDia = new Map(o.porDia.map((d) => [d.dia, d]));
        const novos = new Map(users.newUsersByDay(o.desde).map((d) => [d.dia, d.n]));
        const daily = [];
        for (let i = dias - 1; i >= 0; i--) {
            const dia = diaSP(Date.now() - i * 86400_000);
            const d = porDia.get(dia) || {};
            daily.push({
                date: dia, tests: d.tests || 0, testsUsers: d.com_conta || 0, testsAnon: d.sem_conta || 0, verified: d.conferidos || 0,
                newUsers: novos.get(dia) || 0, avgDownload: d.dl ?? null, avgUpload: d.ul ?? null, avgPing: d.ping ?? null, avgJitter: d.jitter ?? null,
            });
        }
        const day = 86400_000;
        return {
            generatedAt: Date.now(),
            totals: { ...users.counts(), tests: store.counts(), tests24h: store.counts({ since: Date.now() - day }), tests7d: store.counts({ since: Date.now() - 7 * day }) },
            period: {
                tests: o.periodo.n, avgDownload: o.periodo.dl, avgUpload: o.periodo.ul, avgPing: o.periodo.ping,
                newUsers: [...novos.values()].reduce((a, b) => a + b, 0), verifiedShare: o.periodo.n ? o.periodo.conferidos : null,
            },
            daily, hours: o.horas, modes: o.modos, topIsps: o.topIsps, topCities: o.topCities,
            recent: store.list({ limit: 12 }).items,
        };
    });
    const mapPoints = cached(30_000, () => store.recentWithLocation(500));

    function live() {
        const s = slots.stats();
        return {
            online: presence.count,
            logados24h: sessions.ativasDesde(Date.now() - 86400_000),
            activeTests: s.active, queued: s.queued, maxConcurrent: s.max, udpPeers: rtc.open,
        };
    }

    // painel aberto: a situação do servidor (testes medindo, fila) chega sozinha
    let ultimo = '';
    setInterval(() => {
        if (!hub.size) return;
        const l = JSON.stringify(live());
        if (l !== ultimo) { ultimo = l; hub.publish('live', JSON.parse(l)); }
    }, 3000).unref();

    function guardTarget(actor, target) {
        if (!target) throw err(404, 'Usuário não encontrado.');
        if (target.id === actor.id) throw err(400, 'Você não pode alterar a sua própria conta por aqui.');
        if (users.isOwner(target)) throw err(403, 'Contas de dono não podem ser alteradas pelo painel. Use o comando "npm run admin" no servidor.');
    }

    function linkNovaSenha(req, alvo, actor) {
        const codigo = sessions.criarCodigo(alvo.id, 'reset', PRAZO_LINK_ADMIN, actor.email);
        return siteOrigin(req) + '/entrar?nova-senha=' + codigo;
    }

    return async function handleAdmin(req, res, url, ip) {
        const p = url.pathname;
        const m = req.method;
        if (!p.startsWith('/api/admin/')) return false;

        const { sess, profile: actor } = authn.requireAdmin(req, ip);
        if (!limits.admin.take(actor.id)) throw err(429, 'Muitas consultas. Aguarde um pouco.');
        const actorInfo = { uid: actor.id, email: actor.email, name: actor.name };
        const n = (k) => (url.searchParams.get(k) ? Number(url.searchParams.get(k)) : null);

        if (p === '/api/admin/overview' && m === 'GET') {
            if (url.searchParams.get('fresh')) overview.reset();
            return sendJson(res, 200, { ...overview(), live: live() }), true;
        }
        if (p === '/api/admin/map' && m === 'GET') return sendJson(res, 200, { points: mapPoints() }), true;
        if (p === '/api/admin/online' && m === 'GET') return sendJson(res, 200, { items: presence.list(), live: live() }), true;

        if (p === '/api/admin/stream' && m === 'GET') {
            // a conexão dura 1 h; o navegador reconecta sozinho
            hub.subscribe(req, res, { user: actorInfo, expiresAt: Math.floor(Date.now() / 1000) + 3600, initial: [['presence', { items: presence.list() }], ['live', live()]] });
            return true;
        }

        if (p === '/api/admin/system' && m === 'GET') {
            const mem = process.memoryUsage();
            let tamanho = null;
            try { tamanho = fs.statSync(config.dbFile).size + (fs.existsSync(config.dbFile + '-wal') ? fs.statSync(config.dbFile + '-wal').size : 0); } catch { /* ok */ }
            let copias = [];
            try { copias = fs.readdirSync(backups.pasta).filter((f) => f.endsWith('.db')).sort(); } catch { /* ok */ }
            return sendJson(res, 200, {
                uptimeS: Math.round(process.uptime()), node: process.version, memoryMB: Math.round(mem.rss / 1048576),
                live: live(), served: slots.stats().served, clock: clock.status(),
                db: { file: config.dbFile, sizeMB: tamanho != null ? Math.round(tamanho / 1048576 * 10) / 10 : null, backups: copias.length, lastBackup: copias[copias.length - 1] || null },
                mail: { enabled: mailer.enabled, estado: mailer.enabled ? mailer.estado : 'desligado' },
                captcha: captcha.provider, geocoder: config.geocoder, liveClients: hub.size,
                owners: db.all("SELECT email FROM users WHERE role = 'owner' ORDER BY created_at").map((r) => r.email),
                settings: {
                    publicUrl: config.publicUrl, trustProxy: config.trustProxy, maxConcurrentTests: config.maxConcurrentTests,
                    ipv4Base: config.ipv4Base, ipv6Base: config.ipv6Base, publicIPv4: config.publicIPv4, udpPort: config.udpPort,
                    anonRetentionDays: config.anonRetentionDays, sessionDays: config.sessionDays,
                },
                platforms: platforms.list(),
            }), true;
        }

        // ---------- testes ----------
        if (p === '/api/admin/tests' && m === 'GET') {
            const q = (url.searchParams.get('q') || '').trim();
            const mode = MODES.includes(url.searchParams.get('mode')) ? url.searchParams.get('mode') : null;
            let uid = url.searchParams.get('uid') || undefined;
            if (uid === 'anon') uid = null;
            let matchedUsers = null;
            if (q) {
                if (/^AUD-/i.test(q)) {
                    const t = store.findByProtocol(q);
                    return sendJson(res, 200, { items: t ? [store.summary(t)] : [], next: null }), true;
                }
                if (isId(q)) {
                    const t = store.get(q);
                    return sendJson(res, 200, { items: t ? [store.summary(t)] : [], next: null }), true;
                }
                matchedUsers = users.list({ q, limit: 8 }).items;
                if (!matchedUsers.length) return sendJson(res, 200, { items: [], next: null, matchedUsers }), true;
                if (uid === undefined) uid = matchedUsers[0].uid;
            }
            const page = store.list({ uid, mode, from: n('from'), to: n('to'), after: url.searchParams.get('after'), limit: n('limit') || 50 });
            return sendJson(res, 200, { ...page, matchedUsers }), true;
        }

        if (p === '/api/admin/tests.csv' && m === 'GET') {
            const mode = MODES.includes(url.searchParams.get('mode')) ? url.searchParams.get('mode') : null;
            let uid = url.searchParams.get('uid') || undefined;
            if (uid === 'anon') uid = null;
            const rows = [];
            let after = null;
            do {
                const page = store.list({ uid, mode, from: n('from'), to: n('to'), after, limit: 1000 });
                rows.push(...page.items);
                after = page.next;
            } while (after && rows.length < 50_000);
            const cab = ['protocolo', 'data_hora', 'modo', 'download_mbps', 'upload_mbps', 'ping_ms', 'jitter_ms', 'perda_pct', 'bufferbloat_ms',
                'conferido', 'nome', 'email', 'operadora', 'ip', 'local', 'latitude', 'longitude', 'aparelho', 'sistema', 'navegador'];
            // aspas sempre; e fórmula (=, +, -, @) vira texto, para a planilha não executar nada
            const esc = (v) => { let s = String(v == null ? '' : v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
            const fmt = (v) => (v == null ? '' : String(Math.round(v * 100) / 100).replace('.', ','));
            const csv = [cab.join(';')].concat(rows.map(r => [
                r.protocol, new Date(r.createdAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }), r.mode,
                fmt(r.download), fmt(r.upload), fmt(r.ping), fmt(r.jitter), fmt(r.loss), fmt(r.bufferbloat), r.verified ? 'sim' : 'não',
                r.user && r.user.name, r.user && r.user.email, r.isp, r.ip, r.place && r.place.label,
                r.location && r.location.lat, r.location && r.location.lng,
                r.device && r.device.type, r.device && r.device.os, r.device && r.device.browser,
            ].map(esc).join(';'))).join('\r\n');
            users.audit({ actor: actorInfo, action: 'exportou testes (planilha)', detail: { linhas: rows.length }, ip });
            res.writeHead(200, {
                'Content-Type': 'text/csv; charset=utf-8',
                'Content-Disposition': `attachment; filename="testes-audicom-${new Date().toISOString().slice(0, 10)}.csv"`,
                'Cache-Control': 'no-store',
            });
            res.end('﻿' + csv); // BOM: o Excel abre com acento certo
            return true;
        }

        const tm = /^\/api\/admin\/tests\/([0-9A-Za-z]{15})$/.exec(p);
        if (tm && m === 'GET') {
            const t = store.get(tm[1]);
            if (!t) throw err(404, 'Teste não encontrado.');
            return sendJson(res, 200, t), true;
        }
        if (tm && m === 'DELETE') {
            const t = store.remove(tm[1]);
            if (!t) throw err(404, 'Teste não encontrado.');
            overview.reset();
            users.audit({ actor: actorInfo, action: 'apagou teste', target: t.uid ? { uid: t.uid, email: t.user && t.user.email } : null, detail: { protocolo: t.protocol }, ip });
            return sendJson(res, 200, { deleted: true }), true;
        }

        // ---------- usuários ----------
        if (p === '/api/admin/users' && m === 'GET') {
            const role = ['admin', 'user'].includes(url.searchParams.get('role')) ? url.searchParams.get('role') : null;
            const page = users.list({ q: url.searchParams.get('q'), role, after: url.searchParams.get('after'), limit: n('limit') || 50 });
            page.items = page.items.map(u => ({ ...u, online: presence.isOnline(u.uid) }));
            return sendJson(res, 200, page), true;
        }

        if (p === '/api/admin/users/invite' && m === 'POST') {
            authn.requireRecentLogin(sess);
            const body = await readJsonBody(req, 4 * 1024);
            const email = validateEmail(body.email);
            const role = body.role === 'admin' ? 'admin' : 'user';
            let alvo = users.getByEmail(email);
            let created = false;
            if (!alvo) {
                const name = String(body.name || '').replace(/\s+/g, ' ').trim().slice(0, 80) || email.split('@')[0];
                alvo = await users.create({ email, name, createdVia: 'admin', ip, role });
                created = true;
            } else if (!users.isOwner(alvo) && alvo.role !== role) {
                alvo = users.update(alvo.id, { role });
            }
            let link = null, emailSent = false;
            if (created) {
                // a pessoa escolhe a própria senha pelo link (por e-mail, se houver, ou pelo WhatsApp)
                link = linkNovaSenha(req, alvo, actor);
                if (mailer.enabled) emailSent = await mailer.novaSenha(alvo, link).then(() => true, () => false);
            }
            overview.reset();
            users.audit({ actor: actorInfo, action: created ? (role === 'admin' ? 'criou administrador' : 'criou usuário') : (role === 'admin' ? 'deu acesso de administrador' : 'atualizou usuário'), target: { uid: alvo.id, email }, ip });
            hub.publish('user-updated', { uid: alvo.id });
            return sendJson(res, 200, { ok: true, created, link, emailSent, user: users.view(alvo) }), true;
        }

        const um = /^\/api\/admin\/users\/([A-Za-z0-9]{20})(\/(role|status|revoke|reset-link))?$/.exec(p);
        if (um) {
            const uid = um[1];
            const action = um[3];
            const target = users.get(uid);

            if (!action && m === 'GET') {
                if (!target) throw err(404, 'Usuário não encontrado.');
                return sendJson(res, 200, {
                    user: { ...users.view(target), online: presence.isOnline(uid) },
                    sessions: sessions.daPessoa(uid).map((s) => ({ createdAt: s.created_at, lastSeenAt: s.last_seen_at, persistente: !!s.persistent, ip: s.ip, device: s.device })),
                    tests: store.list({ uid, limit: 100 }),
                }), true;
            }

            if (action === 'role' && m === 'POST') {
                authn.requireRecentLogin(sess);
                guardTarget(actor, target);
                const body = await readJsonBody(req, 1024);
                const role = body.role === 'admin' ? 'admin' : 'user';
                if (target.role === role) return sendJson(res, 200, { user: users.view(target) }), true;
                const updated = users.update(uid, { role });
                users.audit({ actor: actorInfo, action: role === 'admin' ? 'deu acesso de administrador' : 'tirou acesso de administrador', target: users.view(target), ip });
                hub.publish('user-updated', { uid });
                return sendJson(res, 200, { user: users.view(updated) }), true;
            }

            if (action === 'status' && m === 'POST') {
                authn.requireRecentLogin(sess);
                guardTarget(actor, target);
                const body = await readJsonBody(req, 1024);
                const disabled = body.disabled === true;
                const updated = users.update(uid, { disabled });
                if (disabled) { sessions.encerrarTodas(uid); presence.bye(uid); }
                users.audit({ actor: actorInfo, action: disabled ? 'desativou conta' : 'reativou conta', target: users.view(target), ip });
                hub.publish('user-updated', { uid });
                return sendJson(res, 200, { user: users.view(updated) }), true;
            }

            if (action === 'revoke' && m === 'POST') {
                if (!target) throw err(404, 'Usuário não encontrado.');
                if (uid !== actor.id && users.isOwner(target)) throw err(403, 'Contas de dono não podem ser alteradas pelo painel.');
                const nSess = sessions.encerrarTodas(uid);
                presence.bye(uid);
                users.audit({ actor: actorInfo, action: 'encerrou as sessões', target: users.view(target), detail: { sessoes: nSess }, ip });
                return sendJson(res, 200, { ok: true, sessions: nSess }), true;
            }

            if (action === 'reset-link' && m === 'POST') {
                authn.requireRecentLogin(sess);
                guardTarget(actor, target);
                const body = await readJsonBody(req, 1024).catch(() => ({}));
                const link = linkNovaSenha(req, target, actor);
                let emailSent = false;
                if (body.enviar && mailer.enabled) emailSent = await mailer.novaSenha(target, link).then(() => true, () => false);
                users.audit({ actor: actorInfo, action: 'gerou link de nova senha', target: users.view(target), detail: emailSent ? { enviado: 'por e-mail' } : null, ip });
                return sendJson(res, 200, { link, emailSent, validadeHoras: PRAZO_LINK_ADMIN / 3600_000 }), true;
            }

            if (!action && m === 'DELETE') {
                authn.requireRecentLogin(sess);
                guardTarget(actor, target);
                const nTests = store.deleteUserTests(uid);
                users.remove(uid);
                presence.bye(uid);
                overview.reset();
                users.audit({ actor: actorInfo, action: 'excluiu conta', target: users.view(target) || { uid, email: target.email }, detail: { testesApagados: nTests }, ip });
                hub.publish('user-deleted', { uid });
                return sendJson(res, 200, { deleted: true, tests: nTests }), true;
            }
        }

        if (p === '/api/admin/audit' && m === 'GET') {
            return sendJson(res, 200, users.listAudit({ after: url.searchParams.get('after'), limit: n('limit') || 50 })), true;
        }

        throw err(404, 'rota não encontrada');
    };
}
