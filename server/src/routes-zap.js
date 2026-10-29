// Rotas do WhatsApp.
//
// Administração (/api/admin/zap…): conectar por QR code, desconectar, escolher
// os grupos e contatos permitidos e o destino padrão. Conectar, desconectar e
// mudar destinos pedem a senha de novo (o QR dá acesso à conta do WhatsApp).
//
// Técnico (/api/tecnico/zap…): enviar um teste guardado, com fotos, para um dos
// destinos permitidos. O texto é montado AQUI, a partir do teste no banco
// (nunca um texto livre do navegador), e o técnico só escolhe entre os
// destinos que a administração liberou: o WhatsApp da empresa não vira
// disparador de mensagens. As fotos não são gravadas: vão da memória para o
// WhatsApp. A auditoria registra quem enviou o quê para onde (sem as fotos).

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readJsonBody, sendJson } from './util.js';
import { jidValido } from './zap.js';

const err = (status, message, code) => Object.assign(new Error(message), { status, code });
const MAX_FOTOS = 6;
const MAX_FOTO = 3 * 1024 * 1024;
const MAX_MINIATURA = 24 * 1024;
const ehJpeg = (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;

function base64(valor, max) {
    if (typeof valor !== 'string') return null;
    const limpo = valor.replace(/^data:image\/jpeg;base64,/, '');
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(limpo) || limpo.length > Math.ceil(max * 4 / 3) + 4) return null;
    const b = Buffer.from(limpo, 'base64');
    return b.length && b.length <= max && ehJpeg(b) ? b : null;
}

export function createZapRoutes({ authn, users, store, zap, config, siteOrigin, createRateLimiter, log = console }) {
    const envios = createRateLimiter({ max: 30, windowMs: 60 * 60_000 });
    let relatorio = null;
    const modulo = async () => (relatorio = relatorio || await import(pathToFileURL(path.join(config.staticDir, 'js/ui/relatorio.js')).href));
    const textoDoTeste = async (t, opts) => (await modulo()).textoCompleto(t, opts);
    const quem = (p) => ({ uid: p.id, email: p.email, name: p.name });

    return async function handleZap(req, res, url, ip) {
        const p = url.pathname;
        const m = req.method;

        // ---------- administração ----------
        if (p === '/api/admin/zap' || p.startsWith('/api/admin/zap/')) {
            const { sess, profile } = authn.requireAdmin(req, ip);
            if (p === '/api/admin/zap' && m === 'GET') return sendJson(res, 200, { ...zap.estado(), ...zap.destinos(), ocultar: zap.ocultar(), partes: (await modulo()).PARTES_MSG }), true;
            if (p === '/api/admin/zap/mensagem' && m === 'POST') {
                const body = await readJsonBody(req, 4 * 1024);
                const validas = new Set((await modulo()).PARTES_MSG.map(([k]) => k));
                const ocultar = [...new Set((Array.isArray(body.ocultar) ? body.ocultar : []).filter((k) => validas.has(k)))];
                zap.salvarOcultar(ocultar);
                users.audit({ actor: quem(profile), action: 'alterou o que vai na mensagem do WhatsApp', detail: { ocultar }, ip });
                return sendJson(res, 200, { ocultar }), true;
            }
            if (p === '/api/admin/zap/conectar' && m === 'POST') {
                authn.requireRecentLogin(sess);
                zap.conectar();
                users.audit({ actor: quem(profile), action: 'iniciou a conexão do WhatsApp', ip });
                return sendJson(res, 200, zap.estado()), true;
            }
            if (p === '/api/admin/zap/desconectar' && m === 'POST') {
                authn.requireRecentLogin(sess);
                await zap.desconectar();
                users.audit({ actor: quem(profile), action: 'desconectou o WhatsApp', ip });
                return sendJson(res, 200, zap.estado()), true;
            }
            if (p === '/api/admin/zap/grupos' && m === 'GET') return sendJson(res, 200, { grupos: await zap.grupos() }), true;
            if (p === '/api/admin/zap/contato' && m === 'POST') {
                const body = await readJsonBody(req, 1024);
                let numero = String(body.numero || '').replace(/\D/g, '');
                if (numero.length === 10 || numero.length === 11) numero = '55' + numero; // número brasileiro sem o 55
                if (numero.length < 12 || numero.length > 15) throw err(400, 'Número inválido. Use DDD + número, por exemplo (34) 99999-9999.');
                const r = await zap.contato(numero);
                if (!r) throw err(404, 'Esse número não tem WhatsApp.');
                return sendJson(res, 200, { jid: r.jid }), true;
            }
            if (p === '/api/admin/zap/destinos' && m === 'POST') {
                authn.requireRecentLogin(sess);
                const body = await readJsonBody(req, 16 * 1024);
                const lista = Array.isArray(body.destinos) ? body.destinos.slice(0, 20) : [];
                const destinos = [];
                for (const d of lista) {
                    if (!d || !jidValido(d.jid)) throw err(400, 'Destino inválido.');
                    const nome = String(d.nome || '').trim().slice(0, 80) || 'Sem nome';
                    if (!destinos.some((x) => x.jid === d.jid)) destinos.push({ jid: d.jid, nome, tipo: d.jid.endsWith('@g.us') ? 'grupo' : 'contato' });
                }
                const padrao = destinos.some((d) => d.jid === body.padrao) ? body.padrao : (destinos[0] ? destinos[0].jid : null);
                zap.salvarDestinos(destinos, padrao);
                users.audit({ actor: quem(profile), action: 'alterou os destinos do WhatsApp', detail: { destinos: destinos.map((d) => d.nome), padrao: (destinos.find((d) => d.jid === padrao) || {}).nome || null }, ip });
                return sendJson(res, 200, zap.destinos()), true;
            }
            if (p === '/api/admin/zap/teste' && m === 'POST') {
                const { padrao, destinos } = zap.destinos();
                if (!padrao) throw err(400, 'Escolha um destino padrão primeiro.');
                await zap.enviar(padrao, `✅ ${config.siteName} conectado. Mensagem de teste enviada por ${profile.name}.`);
                users.audit({ actor: quem(profile), action: 'enviou mensagem de teste no WhatsApp', detail: { destino: (destinos.find((d) => d.jid === padrao) || {}).nome }, ip });
                return sendJson(res, 200, { ok: true }), true;
            }
            throw err(404, 'rota não encontrada');
        }

        // ---------- técnico ----------
        if (p === '/api/tecnico/zap' && m === 'GET') {
            authn.requireTecnico(req, ip);
            const { destinos, padrao } = zap.destinos();
            return sendJson(res, 200, { pronto: zap.pronto(), estado: zap.estado().estado, destinos, padrao }), true;
        }
        if (p === '/api/tecnico/zap/enviar' && m === 'POST') {
            const { profile } = authn.requireTecnico(req, ip);
            if (!envios.take(profile.id)) throw err(429, 'Muitos envios na última hora. Aguarde um pouco.');
            const body = await readJsonBody(req, 26 * 1024 * 1024);
            const t = typeof body.teste === 'string' && /^[0-9A-Za-z]{15}$/.test(body.teste) ? store.get(body.teste) : null;
            if (!t) throw err(404, 'Teste não encontrado.');
            const { destinos } = zap.destinos();
            const destino = destinos.find((d) => d.jid === body.destino);
            if (!destino) throw err(400, 'Escolha um dos destinos liberados pela administração.');
            const fotos = Array.isArray(body.fotos) ? body.fotos : [];
            if (fotos.length > MAX_FOTOS) throw err(400, `No máximo ${MAX_FOTOS} fotos por envio.`);
            // dados do atendimento: os da janela de envio valem (e ficam guardados no teste)
            const texto = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
            const veio = body.atendimento && typeof body.atendimento === 'object' ? body.atendimento : {};
            const planoVeio = Number(veio.plano);
            const at = {
                cliente: texto(veio.cliente, 80) ?? (t.atendimento || {}).cliente ?? null,
                plano: Number.isFinite(planoVeio) && planoVeio > 0 && planoVeio <= 100_000 ? Math.round(planoVeio) : (t.atendimento || {}).plano ?? null,
                obs: texto(veio.obs, 500) ?? texto(body.obs, 500) ?? (t.atendimento || {}).obs ?? null,
            };
            const temAt = at.cliente || at.plano || at.obs;
            if (temAt && JSON.stringify(at) !== JSON.stringify(t.atendimento || null)) store.setAtendimento(t.id, at);
            t.atendimento = temAt ? at : null;
            const ocultar = zap.ocultar();
            const imagens = fotos.map((f, i) => {
                const imagem = base64(f && f.imagem, MAX_FOTO);
                if (!imagem) throw err(400, `A foto ${i + 1} não é uma imagem JPEG válida (ou passa de 3 MB).`);
                const mini = base64(f && f.miniatura, MAX_MINIATURA);
                return {
                    imagem: imagem.toString('base64'),
                    miniatura: mini ? mini.toString('base64') : null,
                    legenda: `📸 Foto ${i + 1} de ${fotos.length} · ${t.protocol}${at.cliente && !ocultar.includes('atendimento') ? ` · ${at.cliente}` : ''}`,
                };
            });
            const link = `${siteOrigin(req)}/r/${t.id}`;
            const relat = await textoDoTeste(t, { link, plano: at.plano || null, empresa: config.serverName || config.siteName, tom: 'tecnico', ocultar });
            const linhas = [
                ocultar.includes('quem') ? null : `👷 *Enviado por:* ${profile.name} (${profile.email})`,
                ocultar.includes('quem') ? null : t.user ? `👤 *Conta do teste:* ${t.user.name || '–'} (${t.user.email || '–'})` : '👤 *Conta do teste:* feito sem conta',
                imagens.length ? `📸 ${imagens.length === 1 ? '1 foto logo abaixo' : `${imagens.length} fotos logo abaixo`}` : null,
                '━━━━━━━━━━━━━━━',
                relat,
            ].filter((l) => l !== null);
            await zap.enviar(destino.jid, linhas.join('\n'), imagens);
            users.audit({ actor: quem(profile), action: 'enviou teste para o WhatsApp', detail: { protocolo: t.protocol, destino: destino.nome, fotos: imagens.length, cliente: at.cliente || null }, ip });
            log.info(`[whatsapp] ${t.protocol} enviado para "${destino.nome}" por ${profile.email} (${imagens.length} foto(s))`);
            return sendJson(res, 200, { ok: true, destino: destino.nome, fotos: imagens.length }), true;
        }
        return false;
    };
}
