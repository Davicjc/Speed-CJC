import crypto from 'node:crypto';

// Sessões de login (cookie) e códigos dos links de e-mail.
//
// O cookie leva um token aleatório de 256 bits; o banco guarda só o SHA-256
// dele. Quem copiar o banco não consegue entrar em nenhuma conta.
//  - HttpOnly: o JavaScript da página não lê o cookie (protege contra XSS).
//  - SameSite=Lax: outro site não consegue usar a sessão em pedidos de escrita.
//  - Secure + prefixo __Host- quando o site está em HTTPS.
// "Manter conectado": sessão de N dias (renovada com o uso); sem marcar, o
// cookie some ao fechar o navegador e a sessão expira em 12 h sem uso.

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const novoToken = () => crypto.randomBytes(32).toString('base64url');
const RENOVA_MS = 5 * 60_000;
const CURTA_MS = 12 * 60 * 60_000;

export function createSessions({ db, sessionDays = 30, log = console }) {
    const longaMs = sessionDays * 24 * 60 * 60_000;

    const limpeza = setInterval(() => {
        try {
            db.run('DELETE FROM sessions WHERE expires_at < ?', Date.now());
            db.run('DELETE FROM tokens WHERE expires_at < ? OR (used_at IS NOT NULL AND used_at < ?)', Date.now(), Date.now() - 7 * 86400_000);
        } catch (e) { log.warn('[sessões] limpeza falhou:', e.message); }
    }, 30 * 60_000);
    limpeza.unref();

    // ---------- cookie ----------
    const nomeCookie = (seguro) => (seguro ? '__Host-speedcjc' : 'speedcjc_sessao');
    function lerToken(req) {
        const c = req.headers.cookie;
        if (!c) return null;
        for (const parte of c.split(';')) {
            const i = parte.indexOf('=');
            if (i < 0) continue;
            const k = parte.slice(0, i).trim();
            if (k === '__Host-speedcjc' || k === 'speedcjc_sessao') {
                const v = parte.slice(i + 1).trim();
                if (/^[A-Za-z0-9_-]{40,60}$/.test(v)) return v;
            }
        }
        return null;
    }
    function gravarCookie(res, token, { persistente, seguro }) {
        const partes = [`${nomeCookie(seguro)}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
        if (seguro) partes.push('Secure');
        if (persistente) partes.push(`Max-Age=${Math.floor(longaMs / 1000)}`);
        res.setHeader('Set-Cookie', partes.join('; '));
    }
    function apagarCookie(res, seguro) {
        res.setHeader('Set-Cookie', [
            `${nomeCookie(seguro)}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${seguro ? '; Secure' : ''}`,
        ]);
    }

    // ---------- sessões ----------
    function criar(userId, { persistente = false, ip = null, device = null } = {}) {
        const token = novoToken();
        const agora = Date.now();
        db.run('INSERT INTO sessions (id, user_id, created_at, last_seen_at, expires_at, reauth_at, persistent, ip, device) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            sha(token), userId, agora, agora, agora + (persistente ? longaMs : CURTA_MS), agora, persistente ? 1 : 0, ip, device);
        return token;
    }

    /** Sessão válida do token (renova a validade com o uso) ou null. */
    function achar(token, { ip } = {}) {
        if (!token) return null;
        const id = sha(token);
        const s = db.get('SELECT * FROM sessions WHERE id = ?', id);
        const agora = Date.now();
        if (!s) return null;
        if (s.expires_at < agora) { db.run('DELETE FROM sessions WHERE id = ?', id); return null; }
        if (agora - s.last_seen_at > RENOVA_MS) {
            const expira = agora + (s.persistent ? longaMs : CURTA_MS);
            db.run('UPDATE sessions SET last_seen_at = ?, expires_at = ?, ip = COALESCE(?, ip) WHERE id = ?', agora, expira, ip || null, id);
            s.last_seen_at = agora; s.expires_at = expira;
        }
        return s;
    }

    const encerrar = (token) => { if (token) db.run('DELETE FROM sessions WHERE id = ?', sha(token)); };
    const encerrarPorId = (userId, id) => db.run('DELETE FROM sessions WHERE user_id = ? AND id = ?', userId, id).changes > 0;
    const encerrarTodas = (userId, excetoId = null) => db.run('DELETE FROM sessions WHERE user_id = ? AND id IS NOT ?', userId, excetoId).changes;
    const confirmouSenha = (id) => db.run('UPDATE sessions SET reauth_at = ? WHERE id = ?', Date.now(), id);
    const daPessoa = (userId) => db.all('SELECT id, created_at, last_seen_at, expires_at, persistent, ip, device FROM sessions WHERE user_id = ? AND expires_at > ? ORDER BY last_seen_at DESC', userId, Date.now());
    const ativasDesde = (desde) => db.get('SELECT COUNT(DISTINCT user_id) n FROM sessions WHERE last_seen_at > ? AND expires_at > ?', desde, Date.now()).n;

    // ---------- links de e-mail (confirmação, nova senha) ----------
    function criarCodigo(userId, tipo, validadeMs, criadoPor = null) {
        const codigo = novoToken();
        db.run('INSERT INTO tokens (id, user_id, kind, created_at, expires_at, created_by) VALUES (?, ?, ?, ?, ?, ?)',
            sha(codigo), userId, tipo, Date.now(), Date.now() + validadeMs, criadoPor);
        return codigo;
    }
    function lerCodigo(codigo, tipo) {
        if (typeof codigo !== 'string' || !/^[A-Za-z0-9_-]{40,60}$/.test(codigo)) return null;
        const t = db.get('SELECT * FROM tokens WHERE id = ? AND kind = ?', sha(codigo), tipo);
        if (!t || t.used_at || t.expires_at < Date.now()) return null;
        return t;
    }
    /** Usa o código uma vez só. Devolve o id da conta ou null. */
    function usarCodigo(codigo, tipo) {
        const t = lerCodigo(codigo, tipo);
        if (!t) return null;
        const r = db.run('UPDATE tokens SET used_at = ? WHERE id = ? AND used_at IS NULL', Date.now(), t.id);
        if (!r.changes) return null;
        // um link novo de senha invalida os outros pendentes da mesma conta
        db.run('UPDATE tokens SET used_at = ? WHERE user_id = ? AND kind = ? AND used_at IS NULL', Date.now(), t.user_id, tipo);
        return t.user_id;
    }

    return {
        lerToken, gravarCookie, apagarCookie,
        criar, achar, encerrar, encerrarPorId, encerrarTodas, confirmouSenha, daPessoa, ativasDesde,
        criarCodigo, lerCodigo, usarCodigo,
    };
}
