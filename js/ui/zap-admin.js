// Administração → WhatsApp: conectar por QR code, desconectar, escolher os
// grupos e contatos para onde os técnicos podem enviar os testes.

import { api } from '../core/auth.js';
import { ICON } from '../core/icons.js';
import { $, esc, toast } from '../core/util.js';

const ROTULO = {
    desligado: ['', 'Desligado'],
    desconectado: ['', 'Desconectado'],
    conectando: ['azul', 'Conectando…'],
    qr: ['atencao', 'Esperando ler o QR code'],
    conectado: ['ok', 'Conectado'],
    erro: ['ruim', 'Erro'],
};

let estado = { estado: 'desligado' };
let destinos = [];
let padrao = null;
let grupos = null;
let timer = null;
let alterado = false;

export function iniciarZapAdmin() {
    const el = $('#zap-conteudo');
    el.addEventListener('click', aoClicar);
    el.addEventListener('change', (e) => {
        if (e.target.name === 'zap-padrao') { padrao = e.target.value; alterado = true; desenhar(); }
    });
    atualizar();
}

async function atualizar() {
    clearTimeout(timer);
    try {
        const r = await api('/api/admin/zap');
        estado = r;
        if (!alterado) { destinos = r.destinos || []; padrao = r.padrao; }
        desenhar();
    } catch (e) {
        $('#zap-conteudo').innerHTML = `<div class="aviso ruim">${ICON.alert}<div>${esc(e.message)}</div></div>`;
    }
    // enquanto conecta ou mostra o QR, confere a cada 3 s; parado, a cada 20 s (só com a aba aberta)
    const rapido = ['conectando', 'qr'].includes(estado.estado);
    timer = setTimeout(() => { if (!$('#v-zap').hidden && !document.hidden) atualizar(); else timer = setTimeout(atualizar, 5000); }, rapido ? 3000 : 20000);
}

function desenhar() {
    const [nivel, rotulo] = ROTULO[estado.estado] || ['', estado.estado];
    const conectado = estado.estado === 'conectado';
    const ligado = ['conectando', 'qr', 'conectado'].includes(estado.estado);
    const conta = estado.conta ? `+${esc(estado.conta.numero)}${estado.conta.nome ? ` · ${esc(estado.conta.nome)}` : ''}` : '';
    $('#zap-conteudo').innerHTML = `
    <div class="aviso">${ICON.info}<div>Use um <strong>número só para isso</strong>, não o principal da empresa. A conexão é a mesma do WhatsApp Web: o WhatsApp pode bloquear números que parecem automação. Os técnicos só enviam para os destinos que você liberar abaixo.</div></div>
    <div class="grade-conta" style="margin-top:16px">
        <div class="painel zap-estado">
            <div class="painel-cabeca"><div><h2>Conexão</h2></div><span class="selo ${nivel}">${rotulo}</span></div>
            ${conta ? `<p class="zap-conta">${ICON.whatsapp}<span>${conta}</span></p>` : ''}
            ${estado.motivo && estado.motivo !== 'reconectando' ? `<p class="suave" style="font-size:var(--t-sm)">${esc(estado.motivo)}</p>` : ''}
            ${estado.estado === 'qr' && estado.qr ? `<div class="zap-qr"><img src="${estado.qr}" alt="QR code para conectar o WhatsApp" width="240" height="240">
                <ol><li>Abra o WhatsApp no celular do número da empresa.</li><li>Toque em <strong>Configurações → Aparelhos conectados → Conectar um aparelho</strong>.</li><li>Aponte a câmera para este código. Ele se renova sozinho.</li></ol></div>` : ''}
            ${estado.estado === 'conectando' ? '<p class="suave" style="font-size:var(--t-sm)">Preparando a conexão. O QR code aparece em alguns segundos.</p>' : ''}
            <div class="det-acoes" style="margin-top:12px">
                ${ligado ? `<button type="button" class="botao botao-perigo botao-pequeno" data-zap="desconectar">${ICON.logout}Desconectar</button>`
                    : `<button type="button" class="botao botao-primario botao-pequeno" data-zap="conectar">${ICON.whatsapp}Conectar WhatsApp</button>`}
                ${conectado && padrao ? `<button type="button" class="botao botao-secundario botao-pequeno" data-zap="teste">Enviar mensagem de teste</button>` : ''}
            </div>
        </div>
        <div class="painel">
            <div class="painel-cabeca"><div><h2>Destinos permitidos</h2><p>Para onde os técnicos podem enviar. O marcado é o padrão.</p></div></div>
            ${destinos.length ? `<ul class="zap-destinos">${destinos.map((d) => `<li>
                <label><input type="radio" name="zap-padrao" value="${esc(d.jid)}" ${d.jid === padrao ? 'checked' : ''}>
                <span>${d.tipo === 'grupo' ? ICON.users : ICON.user}<strong>${esc(d.nome)}</strong><small>${d.tipo === 'grupo' ? 'grupo' : 'contato'}</small></span></label>
                <button type="button" class="botao botao-fantasma botao-icone" data-zap="remover" data-jid="${esc(d.jid)}" aria-label="Remover ${esc(d.nome)}">${ICON.trash}</button></li>`).join('')}</ul>`
                : '<p class="suave" style="font-size:var(--t-sm)">Nenhum destino ainda. Conecte o WhatsApp e adicione grupos ou contatos.</p>'}
            ${alterado ? `<div class="det-acoes" style="margin-top:12px"><button type="button" class="botao botao-primario botao-pequeno" data-zap="salvar">Salvar destinos</button>
                <button type="button" class="botao botao-fantasma botao-pequeno" data-zap="descartar">Descartar</button></div>` : ''}
        </div>
    </div>
    ${conectado ? `<div class="painel" style="margin-top:16px">
        <div class="painel-cabeca"><div><h2>Adicionar destino</h2><p>Grupos de que este WhatsApp participa, ou um contato pelo número.</p></div></div>
        <div class="zap-adicionar">
            <form class="linha-flex" data-form="contato">
                <input class="entrada" id="zap-numero" inputmode="tel" placeholder="(34) 99999-9999" aria-label="Número do contato" style="max-width:220px">
                <input class="entrada" id="zap-nome" placeholder="Nome (ex.: Supervisor)" aria-label="Nome do contato" style="max-width:220px" maxlength="80">
                <button type="submit" class="botao botao-secundario botao-pequeno">Adicionar contato</button>
            </form>
            <div style="margin-top:14px">${grupos === null ? `<button type="button" class="botao botao-secundario botao-pequeno" data-zap="grupos">${ICON.users}Ver os grupos</button>`
                : grupos.length ? `<ul class="zap-grupos">${grupos.map((g) => `<li><span><strong>${esc(g.nome)}</strong><small>${g.participantes} participantes</small></span>
                    ${destinos.some((d) => d.jid === g.jid) ? '<span class="selo ok">Adicionado</span>' : `<button type="button" class="botao botao-secundario botao-pequeno" data-zap="add-grupo" data-jid="${esc(g.jid)}" data-nome="${esc(g.nome)}">Adicionar</button>`}</li>`).join('')}</ul>`
                : '<p class="suave" style="font-size:var(--t-sm)">Este WhatsApp não participa de nenhum grupo.</p>'}</div>
        </div></div>` : ''}`;
    const form = document.querySelector('[data-form="contato"]');
    if (form) form.addEventListener('submit', adicionarContato);
}

async function adicionarContato(e) {
    e.preventDefault();
    const numero = $('#zap-numero').value;
    const nome = $('#zap-nome').value.trim();
    try {
        const r = await api('/api/admin/zap/contato', { method: 'POST', body: { numero } });
        if (!destinos.some((d) => d.jid === r.jid)) destinos.push({ jid: r.jid, nome: nome || numero, tipo: 'contato' });
        if (!padrao) padrao = r.jid;
        alterado = true;
        desenhar();
    } catch (err) { toast(err.message, 'ruim'); }
}

async function aoClicar(e) {
    const b = e.target.closest('[data-zap]');
    if (!b) return;
    const acao = b.dataset.zap;
    b.disabled = true;
    try {
        if (acao === 'conectar') { estado = await api('/api/admin/zap/conectar', { method: 'POST' }); grupos = null; }
        if (acao === 'desconectar') { estado = await api('/api/admin/zap/desconectar', { method: 'POST' }); grupos = null; toast('WhatsApp desconectado.'); }
        if (acao === 'grupos') grupos = (await api('/api/admin/zap/grupos')).grupos;
        if (acao === 'add-grupo') { destinos.push({ jid: b.dataset.jid, nome: b.dataset.nome, tipo: 'grupo' }); if (!padrao) padrao = b.dataset.jid; alterado = true; }
        if (acao === 'remover') { destinos = destinos.filter((d) => d.jid !== b.dataset.jid); if (padrao === b.dataset.jid) padrao = destinos[0] ? destinos[0].jid : null; alterado = true; }
        if (acao === 'descartar') { alterado = false; return atualizar(); }
        if (acao === 'salvar') {
            const r = await api('/api/admin/zap/destinos', { method: 'POST', body: { destinos, padrao } });
            destinos = r.destinos; padrao = r.padrao; alterado = false;
            toast('Destinos salvos.');
        }
        if (acao === 'teste') { await api('/api/admin/zap/teste', { method: 'POST' }); toast('Mensagem de teste enviada.'); }
    } catch (err) { toast(err.message, 'ruim'); }
    finally { b.disabled = false; }
    if (['conectar', 'desconectar'].includes(acao)) atualizar(); else desenhar();
}
