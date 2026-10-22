import { coletarAparelho, conexaoDoNavegador, NOMES_CONEXAO } from '../core/device.js';
import { ICON } from '../core/icons.js';
import { guardarPendente } from '../core/pendentes.js';
import { iniciarPagina } from '../core/shell.js';
import { $, $$, copiar, esc, fmtHora, fmtMbps, fmtMs, fmtNum, fmtPct, html, setHtml, storage, store, toast } from '../core/util.js';
import * as M from '../engine/motor.js';
import { executarTeste } from '../engine/teste.js';
import { iniciarConstelacao } from '../ui/constelacao.js';
import { barrasHorizontais, graficoLinhas } from '../ui/graficos.js';
import { classificar, dicas, usos, veredito } from '../ui/qualidade.js';
import { criarVelocimetro } from '../ui/velocimetro.js';

const sessao = await iniciarPagina({ pagina: 'teste' });
const cfg = sessao.cfg || {};
const velo = criarVelocimetro($('#velo'));
const rede = iniciarConstelacao();

let modo = 'rapido';
let rodando = false;
let controle = null;
let ultimoResultado = null;

// ---------- opções ----------
const AJUDA_MODO = {
    rapido: 'Velocidade, latência e estabilidade, em cerca de 30 segundos.',
    completo: 'Inclui IPv4 e IPv6, tipo de NAT, rota até você e o tempo até bancos e aplicativos. Cerca de 1 minuto.',
};
$$('#modos button').forEach((b) => b.addEventListener('click', () => escolherModo(b.dataset.modo)));
$('#modos').addEventListener('keydown', (e) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    e.preventDefault();
    escolherModo(modo === 'rapido' ? 'completo' : 'rapido');
    $(`#modos button[data-modo="${modo}"]`).focus();
});
function escolherModo(m) {
    modo = m;
    $$('#modos button').forEach((b) => {
        const sel = b.dataset.modo === m;
        b.setAttribute('aria-checked', String(sel));
        b.tabIndex = sel ? 0 : -1;
    });
    $('#modo-ajuda').textContent = AJUDA_MODO[m];
    $('[data-etapa="diagnostico"]').hidden = m !== 'completo';
}
escolherModo('rapido');

const chaveLocal = $('#usar-local');
if (!window.isSecureContext || !navigator.geolocation) {
    chaveLocal.checked = false;
    chaveLocal.disabled = true;
    $('#local-chave').style.opacity = '0.6';
    $('#local-ajuda').textContent = 'A localização do aparelho só funciona quando o site é aberto por HTTPS. O teste usa a cidade aproximada do seu IP.';
} else {
    chaveLocal.checked = storage('audicom.usar-local', !!sessao.user);
    chaveLocal.addEventListener('change', () => store('audicom.usar-local', chaveLocal.checked));
}

if (cfg.accounts && !sessao.user) $('#chamada').hidden = false;
if (cfg.serverName) $('#c-servidor').textContent = `${cfg.serverName}, ${cfg.serverLocation || ''}`.replace(/, $/, '');

// ---------- quem é você (IP e operadora, como o servidor vê) ----------
M.quemSouEu().then((w) => {
    $('#c-ip').textContent = w.ip || '–';
    $('#c-isp').textContent = w.isp || 'Não identificada';
    $('#c-local').textContent = w.private ? 'Rede interna' : [w.city, w.region].filter(Boolean).join(' - ') || 'Não identificado';
    $('#c-ip').title = w.family || '';
}).catch(() => {
    $('#c-ip').textContent = '–';
    $('#c-isp').textContent = '–';
    $('#c-local').textContent = '–';
});
M.preparar().catch(() => {}); // abre a conexão de teste antes do clique

// ---------- leituras ----------
const FMT = { download: fmtMbps, upload: fmtMbps, ping: fmtMs, jitter: fmtMs, perda: fmtPct, bufferbloat: fmtMs };
function leitura(tipo, v, { selo = false } = {}) {
    const alvo = $(`#v-${tipo}`);
    if (!alvo) return;
    alvo.textContent = v == null ? '–' : FMT[tipo](v);
    const q = $(`#q-${tipo}`);
    if (selo) {
        const c = classificar(tipo, v);
        q.innerHTML = c ? `<span class="selo ${c.nivel}">${esc(c.rotulo)}</span>` : '';
    } else q.innerHTML = '';
}
function leituraAtiva(tipo) {
    $$('.leitura').forEach((l) => l.classList.toggle('ativa', l.dataset.tipo === tipo || (tipo === 'ping' && l.dataset.tipo === 'jitter')));
}

function centro(rotulo, numero, unidade) {
    $('#velo-rotulo').textContent = rotulo;
    $('#velo-numero').textContent = numero;
    $('#velo-unidade').textContent = unidade;
}

const ORDEM = ['ping', 'download', 'upload', 'estabilidade', 'diagnostico'];
function marcarEtapa(etapa) {
    const i = ORDEM.indexOf(etapa);
    $$('#etapas li').forEach((li) => {
        const j = ORDEM.indexOf(li.dataset.etapa);
        li.classList.toggle('feita', i > j || etapa === 'fim');
        li.classList.toggle('ativa', i === j);
        if (i === j) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
    });
}

function intensidade(mbps) { return Math.min(1, Math.log10(1 + Math.max(0, mbps)) / 3); }

// ---------- localização ----------
function pedirLocal() {
    return new Promise((resolve) => {
        const t = setTimeout(() => resolve(null), 15000);
        navigator.geolocation.getCurrentPosition(
            (p) => { clearTimeout(t); resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }); },
            (e) => {
                clearTimeout(t);
                if (e.code === 1) {
                    toast('Localização não autorizada. O teste segue usando a cidade do seu IP.', 'info');
                    chaveLocal.checked = false;
                    store('audicom.usar-local', false);
                }
                resolve(null);
            },
            { enableHighAccuracy: true, timeout: 14000, maximumAge: 120000 },
        );
    });
}

// ---------- teste ----------
$('#iniciar').addEventListener('click', iniciar);
$('#de-novo').addEventListener('click', iniciar);
$('#parar').addEventListener('click', () => { if (controle) controle.abort(); });

function bloquearOpcoes(sim) {
    $$('#modos button').forEach((b) => { b.disabled = sim; });
    if (window.isSecureContext && navigator.geolocation) chaveLocal.disabled = sim;
}

function limpar() {
    for (const t of Object.keys(FMT)) leitura(t, null);
    leituraAtiva(null);
    $('#resultado').hidden = true;
    $('#intro').hidden = false;
    $('#detalhes').hidden = true;
    ['protocolos', 'nat', 'servicos', 'bancos', 'relogio', 'rota'].forEach((k) => { const p = $(`#d-${k}`); p.hidden = true; p.innerHTML = ''; });
    $('#curva').innerHTML = '';
    velo.reiniciarEscala();
}

async function iniciar() {
    if (rodando) return;
    rodando = true;
    controle = new AbortController();
    // lido antes de bloquear as opções (o bloqueio desativa a chave durante o teste)
    const querLocal = chaveLocal.checked && !chaveLocal.disabled;
    limpar();
    bloquearOpcoes(true);
    $('#parar').hidden = false;
    $('#de-novo').disabled = true;
    sessao.definirEstado('testing');
    document.body.classList.add('testando');

    const geo = querLocal ? pedirLocal() : Promise.resolve(null);
    const amostras = { download: [], upload: [] };
    let inicioEtapa = performance.now();
    let etapaAtual = null;

    velo.modo('ping');
    centro('Ping', '–', 'ms');
    let r;
    try {
        r = await executarTeste({
            modo,
            sinal: controle.signal,
            eventos: {
                etapa(n) {
                    etapaAtual = n;
                    inicioEtapa = performance.now();
                    marcarEtapa(n);
                    leituraAtiva(n === 'estabilidade' ? 'perda' : n);
                    if (n === 'ping') { velo.modo('ping'); centro('Ping', '–', 'ms'); rede.fluxo(null); }
                    if (n === 'download') { velo.modo('download'); centro('Download', '0', 'Mbps'); rede.fluxo('download', 0.05, $('#velo')); }
                    if (n === 'upload') { velo.modo('upload'); centro('Upload', '0', 'Mbps'); rede.fluxo('upload', 0.05, $('#velo')); }
                    if (n === 'estabilidade' || n === 'diagnostico') {
                        rede.fluxo(null);
                        velo.modo('ping');
                        centro(n === 'estabilidade' ? 'Estabilidade' : 'Diagnóstico', '…', n === 'estabilidade' ? 'perda de pacotes' : 'da sua rede');
                    }
                },
                valor(tipo, v) {
                    leitura(tipo, v);
                    if (tipo === etapaAtual && (tipo === 'download' || tipo === 'upload')) {
                        velo.valor(v);
                        $('#velo-numero').textContent = fmtMbps(v);
                        rede.fluxo(tipo, intensidade(v), $('#velo'));
                    }
                    if (tipo === 'ping' && etapaAtual === 'ping') $('#velo-numero').textContent = fmtMs(v);
                },
                amostra(tipo, mbps) {
                    const x = Math.round(((performance.now() - inicioEtapa) / 1000) * 2) / 2;
                    amostras[tipo].push({ x, y: mbps });
                },
                status(t) { $('#status').textContent = t; },
                diag(chave, dados) { mostrarDiag(chave, dados); },
            },
        });
    } catch (e) {
        rede.fluxo(null);
        velo.modo('ocioso');
        marcarEtapa(null);
        leituraAtiva(null);
        $('#status').textContent = e.name === 'AbortError' ? 'Teste interrompido.' : `Não foi possível concluir o teste: ${e.message}`;
        if (e.name !== 'AbortError') toast('O teste não terminou. Confira sua conexão e tente de novo.', 'ruim');
        encerrar();
        return;
    }
    encerrar();
    marcarEtapa('fim');
    leituraAtiva(null);
    ultimoResultado = r;
    mostrarResultado(r, amostras);
    salvar(r, await geo);
}

function encerrar() {
    rodando = false;
    controle = null;
    bloquearOpcoes(false);
    $('#parar').hidden = true;
    $('#de-novo').disabled = false;
    sessao.definirEstado('online');
    document.body.classList.remove('testando');
    rede.fluxo(null);
}

// ---------- resultado ----------
const ICONE_ESTADO = { ok: ICON.checkCircle, atencao: ICON.alert, ruim: ICON.xCircle };
const TEXTO_ESTADO = { ok: 'atende', atencao: 'no limite', ruim: 'não atende' };

function mostrarResultado(r, amostras) {
    velo.modo('fim');
    velo.valor(r.download || 0);
    centro('Download', fmtMbps(r.download), 'Mbps');
    for (const t of ['download', 'upload', 'ping', 'jitter', 'bufferbloat']) leitura(t, r[t], { selo: true });
    leitura('perda', r.loss, { selo: true });
    $('#status').textContent = r.erros.length ? `Parte do teste não foi medida: ${r.erros.map((x) => x.split(':')[0]).join(', ')}.` : 'Teste concluído.';

    const v = veredito(r);
    $('#r-quando').textContent = `Hoje às ${fmtHora(Date.now())}`;
    $('#r-titulo').textContent = v.titulo;
    $('#r-texto').textContent = v.texto;

    const plano = sessao.me && sessao.me.profile && sessao.me.profile.planMbps;
    if (plano && r.download != null) {
        const pct = Math.round((r.download / plano) * 100);
        setHtml($('#r-plano'), html`Você recebeu <strong>${pct}%</strong> do seu plano de ${plano} Mbps neste teste.`);
        $('#r-plano').hidden = false;
    } else $('#r-plano').hidden = true;

    $('#r-usos').innerHTML = usos(r).map((u) => `<li class="${u.estado}">${ICONE_ESTADO[u.estado]}<strong>${esc(u.titulo)}<span class="sr-only">: ${TEXTO_ESTADO[u.estado]}</span></strong><span>${esc(u.detalhe)}</span></li>`).join('');
    const ds = dicas(r, { tipoConexao: conexaoDoNavegador().type, planoMbps: plano });
    $('#r-dicas').innerHTML = ds.map((d) => `<li>${esc(d)}</li>`).join('');
    $('#r-dicas').hidden = !ds.length;

    $('#copiar').hidden = true;
    $('#whatsapp').hidden = true;
    $('#r-salvo').className = 'salvo';
    $('#r-salvo').innerHTML = '<span class="giro" aria-hidden="true" style="width:16px;height:16px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:giro .7s linear infinite"></span>Guardando o resultado…';

    $('#intro').hidden = true;
    $('#resultado').hidden = false;
    $('#resultado').focus({ preventScroll: true });

    // detalhes: curva de velocidade + aparelho
    $('#detalhes').hidden = false;
    const balde = (lista) => {
        const m = new Map();
        for (const p of lista) { const a = m.get(p.x) || []; a.push(p.y); m.set(p.x, a); }
        return [...m.entries()].map(([x, ys]) => ({ x, y: ys.reduce((s, y) => s + y, 0) / ys.length })).sort((a, b) => a.x - b.x);
    };
    graficoLinhas($('#curva'), {
        series: [
            { nome: 'Download', cor: 'var(--serie-download)', pontos: balde(amostras.download), area: true },
            { nome: 'Upload', cor: 'var(--serie-upload)', pontos: balde(amostras.upload), tracejado: true },
        ],
        altura: 220,
        formatoY: (y) => fmtMbps(y),
        formatoEixo: (y) => fmtNum(y, y < 10 && y % 1 ? 1 : 0),
        formatoX: (x) => `${fmtNum(x, 0)} s`,
        formatoDica: (x) => `${fmtNum(x, 1)} s depois do início`,
    });
    mostrarAparelho();
}

async function mostrarAparelho() {
    const a = await coletarAparelho();
    const c = conexaoDoNavegador();
    setHtml($('#d-aparelho'), html`<div class="painel-cabeca"><div><h3>Seu aparelho</h3><p>O que o navegador informa. Aparelho lento também deixa a internet "parecendo" lenta.</p></div></div>
        <dl class="dados">
            <dt>Aparelho</dt><dd>${a.model ? `${a.type} ${a.model}` : a.type}</dd>
            <dt>Sistema</dt><dd>${[a.os, a.osVersion].filter(Boolean).join(' ') || 'Não informado'}</dd>
            <dt>Navegador</dt><dd>${[a.browser, a.browserVersion].filter(Boolean).join(' ') || 'Não informado'}</dd>
            <dt>Processador</dt><dd>${a.cores ? `${a.cores} núcleos` : 'Não informado'}</dd>
            <dt>Memória</dt><dd>${a.ram ? `${a.ram} GB ou mais` : 'Não informada'}</dd>
            <dt>Conexão</dt><dd>${c.type ? NOMES_CONEXAO[c.type] || c.type : 'O navegador não informa'}</dd>
        </dl>`);
}

async function salvar(r, geo) {
    const aparelho = await coletarAparelho();
    const payload = {
        mode: r.mode, download: r.download, upload: r.upload, ping: r.ping, jitter: r.jitter, loss: r.loss, bufferbloat: r.bufferbloat,
        pingMin: r.pingMin, pingMax: r.pingMax, dlWindowMs: r.dlWindowMs, loadedLatency: r.loadedLatency,
        location: geo,
        device: { type: aparelho.type, os: aparelho.os, osVersion: aparelho.osVersion, browser: aparelho.browser, browserVersion: aparelho.browserVersion, model: aparelho.model, cores: aparelho.cores, ram: aparelho.ram, screen: aparelho.screen },
        connection: conexaoDoNavegador(),
        advanced: r.advanced,
    };
    let res = null;
    const salvo = $('#r-salvo');
    try {
        res = await M.salvarResultado(payload);
    } catch (e) {
        salvo.className = 'salvo atencao';
        setHtml(salvo, html`${{ __raw: ICON.alert }}<span>Não foi possível guardar o resultado (${e.message}). O resultado acima continua valendo.</span>`);
        habilitarCompartilhar(null, r);
        return;
    }

    if (res.upload != null && Math.abs(res.upload - (r.upload ?? res.upload)) > 0.01) {
        r.upload = res.upload; // o upload medido pelo servidor é o que vale
        leitura('upload', r.upload, { selo: true });
    }
    setHtml($('#r-quando'), html`Hoje às ${fmtHora(Date.now())}. Protocolo <span class="mono-copy">${res.protocol}</span>`);
    habilitarCompartilhar(location.origin + res.path, r);

    if (res.saved === 'account') {
        salvo.className = 'salvo ok';
        setHtml(salvo, html`${{ __raw: ICON.checkCircle }}<span>Guardado no seu painel${res.place && res.place.label ? `, com local: ${res.place.label}` : ''}. <a href="/painel">Ver meu histórico</a></span>`);
    } else {
        if (res.claimToken) guardarPendente(res.id, res.claimToken);
        salvo.className = 'salvo';
        if (cfg.accounts) {
            setHtml(salvo, html`${{ __raw: ICON.info }}<span>Este teste ainda não está em uma conta. <a href="/entrar?next=%2Fpainel">Entre</a> ou <a href="/cadastro?next=%2Fpainel">crie sua conta</a> nas próximas 24 horas e ele vai junto para o seu histórico.</span>`);
        } else {
            setHtml(salvo, html`${{ __raw: ICON.checkCircle }}<span>Resultado registrado.</span>`);
        }
    }
    if (res.verified === false) {
        salvo.insertAdjacentHTML('beforeend', '<span class="suave" style="flex-basis:100%;font-size:var(--t-xs)">O servidor não conseguiu conferir todas as medidas deste teste; ele fica marcado como não conferido.</span>');
    }
}

function resumoTexto(r, link) {
    const linhas = [
        'Meu teste de velocidade na Audicom Telecom',
        `Download: ${fmtMbps(r.download)} Mbps`,
        `Upload: ${fmtMbps(r.upload)} Mbps`,
        `Ping: ${fmtMs(r.ping)} ms, jitter: ${fmtMs(r.jitter)} ms`,
    ];
    if (r.loss != null) linhas.push(`Perda de pacotes: ${fmtPct(r.loss)}%`);
    if (link) linhas.push(link);
    return linhas.join('\n');
}

function habilitarCompartilhar(link, r) {
    const bc = $('#copiar');
    bc.innerHTML = ICON.copy + (link ? 'Copiar link' : 'Copiar resultado');
    bc.hidden = false;
    bc.onclick = async () => {
        const ok = await copiar(link || resumoTexto(r));
        toast(ok ? (link ? 'Link copiado.' : 'Resultado copiado.') : 'Não foi possível copiar.', ok ? 'ok' : 'ruim');
    };
    const wa = $('#whatsapp');
    wa.innerHTML = ICON.whatsapp + 'Enviar no WhatsApp';
    wa.href = 'https://wa.me/?text=' + encodeURIComponent(resumoTexto(r, link));
    wa.hidden = false;
}

// ---------- diagnóstico (modo completo) ----------
function painel(id, titulo, descricao, corpo) {
    const p = $(`#d-${id}`);
    setHtml(p, html`<div class="painel-cabeca"><div><h3>${titulo}</h3>${descricao ? html`<p>${descricao}</p>` : ''}</div></div>${{ __raw: String(corpo) }}`);
    p.hidden = false;
    $('#detalhes').hidden = false;
}
const selo = (nivel, texto) => `<span class="selo ${nivel}">${esc(texto)}</span>`;
const nivelMs = (ms) => (ms == null ? null : ms < 50 ? { nivel: 'ok', rotulo: 'Rápido' } : ms < 120 ? { nivel: 'ok', rotulo: 'Bom' } : { nivel: 'atencao', rotulo: 'Lento' });

function mostrarDiag(chave, d) {
    if (chave === 'protocolos') {
        const linha = (nome, x) => {
            const estado = x.alcance === null ? selo('', 'Não verificável') : x.alcance ? selo('ok', 'Funciona') : selo('ruim', 'Sem acesso');
            return `<div class="diag-linha"><strong>${nome} ${estado}</strong><span class="valor">${x.mbps != null ? fmtMbps(x.mbps) + ' <small class="suave">Mbps</small>' : '–'}</span>
                ${x.ip ? `<p>Endereço: ${esc(x.ip)}</p>` : ''}</div>`;
        };
        painel('protocolos', 'IPv4 e IPv6', 'Download medido separadamente em cada versão do protocolo da internet.',
            `<div class="diag-linhas">${linha('IPv4', d.ipv4)}${linha('IPv6', d.ipv6)}</div>
             <p class="diag-explica">${d.ipv6 && d.ipv6.alcance ? 'Sua conexão já usa IPv6, o protocolo novo da internet.'
                : d.ipv6 && d.ipv6.alcance === false ? 'Sem IPv6, alguns serviços ficam dependentes de NAT. Não costuma ser um problema no dia a dia.'
                : 'Não deu para verificar o IPv6 por este endereço do site.'}</p>`);
    }
    if (chave === 'nat') {
        const tipo = d.tipo === 'normal' ? selo('ok', 'Normal') : d.tipo === 'simétrico' ? selo('atencao', 'Simétrico') : d.tipo ? selo('ok', d.tipo) : selo('', 'Não medido');
        const duplo = /sim|provável/.test(d.duploNat || '') ? selo('atencao', d.duploNat) : d.duploNat === 'não' ? selo('ok', 'Não') : selo('', d.duploNat || 'Não medido');
        painel('nat', 'Roteador e NAT', 'NAT é como o roteador divide um endereço da internet entre os aparelhos da casa.',
            `<div class="diag-linhas">
                <div class="diag-linha"><strong>Tipo de NAT</strong><span>${tipo}</span><p>${d.tipo === 'simétrico' ? 'O NAT simétrico atrapalha jogos online, chamadas e acesso remoto a câmeras.' : d.tipo ? 'Jogos, chamadas e acesso remoto funcionam normalmente.' : esc(d.motivoTipo || '')}</p></div>
                <div class="diag-linha"><strong>Duplo NAT</strong><span>${duplo}</span>${d.motivo ? `<p>${esc(d.motivo)}</p>` : ''}</div>
                <div class="diag-linha"><strong>IP compartilhado (CGNAT)</strong><span>${d.cgnat ? selo('atencao', 'Sim') : selo('ok', 'Não')}</span></div>
            </div>`);
    }
    if (chave === 'servicos' || chave === 'bancos') {
        const id = chave;
        painel(id, chave === 'servicos' ? 'Tempo até os aplicativos' : 'Tempo até bancos e PIX',
            chave === 'servicos' ? 'Ida e volta até o servidor mais próximo de cada serviço.' : 'Ida e volta até os servidores de cada banco. É o que pesa quando o app do banco demora a abrir.',
            '<div class="lista-barras"></div>');
        barrasHorizontais($(`#d-${id} .lista-barras`), d.map((s) => ({ nome: s.label, valor: s.ms, vazio: s.indisponivel ? 'n/d' : s.ms === null ? '…' : 'falhou' })), {
            formato: (v) => `${v} ms`, maximo: 250, cor: 'var(--serie-download)', nivel: nivelMs,
        });
    }
    if (chave === 'relogio') {
        if (!d) { painel('relogio', 'Relógio do aparelho', null, '<p class="suave">Não foi possível comparar com a hora oficial agora.</p>'); return; }
        const s = d.offsetS;
        const abs = Math.abs(s);
        const est = abs < 2 ? selo('ok', 'Certo') : abs < 60 ? selo('atencao', s > 0 ? 'Adiantado' : 'Atrasado') : selo('ruim', s > 0 ? 'Muito adiantado' : 'Muito atrasado');
        painel('relogio', 'Relógio do aparelho', 'Comparado com a hora oficial do Brasil (NTP.br).',
            `<div class="diag-linhas"><div class="diag-linha"><strong>Diferença ${est}</strong><span class="valor">${s > 0 ? '+' : s < 0 ? '−' : ''}${fmtNum(abs, abs < 10 ? 2 : 0)} <small class="suave">s</small></span>
             <p>${abs < 2 ? 'Tudo certo.' : 'Relógio errado faz aplicativos de banco e sites seguros recusarem a conexão. Ative a data e hora automáticas no aparelho.'}</p></div></div>`);
    }
    if (chave === 'rota') {
        if (!d || !d.length) { painel('rota', 'Rota até você', null, '<p class="suave">O rastreamento da rota não respondeu desta vez.</p>'); return; }
        painel('rota', 'Rota até você', 'O caminho dos pacotes do servidor da Audicom até a sua conexão, salto a salto.',
            `<div class="tabela-wrap"><table class="tabela rota"><thead><tr><th>Salto</th><th>Endereço</th><th class="n">Perda</th><th class="n">Tempo médio</th></tr></thead><tbody>
            ${d.map((h) => `<tr><td>${h.hop}</td><td>${esc(h.host || 'não responde')}</td><td class="n">${h.perda != null ? fmtPct(h.perda) + '%' : '–'}</td><td class="n">${h.media != null ? fmtMs(h.media) + ' ms' : '–'}</td></tr>`).join('')}
            </tbody></table></div><p class="diag-explica">Saltos que "não respondem" são normais: muitos roteadores não respondem a esse tipo de consulta e seguem passando o tráfego.</p>`);
    }
}

// atalho: espaço/enter no velocímetro parado inicia
document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && document.activeElement === document.body && !rodando && !ultimoResultado) iniciar();
});
