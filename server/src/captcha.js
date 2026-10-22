import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// Captcha do cadastro. Dois provedores, mesma interface:
//
//  - Cloudflare Turnstile (quando TURNSTILE_SITE_KEY/TURNSTILE_SECRET existem):
//    o widget roda no navegador e a resposta é conferida AQUI, no servidor,
//    contra a API da Cloudflare. É o recomendado para o site público.
//
//  - Desafio próprio (prova de trabalho), quando não há chaves: o servidor
//    sorteia um número, entrega só o hash dele (assinado com HMAC) e o
//    navegador precisa encontrar o número testando um por um — custa alguns
//    segundos de processamento a cada cadastro, o que torna caro criar contas
//    em massa. Não depende de nenhum serviço de terceiros.
//
// Nos dois casos a resposta vale uma vez só e expira.

const POW_TTL_MS = 10 * 60_000;
const TURNSTILE_VERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function loadKey(dataDir) {
    const file = path.join(dataDir, 'captcha.key');
    try {
        const k = fs.readFileSync(file, 'utf8').trim();
        if (k.length >= 32) return k;
    } catch { /* cria abaixo */ }
    const k = crypto.randomBytes(32).toString('hex');
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(file, k + '\n', { mode: 0o600 });
    return k;
}

export function createCaptcha({ dataDir, turnstileSiteKey, turnstileSecret, powMax = 1_200_000, log = console, fetchImpl = fetch }) {
    const provider = turnstileSiteKey && turnstileSecret ? 'turnstile' : 'pow';
    const key = provider === 'pow' ? loadKey(dataDir) : null;
    const used = new Map();       // resposta já usada -> expira em
    const issued = new Map();     // ip -> [instantes] (dificuldade sobe para quem pede demais)

    const sweeper = setInterval(() => {
        const t = Date.now();
        for (const [k, exp] of used) if (exp < t) used.delete(k);
        for (const [ip, arr] of issued) {
            while (arr.length && arr[0] < t - 60 * 60_000) arr.shift();
            if (!arr.length) issued.delete(ip);
        }
    }, 60_000);
    sweeper.unref();

    if (provider === 'pow') log.warn('[captcha] usando o desafio próprio (prova de trabalho). Funciona sem nada externo; para mais proteção, dá para ligar o Cloudflare Turnstile (veja docs/MANUAL.md, seção 8).');

    const hmac = (s) => crypto.createHmac('sha256', key).update(s).digest('hex');
    const safeEq = (a, b) => {
        const x = Buffer.from(String(a)), y = Buffer.from(String(b));
        return x.length === y.length && crypto.timingSafeEqual(x, y);
    };

    function publicConfig() {
        return provider === 'turnstile' ? { provider, siteKey: turnstileSiteKey } : { provider };
    }

    /** Novo desafio de prova de trabalho (só no modo 'pow'). */
    function challenge(ip) {
        if (provider !== 'pow') return null;
        const arr = issued.get(ip) || [];
        arr.push(Date.now());
        issued.set(ip, arr);
        // quem pede muitos desafios na mesma hora recebe desafios mais longos
        const factor = arr.length > 30 ? 4 : arr.length > 12 ? 2 : 1;
        const max = powMax * factor;
        const expires = Date.now() + POW_TTL_MS;
        const salt = crypto.randomBytes(12).toString('hex') + '.' + expires.toString(36);
        const number = crypto.randomInt(0, max);
        const challengeHash = sha256(salt + number);
        return { algorithm: 'SHA-256', salt, challenge: challengeHash, maxnumber: max, signature: hmac(challengeHash) };
    }

    function verifyPow(payload) {
        let p;
        try { p = JSON.parse(Buffer.from(String(payload), 'base64').toString('utf8')); } catch { return { ok: false, reason: 'resposta do captcha ilegível' }; }
        if (!p || typeof p.salt !== 'string' || typeof p.challenge !== 'string' || typeof p.signature !== 'string' || !Number.isInteger(p.number)) {
            return { ok: false, reason: 'resposta do captcha incompleta' };
        }
        const expires = parseInt(p.salt.split('.')[1] || '', 36);
        if (!Number.isFinite(expires) || expires < Date.now()) return { ok: false, reason: 'o captcha expirou, confirme de novo' };
        if (!safeEq(hmac(p.challenge), p.signature)) return { ok: false, reason: 'captcha inválido' };
        if (sha256(p.salt + p.number) !== p.challenge) return { ok: false, reason: 'captcha não resolvido' };
        if (used.has(p.challenge)) return { ok: false, reason: 'este captcha já foi usado, confirme de novo' };
        used.set(p.challenge, expires);
        return { ok: true };
    }

    async function verifyTurnstile(token, ip) {
        if (typeof token !== 'string' || token.length < 10 || token.length > 4096) return { ok: false, reason: 'confirme o captcha' };
        if (used.has(token)) return { ok: false, reason: 'este captcha já foi usado, confirme de novo' };
        const body = new URLSearchParams({ secret: turnstileSecret, response: token, idempotency_key: crypto.randomUUID() });
        if (ip) body.set('remoteip', ip);
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 8000);
        try {
            const res = await fetchImpl(TURNSTILE_VERIFY, { method: 'POST', body, signal: ctrl.signal });
            const d = await res.json();
            if (!d.success) {
                log.warn('[captcha] Turnstile recusou:', (d['error-codes'] || []).join(', '));
                const codes = d['error-codes'] || [];
                if (codes.includes('timeout-or-duplicate')) return { ok: false, reason: 'o captcha expirou, confirme de novo' };
                if (codes.some(c => /secret/.test(c))) return { ok: false, reason: 'captcha mal configurado no servidor (chave secreta)' };
                return { ok: false, reason: 'não foi possível confirmar que você não é um robô' };
            }
            if (d.action && d.action !== 'signup') return { ok: false, reason: 'captcha de outro formulário' };
            used.set(token, Date.now() + 10 * 60_000);
            return { ok: true };
        } catch (e) {
            log.warn('[captcha] falha ao falar com a Cloudflare:', e.message);
            return { ok: false, reason: 'o serviço de captcha não respondeu, tente de novo' };
        } finally {
            clearTimeout(t);
        }
    }

    return {
        provider,
        publicConfig,
        challenge,
        /** Confere a resposta do captcha enviada no cadastro. */
        verify(answer, ip) {
            return provider === 'turnstile' ? verifyTurnstile(answer, ip) : Promise.resolve(verifyPow(answer));
        },
    };
}
