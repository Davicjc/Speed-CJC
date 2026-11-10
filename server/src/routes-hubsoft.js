// Rotas do HubSoft (somente leitura; ver hubsoft.js).
//
// Técnico:
//   GET /api/tecnico/hubsoft/conexao        quem usa o IP DESTE pedido (o navegador não escolhe o IP)
//   GET /api/tecnico/hubsoft/cliente?codigo  o cliente pelo código, quando o técnico diz que não é o do IP
// Administração:
//   GET    /api/admin/hubsoft          estado (nunca as credenciais)
//   POST   /api/admin/hubsoft          salvar credenciais: só o dono, com a senha confirmada há pouco
//   POST   /api/admin/hubsoft/testar   confere se o HubSoft aceita as credenciais
//   POST   /api/admin/hubsoft/ligar    { ativo }: desligar qualquer administrador pode (é o botão de
//                                      emergência); ligar, só o dono com a senha confirmada
//   DELETE /api/admin/hubsoft          apaga as credenciais: só o dono, com a senha confirmada
// Cada consulta que devolve um cliente fica na auditoria (quem, qual cliente, como).

import { readJsonBody, sendJson } from './util.js';

const err = (status, message, code) => Object.assign(new Error(message), { status, code });

export function createHubsoftRoutes({ authn, users, hubsoft, createRateLimiter, log = console }) {
    const porConexao = createRateLimiter({ max: 120, windowMs: 60 * 60_000 });
    const porCodigo = createRateLimiter({ max: 40, windowMs: 60 * 60_000 });
    const quem = (p) => ({ uid: p.id, email: p.email, name: p.name });
    const soDono = (req, ip) => {
        const u = authn.requireAdmin(req, ip);
        if (!users.isOwner(u.profile)) throw err(403, 'Só o dono da conta muda a integração com o HubSoft.');
        authn.requireRecentLogin(u.sess);
        return u;
    };

    return async function handleHubsoft(req, res, url, ip) {
        const p = url.pathname;
        const m = req.method;

        if (p === '/api/tecnico/hubsoft/conexao' || p === '/api/tecnico/hubsoft/cliente') {
            const { profile } = authn.requireTecnico(req, ip);
            if (m !== 'GET') throw err(405, 'método não permitido');
            if (!hubsoft.ativo()) return sendJson(res, 200, { ativo: false }), true;
            const limite = p.endsWith('/conexao') ? porConexao : porCodigo;
            if (!limite.take(profile.id)) throw err(429, 'Muitas consultas ao HubSoft na última hora. Preencha o cliente à mão por enquanto.');
            const r = p.endsWith('/conexao') ? await hubsoft.porIp(ip) : await hubsoft.porCodigo(url.searchParams.get('codigo'));
            if (!r) return sendJson(res, 200, { ativo: false }), true;
            if (r.encontrado) {
                users.audit({ actor: quem(profile), action: 'consultou cliente no HubSoft', detail: { codigo: r.cliente.codigo, por: p.endsWith('/conexao') ? 'ip' : 'codigo' }, ip });
            }
            return sendJson(res, 200, { ativo: true, ...r, ...(p.endsWith('/conexao') ? { ip } : {}) }), true;
        }

        if (p !== '/api/admin/hubsoft' && !p.startsWith('/api/admin/hubsoft/')) return false;

        if (p === '/api/admin/hubsoft' && m === 'GET') {
            authn.requireAdmin(req, ip);
            return sendJson(res, 200, hubsoft.estado()), true;
        }
        if (p === '/api/admin/hubsoft' && m === 'POST') {
            const { profile } = soDono(req, ip);
            const b = await readJsonBody(req, 4 * 1024);
            const estado = await hubsoft.salvar({ url: b.url, clientId: b.clientId, clientSecret: b.clientSecret, usuario: b.usuario, senha: b.senha });
            users.audit({ actor: quem(profile), action: 'configurou a integração com o HubSoft', detail: { url: estado.url }, ip });
            log.info(`[hubsoft] configurado por ${profile.email} (${estado.url})`);
            return sendJson(res, 200, estado), true;
        }
        if (p === '/api/admin/hubsoft' && m === 'DELETE') {
            const { profile } = soDono(req, ip);
            const estado = hubsoft.remover();
            users.audit({ actor: quem(profile), action: 'apagou a integração com o HubSoft', ip });
            log.info(`[hubsoft] credenciais apagadas por ${profile.email}`);
            return sendJson(res, 200, estado), true;
        }
        if (p === '/api/admin/hubsoft/testar' && m === 'POST') {
            authn.requireAdmin(req, ip);
            return sendJson(res, 200, await hubsoft.testar()), true;
        }
        if (p === '/api/admin/hubsoft/ligar' && m === 'POST') {
            const b = await readJsonBody(req, 1024);
            const ligar = b.ativo === true;
            const { profile } = ligar ? soDono(req, ip) : authn.requireAdmin(req, ip);
            const estado = hubsoft.ligar(ligar);
            users.audit({ actor: quem(profile), action: ligar ? 'ligou a integração com o HubSoft' : 'desligou a integração com o HubSoft', ip });
            return sendJson(res, 200, estado), true;
        }
        throw err(404, 'rota não encontrada');
    };
}
