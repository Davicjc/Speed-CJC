import { idTime, isId, newId, protocol, randomToken, sha256 } from './ids.js';

// Testes no banco (tabela tests). Os campos usados em busca e estatística
// ficam em colunas; o resto (aparelho, conexão, diagnóstico, conferência do
// servidor) fica num JSON. Nome e e-mail da pessoa vêm sempre da conta atual.

const CLAIM_WINDOW_MS = 24 * 60 * 60_000;
// fuso de Brasília (sem horário de verão desde 2019)
const DIA = "strftime('%Y-%m-%d', t.created_at / 1000, 'unixepoch', '-3 hours')";
const HORA = "CAST(strftime('%H', t.created_at / 1000, 'unixepoch', '-3 hours') AS INTEGER)";
const SELECT = 'SELECT t.*, u.name AS u_name, u.email AS u_email FROM tests t LEFT JOIN users u ON u.id = t.user_id';
const COLUNAS = new Set(['id', 'protocol', 'createdAt', 'uid', 'user', 'claimToken']);

export function createTestsStore({ db, log = console }) {
    function linha(r) {
        if (!r) return null;
        let extra = {};
        try { extra = JSON.parse(r.data || '{}'); } catch { extra = {}; }
        return {
            ...extra,
            id: r.id,
            protocol: r.protocol,
            createdAt: r.created_at,
            mode: r.mode,
            download: r.download, upload: r.upload, ping: r.ping, jitter: r.jitter, loss: r.loss, bufferbloat: r.bufferbloat,
            verified: !!r.verified,
            ip: r.ip, isp: r.isp,
            uid: r.user_id || null,
            user: r.user_id ? { name: r.u_name || null, email: r.u_email || null } : null,
        };
    }

    /** Grava um teste. Devolve { id, protocol, claimToken?, createdAt }. */
    function save(t) {
        const agora = Date.now();
        let id = newId(agora);
        let proto = protocol(agora);
        let claimToken = null, claimHash = null, claimUntil = null;
        if (!t.uid) {
            // teste sem login: quem fez pode "pegar" ele para a conta em até 24 h,
            // provando que tem o código secreto devolvido só para esse navegador
            claimToken = randomToken();
            claimHash = sha256(claimToken);
            claimUntil = agora + CLAIM_WINDOW_MS;
        }
        const resto = {};
        for (const [k, v] of Object.entries(t)) if (!COLUNAS.has(k)) resto[k] = v;
        const place = t.place || {};
        const loc = t.location || {};
        for (let tentativa = 0; ; tentativa++) {
            try {
                db.run(`INSERT INTO tests (id, protocol, created_at, user_id, mode, download, upload, ping, jitter, loss, bufferbloat, verified,
                        ip, isp, city, region, place_label, lat, lng, claim_hash, claim_until, data)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    id, proto, agora, t.uid || null, t.mode, t.download ?? null, t.upload ?? null, t.ping ?? null, t.jitter ?? null, t.loss ?? null, t.bufferbloat ?? null,
                    t.verified ? 1 : 0, t.ip || null, t.isp || null, place.city || null, place.region || null, place.label || null,
                    Number.isFinite(loc.lat) ? loc.lat : null, Number.isFinite(loc.lng) ? loc.lng : null, claimHash, claimUntil, JSON.stringify(resto));
                break;
            } catch (e) {
                // protocolo repetido no mesmo minuto (raríssimo): sorteia outro
                if (/UNIQUE/.test(e.message) && tentativa < 5) { id = newId(agora); proto = protocol(agora); continue; }
                throw e;
            }
        }
        return { id, protocol: proto, claimToken, createdAt: agora };
    }

    const get = (id) => (isId(id) ? linha(db.get(`${SELECT} WHERE t.id = ?`, id)) : null);
    const findByProtocol = (p) => linha(db.get(`${SELECT} WHERE t.protocol = ?`, String(p).trim().toUpperCase()));

    /** Resumo para listas (sem os detalhes pesados do modo completo). */
    function summary(d) {
        return {
            id: d.id,
            protocol: d.protocol,
            createdAt: d.createdAt,
            mode: d.mode,
            download: d.download ?? null,
            upload: d.upload ?? null,
            ping: d.ping ?? null,
            jitter: d.jitter ?? null,
            loss: d.loss ?? null,
            bufferbloat: d.bufferbloat ?? null,
            verified: !!d.verified,
            isp: d.isp || null,
            ip: d.ip || null,
            place: d.place || null,
            location: d.location ? { lat: d.location.lat, lng: d.location.lng, accuracy: d.location.accuracy ?? null } : null,
            device: d.device ? { type: d.device.type || null, os: d.device.os || null, browser: d.device.browser || null, model: d.device.model || null } : null,
            connection: d.connection ? { type: d.connection.type || null } : null,
            uid: d.uid || null,
            user: d.user || null,
        };
    }

    /** Página de testes, do mais novo para o mais antigo (o id já vem nessa ordem). */
    function list({ uid, mode = null, from = null, to = null, after = null, limit = 50 } = {}) {
        limit = Math.min(Math.max(Number(limit) || 50, 1), 1000);
        const onde = [], vals = [];
        if (uid === null) onde.push('t.user_id IS NULL');
        else if (uid !== undefined) { onde.push('t.user_id = ?'); vals.push(uid); }
        if (mode) { onde.push('t.mode = ?'); vals.push(mode); }
        if (Number.isFinite(from)) { onde.push('t.created_at >= ?'); vals.push(from); }
        if (Number.isFinite(to)) { onde.push('t.created_at <= ?'); vals.push(to); }
        if (after && isId(after)) { onde.push('t.id > ?'); vals.push(after); }
        const rows = db.all(`${SELECT} ${onde.length ? 'WHERE ' + onde.join(' AND ') : ''} ORDER BY t.id LIMIT ?`, ...vals, limit + 1);
        const itens = rows.slice(0, limit).map(linha);
        return { items: itens.map(summary), next: rows.length > limit ? itens[itens.length - 1].id : null };
    }

    function remove(id) {
        const t = get(id);
        if (!t) return null;
        db.run('DELETE FROM tests WHERE id = ?', id);
        return t;
    }

    /** Leva um teste feito sem login para a conta de quem fez (prova: o código secreto). */
    function claim(id, token, user) {
        if (!isId(id) || typeof token !== 'string' || token.length < 20) return { ok: false, reason: 'código inválido' };
        return db.tx(() => {
            const r = db.get('SELECT user_id, claim_hash, claim_until FROM tests WHERE id = ?', id);
            if (!r) return { ok: false, reason: 'teste não encontrado' };
            if (r.user_id === user.id) return { ok: true, already: true };
            if (r.user_id) return { ok: false, reason: 'este teste já pertence a outra conta' };
            if (!r.claim_hash || r.claim_hash !== sha256(token)) return { ok: false, reason: 'código inválido' };
            if ((r.claim_until || 0) < Date.now()) return { ok: false, reason: 'passou o prazo de 24 h para salvar este teste' };
            db.run('UPDATE tests SET user_id = ?, claim_hash = NULL, claim_until = NULL WHERE id = ? AND user_id IS NULL', user.id, id);
            return { ok: true };
        });
    }

    const deleteUserTests = (uid) => db.run('DELETE FROM tests WHERE user_id = ?', uid).changes;
    const purgeAnonymous = (days) => db.run('DELETE FROM tests WHERE user_id IS NULL AND created_at < ?', Date.now() - days * 86400_000).changes;

    /** Últimos testes com coordenadas do aparelho (mapa do admin). */
    function recentWithLocation(limit = 500) {
        return db.all(`SELECT t.id, t.created_at, t.download, t.upload, t.ping, t.lat, t.lng, t.place_label, t.city, t.region, t.isp, t.mode, t.verified, t.user_id, u.name u_name, u.email u_email
            FROM tests t LEFT JOIN users u ON u.id = t.user_id WHERE t.lat IS NOT NULL ORDER BY t.created_at DESC LIMIT ?`, limit)
            .map((r) => ({
                id: r.id, createdAt: r.created_at, download: r.download, upload: r.upload, ping: r.ping, lat: r.lat, lng: r.lng,
                place: r.place_label ? { label: r.place_label, city: r.city, region: r.region } : null, isp: r.isp, mode: r.mode, verified: !!r.verified,
                uid: r.user_id || null, user: r.user_id ? { name: r.u_name, email: r.u_email } : null,
            }));
    }

    const counts = ({ since = null } = {}) => (since
        ? db.get('SELECT COUNT(*) n FROM tests WHERE created_at >= ?', since).n
        : db.get('SELECT COUNT(*) n FROM tests').n);

    /** Números do painel de administração para os últimos N dias. */
    function overview(dias = 30) {
        const desde = Date.now() - dias * 86400_000;
        const porDia = db.all(`SELECT ${DIA} dia, COUNT(*) tests, SUM(t.user_id IS NOT NULL) com_conta, SUM(t.user_id IS NULL) sem_conta, SUM(t.verified) conferidos,
                AVG(t.download) dl, AVG(t.upload) ul, AVG(t.ping) ping, AVG(t.jitter) jitter
            FROM tests t WHERE t.created_at >= ? GROUP BY dia`, desde);
        const horas = Array(24).fill(0);
        for (const r of db.all(`SELECT ${HORA} h, COUNT(*) n FROM tests t WHERE t.created_at >= ? GROUP BY h`, desde)) horas[r.h] = r.n;
        const modos = Object.fromEntries(db.all('SELECT mode, COUNT(*) n FROM tests t WHERE t.created_at >= ? GROUP BY mode', desde).map((r) => [r.mode, r.n]));
        const topIsps = db.all(`SELECT COALESCE(t.isp, 'desconhecida') name, COUNT(*) count FROM tests t WHERE t.created_at >= ? GROUP BY name ORDER BY count DESC LIMIT 8`, desde);
        const topCities = db.all(`SELECT CASE WHEN t.city IS NULL THEN 'sem cidade' WHEN t.region IS NULL THEN t.city ELSE t.city || ' - ' || t.region END name, COUNT(*) count
            FROM tests t WHERE t.created_at >= ? GROUP BY name ORDER BY count DESC LIMIT 8`, desde);
        const p = db.get(`SELECT COUNT(*) n, AVG(t.download) dl, AVG(t.upload) ul, AVG(t.ping) ping, AVG(t.verified) conferidos FROM tests t WHERE t.created_at >= ?`, desde);
        return { desde, porDia, horas, modos, topIsps, topCities, periodo: p };
    }

    return { save, get, summary, list, findByProtocol, remove, claim, deleteUserTests, purgeAnonymous, recentWithLocation, counts, overview, idTime };
}
