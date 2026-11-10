// Linha de teste das listas (Administração e /tecnico). Uma linha só para as
// duas, para ficarem iguais: no computador, colunas de largura fixa com o
// texto longo cortado em "…"; no celular (CSS em base.css, .tabela.lista),
// cada linha vira um cartão.
// O destaque é quem foi atendido (cliente e código do HubSoft); quem fez o
// teste vem embaixo.

import { esc, fmtDiaCurto, fmtHora, fmtMbps, fmtMs, fmtPct } from '../core/util.js';

export const CABECALHO_TESTES = `<tr>
    <th class="c-quando">Quando</th><th class="c-quem">Cliente / quem fez</th><th class="c-origem">Origem</th>
    <th class="n">Down <small>Mbps</small></th><th class="n">Up <small>Mbps</small></th><th class="n">Ping <small>ms</small></th><th class="n">Perda</th>
    <th class="c-rede">Operadora e local</th></tr>`;

export function linhaTeste(t, { novo = false } = {}) {
    const at = t.atendimento || {};
    const pessoa = t.user ? (t.user.name || t.user.email) : null;
    const titulo = at.cliente || pessoa || 'Sem conta';
    const sub = at.cliente
        ? [at.codigo != null ? `cód. ${at.codigo}` : null, pessoa ? `por ${pessoa}` : 'sem conta'].filter(Boolean).join(' · ')
        : (t.user ? t.user.email || '' : 'teste sem login');
    const origem = t.origem === 'tecnico' ? '<span class="selo origem-tecnico">Técnico</span>' : '<span class="selo origem-cliente">Cliente</span>';
    const rede = [t.isp, t.place && t.place.label].filter(Boolean).join(' · ') || '–';
    return `<tr class="clicavel${novo ? ' novo' : ''}" data-id="${esc(t.id)}" tabindex="0">
        <td class="c-quando"><strong>${esc(fmtDiaCurto(t.createdAt))}, ${esc(fmtHora(t.createdAt))}</strong><span class="fraco mono">${esc(t.protocol || '')}</span></td>
        <td class="c-quem"><strong class="corta" title="${esc(titulo)}">${esc(titulo)}</strong><span class="fraco corta" title="${esc(sub)}">${esc(sub)}</span></td>
        <td class="c-origem">${origem}<span class="fraco">${t.mode === 'completo' ? 'completo' : 'rápido'}</span>${t.verified === false ? '<b class="nao-conferido">não conferido</b>' : ''}</td>
        <td class="n" data-r="Down (Mbps)">${esc(fmtMbps(t.download))}</td>
        <td class="n" data-r="Up (Mbps)">${esc(fmtMbps(t.upload))}</td>
        <td class="n" data-r="Ping (ms)">${esc(fmtMs(t.ping))}</td>
        <td class="n" data-r="Perda">${t.loss != null ? `${esc(fmtPct(t.loss))}%` : '–'}</td>
        <td class="c-rede"><span class="corta2" title="${esc(rede)}">${esc(rede)}</span></td>
    </tr>`;
}
