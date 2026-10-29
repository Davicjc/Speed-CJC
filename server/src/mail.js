import nodemailer from 'nodemailer';

// E-mail do site (opcional): confirmação de cadastro e link de nova senha.
// Usa qualquer SMTP (o mesmo do e-mail de contato da empresa, por exemplo). Sem
// SMTP configurado, o site funciona igual: as contas não precisam de
// confirmação e o link de nova senha é gerado pelo administrador no painel.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let MARCA = 'Speed CJC'; // nome do site (SITE_NAME)

function modelo({ titulo, texto, botao, link, rodape }) {
    return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(titulo)}</title></head>
<body style="margin:0;padding:0;background:#090C10;font-family:'IBM Plex Sans',Segoe UI,Arial,sans-serif;color:#E8EDF2">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#090C10;padding:32px 16px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#151A21;border:1px solid #222A34;border-radius:12px">
<tr><td style="padding:28px 28px 8px;font-size:20px;font-weight:700;letter-spacing:-0.3px;color:#E8EDF2">${esc(MARCA)} <span style="font-weight:400;color:#7B8592;font-size:14px">· teste de velocidade</span></td></tr>
<tr><td style="padding:8px 28px 0;font-size:22px;font-weight:700;color:#E8EDF2">${esc(titulo)}</td></tr>
<tr><td style="padding:12px 28px 0;font-size:15px;line-height:1.6;color:#A9B3BF">${texto}</td></tr>
<tr><td style="padding:24px 28px"><a href="${esc(link)}" style="display:inline-block;background:#46E08C;color:#06140C;text-decoration:none;font-weight:700;font-size:15px;padding:13px 22px;border-radius:999px">${esc(botao)}</a></td></tr>
<tr><td style="padding:0 28px 24px;font-size:12px;line-height:1.6;color:#7B8592">Se o botão não abrir, copie este endereço no navegador:<br><span style="color:#46E08C;word-break:break-all">${esc(link)}</span></td></tr>
<tr><td style="padding:16px 28px 24px;border-top:1px solid #222A34;font-size:12px;line-height:1.6;color:#7B8592">${rodape}</td></tr>
</table></td></tr></table></body></html>`;
}

export function createMailer({ host, port, secure, user, pass, from }, { log = console, marca } = {}) {
    if (marca) MARCA = marca;
    if (!host) {
        return { enabled: false, async verificar() { return 'desligado'; }, async enviar() { throw new Error('e-mail não configurado'); } };
    }
    const transporte = nodemailer.createTransport({
        host, port, secure,
        auth: user ? { user, pass } : undefined,
        connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000,
    });
    const remetente = from || (user && user.includes('@') ? `${MARCA} <${user}>` : MARCA);
    let estado = 'não verificado';

    async function enviar({ para, assunto, html, texto }) {
        await transporte.sendMail({ from: remetente, to: para, subject: assunto, html, text: texto });
        log.info(`[e-mail] "${assunto}" enviado para ${para}`);
    }

    return {
        enabled: true,
        get estado() { return estado; },
        async verificar() {
            try { await transporte.verify(); estado = 'ok'; } catch (e) { estado = 'erro: ' + e.message; log.warn('[e-mail] SMTP não respondeu:', e.message); }
            return estado;
        },
        enviar,
        confirmacao(u, link) {
            return enviar({
                para: u.email,
                assunto: `Confirme seu e-mail no ${MARCA}`,
                texto: `Olá, ${u.name}.\n\nPara confirmar o seu e-mail, abra: ${link}\n\nO link vale por 3 dias. Se você não criou esta conta, ignore este e-mail.\n\n${MARCA}`,
                html: modelo({
                    titulo: 'Confirme seu e-mail',
                    texto: `Olá, ${esc(u.name)}. Falta só confirmar que este e-mail é seu para completar a conta no ${esc(MARCA)}.`,
                    botao: 'Confirmar meu e-mail', link,
                    rodape: 'O link vale por 3 dias. Se você não criou esta conta, ignore este e-mail.',
                }),
            });
        },
        novaSenha(u, link) {
            return enviar({
                para: u.email,
                assunto: `Crie uma nova senha no ${MARCA}`,
                texto: `Olá, ${u.name}.\n\nPara criar uma nova senha, abra: ${link}\n\nO link vale por 1 hora e só funciona uma vez. Se você não pediu, ignore este e-mail: a senha atual continua valendo.\n\n${MARCA}`,
                html: modelo({
                    titulo: 'Crie uma nova senha',
                    texto: `Olá, ${esc(u.name)}. Recebemos um pedido para criar uma nova senha na sua conta do ${esc(MARCA)}.`,
                    botao: 'Criar nova senha', link,
                    rodape: 'O link vale por 1 hora e só funciona uma vez. Se você não pediu, ignore este e-mail: a senha atual continua valendo.',
                }),
            });
        },
    };
}
