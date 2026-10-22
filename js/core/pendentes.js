// Testes feitos sem login ficam "pendentes" neste navegador por 24 h: o
// servidor devolveu um código secreto que prova que foi este navegador que
// fez o teste. Ao entrar na conta, eles vão sozinhos para o histórico.

import { api } from './auth.js';
import { storage, store, toast } from './util.js';

const CHAVE = 'audicom.testes-pendentes';
const PRAZO = 24 * 60 * 60_000;

const lista = () => (storage(CHAVE, []) || []).filter((p) => p && p.id && p.token && Date.now() - p.at < PRAZO);

export function guardarPendente(id, token) {
    const l = lista().filter((p) => p.id !== id);
    l.push({ id, token, at: Date.now() });
    store(CHAVE, l.slice(-20));
}

export const temPendentes = () => lista().length > 0;

export async function reivindicarPendentes({ avisar = true } = {}) {
    const l = lista();
    if (!l.length) { store(CHAVE, null); return 0; }
    let n = 0;
    const ficam = [];
    for (const p of l) {
        try {
            await api(`/api/results/${p.id}/claim`, { method: 'POST', body: { token: p.token } });
            n++;
        } catch (e) {
            if (e.status === 0 || e.status >= 500 || e.status === 429) ficam.push(p); // tenta de novo depois
        }
    }
    store(CHAVE, ficam.length ? ficam : null);
    if (n && avisar) toast(n === 1 ? 'O teste que você fez sem entrar foi guardado no seu painel.' : `${n} testes feitos sem entrar foram guardados no seu painel.`);
    return n;
}
