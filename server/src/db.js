import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// Banco de dados do site: um arquivo SQLite (data/audicom.db), no próprio
// servidor. Guarda contas, sessões de login, links de e-mail (confirmação e
// nova senha), testes e o registro de auditoria.
//
// Modo WAL: o site e o comando de administração (tools/admin.mjs) podem usar
// o banco ao mesmo tempo. Chaves estrangeiras com ON DELETE CASCADE: excluir
// uma conta apaga junto as sessões e os testes dela (LGPD).

const MIGRACOES = [
    // 1: estrutura inicial
    `
    CREATE TABLE users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE COLLATE NOCASE,
        name TEXT NOT NULL,
        phone TEXT,
        city TEXT,
        plan_mbps INTEGER,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin', 'owner')),
        disabled INTEGER NOT NULL DEFAULT 0,
        email_verified INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        created_via TEXT,
        created_ip TEXT,
        captcha TEXT,
        password_changed_at INTEGER,
        last_login_at INTEGER,
        last_seen_at INTEGER,
        last_ip TEXT,
        last_city TEXT,
        last_device TEXT
    );
    CREATE INDEX users_created ON users (created_at DESC);
    CREATE INDEX users_role ON users (role);

    CREATE TABLE sessions (
        id TEXT PRIMARY KEY,                -- sha256 do token do cookie (o token em si não fica no banco)
        user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        reauth_at INTEGER NOT NULL,         -- última vez que a senha foi digitada nesta sessão
        persistent INTEGER NOT NULL DEFAULT 0,
        ip TEXT,
        device TEXT
    );
    CREATE INDEX sessions_user ON sessions (user_id);
    CREATE INDEX sessions_expires ON sessions (expires_at);

    CREATE TABLE tokens (
        id TEXT PRIMARY KEY,                -- sha256 do código do link
        user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK (kind IN ('verify', 'reset')),
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        used_at INTEGER,
        created_by TEXT
    );
    CREATE INDEX tokens_user ON tokens (user_id, kind);

    CREATE TABLE tests (
        id TEXT PRIMARY KEY,                -- em ordem cronológica inversa (ids.js)
        protocol TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL,
        user_id TEXT REFERENCES users (id) ON DELETE CASCADE,
        mode TEXT NOT NULL,
        download REAL, upload REAL, ping REAL, jitter REAL, loss REAL, bufferbloat REAL,
        verified INTEGER NOT NULL DEFAULT 0,
        ip TEXT,
        isp TEXT,
        city TEXT,
        region TEXT,
        place_label TEXT,
        lat REAL,
        lng REAL,
        claim_hash TEXT,
        claim_until INTEGER,
        data TEXT NOT NULL                  -- JSON com o restante (aparelho, conexão, diagnóstico, conferência)
    );
    CREATE INDEX tests_created ON tests (created_at DESC);
    CREATE INDEX tests_user ON tests (user_id, id);
    CREATE INDEX tests_mode ON tests (mode, id);

    CREATE TABLE audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        at INTEGER NOT NULL,
        actor_id TEXT, actor_email TEXT, actor_name TEXT,
        action TEXT NOT NULL,
        target_id TEXT, target_email TEXT, target_name TEXT,
        detail TEXT,
        ip TEXT
    );
    `,
    // 2: acesso técnico (o /tecnico) e de onde veio cada teste (página do cliente ou técnica)
    `
    ALTER TABLE users ADD COLUMN tecnico INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE tests ADD COLUMN origem TEXT NOT NULL DEFAULT 'cliente';
    CREATE INDEX tests_origem ON tests (origem, id);
    `,
];

export function openDatabase(file, log = console) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const db = new DatabaseSync(file);
    db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;');
    try { fs.chmodSync(file, 0o600); } catch { /* ok */ }

    const versao = db.prepare('PRAGMA user_version').get().user_version;
    for (let v = versao; v < MIGRACOES.length; v++) {
        db.exec('BEGIN');
        try {
            db.exec(MIGRACOES[v]);
            db.exec(`PRAGMA user_version = ${v + 1}`);
            db.exec('COMMIT');
            log.info(`[banco] estrutura atualizada para a versão ${v + 1}`);
        } catch (e) {
            db.exec('ROLLBACK');
            throw e;
        }
    }

    // prepara uma vez, reaproveita sempre
    const cache = new Map();
    const stmt = (sql) => {
        let s = cache.get(sql);
        if (!s) { s = db.prepare(sql); cache.set(sql, s); }
        return s;
    };

    return {
        raw: db,
        get: (sql, ...p) => stmt(sql).get(...p) || null,
        all: (sql, ...p) => stmt(sql).all(...p),
        run: (sql, ...p) => stmt(sql).run(...p),
        /** Executa fn dentro de uma transação (tudo ou nada). */
        tx(fn) {
            db.exec('BEGIN IMMEDIATE');
            try {
                const r = fn();
                db.exec('COMMIT');
                return r;
            } catch (e) {
                db.exec('ROLLBACK');
                throw e;
            }
        },
        close: () => db.close(),
    };
}

/**
 * Cópia de segurança diária (VACUUM INTO gera um arquivo consistente mesmo com
 * o site rodando). Fica em data/backups/audicom-AAAA-MM-DD.db; as mais antigas
 * que `dias` são apagadas.
 */
export function createBackups({ db, dataDir, dias = 14, log = console }) {
    const pasta = path.join(dataDir, 'backups');
    function fazer() {
        try {
            fs.mkdirSync(pasta, { recursive: true, mode: 0o700 });
            const hoje = new Date().toISOString().slice(0, 10);
            const destino = path.join(pasta, `audicom-${hoje}.db`);
            if (!fs.existsSync(destino)) {
                db.raw.exec(`VACUUM INTO '${destino.replace(/'/g, "''")}'`);
                fs.chmodSync(destino, 0o600);
                log.info(`[backup] cópia do banco salva em ${destino}`);
            }
            const limite = Date.now() - dias * 24 * 60 * 60_000;
            for (const f of fs.readdirSync(pasta)) {
                const m = /^audicom-(\d{4}-\d{2}-\d{2})\.db$/.exec(f);
                if (m && Date.parse(m[1]) < limite) fs.unlinkSync(path.join(pasta, f));
            }
        } catch (e) {
            log.warn('[backup] falhou:', e.message);
        }
    }
    const t1 = setTimeout(fazer, 60_000);
    const t2 = setInterval(fazer, 6 * 60 * 60_000);
    t1.unref(); t2.unref();
    return { fazer, pasta };
}
