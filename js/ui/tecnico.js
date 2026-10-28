// Partes só do Speed Teste Técnico (/tecnico): dados do atendimento, painel de
// medidas detalhadas e a lista de testes de todos os clientes.

import { api } from '../core/auth.js';
import { NOMES_CONEXAO } from '../core/device.js';
import { $, $$, esc, fmtDataHora, fmtMbps, fmtMs, fmtNum, fmtPct, html, setHtml } from '../core/util.js';
import { abrirDetalhe } from './detalhe.js';

// ---------- atendimento ----------
export function atendimento() {
    const plano = Number($('#at-plano').value);
    return {
        cliente: $('#at-cliente').value.trim() || null,
        plano: Number.isFinite(plano) && plano > 0 ? Math.round(plano) : null,
        obs: $('#at-obs').value.trim() || null,
    };
}

// ---------- medidas detalhadas ----------
const v = (x, unid = '') => (x == null || x === '' || x === '–' ? '–' : `${x}${unid}`);

export function medidasDetalhadas(el, t, { res = null, erroAoGuardar = null } = {}) {
    const ll = t.loadedLatency || {};
    const dev = t.device || {};
    const con = t.connection || {};
    const at = t.atendimento || {};
    const conferencia = res
        ? (res.verified ? 'Conferido: o servidor confirmou as medidas' : 'Não conferido: o servidor não confirmou todas as medidas')
        : `Não guardado${erroAoGuardar ? ` (${erroAoGuardar})` : ''}`;
    setHtml(el, html`<div class="painel-cabeca"><div><h3>Medidas detalhadas</h3><p>Tudo o que o teste mediu, sem arredondar a história.</p></div></div>
        <div class="medidas-tec">
            <dl class="dados">
                <dt>Ping (mediana)</dt><dd>${v(fmtMs(t.ping), ' ms')}</dd>
                <dt>Ping mínimo / máximo</dt><dd>${t.pingMin != null ? `${fmtMs(t.pingMin)} / ${fmtMs(t.pingMax)} ms` : '–'}</dd>
                <dt>Jitter (RFC 3550)</dt><dd>${v(fmtMs(t.jitter), ' ms')}</dd>
                <dt>Perda de pacotes (UDP)</dt><dd>${t.loss != null ? `${fmtPct(t.loss)}% de 200 pacotes` : 'não medida'}</dd>
                <dt>Ping durante o download</dt><dd>${ll.download != null ? `${fmtMs(ll.download)} ms` : '–'}</dd>
                <dt>Ping durante o upload</dt><dd>${ll.upload != null ? `${fmtMs(ll.upload)} ms` : '–'}</dd>
                <dt>Bufferbloat (aumento)</dt><dd>${t.bufferbloat != null ? `+${fmtMs(t.bufferbloat)} ms` : '–'}</dd>
                <dt>Download</dt><dd>${v(fmtMbps(t.download), ' Mbps')}${t.dlWindowMs ? ` (janela de ${fmtNum(t.dlWindowMs / 1000, 1)} s, 6 conexões)` : ''}</dd>
                <dt>Upload (medido no servidor)</dt><dd>${v(fmtMbps(t.upload), ' Mbps')}</dd>
            </dl>
            <dl class="dados">
                <dt>IP</dt><dd class="mono">${t.ip || '–'}${t.ipFamily ? ` (${t.ipFamily})` : ''}</dd>
                <dt>Operadora</dt><dd>${t.isp || 'não identificada'}${t.asn ? ` · ${t.asn}` : ''}</dd>
                <dt>Local</dt><dd>${(t.place && t.place.label) || '–'}${t.place && t.place.source === 'aparelho' ? ' (GPS do aparelho)' : t.place ? ' (pelo IP)' : ''}</dd>
                <dt>Conexão do aparelho</dt><dd>${con.type ? NOMES_CONEXAO[con.type] || con.type : 'o navegador não informa'}${con.downlink != null ? ` · estimativa ${fmtNum(con.downlink, 1)} Mbps` : ''}${con.rtt != null ? ` · ${con.rtt} ms` : ''}</dd>
                <dt>Aparelho</dt><dd>${[dev.model ? `${dev.type} ${dev.model}` : dev.type, [dev.os, dev.osVersion].filter(Boolean).join(' '), [dev.browser, dev.browserVersion].filter(Boolean).join(' ')].filter(Boolean).join(', ') || '–'}</dd>
                <dt>Processador / memória</dt><dd>${dev.cores ? `${dev.cores} núcleos` : '–'} · ${dev.ram ? `${dev.ram} GB ou mais` : '–'}${dev.screen ? ` · tela ${dev.screen}` : ''}</dd>
                <dt>Servidor</dt><dd>${t.server ? `${t.server.name}, ${t.server.location}` : '–'}</dd>
                <dt>Protocolo</dt><dd class="mono">${(res && res.protocol) || '–'}</dd>
                <dt>Conferência</dt><dd>${conferencia}</dd>
                ${at.cliente || at.plano || at.obs ? html`<dt>Atendimento</dt><dd>${[at.cliente, at.plano ? `plano de ${at.plano} Mbps` : null, at.obs].filter(Boolean).join(' · ')}</dd>` : ''}
            </dl>
        </div>`);
    el.hidden = false;
}

// ---------- lista de testes de todos os clientes ----------
let cfgLista = {};
let filtros = { q: '', origem: '' };
let proximo = null;
let carregando = false;

const quemFez = (t) => {
    const at = t.atendimento && t.atendimento.cliente ? `<span class="fraco">Cliente: ${esc(t.atendimento.cliente)}</span>` : '';
    const pessoa = t.user ? `${esc(t.user.name || t.user.email)}<br><span class="fraco">${esc(t.user.email || '')}</span>` : '<span class="fraco">sem conta</span>';
    return `${pessoa}${at ? '<br>' + at : ''}`;
};

function linhaHtml(t) {
    return `<tr class="clicavel" data-id="${esc(t.id)}" tabindex="0">
        <td>${esc(fmtDataHora(t.createdAt))}</td>
        <td class="mono">${esc(t.protocol)}</td>
        <td><span class="selo ${t.origem === 'tecnico' ? 'origem-tecnico' : 'origem-cliente'}">${t.origem === 'tecnico' ? 'Técnico' : 'Cliente'}</span>${t.mode === 'completo' ? '<br><span class="fraco">completo</span>' : ''}</td>
        <td>${quemFez(t)}</td>
        <td class="n">${fmtMbps(t.download)}</td>
        <td class="n">${fmtMbps(t.upload)}</td>
        <td class="n">${fmtMs(t.ping)}</td>
        <td class="n">${t.loss != null ? fmtPct(t.loss) + '%' : '–'}</td>
        <td>${esc(t.isp || '–')}</td>
        <td>${esc((t.place && t.place.label) || '–')}</td>
    </tr>`;
}

async function carregar({ mais = false } = {}) {
    if (carregando) return;
    carregando = true;
    const tb = $('#linhas-tec');
    const busca = new URLSearchParams({ limit: '30' });
    if (filtros.q) busca.set('q', filtros.q);
    if (filtros.origem) busca.set('origem', filtros.origem);
    if (mais && proximo) busca.set('after', proximo);
    if (!mais) tb.innerHTML = '<tr><td colspan="10"><div class="esqueleto" style="height:60px"></div></td></tr>';
    try {
        const r = await api('/api/tecnico/tests?' + busca);
        proximo = r.next;
        const linhas = r.items.map(linhaHtml).join('');
        if (mais) tb.insertAdjacentHTML('beforeend', linhas);
        else tb.innerHTML = linhas || `<tr><td colspan="10"><p class="suave" style="padding:12px">${filtros.q ? 'Nenhum teste encontrado para essa busca.' : 'Nenhum teste ainda.'}</p></td></tr>`;
        $('#mais-tec').hidden = !proximo;
    } catch (e) {
        tb.innerHTML = `<tr><td colspan="10"><div class="aviso ruim"><div>${esc(e.message)}</div></div></td></tr>`;
    } finally { carregando = false; }
}

export function recarregarLista() { carregar(); }

export function iniciarListaTecnica({ cfg }) {
    cfgLista = cfg || {};
    $('#testes-tec').hidden = false;
    let espera;
    $('#busca-tec').addEventListener('input', (e) => {
        clearTimeout(espera);
        espera = setTimeout(() => { filtros.q = e.target.value.trim(); carregar(); }, 350);
    });
    $('#filtros-tec').addEventListener('submit', (e) => { e.preventDefault(); filtros.q = $('#busca-tec').value.trim(); carregar(); });
    $$('#origem-tec button').forEach((b) => b.addEventListener('click', () => {
        $$('#origem-tec button').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
        filtros.origem = b.dataset.origem;
        carregar();
    }));
    $('#mais-tec').addEventListener('click', () => carregar({ mais: true }));
    const abrir = (id) => abrirDetalhe({ carregar: () => api('/api/tecnico/tests/' + id), cfg: cfgLista, admin: true, tom: 'tecnico' });
    $('#linhas-tec').addEventListener('click', (e) => { const tr = e.target.closest('tr[data-id]'); if (tr) abrir(tr.dataset.id); });
    $('#linhas-tec').addEventListener('keydown', (e) => { if (e.key === 'Enter') { const tr = e.target.closest('tr[data-id]'); if (tr) abrir(tr.dataset.id); } });
    carregar();
}


// atendimento: no celular começa fechado, mostrando o resumo do que já foi preenchido
const dobra = document.getElementById('atendimento');
if (dobra) {
    if (window.matchMedia('(max-width: 760px)').matches) dobra.open = false;
    const resumir = () => {
        const a = atendimento();
        const partes = [a.cliente, a.plano ? `${a.plano} Mbps` : null, a.obs ? 'com observação' : null].filter(Boolean);
        const el = $('#at-resumo');
        el.textContent = partes.length ? partes.join(' · ') : 'cliente, plano e observação';
        el.classList.toggle('preenchido', partes.length > 0);
    };
    dobra.addEventListener('input', resumir);
    resumir();
}
