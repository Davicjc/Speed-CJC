// Sobe um servidor de teste isolado (porta aleatória, banco temporário) e
// oferece um "navegador" simples que guarda o cookie de sessão.
// Com BASE=http://... no ambiente, usa esse servidor em vez de subir um.
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function subirServidor(envExtra = {}) {
    if (process.env.BASE) return { base: process.env.BASE.replace(/\/$/, ''), dataDir: process.env.DATA_DIR || null, parar() {} };
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audicom-teste-'));
    const porta = 20000 + Math.floor(Math.random() * 20000);
    const env = { ...process.env, PORT: String(porta), DATA_DIR: dataDir, GEOCODER: 'off', SIGNUP_LIMIT_PER_HOUR: '1000', ANON_TESTS_PER_DAY: '1000', ANON_TESTS_PER_IP_DAY: '1000', SMTP_HOST: '', NTP_SERVERS: 'a.st1.ntp.br', ...envExtra };
    const proc = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/server.js'], { cwd: raiz, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let saida = '';
    await new Promise((ok, falha) => {
        const t = setTimeout(() => falha(new Error('o servidor de teste não subiu:\n' + saida)), 20000);
        const ler = (d) => { saida += d; if (saida.includes('ouvindo em')) { clearTimeout(t); ok(); } };
        proc.stdout.on('data', ler);
        proc.stderr.on('data', ler);
        proc.on('exit', (c) => { clearTimeout(t); falha(new Error('o servidor saiu com código ' + c + ':\n' + saida)); });
    });
    proc.removeAllListeners('exit');
    return {
        base: `http://127.0.0.1:${porta}`,
        dataDir,
        env,
        /** Roda o comando de administração (npm run admin) neste servidor. */
        admin(...args) {
            return execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', 'tools/admin.mjs', ...args], { cwd: raiz, env, encoding: 'utf8' });
        },
        parar() { proc.kill('SIGTERM'); try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* ok */ } },
    };
}

/** "Navegador" mínimo: guarda o cookie de sessão e manda o cabeçalho do site. */
export function navegador(base) {
    let cookie = null;
    async function pedido(metodo, caminho, corpo, extras = {}) {
        const headers = { 'X-Audicom': '1', ...extras };
        if (corpo !== undefined) headers['Content-Type'] = 'application/json';
        if (cookie) headers.Cookie = cookie;
        const r = await fetch(base + caminho, { method: metodo, headers, body: corpo === undefined ? undefined : JSON.stringify(corpo), redirect: 'manual' });
        const sc = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
        for (const c of sc) {
            const [par] = c.split(';');
            if (/Max-Age=0/.test(c)) cookie = null; else cookie = par;
        }
        const texto = await r.text();
        let body = {};
        try { body = texto ? JSON.parse(texto) : {}; } catch { body = { texto }; }
        return { status: r.status, body, headers: r.headers, texto };
    }
    return {
        get: (c, extras) => pedido('GET', c, undefined, extras),
        post: (c, b, extras) => pedido('POST', c, b === undefined ? {} : b, extras),
        patch: (c, b) => pedido('PATCH', c, b),
        del: (c) => pedido('DELETE', c),
        get cookie() { return cookie; },
        set cookie(v) { cookie = v; },
    };
}
