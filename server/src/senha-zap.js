// "Esqueci minha senha" pelo WhatsApp: um código de 6 números vai para o
// WhatsApp que já está cadastrado na conta, e a pessoa escolhe a senha nova
// com ele (e já entra).
//
// Contra abuso e contra roubo de conta:
// - O código vai SÓ para o número que já estava na conta, nunca para um número
//   digitado na hora. Pedir pelo número só funciona se ele for de uma conta só.
// - Captcha no pedido. A resposta é sempre a mesma, exista a conta ou não, e o
//   envio acontece em segundo plano, para nem o tempo de resposta denunciar
//   quem tem cadastro.
// - Limites por IP, por conta, por número e no total: ninguém usa o WhatsApp da
//   empresa como disparador, e ele não é bloqueado por spam.
// - 6 números, vale 10 minutos, 5 tentativas e uso único. Fica só em memória e
//   só como HMAC (reiniciar o servidor invalida os códigos pendentes).
// - Conta de dono não usa este caminho: só pelo terminal do servidor.

import crypto from 'node:crypto';
import { normalizePhone, validateEmail } from './results.js';

const VALIDADE_MS = 10 * 60_000;
const TENTATIVAS = 5;
const INTERVALO_MS = 60_000; // no máximo um código novo por minuto para a mesma conta
const HORA = 60 * 60_000;

const erro = (status, message, code) => Object.assign(new Error(message), { status, code });
const digitos = (fone) => String(fone || '').replace(/\D/g, '');

export function createSenhaZap({ users, zap, createRateLimiter, nomeSite = 'Teste de velocidade', log = console }) {
    const segredo = crypto.randomBytes(32);
    const codigos = new Map(); // uid -> { hash, expira, tentativas, criado }
    const limites = {
        ip: createRateLimiter({ max: 5, windowMs: HORA }),
        conta: createRateLimiter({ max: 3, windowMs: HORA }),
        contaDia: createRateLimiter({ max: 6, windowMs: 24 * HORA }),
        numero: createRateLimiter({ max: 4, windowMs: HORA }),
        total: createRateLimiter({ max: 40, windowMs: HORA }),
    };
    const hmac = (uid, codigo) => crypto.createHmac('sha256', segredo).update(`${uid}:${codigo}`).digest();
    setInterval(() => { const agora = Date.now(); for (const [k, v] of codigos) if (v.expira < agora) codigos.delete(k); }, 60_000).unref();

    const conectado = () => zap.estado().estado === 'conectado';
    // a administração pode desligar a recuperação pelo WhatsApp (Administração → WhatsApp)
    const disponivel = () => conectado() && (typeof zap.senhaAtiva !== 'function' || zap.senhaAtiva());

    /** A conta pelo e-mail ou pelo WhatsApp (só se o número for de uma conta só). */
    function conta(login) {
        const s = String(login || '').trim().slice(0, 254);
        if (!s) return null;
        if (s.includes('@')) {
            try { return users.getByEmail(validateEmail(s)); } catch { return null; }
        }
        let fone;
        try { fone = normalizePhone(s); } catch { return null; }
        const lista = users.getByPhone(fone);
        return lista.length === 1 ? lista[0] : null;
    }
    const podeUsar = (u) => !!u && !u.disabled && !!u.phone && !users.isOwner(u);

    function mandar(u, texto) {
        (async () => {
            const c = await zap.contato(digitos(u.phone));
            if (!c || !c.jid) { log.warn(`[senha-zap] o número da conta ${u.email} não tem WhatsApp`); return; }
            await zap.enviar(c.jid, texto);
        })().catch((e) => log.warn(`[senha-zap] não deu para enviar para ${u.email}: ${e.message}`));
    }

    /** Pede um código. Não diz se a conta existe: quem chama responde sempre igual. */
    function pedir({ login, ip }) {
        if (!disponivel()) throw erro(503, 'A recuperação de senha pelo WhatsApp não está disponível agora. Fale com o suporte.', 'zap_off');
        if (!limites.ip.take(ip)) throw erro(429, 'Muitos pedidos a partir da sua rede. Espere um pouco e tente de novo.');
        const u = conta(login);
        if (!podeUsar(u)) { if (u) log.info(`[senha-zap] pedido para ${u.email} ignorado (${u.disabled ? 'desativada' : !u.phone ? 'sem WhatsApp' : 'conta de dono'})`); return; }
        const atual = codigos.get(u.id);
        if (atual && Date.now() - atual.criado < INTERVALO_MS) return;
        if (!limites.conta.take(u.id) || !limites.contaDia.take(u.id) || !limites.numero.take(digitos(u.phone))) { log.warn(`[senha-zap] limite de códigos da conta ${u.email}`); return; }
        if (!limites.total.take('todos')) { log.warn('[senha-zap] limite geral de códigos por hora atingido'); return; }
        const codigo = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
        codigos.set(u.id, { hash: hmac(u.id, codigo), expira: Date.now() + VALIDADE_MS, tentativas: 0, criado: Date.now() });
        mandar(u, `🔐 *${nomeSite}*\n\nSeu código para criar uma nova senha é:\n\n*${codigo}*\n\nVale por 10 minutos. Não passe este código para ninguém, nem para quem disser que é do suporte.\n\nSe não foi você que pediu, ignore esta mensagem: sua senha continua a mesma.`);
        log.info(`[senha-zap] código enviado para o WhatsApp da conta ${u.email} (${ip})`);
    }

    /** Confere o código; certo, devolve a conta (e o código deixa de valer). */
    function conferir({ login, codigo }) {
        const u = conta(login);
        const reg = u && codigos.get(u.id);
        const invalido = () => erro(400, 'Código errado ou vencido. Use o último código que chegou no WhatsApp, ou peça outro.', 'codigo');
        if (!podeUsar(u) || !reg) throw invalido();
        if (reg.expira < Date.now()) { codigos.delete(u.id); throw invalido(); }
        const c = digitos(codigo);
        if (c.length !== 6) throw erro(400, 'O código tem 6 números.', 'codigo');
        reg.tentativas++;
        if (!crypto.timingSafeEqual(reg.hash, hmac(u.id, c))) {
            if (reg.tentativas >= TENTATIVAS) { codigos.delete(u.id); throw erro(400, 'Muitas tentativas erradas. Peça um código novo.', 'codigo'); }
            throw invalido();
        }
        codigos.delete(u.id);
        return u;
    }

    /** Aviso no WhatsApp da pessoa de que a senha mudou (quem não pediu fica sabendo). */
    function avisarTroca(u, { porAdmin = false } = {}) {
        if (!u || !u.phone || !conectado()) return;
        mandar(u, `🔐 *${nomeSite}*\n\nA senha da sua conta (${u.email}) foi trocada agora há pouco${porAdmin ? ' por um administrador' : ''}.\n\nSe não foi você, fale com o suporte.`);
    }

    return { disponivel, conta, pedir, conferir, avisarTroca };
}
