// Relatório de um teste: o mesmo desenho do diagnóstico na página do teste e
// na gaveta do painel/administração, e o texto completo que vai para o
// WhatsApp ou para a área de transferência.

import { NOMES_CONEXAO } from '../core/device.js';
import { ICON } from '../core/icons.js';
import { esc, fmtDataHora, fmtMbps, fmtMs, fmtNum, fmtPct } from '../core/util.js';
import { barrasHorizontais } from './graficos.js';
import { classificar, planoParaCliente, usos, veredito } from './qualidade.js';

export const NOME_MODO = { rapido: 'Teste rápido', completo: 'Diagnóstico completo' };

const selo = (nivel, texto) => `<span class="selo ${nivel}">${esc(texto)}</span>`;
const nivelMs = (ms) => (ms == null ? null : ms < 50 ? { nivel: 'ok', rotulo: 'Rápido' } : ms < 120 ? { nivel: 'ok', rotulo: 'Bom' } : { nivel: 'atencao', rotulo: 'Lento' });
// tom do cliente: descreve o tempo sem chamar de lento
const nivelMsCliente = (ms) => (ms == null ? null : ms < 50 ? { nivel: 'ok', rotulo: 'Rápido' } : ms < 120 ? { nivel: 'ok', rotulo: 'Bom' } : { nivel: '', rotulo: 'Mais demorado' });

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
                const valor = x.mbps != null ? fmtMbps(x.mbps) + ' <small class="suave">Mbps</small>'
                    : x.alcance === null || x.alcance === undefined ? '<small class="suave">não testado</small>' : '–';
                const nota = [x.ip ? `Endereço: ${esc(x.ip)}` : null, x.principal ? 'a conexão deste teste' : null].filter(Boolean).join(' · ');
                return `<div class="diag-linha"><strong>${nome} ${estado}</strong><span class="valor">${valor}</span>
                    ${nota ? `<p>${nota}</p>` : ''}</div>`;
            };
            return `<div class="diag-linhas">${linha('IPv4', d.ipv4)}${linha('IPv6', d.ipv6)}</div>
                <p class="diag-explica">${d.ipv6 && d.ipv6.alcance ? 'A conexão já usa IPv6, o protocolo novo da internet.'
                    : d.ipv6 && d.ipv6.alcance === false ? (tom === 'tecnico' ? 'Sem IPv6, alguns serviços ficam dependentes de NAT. Não costuma ser um problema no dia a dia.' : 'A conexão está usando o IPv4, que atende normalmente todos os sites e aplicativos.')
                    : 'O IPv6 não pôde ser testado por este endereço do site.'}</p>`;
        },
    },
    nat: {
        titulo: 'Roteador e NAT',
        descricao: 'NAT é como o roteador divide um endereço da internet entre os aparelhos da casa.',
        corpo(d) {
            const t = TIPO_NAT[d.tipo];
            const nivelDuplo = d.duploNat === 'não' ? 'ok' : /^sim|provável|possível/.test(d.duploNat || '') ? 'atencao' : '';
            const textoDuplo = d.duploNat ? d.duploNat.charAt(0).toUpperCase() + d.duploNat.slice(1) : 'Não medido';
            const metodo = { ping: 'Contados pelo TTL dos pacotes do aparelho comparado com o ping no roteador do cliente.', rota: 'Contados pelo TTL dos pacotes do aparelho comparado com a rota até o roteador do cliente.', 'rota estimada': 'Estimado pela rota, porque o roteador do cliente não responde ping.' }[d.metodo] || 'Contados pelo caminho dos pacotes até o aparelho.';
            return `<div class="diag-linhas">
                <div class="diag-linha"><strong>Tipo de NAT</strong><span>${t ? selo(t.nivel, t.nome) : selo('', 'Não medido')}</span><p>${t ? esc(t.explica + (d.ipMuda ? ' O IP de saída muda conforme o destino.' : '')) : esc(d.motivoTipo || '')}</p></div>
                <div class="diag-linha"><strong>Duplo NAT</strong><span>${selo(nivelDuplo, textoDuplo)}</span>${d.motivo ? `<p>${esc(d.motivo)}</p>` : ''}</div>
                ${d.roteadoresInternos != null && d.roteadoresInternos >= 0 && !d.ipPrivado ? `<div class="diag-linha"><strong>Roteadores dentro da casa</strong><span class="valor">${fmtNum(d.roteadoresInternos, 0)}</span><p>O normal é 1. ${esc(metodo)}</p></div>` : ''}
                <div class="diag-linha"><strong>IP compartilhado (CGNAT)</strong><span>${d.cgnat ? selo('atencao', 'Sim') : selo('ok', 'Não')}</span></div>
                ${d.ipsDiferentes ? `<div class="diag-linha"><strong>IP visto pela internet</strong><span class="valor">${esc(d.ipStun)}</span><p>O servidor vê ${esc(d.ipServidor)}: ${d.ipPrivado || d.cgnat ? 'o aparelho chegou por dentro da rede e sai para a internet por outro IP.' : 'o NAT usa IPs diferentes conforme o destino.'}</p></div>` : ''}
                ${d.ipPrivado ? '<div class="diag-linha"><strong>Teste pela rede interna</strong><span>' + selo('', 'Rede local') + '</span><p>O aparelho chegou ao servidor por um IP privado, sem passar pela internet.</p></div>' : ''}
            </div>`;
        },
    },
    mtu: {
        titulo: 'MTU e MSS',
        descricao: 'Tamanho máximo de pacote que passa no caminho até o cliente (MTU) e o que a conexão dele anuncia (MSS).',
        corpo(d) {
            const a = avaliarMtu(d);
            const seloMtu = d.mtuCaminho == null ? selo('', 'Não medido') : d.mtuCaminho === 1500 ? selo('ok', 'Padrão') : d.mtuCaminho === 1492 ? selo('ok', 'PPPoE') : selo('atencao', 'Reduzido');
            return `<div class="diag-linhas">
                <div class="diag-linha"><strong>MTU do caminho ${seloMtu}</strong><span class="valor">${d.mtuCaminho != null ? fmtNum(d.mtuCaminho, 0) : '–'} <small class="suave">bytes</small></span>
                    <p>${d.mtuCaminho == null ? esc(d.motivo || 'Não foi possível medir.')
                        : d.metodo === 'aviso durante o teste' ? 'O roteador do cliente não responde ping: tamanho avisado por um roteador durante o download.'
                        : `Ping sem fragmentar até o IP do cliente (${esc(d.familia || '')})${d.metodo === 'aviso do roteador' ? ', pelo aviso de um roteador no caminho' : ''}.`}</p></div>
                <div class="diag-linha"><strong>MSS anunciado (TCP) ${d.mss == null ? selo('', 'Não medido') : a.nivel === 'ruim' || (a.nivel === 'atencao' && d.mtuPeloMss > d.mtuCaminho) ? selo(a.nivel, 'Maior que o caminho') : selo('ok', 'Certo')}</strong><span class="valor">${d.mss != null ? fmtNum(d.mss, 0) : '–'} <small class="suave">bytes</small></span>
                    <p>${d.mss != null && d.mssLimitado ? `O servidor já se ajustou ao caminho (MTU ${fmtNum(d.mtuPeloMss, 0)}); o MSS do aparelho pode ser maior. Confira o ajuste de MSS no roteador.`
                        : d.mss != null ? `Equivale a MTU ${fmtNum(d.mtuPeloMss, 0)} na rede do cliente.` : esc(d.motivo === 'teste feito no próprio servidor' ? 'Teste feito no próprio servidor: não se aplica.' : 'A conexão TCP do cliente não foi encontrada.')}</p></div>
                ${a.texto ? `<p class="diag-explica">${esc(a.texto)}</p>` : ''}
            </div>`;
        },
    },
    servicos: { titulo: 'Tempo até os aplicativos', descricao: 'Ida e volta até o servidor mais próximo de cada serviço.', barras: true },
    streaming: { titulo: 'Tempo até os streamings', descricao: 'Filmes, séries, vídeos e música. Quanto menor, mais rápido o vídeo começa.', barras: true },
    iptv: { titulo: 'Tempo até a TV ao vivo (IPTV)', descricao: 'Plataformas oficiais de TV pela internet. Pesa na troca de canal e nos travamentos.', barras: true },
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
/** Tipo de NAT medido pelo STUN, com o equivalente dos consoles (o que o cliente gamer conhece). */
const TIPO_NAT = {
    normal: { nivel: 'ok', nome: 'Moderado (cone)', curto: 'moderado (cone)', explica: 'Equivale ao NAT tipo 2 dos consoles: jogos, chamadas e câmeras funcionam. Para abrir de vez, UPnP ou DMZ no roteador.' },
    'simétrico': { nivel: 'atencao', nome: 'Estrito (simétrico)', curto: 'estrito (simétrico)', explica: 'Equivale ao NAT tipo 3 dos consoles: atrapalha jogos online, chamadas e acesso remoto a câmeras.' },
    'sem NAT (IPv6 direto)': { nivel: 'ok', nome: 'Sem NAT (IPv6)', curto: 'sem NAT (IPv6)', explica: 'O aparelho fala direto com a internet pelo IPv6.' },
};

export const PARTES_DIAG = ['protocolos', 'nat', 'mtu', 'servicos', 'streaming', 'iptv', 'bancos', 'relogio', 'rota'];
const SO_TECNICO = new Set(['nat', 'mtu', 'rota']);

/** MSS maior que o caminho = pacotes grandes somem (sites e VPN travando no meio). */
export function avaliarMtu(d) {
    if (!d || (d.mss == null && d.mtuCaminho == null)) return { nivel: '', texto: '' };
    if (d.mtuPeloMss != null && d.mtuCaminho != null && d.mtuPeloMss > d.mtuCaminho) {
        // pacotes grandes somem sem aviso (busca por ping) = buraco negro de MTU; com aviso de
        // um roteador (Frag needed), o TCP se ajusta sozinho e só fica mais lento no começo
        if (d.metodo === 'ping') return { nivel: 'ruim', texto: `O MSS anunciado (${d.mss}) passa do que o caminho aguenta (MTU ${d.mtuCaminho}) e os pacotes grandes somem sem aviso (buraco negro de MTU). Ative o ajuste de MSS (MSS clamping) no roteador do cliente ou no concentrador: sem isso, sites, bancos e VPN travam no meio.` };
        return { nivel: 'atencao', texto: `O MSS anunciado (${d.mss}) passa do que o caminho aguenta (MTU ${d.mtuCaminho}). Funciona porque um roteador avisa o tamanho, mas o ideal é ativar o ajuste de MSS (MSS clamping) no roteador do cliente ou no concentrador.` };
    }
    if (d.mtuCaminho != null && d.mtuCaminho < 1492) return { nivel: 'atencao', texto: `MTU ${d.mtuCaminho} é baixo. Confira túneis, VLAN ou PPPoE no caminho.` };
    return { nivel: 'ok', texto: d.mtuCaminho == null ? 'O MTU do caminho não respondeu ao ping; o MSS da conexão está coerente.' : '' };
}
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
 * Bolinha de cada medida no texto: verde, amarela e vermelha para o técnico;
 * para o cliente, só verde, azul e branca (nunca vermelho: mesmo critério da tela).
 */
function bolinha(tipo, valor, tom) {
    const c = classificar(tipo, valor, { tom });
    if (!c) return '';
    if (tom === 'tecnico') return c.nivel === 'ok' ? ' 🟢' : c.nivel === 'atencao' ? ' 🟡' : ' 🔴';
    return c.nivel === 'ok' ? ' 🟢' : c.nivel === 'azul' ? ' 🔵' : ' ⚪';
}

/**
 * Texto completo do teste para o WhatsApp e para copiar, com emojis e seções.
 * Leva tudo o que o teste mediu (no modo completo, também o diagnóstico; a rota
 * e o NAT só para o técnico), menos as coordenadas do aparelho: o local vai
 * pelo nome do bairro e da cidade.
 */
/** Partes da mensagem que a administração pode tirar do envio pelo WhatsApp (Administração → WhatsApp). */
export const PARTES_MSG = [
    ['quem', 'Quem enviou e conta do teste'], ['atendimento', 'Atendimento (cliente, plano, observação)'],
    ['velocidade', 'Download e upload'], ['plano', 'Porcentagem do plano'], ['latencia', 'Ping, jitter, perda e linha cheia'],
    ['operadora', 'Operadora e IP'], ['local', 'Localização'], ['aparelho', 'Aparelho, tipo de conexão e servidor'],
    ['protocolos', 'IPv4 e IPv6'], ['nat', 'NAT, CGNAT e roteadores'], ['mtu', 'MTU e MSS'], ['relogio', 'Relógio do aparelho'],
    ['servicos', 'Aplicativos'], ['streaming', 'Streaming'], ['iptv', 'IPTV (TV ao vivo)'], ['bancos', 'Bancos e PIX'],
    ['rota', 'Rota salto a salto'], ['link', 'Link do resultado'],
];

export function textoCompleto(t, { link, plano, empresa = 'Audicom Telecom', tom = 'cliente', ocultar = [] } = {}) {
    const L = [];
    const ver = (k) => !ocultar.includes(k);
    const tecnico = tom === 'tecnico';
    const v = veredito(t, { tom });
    const adv = t.advanced || {};
    const ll = t.loadedLatency || {};
    const at = t.atendimento || {};
    const icone = v.nivel === 'ok' ? '✅' : v.nivel === 'ruim' ? '❌' : tecnico ? '⚠️' : 'ℹ️';

    L.push(`📶 *Teste de velocidade · ${empresa}*`);
    const quando = [t.protocol ? `🧾 ${t.protocol}` : null, t.createdAt ? fmtDataHora(t.createdAt) : null].filter(Boolean).join(' · ');
    if (quando) L.push(quando);
    L.push(`${icone} ${NOME_MODO[t.mode] || 'Teste'}: *${v.titulo}*`);
    if (tecnico && t.verified === false) L.push('⚠️ Não conferido pelo servidor');

    if (tecnico && ver('atendimento') && (at.cliente || at.plano || at.obs)) {
        L.push('', '🏠 *Atendimento*');
        if (at.cliente) L.push(`• Cliente: ${at.cliente}`);
        if (at.plano) L.push(`• Plano: ${at.plano} Mbps`);
        if (at.obs) L.push(`• Obs.: ${at.obs}`);
    }

    const pct = tecnico ? (plano && t.download != null ? Math.round((t.download / plano) * 100) : null) : planoParaCliente(t.download, plano);
    if (ver('velocidade') || (ver('plano') && pct != null)) L.push('', '🚀 *Velocidade*');
    if (ver('velocidade')) {
        L.push(`⬇️ Download: *${mbps(t.download)}*${bolinha('download', t.download, tom)}`);
        L.push(`⬆️ Upload: *${mbps(t.upload)}*${bolinha('upload', t.upload, tom)}`);
    }
    if (ver('plano') && pct != null) L.push(`📦 Plano de ${plano} Mbps: ${pct}% no download`);

    if (ver('latencia')) {
    L.push('', '⏱️ *Latência e estabilidade*');
    L.push(`🏓 Ping: ${ms(t.ping)}${t.pingMin != null && t.pingMax != null ? ` (mín. ${fmtMs(t.pingMin)} · máx. ${fmtMs(t.pingMax)})` : ''}${bolinha('ping', t.ping, tom)}`);
    L.push(`〰️ Jitter: ${ms(t.jitter)}${bolinha('jitter', t.jitter, tom)}`);
    L.push(`📉 Perda de pacotes: ${t.loss != null ? fmtPct(t.loss) + '%' : 'não medida'}${bolinha('perda', t.loss, tom)}`);
    if (t.bufferbloat != null) {
        const det = [ll.download != null ? `${fmtMs(ll.download)} ms no download` : null, ll.upload != null ? `${fmtMs(ll.upload)} ms no upload` : null].filter(Boolean).join(' · ');
        L.push(`🚦 Ping com a linha cheia: +${fmtMs(t.bufferbloat)} ms${det ? ` (${det})` : ''}${bolinha('bufferbloat', t.bufferbloat, tom)}`);
    }
    }

    const con = [];
    if (ver('operadora')) {
        con.push(`🏢 Operadora: ${t.isp || 'não identificada'}`);
        if (t.ip) con.push(`🔢 IP: ${t.ip}${t.ipFamily ? ` (${t.ipFamily})` : ''}`);
    }
    if (ver('local')) {
        if (t.place && t.place.label) con.push(`📍 Local: ${t.place.label}${t.place.source === 'aparelho' ? ' (GPS do aparelho)' : ' (aproximado pelo IP)'}`);
        else con.push('📍 Local: sem localização');
    }
    if (ver('aparelho')) {
        const ap = aparelhoTexto(t.device);
        if (ap) con.push(`📱 Aparelho: ${ap}`);
        if (t.connection && t.connection.type) con.push(`📡 Conexão do aparelho: ${NOMES_CONEXAO[t.connection.type] || t.connection.type}`);
        if (t.server && t.server.name) con.push(`🖥️ Servidor: ${t.server.name}${t.server.location ? `, ${t.server.location}` : ''}`);
    }
    if (con.length) L.push('', '🌐 *Conexão*', ...con);

    if (t.mode === 'completo') {
        const diag = [];
        const pr = adv.protocolos;
        if (pr && ver('protocolos')) {
            for (const [nome, x] of [['IPv4', pr.ipv4], ['IPv6', pr.ipv6]]) {
                if (!x) continue;
                const est = x.alcance == null ? '➖ não testado' : x.alcance ? `✅ funciona${x.mbps != null ? ` · ${fmtMbps(x.mbps)} Mbps` : ''}` : tecnico ? '❌ sem acesso' : '➖ não utilizado';
                diag.push(`🌍 ${nome}: ${est}${x.ip ? ` (${x.ip})` : ''}`);
            }
        }
        if (tecnico && adv.nat && ver('nat')) {
            const n = adv.nat;
            diag.push(`🔀 NAT: ${(TIPO_NAT[n.tipo] || {}).curto || n.tipo || 'não medido'} · Duplo NAT: ${n.duploNat || 'não medido'} · CGNAT: ${n.cgnat ? 'sim' : 'não'}`);
            if (n.roteadoresInternos != null && n.roteadoresInternos >= 0) diag.push(`🏠 Roteadores dentro da casa: ${n.roteadoresInternos}${n.metodo === 'rota estimada' ? ' (estimado)' : ''}`);
            if (n.ipsDiferentes) diag.push(`🌐 A internet vê o IP ${n.ipStun} (o servidor vê ${n.ipServidor})`);
        }
        if (tecnico && adv.mtu && ver('mtu') && (adv.mtu.mss != null || adv.mtu.mtuCaminho != null)) {
            const a = avaliarMtu(adv.mtu);
            const mssMaior = adv.mtu.mtuPeloMss != null && adv.mtu.mtuCaminho != null && adv.mtu.mtuPeloMss > adv.mtu.mtuCaminho;
            diag.push(`📏 MTU: ${adv.mtu.mtuCaminho != null ? adv.mtu.mtuCaminho : 'sem resposta ao ping'} · MSS: ${adv.mtu.mss != null ? adv.mtu.mss : '–'} ${a.nivel === 'ruim' ? '❌ MSS maior que o caminho (buraco negro)' : mssMaior ? '⚠️ MSS maior que o caminho' : a.nivel === 'atencao' ? '⚠️ MTU baixo' : '✅'}`);
        }
        if (adv.relogio && ver('relogio')) diag.push(`🕒 Relógio do aparelho: ${Math.abs(adv.relogio.offsetS) < 2 ? '✅ certo' : `⚠️ ${relogioTexto(adv.relogio)}`}`);
        if (diag.length) L.push('', '🔬 *Diagnóstico*', ...diag);
        const linha = (arr) => arr.map((s) => `${s.label} ${s.ms != null ? s.ms : s.indisponivel ? 'n/d' : '–'}`).join(' · ');
        for (const [k, titulo] of [['servicos', '📲 *Aplicativos*'], ['streaming', '🎬 *Streaming*'], ['iptv', '📺 *IPTV (TV ao vivo)*'], ['bancos', '🏦 *Bancos e PIX*']]) {
            if (ver(k) && adv[k] && adv[k].length) L.push('', `${titulo} (ms)`, linha(adv[k]));
        }
        if (tecnico && !ver('rota')) { /* rota fora da mensagem */ } else if (tecnico && adv.rota && adv.rota.length) {
            L.push('', `🛣️ *Rota até a conexão* (${adv.rota.length} saltos)`);
            for (const h of adv.rota) {
                const extra = [h.media != null ? `${fmtMs(h.media)} ms` : null, h.perda ? `${fmtPct(h.perda)}% perda` : null].filter(Boolean).join(' · ');
                L.push(`${h.hop}. ${h.host || '* não responde'}${extra ? ` · ${extra}` : ''}`);
            }
        } else if (tecnico && adv.rotaErro) L.push('', `🛣️ Rota: não respondeu (${adv.rotaErro})`);
    }

    if (link && ver('link')) L.push('', `🔗 ${link}`);
    return L.join('\n');
}
