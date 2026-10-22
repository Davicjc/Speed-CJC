// Login e cliente da API — tudo no servidor da Audicom.
//
// A sessão fica num cookie HttpOnly (o JavaScript da página nem enxerga):
// o navegador manda sozinho em cada pedido. Os pedidos que mudam algo levam
// o cabeçalho X-Audicom, que o servidor exige para recusar pedidos vindos de
// outros sites (CSRF).

import { esc } from './util.js';

let configPromise = null;
export function getConfig() {
    if (!configPromise) {
        configPromise = fetch('/api/config', { cache: 'no-store' })
            .then((r) => { if (!r.ok) throw new Error('servidor indisponível'); return r.json(); })
            .catch((e) => { configPromise = null; throw e; });
    }
    return configPromise;
}

export class ApiError extends Error {
    constructor(status, message, code) { super(message); this.status = status; this.code = code || null; }
}

/**
 * Chama a API. Pedidos sem sessão recebem 401 com code 'login'.
 * Ações sensíveis que o servidor recusar com "reauth" abrem um pedido de
 * senha e são repetidas automaticamente.
 */
export async function api(caminho, opts = {}) {
    const { method = 'GET', body, bruto = false, tentativa = 0 } = opts;
    const headers = { 'X-Audicom': '1' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    let res;
    try {
        res = await fetch(caminho, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, cache: 'no-store', credentials: 'same-origin' });
    } catch {
        throw new ApiError(0, 'Sem conexão com o servidor. Verifique sua internet.', 'rede');
    }
    if (bruto && res.ok) return res;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        const e = new ApiError(res.status, data.error || `O servidor respondeu ${res.status}.`, data.code);
        if (e.code === 'reauth' && tentativa < 2 && (await pedirSenha(e.message))) return api(caminho, { ...opts, tentativa: tentativa + 1 });
        throw e;
    }
    return data;
}

// ---------- sessão ----------
let mePromise = null;
/** { profile, isAdmin, isOwner, emailVerified, mail } de quem está logado, ou null. */
export function sessaoAtual({ recarregar = false } = {}) {
    if (!mePromise || recarregar) {
        mePromise = api('/api/auth/session').then((r) => (r && r.anonimo ? null : r)).catch((e) => {
            if (e.status === 401 || e.status === 403) return null;
            mePromise = null;
            throw e;
        });
    }
    return mePromise;
}

const canal = typeof BroadcastChannel === 'function' ? new BroadcastChannel('audicom-sessao') : null;
/** Avisa as outras abas que a pessoa entrou ou saiu. */
function avisarAbas(tipo) { try { canal && canal.postMessage(tipo); } catch { /* ok */ } }
export function aoMudarSessao(cb) { if (canal) canal.addEventListener('message', (ev) => cb(ev.data)); }

export async function entrar(email, senha, { lembrar = false } = {}) {
    const me = await api('/api/auth/login', { method: 'POST', body: { email: email.trim(), password: senha, lembrar } });
    mePromise = Promise.resolve(me);
    avisarAbas('entrou');
    return me;
}

export async function cadastrar(dados) {
    const r = await api('/api/auth/signup', { method: 'POST', body: dados });
    mePromise = Promise.resolve(r);
    avisarAbas('entrou');
    return r;
}

export async function sair() {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
    mePromise = Promise.resolve(null);
    avisarAbas('saiu');
}

export const enviarConfirmacao = () => api('/api/auth/verify/resend', { method: 'POST' });
export const confirmarEmail = (token) => api('/api/auth/verify', { method: 'POST', body: { token } });
export const redefinirSenha = (email) => api('/api/auth/forgot', { method: 'POST', body: { email: email.trim() } });
export const conferirLinkSenha = (token) => api('/api/auth/reset?token=' + encodeURIComponent(token));
export const novaSenhaComCodigo = (token, password) => api('/api/auth/reset', { method: 'POST', body: { token, password } });
export const reconfirmarSenha = (password) => api('/api/auth/reauth', { method: 'POST', body: { password } });
export const trocarSenha = (atual, nova) => api('/api/me/password', { method: 'POST', body: { current: atual, password: nova } });

/** Diálogo "confirme sua senha" para ações sensíveis. Resolve true se confirmou. */
export function pedirSenha(motivo = 'Por segurança, confirme sua senha para continuar.') {
    return new Promise((resolve) => {
        const d = document.createElement('dialog');
        d.className = 'modal';
        d.innerHTML = `<form class="modal-corpo" method="post" novalidate>
            <h2>Confirme sua senha</h2>
            <p>${esc(motivo)}</p>
            <input type="email" autocomplete="username" hidden>
            <div class="campo"><label for="reauth-senha">Senha</label>
                <input id="reauth-senha" class="entrada" type="password" autocomplete="current-password" required></div>
            <p class="erro-campo" role="alert" hidden></p>
            <div class="modal-acoes">
                <button type="button" value="nao" class="botao botao-fantasma">Cancelar</button>
                <button type="submit" class="botao botao-primario">Confirmar</button>
            </div></form>`;
        document.body.appendChild(d);
        const form = d.querySelector('form');
        const erro = d.querySelector('.erro-campo');
        let ok = false;
        d.querySelector('button[value="nao"]').addEventListener('click', () => d.close());
        form.addEventListener('submit', async (ev) => {
            ev.preventDefault();
            const btn = form.querySelector('button[type="submit"]');
            btn.disabled = true;
            erro.hidden = true;
            try {
                await api('/api/auth/reauth', { method: 'POST', body: { password: form.querySelector('#reauth-senha').value }, tentativa: 9 });
                ok = true;
                d.close();
            } catch (e) {
                erro.textContent = e.message;
                erro.hidden = false;
            } finally { btn.disabled = false; }
        });
        d.addEventListener('close', () => { d.remove(); resolve(ok); });
        d.showModal();
        d.querySelector('#reauth-senha').focus();
    });
}
