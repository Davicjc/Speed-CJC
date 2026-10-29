// Processo separado do WhatsApp (iniciado por zap.js). Fica isolado do site:
// se a biblioteca travar ou cair, o teste de velocidade continua no ar e este
// processo é reiniciado sozinho.
//
// Usa a conexão do WhatsApp Web (aparelho conectado por QR code). A sessão fica
// em data/whatsapp/ (permissão só do root): quem tem esses arquivos controla a
// conta, por isso nunca saem do servidor nem vão para o git.
//
// Conversa com o processo principal por IPC:
//   recebe  { cmd: 'grupos' | 'enviar' | 'sair', id, ... }
//   envia   { evt: 'estado', estado, qr?, conta? }  e  { evt: 'resposta', id, ok, dados?, erro? }

import fs from 'node:fs';
import makeWASocket, { DisconnectReason, fetchLatestBaileysVersion, useMultiFileAuthState } from '@whiskeysockets/baileys';
import pino from 'pino';

const PASTA = process.env.ZAP_AUTH_DIR;
if (!PASTA) process.exit(1);
fs.mkdirSync(PASTA, { recursive: true, mode: 0o700 });
try { fs.chmodSync(PASTA, 0o700); } catch { /* ok */ }

const avisar = (m) => { try { process.send && process.send(m); } catch { /* processo principal saiu */ } };
let sock = null;
let conectado = false;
let encerrando = false;

async function iniciar() {
    const { state, saveCreds } = await useMultiFileAuthState(PASTA);
    let version;
    try { version = (await fetchLatestBaileysVersion()).version; } catch { version = undefined; }
    sock = makeWASocket({
        auth: state, version, logger: pino({ level: 'silent' }), printQRInTerminal: false,
        browser: [process.env.SITE_NAME || 'Speed CJC', 'Chrome', '1.0'], markOnlineOnConnect: false, syncFullHistory: false,
        generateHighQualityLinkPreview: false,
    });
    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', (u) => {
        if (u.qr) avisar({ evt: 'estado', estado: 'qr', qr: u.qr });
        if (u.connection === 'connecting') avisar({ evt: 'estado', estado: 'conectando' });
        if (u.connection === 'open') {
            conectado = true;
            const id = (sock.user && sock.user.id) || '';
            avisar({ evt: 'estado', estado: 'conectado', conta: { numero: id.split(':')[0].split('@')[0], nome: (sock.user && sock.user.name) || null } });
        }
        if (u.connection === 'close') {
            conectado = false;
            const codigo = u.lastDisconnect && u.lastDisconnect.error && u.lastDisconnect.error.output && u.lastDisconnect.error.output.statusCode;
            if (codigo === DisconnectReason.loggedOut) {
                // desconectado pelo celular: apaga a sessão, volta a pedir QR
                try { fs.rmSync(PASTA, { recursive: true, force: true }); } catch { /* ok */ }
                avisar({ evt: 'estado', estado: 'desconectado', motivo: 'O aparelho foi desconectado pelo celular.' });
                process.exit(0);
            }
            if (!encerrando) {
                avisar({ evt: 'estado', estado: 'conectando' });
                setTimeout(() => iniciar().catch((e) => avisar({ evt: 'estado', estado: 'erro', motivo: e.message })), 3000);
            }
        }
    });
}

const exigirConexao = () => { if (!sock || !conectado) throw new Error('O WhatsApp não está conectado.'); };

const COMANDOS = {
    async grupos() {
        exigirConexao();
        const todos = await sock.groupFetchAllParticipating();
        return Object.values(todos).map((g) => ({ jid: g.id, nome: g.subject || 'Grupo sem nome', participantes: (g.participants || []).length }))
            .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    },
    async contato({ numero }) {
        exigirConexao();
        const [r] = await sock.onWhatsApp(numero);
        return r && r.exists ? { jid: r.jid } : null;
    },
    async enviar({ destino, texto, imagens = [] }) {
        exigirConexao();
        await sock.sendMessage(destino, { text: texto });
        for (const [i, img] of imagens.entries()) {
            await sock.sendMessage(destino, {
                image: Buffer.from(img.imagem, 'base64'),
                // miniatura pronta (feita no navegador): dispensa biblioteca de imagem aqui
                jpegThumbnail: img.miniatura || undefined,
                caption: img.legenda || `Foto ${i + 1} de ${imagens.length}`,
            });
        }
        return { mensagens: 1 + imagens.length };
    },
    async sair() {
        encerrando = true;
        try { if (sock) await sock.logout(); } catch { /* já desconectado */ }
        try { fs.rmSync(PASTA, { recursive: true, force: true }); } catch { /* ok */ }
        avisar({ evt: 'estado', estado: 'desconectado' });
        setTimeout(() => process.exit(0), 200);
        return {};
    },
};

process.on('message', async (m) => {
    if (!m || !COMANDOS[m.cmd]) return;
    try { avisar({ evt: 'resposta', id: m.id, ok: true, dados: await COMANDOS[m.cmd](m) }); }
    catch (e) { avisar({ evt: 'resposta', id: m.id, ok: false, erro: e && e.message ? e.message : String(e) }); }
});
process.on('disconnect', () => process.exit(0)); // o processo principal saiu
process.on('unhandledRejection', (e) => avisar({ evt: 'estado', estado: 'erro', motivo: String(e && e.message || e) }));

avisar({ evt: 'estado', estado: 'conectando' });
iniciar().catch((e) => { avisar({ evt: 'estado', estado: 'erro', motivo: e.message }); process.exit(1); });
