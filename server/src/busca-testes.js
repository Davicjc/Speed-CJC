// Busca de testes, usada pela administração e pelo /tecnico: por protocolo
// SPD-…, pelo id, ou pelo nome/e-mail de quem fez, com filtros de modo,
// origem (página do cliente ou técnica), período e paginação.

import { isId } from './ids.js';
import { MODES } from './results.js';

const ORIGENS = ['cliente', 'tecnico'];

export function buscarTestes({ store, users, url }) {
    const n = (k) => (url.searchParams.get(k) ? Number(url.searchParams.get(k)) : null);
    const q = (url.searchParams.get('q') || '').trim();
    const mode = MODES.includes(url.searchParams.get('mode')) ? url.searchParams.get('mode') : null;
    const origem = ORIGENS.includes(url.searchParams.get('origem')) ? url.searchParams.get('origem') : null;
    let uid = url.searchParams.get('uid') || undefined;
    if (uid === 'anon') uid = null;
    let matchedUsers = null;
    if (q) {
        // protocolo: PREFIXO-AAMMDD-HHMM-XXXX (qualquer prefixo, inclusive o de antes de trocar)
        if (/^[A-Z0-9]{2,6}-\d{6}-\d{4}-/i.test(q)) {
            const t = store.findByProtocol(q);
            return { items: t ? [store.summary(t)] : [], next: null };
        }
        if (isId(q)) {
            const t = store.get(q);
            return { items: t ? [store.summary(t)] : [], next: null };
        }
        matchedUsers = users.list({ q, limit: 8 }).items;
        if (!matchedUsers.length) return { items: [], next: null, matchedUsers };
        if (uid === undefined) uid = matchedUsers[0].uid;
    }
    const page = store.list({ uid, mode, origem, from: n('from'), to: n('to'), after: url.searchParams.get('after'), limit: n('limit') || 50 });
    return { ...page, matchedUsers };
}
