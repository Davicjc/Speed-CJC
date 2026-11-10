// Cartão "É o cliente deste teste?" do /tecnico, com o HubSoft.
//
// Só aparece quando a administração ligou a integração; desligada, a página
// fica como sempre (campos à mão). Ao abrir, o servidor procura quem está
// usando o IP desta conexão (a sessão do Radius aberta agora) e mostra nome,
// código, plano, rua/bairro e "conectado desde", com Sim e Não:
// - Sim: preenche o cliente e o plano sozinho.
// - Não: pede o código do cliente; quem não sabe vai para o preenchimento à mão.
// No CGNAT o IP passa de um cliente para outro, então a página confere o IP
// de tempos em tempos (e quando o aparelho troca de rede) e, se ele mudar,
// pergunta de novo.

import { api } from '../core/auth.js';
import { ICON } from '../core/icons.js';
import { $, esc, fmtNum } from '../core/util.js';
import { quemSouEu } from '../engine/motor.js';

const VIGIA_MS = 30_000;
let modo = 'off'; // off | procurando | pergunta | codigo | confirmado | manual
let achado = null; // cliente mostrado na pergunta
let confirmado = null; // { codigo, nome, plano, ip }
let ipAtual = null;
let aviso = null; // frase acima da pergunta/código
let ocupado = () => false;
let consultando = false;

const cartao = () => $('#hs-cartao');

/** Código do HubSoft que vai junto com o teste (só se o nome no campo ainda é o confirmado). */
export function codigoHubsoft() {
    const c = $('#at-cliente');
    return confirmado && c && c.value.trim() === confirmado.nome ? confirmado.codigo : null;
}

function preencher(cli) {
    const campo = (id, v) => { const el = $(id); if (el && v != null) { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); } };
    campo('#at-cliente', cli.nome);
    if (cli.plano && cli.plano.download) campo('#at-plano', String(Math.round(cli.plano.download)));
}

const planoTexto = (p) => (p && p.download ? `${fmtNum(p.download, p.download % 1 ? 1 : 0)} Mbps` : null);

function desenhar() {
    const el = cartao();
    if (!el) return;
    const intro = $('#intro');
    // com o HubSoft ligado, cliente e plano vêm dele; os campos só aparecem no "à mão"
    intro && intro.classList.toggle('hs-ligado', modo !== 'off' && modo !== 'manual');
    el.hidden = modo === 'off';
    el.dataset.modo = modo;
    if (modo === 'procurando') {
        el.innerHTML = `<p class="hs-procurando"><span class="hs-giro" aria-hidden="true"></span>Procurando o cliente desta conexão…</p>`;
    } else if (modo === 'pergunta') {
        const c = achado;
        const plano = planoTexto(c.plano);
        const lugar = [c.rua, c.bairro].filter(Boolean).join(' · ');
        el.innerHTML = `<p class="hs-titulo">${aviso ? `${esc(aviso)} ` : ''}É o cliente deste teste?</p>
            <strong class="hs-nome">${esc(c.nome)}</strong>
            <span class="hs-cod">Código ${esc(String(c.codigo))}</span>
            <ul class="hs-info">
                ${plano ? `<li>${ICON.gauge}<span>Plano <b>${esc(plano)}</b></span></li>` : ''}
                ${lugar ? `<li>${ICON.pin}<span>${esc(lugar)}</span></li>` : ''}
                ${c.conectadoDesde ? `<li>${ICON.clock}<span>Conectado desde ${esc(c.conectadoDesde)}</span></li>` : ''}
                ${c.habilitado === false && c.situacao ? `<li class="hs-alerta">${ICON.alert}<span>${esc(c.situacao)}</span></li>` : ''}
            </ul>
            <div class="hs-botoes">
                <button type="button" class="botao botao-primario" data-hs="sim">${ICON.check}Sim, é este</button>
                <button type="button" class="botao botao-secundario" data-hs="nao">Não</button>
            </div>`;
    } else if (modo === 'codigo') {
        el.innerHTML = `<form class="hs-form" novalidate>
            <p class="hs-titulo">${esc(aviso || 'Qual o código do cliente?')}</p>
            <label for="hs-codigo">Código do cliente no HubSoft</label>
            <div class="hs-busca">
                <input class="entrada" id="hs-codigo" inputmode="numeric" pattern="[0-9]*" maxlength="9" autocomplete="off" placeholder="Ex.: 4521">
                <button type="submit" class="botao botao-primario">${ICON.search}Buscar</button>
            </div>
            <p class="erro-campo" id="hs-erro" role="alert" hidden></p>
            <button type="button" class="hs-link" data-hs="manual">Não sei o código: preencher à mão</button>
        </form>`;
    } else if (modo === 'confirmado') {
        const plano = planoTexto(confirmado.plano);
        el.innerHTML = `<div class="hs-ok"><span class="hs-ok-icone" aria-hidden="true">${ICON.check}</span>
            <div><strong>${esc(confirmado.nome)}</strong><span>Código ${esc(String(confirmado.codigo))}${plano ? ` · ${esc(plano)}` : ''}</span></div>
            <button type="button" class="hs-link" data-hs="trocar">Trocar</button></div>`;
    } else if (modo === 'manual') {
        el.innerHTML = `<button type="button" class="hs-link hs-voltar" data-hs="buscar">${ICON.search}Buscar o cliente no HubSoft</button>`;
    }
}

function ir(novo, extra = {}) {
    modo = novo;
    if ('aviso' in extra) aviso = extra.aviso;
    desenhar();
    if (novo === 'codigo') setTimeout(() => { const i = $('#hs-codigo'); if (i && !matchMedia('(hover: none)').matches) i.focus(); }, 0);
}

const MOTIVO = { ipv6: 'Esta conexão está em IPv6 e não dá para achar o cliente por ela.', 'sem-sessao': 'Não achamos o cliente por esta conexão.' };

/** Pergunta ao servidor quem usa o IP desta conexão. `mudou`: o IP trocou desde a última vez. */
async function consultarConexao({ mudou = false } = {}) {
    if (consultando) return;
    consultando = true;
    if (modo !== 'confirmado' || mudou) ir('procurando');
    try {
        const r = await api('/api/tecnico/hubsoft/conexao');
        if (!r.ativo) { ir('off'); return; }
        ipAtual = r.ip || ipAtual;
        if (r.encontrado) {
            if (confirmado && confirmado.codigo === r.cliente.codigo) { confirmado.ip = ipAtual; ir('confirmado'); return; }
            achado = r.cliente;
            ir('pergunta', { aviso: mudou ? 'A conexão mudou.' : null });
        } else {
            ir('codigo', { aviso: (mudou ? 'A conexão mudou. ' : '') + (MOTIVO[r.motivo] || MOTIVO['sem-sessao']) + ' Qual o código do cliente?' });
        }
    } catch (e) {
        if (e.status === 403 || e.status === 401) { ir('off'); return; }
        ir(confirmado ? 'confirmado' : 'codigo', { aviso: `${e.message || 'O HubSoft não respondeu.'} Digite o código do cliente ou preencha à mão.` });
    } finally { consultando = false; }
}

async function buscarCodigo(form) {
    const input = form.querySelector('#hs-codigo');
    const erroEl = form.querySelector('#hs-erro');
    const codigo = input.value.replace(/\D/g, '');
    erroEl.hidden = true;
    if (!codigo) { erroEl.textContent = 'Digite o código (só números).'; erroEl.hidden = false; input.focus(); return; }
    const botao = form.querySelector('button[type="submit"]');
    botao.disabled = true;
    try {
        const r = await api('/api/tecnico/hubsoft/cliente?codigo=' + encodeURIComponent(codigo));
        if (!r.ativo) { ir('off'); return; }
        if (!r.encontrado) { erroEl.textContent = `Nenhum cliente com o código ${codigo}.`; erroEl.hidden = false; input.select(); return; }
        achado = r.cliente;
        ir('pergunta', { aviso: null });
    } catch (e) {
        erroEl.textContent = e.message || 'O HubSoft não respondeu.';
        erroEl.hidden = false;
    } finally { botao.disabled = false; }
}

/** Confere o IP de tempos em tempos e quando o aparelho troca de rede; se mudou, pergunta de novo. */
function vigiar() {
    const conferir = async () => {
        if (modo === 'off' || document.hidden || ocupado() || consultando) return;
        try {
            const w = await quemSouEu();
            if (w && w.ip && !ipAtual) { ipAtual = w.ip; return; }
            if (w && w.ip && w.ip !== ipAtual) {
                ipAtual = w.ip;
                if (modo === 'manual') return; // quem escolheu à mão não é interrompido
                consultarConexao({ mudou: true });
            }
        } catch { /* sem rede agora: confere na próxima */ }
    };
    setInterval(conferir, VIGIA_MS);
    window.addEventListener('online', () => setTimeout(conferir, 1500));
    document.addEventListener('visibilitychange', () => { if (!document.hidden) conferir(); });
    if (navigator.connection && navigator.connection.addEventListener) navigator.connection.addEventListener('change', () => setTimeout(conferir, 1500));
}

export function iniciarHubsoft({ ocupado: f } = {}) {
    const el = cartao();
    if (!el) return;
    if (f) ocupado = f;
    el.addEventListener('click', (e) => {
        const b = e.target.closest('[data-hs]');
        if (!b) return;
        const acao = b.dataset.hs;
        if (acao === 'sim' && achado) {
            confirmado = { codigo: achado.codigo, nome: achado.nome, plano: achado.plano, ip: ipAtual };
            preencher(achado);
            ir('confirmado');
        } else if (acao === 'nao') ir('codigo', { aviso: 'Qual o código do cliente?' });
        else if (acao === 'manual') { confirmado = null; ir('manual'); setTimeout(() => $('#at-cliente') && $('#at-cliente').focus(), 0); }
        else if (acao === 'trocar' || acao === 'buscar') { confirmado = null; consultarConexao(); }
    });
    el.addEventListener('submit', (e) => { e.preventDefault(); buscarCodigo(e.target); });
    consultarConexao().then(() => { if (modo !== 'off') vigiar(); });
}
