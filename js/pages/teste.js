import { coletarAparelho, conexaoDoNavegador, NOMES_CONEXAO } from '../core/device.js';
import { ICON } from '../core/icons.js';
import { guardarPendente } from '../core/pendentes.js';
import { iniciarPagina } from '../core/shell.js';
import { $, $$, copiar, esc, evento, fmtHora, fmtMbps, fmtMs, fmtNum, fmtPct, html, setHtml, store, toast } from '../core/util.js';
import * as M from '../engine/motor.js';
import { executarTeste } from '../engine/teste.js';
import { iniciarConstelacao } from '../ui/constelacao.js';
import { barrasHorizontais, graficoLinhas } from '../ui/graficos.js';
import { convidarInstalar } from '../ui/instalar.js';
import { iniciarLocalizacao, pedirPosicao } from '../ui/localizacao.js';
import { classificar, dicas, planoParaCliente, veredito } from '../ui/qualidade.js';
import { desenharDiag, textoCompleto, usosHtml } from '../ui/relatorio.js';
import { criarVelocimetro } from '../ui/velocimetro.js';

// A mesma página serve dois públicos: o cliente (/), com resultado honesto e
// sem alarme, e o técnico (/tecnico), com tudo, para técnicos e administradores.
const TOM = document.body.dataset.tom === 'tecnico' ? 'tecnico' : 'cliente';
const TECNICO = TOM === 'tecnico';

const sessao = await iniciarPagina({ pagina: TECNICO ? 'tecnico' : 'teste', exigirLogin: TECNICO });
const cfg = sessao.cfg || {};
if (TECNICO && !(sessao.me && sessao.me.isTecnico)) {
    setHtml($('#conteudo'), html`<section class="miolo sem-acesso">${{ __raw: ICON.lock }}
        <h1>Speed teste técnico</h1>
        <p>Esta área é só para técnicos e administradores da Audicom. Se você é técnico, peça o acesso a um administrador.</p>
        <a class="botao botao-primario" href="/">Ir para o teste de velocidade</a></section>`);
    await new Promise(() => {}); // para aqui: sem acesso, nada mais carrega
}
const tec = TECNICO ? await import('../ui/tecnico.js') : null;
const velo = criarVelocimetro($('#velo'));
const rede = iniciarConstelacao();

let modo = 'rapido';
let rodando = false;
let controle = null;
let ultimoResultado = null;
let quem = {}; // IP, operadora e cidade, como o servidor vê

// ---------- opções ----------
const AJUDA_MODO = TECNICO ? {
    rapido: 'Velocidade, latência, linha cheia e perda por UDP, em cerca de 30 segundos.',
    completo: 'Tudo: IPv4 e IPv6, NAT e CGNAT, MTU e MSS, rota salto a salto, aplicativos, streaming, IPTV, bancos e relógio. Cerca de 1 minuto.',
} : {
    rapido: 'Velocidade, latência e estabilidade, em cerca de 30 segundos.',
    completo: 'Inclui IPv4 e IPv6, o tempo até bancos, aplicativos, streaming e TV ao vivo e o relógio do aparelho. Cerca de 1 minuto.',
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
escolherModo(TECNICO ? 'completo' : 'rapido');

const chaveLocal = $('#usar-local');
iniciarLocalizacao({ chave: chaveLocal, rotulo: $('#local-chave'), ajuda: $('#local-ajuda'), ocupado: () => rodando });
convidarInstalar({ tecnico: TECNICO, ocupado: () => rodando });

if (!TECNICO && cfg.accounts && !sessao.user) $('#chamada').hidden = false;
if (tec) tec.iniciarListaTecnica({ cfg });
if (cfg.serverName) $('#c-servidor').textContent = `${cfg.serverName}, ${cfg.serverLocation || ''}`.replace(/, $/, '');

// ---------- quem é você (IP e operadora, como o servidor vê) ----------
M.quemSouEu().then((w) => {
    quem = w || {};
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
        const c = classificar(tipo, v, { tom: TOM });
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
async function pedirLocal() {
    const r = await pedirPosicao();
    if (r.ok) return r.posicao;
    if (r.codigo === 1) {
        toast('Localização não autorizada. O teste segue usando a cidade do seu IP.', 'info');
        chaveLocal.checked = false;
        store('audicom.local', 'bloqueado');
    }
    return null;
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
    const bz = $('#zap-enviar-teste');
    if (bz) bz.remove();
    $('#detalhes').hidden = true;
    ['protocolos', 'nat', 'mtu', 'servicos', 'streaming', 'iptv', 'bancos', 'relogio', 'rota', 'medidas'].forEach((k) => { const p = $(`#d-${k}`); if (p) { p.hidden = true; p.innerHTML = ''; } });
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
    evento('teste_iniciado', { modo });
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
        if (e.code === 'limite') {
            $('#status').textContent = 'Limite de testes sem conta atingido hoje.';
            avisoLimite(e.message);
            encerrar();
            return;
        }
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
    evento('teste_concluido', { modo, download_mbps: Math.round(r.download || 0), upload_mbps: Math.round(r.upload || 0), ping_ms: Math.round(r.ping || 0) });
    salvar(r, await geo);
}

/** Cota diária sem login: convida a entrar, sem tom de bronca. */
function avisoLimite(motivo) {
    const volta = encodeURIComponent(location.pathname);
    const d = document.createElement('dialog');
    d.className = 'modal';
    d.innerHTML = `<div class="modal-corpo">
        <h2>Continue testando com a sua conta</h2>
        <p>${esc(motivo)}</p>
        <p class="suave" style="font-size:var(--t-sm)">A conta é gratuita, leva menos de um minuto, e todos os testes vão para o seu histórico, com gráfico e mapa.</p>
        <div class="modal-acoes">
            <a class="botao botao-fantasma" href="/entrar?next=${volta}">Já tenho conta</a>
            <a class="botao botao-primario" href="/cadastro?next=${volta}">Criar conta grátis</a>
        </div></div>`;
    document.body.appendChild(d);
    d.addEventListener('close', () => d.remove());
    d.addEventListener('click', (ev) => { if (ev.target === d) d.close(); });
    d.showModal();
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
/** Plano para comparar: no técnico, o do atendimento; no cliente, o da conta. */
function planoAtual() {
    if (TECNICO) return tec.atendimento().plano;
    return (sessao.me && sessao.me.profile && sessao.me.profile.planMbps) || null;
}

/** Média das amostras de cada meio segundo: a curva de velocidade do teste. */
function balde(lista) {
    const m = new Map();
    for (const p of lista) { const a = m.get(p.x) || []; a.push(p.y); m.set(p.x, a); }
    return [...m.entries()].map(([x, ys]) => ({ x, y: Math.round((ys.reduce((s, y) => s + y, 0) / ys.length) * 10) / 10 })).sort((a, b) => a.x - b.x);
}

function mostrarResultado(r, amostras) {
    velo.modo('fim');
    velo.valor(r.download || 0);
    centro('Download', fmtMbps(r.download), 'Mbps');
    for (const t of ['download', 'upload', 'ping', 'jitter', 'bufferbloat']) leitura(t, r[t], { selo: true });
    leitura('perda', r.loss, { selo: true });
    const faltou = r.erros.map((x) => x.split(':')[0]).join(', ');
    $('#status').textContent = !r.erros.length ? 'Teste concluído.'
        : TECNICO ? `Parte do teste não foi medida: ${r.erros.join('; ')}.`
        : `Não deu para medir ${faltou} desta vez. Vale testar de novo em instantes.`;

    const v = veredito(r, { tom: TOM });
    $('#r-quando').textContent = `Hoje às ${fmtHora(Date.now())}`;
    $('#r-titulo').textContent = v.titulo;
    $('#r-texto').textContent = v.texto;

    const plano = planoAtual();
    // cliente: a comparação aparece quando o resultado chega perto do plano; técnico: sempre
    const pct = TECNICO ? (plano && r.download != null ? Math.round((r.download / plano) * 100) : null) : planoParaCliente(r.download, plano);
    if (pct != null) {
        setHtml($('#r-plano'), html`${TECNICO ? 'O cliente recebeu' : 'Você recebeu'} <strong>${pct}%</strong> do plano de ${plano} Mbps neste teste.`);
        $('#r-plano').hidden = false;
    } else $('#r-plano').hidden = true;

    $('#r-usos').innerHTML = usosHtml(r, { tom: TOM });
    const ds = dicas(r, { tipoConexao: conexaoDoNavegador().type, planoMbps: plano, tom: TOM });
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
    r.curva = { download: balde(amostras.download), upload: balde(amostras.upload) };
    graficoLinhas($('#curva'), {
        series: [
            { nome: 'Download', cor: 'var(--serie-download)', pontos: r.curva.download, area: true },
            { nome: 'Upload', cor: 'var(--serie-upload)', pontos: r.curva.upload, tracejado: true },
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
    setHtml($('#d-aparelho'), html`<div class="painel-cabeca"><div><h3>Seu aparelho</h3><p>O que o navegador informa. Um aparelho mais antigo também pode limitar o resultado.</p></div></div>
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
        curve: r.curva ? { download: r.curva.download.map((p) => [p.x, p.y]), upload: r.curva.upload.map((p) => [p.x, p.y]) } : null,
        origem: TOM,
        atendimento: TECNICO ? tec.atendimento() : null,
    };
    let res = null;
    const salvo = $('#r-salvo');
    try {
        res = await M.salvarResultado(payload);
    } catch (e) {
        salvo.className = 'salvo atencao';
        setHtml(salvo, html`${{ __raw: ICON.alert }}<span>Não foi possível guardar o resultado (${e.message}). O resultado acima continua valendo.</span>`);
        habilitarCompartilhar(null, r, null, aparelho);
        if (tec) tec.medidasDetalhadas($('#d-medidas'), comoRelatorio(r, null, aparelho), { erroAoGuardar: e.message });
        return;
    }

    if (res.upload != null && Math.abs(res.upload - (r.upload ?? res.upload)) > 0.01) {
        r.upload = res.upload; // o upload medido pelo servidor é o que vale
        leitura('upload', r.upload, { selo: true });
    }
    setHtml($('#r-quando'), html`Hoje às ${fmtHora(Date.now())}. Protocolo <span class="mono-copy">${res.protocol}</span>`);
    habilitarCompartilhar(location.origin + res.path, r, res, aparelho);
    if (tec) {
        tec.medidasDetalhadas($('#d-medidas'), comoRelatorio(r, res, aparelho), { res });
        tec.recarregarLista();
        const bz = document.createElement('button');
        bz.type = 'button';
        bz.className = 'botao botao-primario';
        bz.id = 'zap-enviar-teste';
        bz.innerHTML = ICON.whatsapp + 'Enviar para o Zap';
        bz.addEventListener('click', () => import('../ui/zap-envio.js').then((m) => m.abrirEnvioZap({ id: res.id, protocol: res.protocol, atendimento: tec.atendimento(), place: res.place })));
        $('#de-novo').after(bz);
    }

    if (TECNICO) {
        salvo.className = 'salvo ok';
        setHtml(salvo, html`${{ __raw: ICON.checkCircle }}<span>Teste técnico guardado (protocolo ${res.protocol})${res.place && res.place.label ? `, com local: ${res.place.label}` : ''}. Aparece na lista abaixo e na administração.</span>`);
    } else if (res.saved === 'account') {
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
    if (res.verified === false && TECNICO) {
        salvo.insertAdjacentHTML('beforeend', '<span class="suave" style="flex-basis:100%;font-size:var(--t-xs)">O servidor não conseguiu conferir todas as medidas deste teste; ele fica marcado como não conferido.</span>');
    }
}

/** O teste no formato do relatório (o mesmo que o painel recebe do servidor). */
function comoRelatorio(r, res, aparelho) {
    return {
        ...r,
        protocol: res && res.protocol,
        createdAt: Date.now(),
        verified: res ? res.verified : undefined,
        isp: quem.isp || null,
        ip: quem.ip || null,
        ipFamily: quem.family || null,
        asn: quem.asn || null,
        ipLocation: quem.city ? { city: quem.city, region: quem.region, country: quem.country } : null,
        place: (res && res.place) || (quem.city ? { label: [quem.city, quem.region].filter(Boolean).join(' - '), source: 'ip' } : null),
        device: aparelho || null,
        connection: conexaoDoNavegador(),
        server: cfg.serverName ? { name: cfg.serverName, location: cfg.serverLocation } : null,
        origem: TOM,
        atendimento: TECNICO ? tec.atendimento() : null,
    };
}

function habilitarCompartilhar(link, r, res, aparelho) {
    const texto = textoCompleto(comoRelatorio(r, res, aparelho), { link, plano: planoAtual(), empresa: cfg.serverName || 'Audicom Telecom', tom: TOM });
    const bc = $('#copiar');
    bc.innerHTML = ICON.copy + 'Copiar resultado';
    bc.hidden = false;
    bc.onclick = async () => {
        const ok = await copiar(texto);
        toast(ok ? 'Resultado completo copiado.' : 'Não foi possível copiar.', ok ? 'ok' : 'ruim');
        if (ok) evento('share', { method: 'copiar', content_type: 'resultado' });
    };
    const wa = $('#whatsapp');
    wa.innerHTML = ICON.whatsapp + 'Enviar no WhatsApp';
    wa.href = 'https://wa.me/?text=' + encodeURIComponent(texto);
    wa.onclick = () => evento('share', { method: 'whatsapp', content_type: 'resultado' });
    wa.hidden = false;
}

// ---------- diagnóstico (modo completo) ----------
function mostrarDiag(chave, d) {
    desenharDiag($(`#d-${chave}`), chave, d, { tom: TOM });
    $('#detalhes').hidden = false;
}

// atalho: espaço/enter no velocímetro parado inicia
document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && document.activeElement === document.body && !rodando && !ultimoResultado) iniciar();
});
