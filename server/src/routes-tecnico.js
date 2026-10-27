// Rotas do /tecnico: técnicos e administradores veem os testes de todos os
// clientes (feitos na página do cliente e na técnica), com todos os detalhes.
// Só leitura: dar e tirar acessos continua sendo da administração.

import { buscarTestes } from './busca-testes.js';
import { sendJson } from './util.js';

const err = (status, message, code) => Object.assign(new Error(message), { status, code });

export function createTecnicoRoutes({ authn, store, users }) {
    return async function handleTecnico(req, res, url, ip) {
        const p = url.pathname;
        if (!p.startsWith('/api/tecnico/')) return false;
        authn.requireTecnico(req, ip);
        if (req.method !== 'GET') throw err(405, 'método não permitido');

        if (p === '/api/tecnico/tests') return sendJson(res, 200, buscarTestes({ store, users, url })), true;

        const tm = /^\/api\/tecnico\/tests\/([0-9A-Za-z]{15})$/.exec(p);
        if (tm) {
            const t = store.get(tm[1]);
            if (!t) throw err(404, 'Teste não encontrado.');
            return sendJson(res, 200, t), true;
        }
        throw err(404, 'rota não encontrada');
    };
}
