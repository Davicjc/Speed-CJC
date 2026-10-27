// Relatório de um teste: o mesmo desenho do diagnóstico na página do teste e
// na gaveta do painel/administração, e o texto completo que vai para o
// WhatsApp ou para a área de transferência.

import { NOMES_CONEXAO } from '../core/device.js';
import { ICON } from '../core/icons.js';
import { esc, fmtDataHora, fmtMbps, fmtMs, fmtNum, fmtPct } from '../core/util.js';
import { barrasHorizontais } from './graficos.js';
import { planoParaCliente, usos, veredito } from './qualidade.js';

export const NOME_MODO = { rapido: 'Teste rápido', completo: 'Diagnóstico completo' };

const selo = (nivel, texto) => `<span class="selo ${nivel}">${esc(texto)}</span>`;
const nivelMs = (ms) => (ms == null ? null : ms < 50 ? { nivel: 'ok', rotulo: 'Rápido' } : ms < 120 ? { nivel: 'ok', rotulo: 'Bom' } : { nivel: 'atencao', rotulo: 'Lento' });
// tom do cliente: descreve o tempo sem chamar de lento
const nivelMsCliente = (ms) => (ms == null ? null : ms < 50 ? { nivel: 'ok', rotulo: 'Rápido' } : ms < 120 ? { nivel: 'ok', rotulo: 'Bom' } : { nivel: '', rotulo: 'Mais demorado' });
const sim = (v) => /sim|provável/.test(v || '');

function aparelhoTexto(d) {
    if (!d) return null;
    const tipo = d.model ? `${d.type || 'Aparelho'} ${d.model}` : d.type;
    return [tipo, [d.os, d.osVersion].filter(Boolean).join(' '), [d.browser, d.browserVersion].filter(Boolean).join(' ')].filter(Boolean).join(', ') || null;
}

function relogioTexto(r) {
    const abs = Math.abs(r.offsetS);
    if (abs < 2) return 'certo';
    return `${r.offsetS > 0 ? 'adiantado' : 'atrasado'} ${fmtNum(abs, abs < 10 ? 1 : 0)} s`;
}

// ---------------------------------------------------------------- desenho

const DIAG = {
    protocolos: {
        titulo: 'IPv4 e IPv6',
        descricao: 'Download medido separadamente em cada versão do protocolo da internet.',
        corpo(d, tom) {
            const linha = (nome, x = {}) => {
                const estado = x.alcance === null || x.alcance === undefined ? selo('', 'Não verificável') : x.alcance ? selo('ok', 'Funciona')
                    : tom === 'tecnico' ? selo('ruim', 'Sem acesso') : selo('', 'Não utilizado');
                return `<div class="diag-linha"><strong>${nome} ${estado}</strong><span class="valor">${x.mbps != null ? fmtMbps(x.mbps) + ' <small class="suave">Mbps</small>' : '–'}</span>
                    ${x.ip ? `<p>Endereço: ${esc(x.ip)}</p>` : ''}</div>`;
            };
            return `<div class="diag-linhas">${linha('IPv4', d.ipv4)}${linha('IPv6', d.ipv6)}</div>
                <p class="diag-explica">${d.ipv6 && d.ipv6.alcance ? 'A conexão já usa IPv6, o protocolo novo da internet.'
                    : d.ipv6 && d.ipv6.alcance === false ? (tom === 'tecnico' ? 'Sem IPv6, alguns serviços ficam dependentes de NAT. Não costuma ser um problema no dia a dia.' : 'A conexão está usando o IPv4, que atende normalmente todos os sites e aplicativos.')
                    : 'Não deu para verificar o IPv6 por este endereço do site.'}</p>`;
        },
    },
    nat: {
        titulo: 'Roteador e NAT',
        descricao: 'NAT é como o roteador divide um endereço da internet entre os aparelhos da casa.',
        corpo(d) {
            const tipo = d.tipo === 'normal' ? selo('ok', 'Normal') : d.tipo === 'simétrico' ? selo('atencao', 'Simétrico') : d.tipo ? selo('ok', d.tipo) : selo('', 'Não medido');
            const duplo = sim(d.duploNat) ? selo('atencao', d.duploNat) : d.duploNat === 'não' ? selo('ok', 'Não') : selo('', d.duploNat || 'Não medido');
            return `<div class="diag-linhas">
                <div class="diag-linha"><strong>Tipo de NAT</strong><span>${tipo}</span><p>${d.tipo === 'simétrico' ? 'O NAT simétrico atrapalha jogos online, chamadas e acesso remoto a câmeras.' : d.tipo ? 'Jogos, chamadas e acesso remoto funcionam normalmente.' : esc(d.motivoTipo || '')}</p></div>
                <div class="diag-linha"><strong>Duplo NAT</strong><span>${duplo}</span>${d.motivo ? `<p>${esc(d.motivo)}</p>` : ''}</div>
                <div class="diag-linha"><strong>IP compartilhado (CGNAT)</strong><span>${d.cgnat ? selo('atencao', 'Sim') : selo('ok', 'Não')}</span></div>
                ${d.roteadoresInternos != null ? `<div class="diag-linha"><strong>Roteadores dentro da casa</strong><span class="valor">${fmtNum(d.roteadoresInternos, 0)}</span><p>Contados pelo caminho dos pacotes até o aparelho.</p></div>` : ''}
                ${d.ipPrivado ? '<div class="diag-linha"><strong>Teste pela rede interna</strong><span>' + selo('', 'Rede local') + '</span><p>O aparelho estava na mesma rede do servidor, sem passar pela internet.</p></div>' : ''}
            </div>`;
        },
    },
    servicos: { titulo: 'Tempo até os aplicativos', descricao: 'Ida e volta até o servidor mais próximo de cada serviço.', barras: true },
    bancos: { titulo: 'Tempo até bancos e PIX', descricao: 'Ida e volta até os servidores de cada banco. É o que pesa quando o app do banco demora a abrir.', barras: true },
    relogio: {
        titulo: 'Relógio do aparelho',
        descricao: 'Comparado com a hora oficial do Brasil (NTP.br).',
        corpo(d, tom) {
            if (!d) return '<p class="suave">Não foi possível comparar com a hora oficial.</p>';
            const s = d.offsetS;
            const abs = Math.abs(s);
            const est = abs < 2 ? selo('ok', 'Certo') : abs < 60 || tom !== 'tecnico' ? selo('atencao', s > 0 ? 'Adiantado' : 'Atrasado') : selo('ruim', s > 0 ? 'Muito adiantado' : 'Muito atrasado');
            return `<div class="diag-linhas"><div class="diag-linha"><strong>Diferença ${est}</strong><span class="valor">${s > 0 ? '+' : s < 0 ? '−' : ''}${fmtNum(abs, abs < 10 ? 2 : 0)} <small class="suave">s</small></span>
                <p>${abs < 2 ? 'Tudo certo.' : 'Relógio errado faz aplicativos de banco e sites seguros recusarem a conexão. Ative a data e hora automáticas no aparelho.'}${d.incertezaS != null ? ` Margem da medida: ${fmtNum(d.incertezaS * 1000, 0)} ms.` : ''}</p></div></div>`;
        },
    },
    rota: {
        titulo: 'Rota até você',
        descricao: 'O caminho dos pacotes do servidor até a conexão, salto a salto.',
        corpo(d) {
            if (!d || !d.length) return '<p class="suave">O rastreamento da rota não respondeu desta vez.</p>';
            return `<div class="tabela-wrap"><table class="tabela rota"><thead><tr><th>Salto</th><th>Endereço</th><th class="n">Perda</th><th class="n">Tempo médio</th></tr></thead><tbody>
                ${d.map((h) => `<tr><td>${h.hop}</td><td>${esc(h.host || 'não responde')}</td><td class="n">${h.perda != null ? fmtPct(h.perda) + '%' : '–'}</td><td class="n">${h.media != null ? fmtMs(h.media) + ' ms' : '–'}</td></tr>`).join('')}
                </tbody></table></div><p class="diag-explica">Saltos que "não respondem" são normais: muitos roteadores não respondem a esse tipo de consulta e seguem passando o tráfego.</p>`;
        },
    },
};

/** Ordem em que o diagnóstico completo aparece. NAT e rota são só do técnico (o cliente não vê, mas são coletados). */
export const PARTES_DIAG = ['protocolos', 'nat', 'servicos', 'bancos', 'relogio', 'rota'];
const SO_TECNICO = new Set(['nat', 'rota']);
export const partesDiag = (tom = 'cliente') => (tom === 'tecnico' ? PARTES_DIAG : PARTES_DIAG.filter((k) => !SO_TECNICO.has(k)));

/**
 * Desenha uma parte do diagnóstico dentro de `el`.
 * estilo 'painel': cabeçalho de cartão (página do teste); 'secao': título simples (gaveta).
 */
export function desenharDiag(el, chave, d, { estilo = 'painel', tom = 'cliente' } = {}) {
    const p = DIAG[chave];
    if (!p || (tom !== 'tecnico' && SO_TECNICO.has(chave))) return;
    const cabeca = estilo === 'painel'
        ? `<div class="painel-cabeca"><div><h3>${esc(p.titulo)}</h3>${p.descricao ? `<p>${esc(p.descricao)}</p>` : ''}</div></div>`
        : `<h3>${esc(p.titulo)}</h3>${p.descricao ? `<p class="suave det-desc">${esc(p.descricao)}</p>` : ''}`;
    if (p.barras) {
        el.innerHTML = `${cabeca}<div class="lista-barras"></div>`;
        barrasHorizontais(el.querySelector('.lista-barras'), (d || []).map((s) => ({ nome: s.label, valor: s.ms, vazio: s.indisponivel ? 'n/d' : s.ms === null ? '…' : 'falhou' })), {
            formato: (v) => `${v} ms`, maximo: 250, cor: 'var(--serie-download)', nivel: tom === 'tecnico' ? nivelMs : nivelMsCliente,
        });
    } else {
        el.innerHTML = cabeca + p.corpo(d || {}, tom);
    }
    el.hidden = false;
}

const ICONE_ESTADO = { ok: ICON.checkCircle, atencao: ICON.alert, ruim: ICON.xCircle, neutro: ICON.clock };
const TEXTO_ESTADO = { ok: 'atende', atencao: 'no limite', ruim: 'não atende', neutro: 'pode variar neste momento' };

/** Lista "o que a conexão aguenta" (4K, jogos, chamadas…). */
export function usosHtml(t, { tom = 'cliente' } = {}) {
    return usos(t, { tom }).map((u) => `<li class="${u.estado}">${ICONE_ESTADO[u.estado]}<strong>${esc(u.titulo)}<span class="sr-only">: ${TEXTO_ESTADO[u.estado]}</span></strong><span>${esc(u.detalhe)}</span></li>`).join('');
}

// ---------------------------------------------------------------- texto

const mbps = (v) => (v == null ? 'não medido' : `${fmtMbps(v)} Mbps`);
const ms = (v) => (v == null ? 'não medido' : `${fmtMs(v)} ms`);

/**
 * Texto completo do teste, para o WhatsApp e para copiar. Leva tudo o que o
 * teste mediu (no modo completo, também o diagnóstico e a rota), menos as
 * coordenadas do aparelho: o local vai só pelo nome do bairro e da cidade.
 */
export function textoCompleto(t, { link, plano, empresa = 'Audicom Telecom', tom = 'cliente' } = {}) {
    const L = [];
    const tecnico = tom === 'tecnico';
    const v = veredito(t, { tom });
    const adv = t.advanced || {};
    const ll = t.loadedLatency || {};

    L.push(`*Teste de velocidade ${empresa}*`);
    const quando = [t.createdAt ? fmtDataHora(t.createdAt) : null, t.protocol ? `Protocolo ${t.protocol}` : null].filter(Boolean).join(' · ');
    if (quando) L.push(quando);
    L.push(`${NOME_MODO[t.mode] || 'Teste'}: ${v.titulo}${tecnico && t.verified === false ? ' (não conferido pelo servidor)' : ''}`);
    if (tecnico && t.origem === 'tecnico') L.push('Teste técnico' + (t.atendimento && t.atendimento.cliente ? ` · cliente ${t.atendimento.cliente}` : ''));

    L.push('', '*Velocidade*');
    L.push(`Download: ${mbps(t.download)}`);
    L.push(`Upload: ${mbps(t.upload)}`);
    const pct = tecnico ? (plano && t.download != null ? Math.round((t.download / plano) * 100) : null) : planoParaCliente(t.download, plano);
    if (pct != null) L.push(`Plano contratado: ${plano} Mbps (${pct}% no download)`);

    L.push('', '*Latência e estabilidade*');
    L.push(`Ping: ${ms(t.ping)}${t.pingMin != null && t.pingMax != null ? ` (mín. ${fmtMs(t.pingMin)}, máx. ${fmtMs(t.pingMax)})` : ''}`);
    L.push(`Jitter: ${ms(t.jitter)}`);
    L.push(`Perda de pacotes: ${t.loss != null ? fmtPct(t.loss) + '%' : 'não medida'}`);
    if (t.bufferbloat != null) {
        const det = [ll.download != null ? `${fmtMs(ll.download)} ms durante o download` : null, ll.upload != null ? `${fmtMs(ll.upload)} ms durante o upload` : null].filter(Boolean).join(' e ');
        L.push(`Ping com a linha cheia: +${fmtMs(t.bufferbloat)} ms${det ? ` (ping de ${det})` : ''}`);
    }

    L.push('', '*Conexão*');
    L.push(`Operadora: ${t.isp || 'não identificada'}`);
    if (t.ip) L.push(`IP: ${t.ip}${t.ipFamily ? ` (${t.ipFamily})` : ''}`);
    if (t.place && t.place.label) L.push(`Local: ${t.place.label}${t.place.source === 'aparelho' ? ' (localização do aparelho)' : t.place.source === 'ip' ? ' (aproximado pelo IP)' : ''}`);
    if (t.connection && t.connection.type) L.push(`Conexão do aparelho: ${NOMES_CONEXAO[t.connection.type] || t.connection.type}`);
    const ap = aparelhoTexto(t.device);
    if (ap) L.push(`Aparelho: ${ap}`);
    if (t.server && t.server.name) L.push(`Servidor: ${t.server.name}${t.server.location ? `, ${t.server.location}` : ''}`);

    if (t.mode === 'completo') {
        const pr = adv.protocolos;
        if (pr) {
            L.push('', '*IPv4 e IPv6*');
            for (const [nome, x] of [['IPv4', pr.ipv4], ['IPv6', pr.ipv6]]) {
                if (!x) continue;
                const est = x.alcance == null ? 'não verificável' : x.alcance ? `funciona${x.mbps != null ? `, ${fmtMbps(x.mbps)} Mbps` : ''}` : tecnico ? 'sem acesso' : 'não utilizado';
                L.push(`${nome}: ${est}${x.ip ? ` (${x.ip})` : ''}`);
            }
        }
        if (tecnico && adv.nat) {
            const n = adv.nat;
            L.push('', '*Roteador e NAT*');
            L.push(`Tipo de NAT: ${n.tipo || 'não medido'}`);
            L.push(`Duplo NAT: ${n.duploNat || 'não medido'}${n.motivo ? ` (${n.motivo})` : ''}`);
            L.push(`IP compartilhado (CGNAT): ${n.cgnat ? 'sim' : 'não'}`);
            if (n.roteadoresInternos != null) L.push(`Roteadores dentro da casa: ${n.roteadoresInternos}`);
        }
        if (adv.relogio) L.push('', `*Relógio do aparelho:* ${relogioTexto(adv.relogio)}`);
        const lista = (titulo, arr) => {
            if (!arr || !arr.length) return;
            L.push('', `*${titulo}*`);
            for (const s of arr) L.push(`${s.label}: ${s.ms != null ? `${s.ms} ms` : s.indisponivel ? 'indisponível' : tecnico ? 'falhou' : 'sem resposta'}`);
        };
        lista('Tempo até os aplicativos', adv.servicos);
        lista('Tempo até bancos e PIX', adv.bancos);
        if (tecnico && adv.rota && adv.rota.length) {
            L.push('', '*Rota até a conexão*');
            for (const h of adv.rota) {
                const extra = [h.media != null ? `${fmtMs(h.media)} ms` : null, h.perda ? `${fmtPct(h.perda)}% de perda` : null].filter(Boolean).join(', ');
                L.push(`${h.hop}. ${h.host || 'não responde'}${extra ? ` (${extra})` : ''}`);
            }
        } else if (tecnico && adv.rotaErro) L.push('', `*Rota até a conexão:* não respondeu (${adv.rotaErro})`);
    }

    if (link) L.push('', `Resultado: ${link}`);
    return L.join('\n');
}
