import { ICON } from './icons.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
/** Escapa texto para HTML. Todo dado vindo de usuário passa por aqui. */
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

/** Template HTML com escape automático: html`<b>${nome}</b>`; raw(...) não escapa. */
export function html(strings, ...vals) {
    let out = '';
    strings.forEach((s, i) => {
        out += s;
        if (i < vals.length) {
            const v = vals[i];
            if (v == null || v === false) return;
            if (Array.isArray(v)) out += v.map(x => (x && x.__raw != null ? x.__raw : esc(x))).join('');
            else out += v && v.__raw != null ? v.__raw : esc(v);
        }
    });
    return { __raw: out, toString() { return out; } };
}
export const raw = (s) => ({ __raw: String(s ?? ''), toString() { return String(s ?? ''); } });

export function setHtml(el, content) { el.innerHTML = content && content.__raw != null ? content.__raw : String(content ?? ''); return el; }

// ---------- números ----------
const nf = (d) => new Intl.NumberFormat('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
const NF = [nf(0), nf(1), nf(2)];

/** Velocidade em Mbps com casas adequadas ao tamanho. */
export function fmtMbps(v) {
    if (v == null || !Number.isFinite(v)) return '–';
    if (v >= 100) return NF[0].format(v);
    if (v >= 10) return NF[1].format(v);
    return NF[2].format(v);
}
export function fmtMs(v) {
    if (v == null || !Number.isFinite(v)) return '–';
    return v >= 100 ? NF[0].format(v) : NF[1].format(v);
}
export function fmtPct(v) {
    if (v == null || !Number.isFinite(v)) return '–';
    return v === 0 ? '0' : v < 1 ? NF[2].format(v) : NF[1].format(v);
}
export const fmtInt = (v) => (v == null || !Number.isFinite(v) ? '–' : NF[0].format(v));
export const fmtNum = (v, d = 1) => (v == null || !Number.isFinite(v) ? '–' : nf(d).format(v));

// ---------- datas ----------
const TZ = 'America/Sao_Paulo';
const dfData = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' });
const dfHora = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
const dfCurta = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, day: '2-digit', month: 'short' });
const dfLonga = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

export const fmtData = (ms) => (ms ? dfData.format(new Date(ms)) : '–');
export const fmtHora = (ms) => (ms ? dfHora.format(new Date(ms)) : '–');
export const fmtDataHora = (ms) => (ms ? `${dfData.format(new Date(ms))} às ${dfHora.format(new Date(ms))}` : '–');
export const fmtDiaCurto = (ms) => (ms ? dfCurta.format(new Date(ms)).replace('.', '') : '–');
export const fmtDataLonga = (ms) => (ms ? dfLonga.format(new Date(ms)) : '–');

const rtf = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' });
export function fmtRelativo(ms) {
    if (!ms) return 'nunca';
    const s = Math.round((ms - Date.now()) / 1000);
    const a = Math.abs(s);
    if (a < 45) return 'agora mesmo';
    if (a < 3600) return rtf.format(Math.round(s / 60), 'minute');
    if (a < 86400) return rtf.format(Math.round(s / 3600), 'hour');
    if (a < 86400 * 30) return rtf.format(Math.round(s / 86400), 'day');
    return fmtData(ms);
}

export function iniciais(nome, email) {
    const base = String(nome || email || '?').trim();
    const partes = base.replace(/@.*/, '').split(/[\s._-]+/).filter(Boolean);
    const ini = partes.length > 1 ? partes[0][0] + partes[partes.length - 1][0] : base.slice(0, 2);
    return ini.toUpperCase();
}
export const primeiroNome = (nome) => String(nome || '').trim().split(/\s+/)[0] || '';

export function telefoneBonito(p) {
    if (!p) return '';
    const d = String(p).replace(/\D/g, '').replace(/^55/, '');
    if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
    if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
    return p;
}

export function median(a) {
    const s = a.filter(Number.isFinite).sort((x, y) => x - y);
    if (!s.length) return null;
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

export function storage(key, fallback = null) {
    try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; }
}
export function store(key, value) {
    try { if (value == null) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify(value)); } catch { /* modo privado */ }
}

// ---------- notificações ----------
let toastsEl = null;
export function toast(msg, tipo = 'ok', ms = 4200) {
    if (!toastsEl) {
        toastsEl = document.createElement('div');
        toastsEl.className = 'toasts';
        toastsEl.setAttribute('role', 'status');
        toastsEl.setAttribute('aria-live', 'polite');
        document.body.appendChild(toastsEl);
    }
    const el = document.createElement('div');
    el.className = `toast ${tipo}`;
    el.innerHTML = (tipo === 'ruim' ? ICON.alert : tipo === 'info' ? ICON.info : ICON.checkCircle) + `<span>${esc(msg)}</span>`;
    toastsEl.appendChild(el);
    setTimeout(() => { el.classList.add('saindo'); setTimeout(() => el.remove(), 220); }, ms);
}

export async function copiar(texto) {
    try {
        await navigator.clipboard.writeText(texto);
        return true;
    } catch {
        const ta = document.createElement('textarea');
        ta.value = texto;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        let ok = false;
        try { ok = document.execCommand('copy'); } catch { ok = false; }
        ta.remove();
        return ok;
    }
}

// ---------- modal ----------
/**
 * Diálogo de confirmação. Resolve true/false.
 * confirmar({ titulo, texto, acao: 'Excluir', perigo: true })
 */
export function confirmar({ titulo, texto, acao = 'Confirmar', perigo = false, cancelar = 'Cancelar' }) {
    return new Promise((resolve) => {
        const d = document.createElement('dialog');
        d.className = 'modal';
        d.innerHTML = `<form method="dialog" class="modal-corpo">
            <h2>${esc(titulo)}</h2>
            ${texto ? `<p>${esc(texto)}</p>` : ''}
            <div class="modal-acoes">
                <button value="nao" class="botao botao-fantasma">${esc(cancelar)}</button>
                <button value="sim" class="botao ${perigo ? 'botao-perigo' : 'botao-primario'}">${esc(acao)}</button>
            </div></form>`;
        document.body.appendChild(d);
        d.addEventListener('close', () => { resolve(d.returnValue === 'sim'); d.remove(); });
        d.showModal();
        d.querySelector('button[value="sim"]').focus();
    });
}

/** Mostra o botão como "carregando" enquanto a promessa roda. */
export async function comCarga(botao, fn) {
    if (!botao) return fn();
    const antes = botao.innerHTML;
    const largura = botao.offsetWidth;
    botao.disabled = true;
    botao.style.minWidth = largura + 'px';
    botao.innerHTML = '<span class="giro" aria-hidden="true"></span><span class="sr-only">Carregando</span>';
    try { return await fn(); } finally {
        botao.disabled = false;
        botao.innerHTML = antes;
        botao.style.minWidth = '';
    }
}

export function baixarArquivo(nome, conteudo, tipo = 'application/json') {
    const blob = conteudo instanceof Blob ? conteudo : new Blob([conteudo], { type: tipo });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nome;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Evento para o Google Analytics, quando ele está ligado. Nunca leva dados pessoais (nome, e-mail, IP). */
export function evento(nome, params = {}) {
    try { if (typeof window.gtag === 'function') window.gtag('event', nome, params); } catch { /* sem estatística, sem problema */ }
}
