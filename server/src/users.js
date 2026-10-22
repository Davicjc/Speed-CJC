import crypto from 'node:crypto';
import { conferir, conferirFantasma, gerarHash, precisaRefazer } from './senhas.js';

// Contas (tabela users), papéis e registro de auditoria.
//
// Quem é administrador é decidido AQUI, no servidor, lendo a conta no banco:
//  - "owner" (dono): criado pelo comando `npm run admin` no servidor. Não pode
//    ser rebaixado, desativado nem excluído pelo painel.
//  - "admin": dado por outro administrador no painel.
//  - Com e-mail configurado (SMTP), admin só vale com o e-mail confirmado:
//    ninguém vira admin cadastrando o e-mail de outra pessoa.
//  - Conta desativada não usa nada.

const err = (status, message, code) => Object.assign(new Error(message), { status, code });
const B62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
function novoId() {
    let s = '';
    for (const b of crypto.randomBytes(40)) { if (b < 248 && s.length < 20) s += B62[b % 62]; }
    return s.length === 20 ? s : novoId();
}

export function createUsers({ db, mailEnabled = false, log = console }) {
    const get = (id) => (id ? db.get('SELECT * FROM users WHERE id = ?', id) : null);
    const getByEmail = (email) => (email ? db.get('SELECT * FROM users WHERE email = ?', String(email).trim()) : null);

    /** O que a própria pessoa (ou um admin) vê da conta. */
    function view(u) {
        if (!u) return null;
        return {
            uid: u.id,
            email: u.email,
            name: u.name,
            phone: u.phone || null,
            city: u.city || null,
            planMbps: u.plan_mbps ?? null,
            role: u.role === 'owner' ? 'admin' : u.role,
            owner: u.role === 'owner',
            disabled: !!u.disabled,
            emailVerified: !!u.email_verified,
            createdAt: u.created_at,
            createdVia: u.created_via || null,
            lastLoginAt: u.last_login_at || null,
            lastSeenAt: u.last_seen_at || null,
            lastIp: u.last_ip || null,
            lastCity: u.last_city || null,
            lastDevice: u.last_device || null,
            passwordChangedAt: u.password_changed_at || null,
            testsCount: u.tests_count ?? db.get('SELECT COUNT(*) n FROM tests WHERE user_id = ?', u.id).n,
        };
    }

    async function create({ email, name, password, phone = null, city = null, planMbps = null, createdVia = 'site', captcha = null, ip = null, role = 'user', emailVerified = false }) {
        email = String(email).trim().toLowerCase();
        if (getByEmail(email)) throw err(409, 'Já existe uma conta com este e-mail. Entre ou use "Esqueci minha senha".', 'exists');
        const id = novoId();
        const hash = await gerarHash(password || crypto.randomBytes(24).toString('base64url'));
        const agora = Date.now();
        try {
            db.run(`INSERT INTO users (id, email, name, phone, city, plan_mbps, password_hash, role, email_verified, created_at, created_via, created_ip, captcha, password_changed_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                id, email, name, phone, city, planMbps, hash, role, emailVerified ? 1 : 0, agora, createdVia, ip, captcha, agora);
        } catch (e) {
            if (/UNIQUE/.test(e.message)) throw err(409, 'Já existe uma conta com este e-mail. Entre ou use "Esqueci minha senha".', 'exists');
            throw e;
        }
        return get(id);
    }

    const CAMPOS = { name: 'name', phone: 'phone', city: 'city', planMbps: 'plan_mbps', role: 'role', disabled: 'disabled', emailVerified: 'email_verified' };
    function update(id, patch) {
        const sets = [], vals = [];
        for (const [k, v] of Object.entries(patch)) {
            const col = CAMPOS[k];
            if (!col) continue;
            sets.push(`${col} = ?`);
            vals.push(typeof v === 'boolean' ? (v ? 1 : 0) : v);
        }
        if (sets.length) db.run(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, ...vals, id);
        return get(id);
    }

    async function setPassword(id, senha) {
        db.run('UPDATE users SET password_hash = ?, password_changed_at = ? WHERE id = ?', await gerarHash(senha), Date.now(), id);
    }

    /** Confere e-mail + senha. Devolve a conta ou null (mesmo tempo nos dois casos). */
    async function checkLogin(email, senha) {
        const u = getByEmail(email);
        if (!u) return conferirFantasma(senha).then(() => null);
        if (!(await conferir(senha, u.password_hash))) return null;
        if (precisaRefazer(u.password_hash)) await setPassword(u.id, senha).catch(() => {});
        return u;
    }
    const checkPassword = (u, senha) => conferir(senha, u.password_hash);

    const isOwner = (u) => !!u && u.role === 'owner';
    const isAdmin = (u) => !!u && !u.disabled && (u.role === 'owner' || (u.role === 'admin' && (!mailEnabled || !!u.email_verified)));

    /** Último acesso, sem escrever a cada clique (no máximo 1 vez a cada 2 min). */
    function touch(id, info = {}, { login = false } = {}) {
        const u = get(id);
        if (!u) return;
        const agora = Date.now();
        if (!login && u.last_seen_at && agora - u.last_seen_at < 2 * 60_000) return;
        db.run(`UPDATE users SET last_seen_at = ?, last_ip = COALESCE(?, last_ip), last_city = COALESCE(?, last_city), last_device = COALESCE(?, last_device)
            ${login ? ', last_login_at = ?' : ''} WHERE id = ?`,
            agora, info.ip || null, info.city || null, info.device || null, ...(login ? [agora] : []), id);
    }

    function list({ q = null, role = null, after = null, limit = 50 } = {}) {
        limit = Math.min(Math.max(Number(limit) || 50, 1), 200);
        const onde = [], vals = [];
        const termo = q ? String(q).trim() : '';
        if (termo) {
            onde.push('(email LIKE ? ESCAPE \'\\\' OR name LIKE ? ESCAPE \'\\\')');
            const like = '%' + termo.replace(/[\\%_]/g, (c) => '\\' + c) + '%';
            vals.push(like, like);
        }
        if (role === 'admin') onde.push("role IN ('admin', 'owner')");
        else if (role === 'user') onde.push("role = 'user'");
        if (after) {
            const cur = get(String(after));
            if (cur) { onde.push('(created_at, id) < (?, ?)'); vals.push(cur.created_at, cur.id); }
        }
        const rows = db.all(`SELECT u.*, (SELECT COUNT(*) FROM tests t WHERE t.user_id = u.id) tests_count FROM users u
            ${onde.length ? 'WHERE ' + onde.join(' AND ') : ''} ORDER BY created_at DESC, id DESC LIMIT ?`, ...vals, limit + 1);
        const itens = rows.slice(0, limit);
        return { items: itens.map(view), next: rows.length > limit ? itens[itens.length - 1].id : null };
    }

    const counts = () => ({
        users: db.get('SELECT COUNT(*) n FROM users').n,
        admins: db.get("SELECT COUNT(*) n FROM users WHERE role IN ('admin', 'owner')").n,
    });
    const newUsersByDay = (desde) => db.all(
        "SELECT strftime('%Y-%m-%d', created_at / 1000, 'unixepoch', '-3 hours') dia, COUNT(*) n FROM users WHERE created_at >= ? GROUP BY dia", desde);

    const remove = (id) => db.run('DELETE FROM users WHERE id = ?', id).changes > 0;

    // ---------- auditoria ----------
    function audit({ actor, action, target = null, detail = null, ip = null }) {
        try {
            db.run('INSERT INTO audit (at, actor_id, actor_email, actor_name, action, target_id, target_email, target_name, detail, ip) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                Date.now(), actor ? actor.uid || actor.id : null, actor ? actor.email : null, actor ? actor.name : null, action,
                target ? target.uid || target.id || null : null, target ? target.email || null : null, target ? target.name || null : null,
                detail ? JSON.stringify(detail) : null, ip);
        } catch (e) { log.warn('[auditoria] não gravou:', e.message); }
        log.info(`[auditoria] ${actor ? actor.email : 'sistema'} → ${action}${target ? ' → ' + (target.email || target.uid || target.id) : ''}${detail ? ' ' + JSON.stringify(detail) : ''}`);
    }

    function listAudit({ after = null, limit = 50 } = {}) {
        limit = Math.min(Math.max(Number(limit) || 50, 1), 200);
        const rows = after
            ? db.all('SELECT * FROM audit WHERE id < ? ORDER BY id DESC LIMIT ?', Number(after), limit + 1)
            : db.all('SELECT * FROM audit ORDER BY id DESC LIMIT ?', limit + 1);
        const itens = rows.slice(0, limit);
        return {
            items: itens.map((a) => ({
                id: a.id, at: a.at, action: a.action, ip: a.ip,
                actor: a.actor_email ? { uid: a.actor_id, email: a.actor_email, name: a.actor_name } : null,
                target: a.target_id || a.target_email ? { uid: a.target_id, email: a.target_email, name: a.target_name } : null,
                detail: a.detail ? JSON.parse(a.detail) : null,
            })),
            next: rows.length > limit ? itens[itens.length - 1].id : null,
        };
    }

    return { get, getByEmail, view, create, update, setPassword, checkLogin, checkPassword, isOwner, isAdmin, touch, list, counts, newUsersByDay, remove, audit, listAudit };
}
