// Administração → HubSoft: ligar a busca do cliente pelo IP no teste do técnico.
// Só o dono configura (o servidor confere e pede a senha de novo). As
// credenciais nunca voltam para esta tela: depois de salvas, aparecem só o
// endereço e o usuário mascarado.

import { api } from '../core/auth.js';
import { ICON } from '../core/icons.js';
import { $, esc, fmtDataHora, toast } from '../core/util.js';

let estado = null;
let ligado = false;

export function iniciarHubsoftAdmin() {
    const el = $('#hubsoft-conteudo');
    if (!ligado) {
        ligado = true;
        el.addEventListener('click', aoClicar);
        el.addEventListener('submit', aoSalvar);
    }
    return atualizar();
}

async function atualizar() {
    try { estado = await api('/api/admin/hubsoft'); desenhar(); } catch (e) {
        $('#hubsoft-conteudo').innerHTML = `<div class="aviso ruim">${ICON.alert}<div>${esc(e.message)}</div></div>`;
    }
}

const formulario = ({ trocar = false } = {}) => `<form class="painel hs-admin-form" novalidate>
    <div class="painel-cabeca"><div><h2>${trocar ? 'Trocar as credenciais' : 'Conectar ao HubSoft'}</h2>
        <p>${trocar ? 'Deixe em branco o que não mudou (Client Secret, usuário e senha continuam os atuais).' : 'Os dados ficam no painel do HubSoft, em Configurações → Integrações (API).'}</p></div></div>
    <div class="hs-admin-campos">
        <div class="campo total"><label for="hs-url">Endereço da API</label>
            <input class="entrada" id="hs-url" type="url" inputmode="url" autocomplete="off" placeholder="https://api.suaempresa.hubsoft.com.br" value="${esc((estado && estado.url) || '')}"></div>
        <div class="campo"><label for="hs-id">Client ID</label>
            <input class="entrada" id="hs-id" autocomplete="off" value="${esc((estado && estado.clientId) || '')}"></div>
        <div class="campo"><label for="hs-secret">Client Secret</label>
            <input class="entrada" id="hs-secret" type="password" autocomplete="new-password" placeholder="${trocar ? 'manter o atual' : ''}"></div>
        <div class="campo"><label for="hs-usuario">Usuário do HubSoft</label>
            <input class="entrada" id="hs-usuario" autocomplete="off" placeholder="${trocar ? 'manter o atual' : 'ex.: api@suaempresa.com.br'}"></div>
        <div class="campo"><label for="hs-senha">Senha do usuário</label>
            <input class="entrada" id="hs-senha" type="password" autocomplete="new-password" placeholder="${trocar ? 'manter a atual' : ''}"></div>
    </div>
    <p class="erro-campo" role="alert" hidden></p>
    <div class="hs-admin-acoes">
        ${trocar ? '<button type="button" class="botao botao-fantasma" data-hs="cancelar">Cancelar</button>' : ''}
        <button type="submit" class="botao botao-primario">${ICON.check}${trocar ? 'Salvar e testar' : 'Conectar e ligar'}</button>
    </div>
</form>`;

const seguranca = `<div class="painel">
    <div class="painel-cabeca"><div><h2>Segurança</h2></div></div>
    <ul class="dicas" style="margin:0">
        <li><strong>Só consulta.</strong> O sistema só lê do HubSoft (nome, código, plano, rua, bairro e "conectado desde"); não existe nenhuma função que altere o cadastro.</li>
        <li>Prefira criar no HubSoft um usuário <strong>só de consulta</strong> para esta integração.</li>
        <li>As credenciais ficam criptografadas no servidor e nunca aparecem de novo nesta tela.</li>
        <li>Só o dono da conta liga, troca ou apaga; qualquer administrador pode desligar na hora.</li>
        <li>Cada cliente consultado pelo técnico fica na <a href="#auditoria" data-ir-aba="auditoria">Auditoria</a>.</li>
    </ul>
</div>`;

function desenhar() {
    const el = $('#hubsoft-conteudo');
    const e = estado || {};
    if (!e.configurado) {
        el.innerHTML = `${e.ilegivel ? `<div class="aviso atencao" style="margin-bottom:16px">${ICON.alert}<div>As credenciais guardadas não puderam ser lidas (o banco veio de outro servidor sem o arquivo <code>data/hubsoft.key</code>). Configure de novo.</div></div>` : ''}
            <div class="grade-hs">${formulario()}${seguranca}</div>`;
        return;
    }
    const selo = e.ativo ? '<span class="selo ok">Ligado</span>' : '<span class="selo">Desligado</span>';
    el.innerHTML = `<div class="grade-hs">
        <div class="pilha">
            <div class="painel hs-admin-estado">
                <div class="painel-cabeca"><div><h2>HubSoft ${selo}</h2>
                    <p>${e.ativo ? 'O teste do técnico já procura o cliente pelo IP da conexão.' : 'Desligado: o teste do técnico volta a ser preenchido à mão.'}</p></div></div>
                <dl class="dados">
                    <dt>Endereço</dt><dd class="mono">${esc(e.url || '–')}</dd>
                    <dt>Usuário</dt><dd>${esc(e.usuario || '–')}</dd>
                    <dt>Client ID</dt><dd class="mono">${esc(e.clientId || '–')}</dd>
                    <dt>Configurado em</dt><dd>${e.atualizadoEm ? esc(fmtDataHora(e.atualizadoEm)) : '–'}</dd>
                    ${e.ultimoErro ? `<dt>Último erro</dt><dd class="hs-admin-erro">${esc(e.ultimoErro.msg)} <span class="suave">(${esc(fmtDataHora(e.ultimoErro.em))})</span></dd>` : ''}
                </dl>
                <div class="hs-admin-acoes">
                    ${e.ativo
                        ? '<button type="button" class="botao botao-secundario" data-hs="desligar">Desligar</button>'
                        : `<button type="button" class="botao botao-primario" data-hs="ligar">${ICON.check}Ligar</button>`}
                    <button type="button" class="botao botao-secundario" data-hs="testar">${ICON.refresh}Testar conexão</button>
                    <button type="button" class="botao botao-secundario" data-hs="trocar">${ICON.key}Trocar credenciais</button>
                    <button type="button" class="botao botao-perigo" data-hs="apagar">${ICON.trash}Apagar</button>
                </div>
            </div>
            <div id="hs-trocar"></div>
        </div>
        ${seguranca}
    </div>`;
}

async function aoClicar(ev) {
    const ir = ev.target.closest('[data-ir-aba]');
    if (ir) { ev.preventDefault(); location.hash = ir.dataset.irAba; return; }
    const b = ev.target.closest('[data-hs]');
    if (!b) return;
    const acao = b.dataset.hs;
    if (acao === 'trocar') { $('#hs-trocar').innerHTML = formulario({ trocar: true }); $('#hs-url').focus(); return; }
    if (acao === 'cancelar') { $('#hs-trocar').innerHTML = ''; return; }
    if (acao === 'apagar' && !confirm('Apagar a integração com o HubSoft? As credenciais saem do servidor e o teste do técnico volta a ser preenchido à mão.')) return;
    b.disabled = true;
    try {
        if (acao === 'testar') { estado = await api('/api/admin/hubsoft/testar', { method: 'POST', body: {} }); toast('O HubSoft aceitou as credenciais.', 'ok'); }
        if (acao === 'ligar' || acao === 'desligar') { estado = await api('/api/admin/hubsoft/ligar', { method: 'POST', body: { ativo: acao === 'ligar' } }); toast(acao === 'ligar' ? 'HubSoft ligado.' : 'HubSoft desligado.', 'ok'); }
        if (acao === 'apagar') { estado = await api('/api/admin/hubsoft', { method: 'DELETE' }); toast('Integração apagada.', 'ok'); }
        desenhar();
    } catch (e) {
        toast(e.message, 'ruim');
        if (acao === 'testar') atualizar();
    } finally { b.disabled = false; }
}

async function aoSalvar(ev) {
    ev.preventDefault();
    const f = ev.target;
    const erro = f.querySelector('.erro-campo');
    const botao = f.querySelector('button[type="submit"]');
    erro.hidden = true;
    botao.disabled = true;
    const texto = botao.innerHTML;
    botao.textContent = 'Conectando ao HubSoft…';
    try {
        estado = await api('/api/admin/hubsoft', { method: 'POST', body: {
            url: f.querySelector('#hs-url').value.trim(),
            clientId: f.querySelector('#hs-id').value.trim(),
            clientSecret: f.querySelector('#hs-secret').value,
            usuario: f.querySelector('#hs-usuario').value.trim(),
            senha: f.querySelector('#hs-senha').value,
        } });
        toast('HubSoft conectado e ligado. O teste do técnico já procura o cliente pelo IP.', 'ok');
        desenhar();
    } catch (e) {
        erro.textContent = e.message;
        erro.hidden = false;
        botao.disabled = false;
        botao.innerHTML = texto;
    }
}
