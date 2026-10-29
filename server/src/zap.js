// WhatsApp do Speed Teste Técnico, visto pelo processo principal.
//
// A conexão roda em zap-worker.mjs, num processo separado: se a biblioteca do
// WhatsApp travar ou cair, o site continua no ar e este módulo reinicia o
// processo (esperando cada vez mais entre as tentativas). O que fica aqui:
// o estado atual (para o painel), o QR code em SVG, e os ajustes guardados no
// banco: se está ligado, os destinos permitidos e o destino padrão.

import { fork } from 'node:child_process';
import path from 'node:path';
import QRCode from 'qrcode';

const JID_GRUPO = /^\d{5,30}(-\d{5,15})?@g\.us$/;
const JID_CONTATO = /^\d{10,15}@s\.whatsapp\.net$/;
export const jidValido = (jid) => typeof jid === 'string' && (JID_GRUPO.test(jid) || JID_CONTATO.test(jid));

export function createZap({ db, dataDir, log = console }) {
    const pasta = path.join(dataDir, 'whatsapp');
    const ler = (chave, padrao) => { const r = db.get('SELECT valor FROM ajustes WHERE chave = ?', chave); try { return r ? JSON.parse(r.valor) : padrao; } catch { return padrao; } };
    const gravar = (chave, valor) => db.run('INSERT INTO ajustes (chave, valor) VALUES (?, ?) ON CONFLICT (chave) DO UPDATE SET valor = excluded.valor', chave, JSON.stringify(valor));

    let proc = null;
    let atual = { estado: 'desligado' };
    let qrSvg = null;
    let espera = 5000;
    let reinicio = null;
    let seq = 0;
    const pendentes = new Map();

    function iniciar() {
        if (proc) return;
        clearTimeout(reinicio);
        atual = { estado: 'conectando' };
        proc = fork(new URL('./zap-worker.mjs', import.meta.url), [], {
            env: { ...process.env, ZAP_AUTH_DIR: pasta },
            execArgv: ['--max-old-space-size=256', '--disable-warning=ExperimentalWarning'],
            stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
        });
        proc.stderr.on('data', (d) => log.warn('[whatsapp]', String(d).trim().slice(0, 300)));
        proc.on('message', async (m) => {
            if (m.evt === 'estado') {
                atual = { estado: m.estado, conta: m.conta || (m.estado === 'conectado' ? atual.conta : null), motivo: m.motivo || null };
                if (m.estado === 'qr') {
                    qrSvg = 'data:image/svg+xml;base64,' + Buffer.from(await QRCode.toString(m.qr, { type: 'svg', margin: 1, color: { dark: '#081535', light: '#ffffff' } })).toString('base64');
                } else qrSvg = null;
                if (m.estado === 'conectado') { espera = 5000; log.info(`[whatsapp] conectado (${m.conta && m.conta.numero})`); }
                if (m.estado === 'desconectado') gravar('zap.ativo', false);
            } else if (m.evt === 'resposta' && pendentes.has(m.id)) {
                const p = pendentes.get(m.id);
                pendentes.delete(m.id);
                clearTimeout(p.t);
                if (m.ok) p.ok(m.dados); else p.falha(Object.assign(new Error(m.erro || 'falha no WhatsApp'), { status: 502 }));
            }
        });
        proc.on('exit', (codigo) => {
            proc = null;
            qrSvg = null;
            for (const [, p] of pendentes) { clearTimeout(p.t); p.falha(Object.assign(new Error('O WhatsApp reiniciou. Tente de novo.'), { status: 503 })); }
            pendentes.clear();
            if (ler('zap.ativo', false)) {
                atual = { estado: 'conectando', motivo: 'reconectando' };
                log.warn(`[whatsapp] processo saiu (${codigo}); nova tentativa em ${espera / 1000} s`);
                reinicio = setTimeout(iniciar, espera);
                reinicio.unref();
                espera = Math.min(espera * 2, 5 * 60_000);
            } else atual = { estado: 'desligado' };
        });
    }

    function chamar(cmd, dados = {}, prazoMs = 60_000) {
        if (!proc || atual.estado !== 'conectado') return Promise.reject(Object.assign(new Error('O WhatsApp não está conectado. Um administrador precisa conectar em Administração → WhatsApp.'), { status: 503 }));
        return new Promise((ok, falha) => {
            const id = ++seq;
            const t = setTimeout(() => { pendentes.delete(id); falha(Object.assign(new Error('O WhatsApp demorou demais para responder.'), { status: 504 })); }, prazoMs);
            pendentes.set(id, { ok, falha, t });
            proc.send({ ...dados, cmd, id });
        });
    }

    if (ler('zap.ativo', false)) iniciar();

    return {
        estado: () => ({ ...atual, qr: atual.estado === 'qr' ? qrSvg : null, ativo: !!ler('zap.ativo', false) }),
        destinos: () => ({ destinos: ler('zap.destinos', []), padrao: ler('zap.padrao', null) }),
        salvarDestinos(destinos, padrao) { gravar('zap.destinos', destinos); gravar('zap.padrao', padrao); },
        ocultar: () => ler('zap.ocultar', []),
        salvarOcultar(lista) { gravar('zap.ocultar', lista); },
        pronto: () => atual.estado === 'conectado' && ler('zap.destinos', []).length > 0,
        conectar() { gravar('zap.ativo', true); espera = 5000; iniciar(); },
        async desconectar() {
            gravar('zap.ativo', false);
            clearTimeout(reinicio);
            if (proc) {
                const p = proc;
                await new Promise((ok) => {
                    const t = setTimeout(() => { try { p.kill(); } catch { /* ok */ } ok(); }, 15000);
                    p.once('exit', () => { clearTimeout(t); ok(); });
                    try { p.send({ cmd: 'sair', id: ++seq }); } catch { clearTimeout(t); ok(); }
                });
            }
            atual = { estado: 'desligado' };
        },
        grupos: () => chamar('grupos'),
        contato: (numero) => chamar('contato', { numero }),
        enviar: (destino, texto, imagens = []) => chamar('enviar', { destino, texto, imagens }, 180_000),
        parar() { clearTimeout(reinicio); if (proc) { proc.removeAllListeners('exit'); try { proc.kill(); } catch { /* ok */ } } },
    };
}
