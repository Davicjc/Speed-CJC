import { api, trocarSenha } from '../core/auth.js';
import { ICON } from '../core/icons.js';
import { faixaConfirmacao, iniciarPagina } from '../core/shell.js';
import {
    $, $$, baixarArquivo, comCarga, confirmar, esc, fmtData, fmtDataHora, fmtDataLonga, fmtDiaCurto, fmtHora, fmtInt,
    fmtMbps, fmtMs, fmtNum, fmtPct, fmtRelativo, html, median, primeiroNome, setHtml, storage, store, telefoneBonito, toast,
} from '../core/util.js';
import { abrirDetalhe } from '../ui/detalhe.js';
import { graficoColunas, graficoLinhas } from '../ui/graficos.js';

const sessao = await iniciarPagina({ pagina: 'painel', exigirLogin: true });
const cfg = sessao.cfg || {};
$('#carregando').hidden = true;
if (sessao.indisponivel || !sessao.me) {
    $('#indisponivel').hidden = false;
    throw new Error('painel indisponível');
}
$('#pagina').hidden = false;

let perfil = sessao.me.profile;
let testes = [];
let proximo = null;
let dias = storage('audicom.painel-periodo', 30);
let mapa = null;

faixaConfirmacao($('#faixa-confirmacao'), sessao.user, sessao.me);
$('#hoje').textContent = fmtDataLonga(Date.now()).replace(/^\w/, (c) => c.toUpperCase());
$('#saudacao').textContent = `Olá, ${primeiroNome(perfil.name) || 'tudo bem'}`;

// ---------- abas ----------
const ABAS = { visao: 't-visao', historico: 't-historico', conta: 't-conta' };
function abrirAba(nome, { foco = false } = {}) {
    for (const [k, id] of Object.entries(ABAS)) {
        const sel = k === nome;
        $('#' + id).setAttribute('aria-selected', String(sel));
        $('#' + id).tabIndex = sel ? 0 : -1;
        $('#s-' + k).hidden = !sel;
    }
    $('#periodos').hidden = nome === 'conta';
    if (foco) $('#' + ABAS[nome]).focus();
    const hash = nome === 'visao' ? '' : '#' + nome;
    if (location.hash !== hash) history.replaceState(null, '', location.pathname + hash);
}
for (const [k, id] of Object.entries(ABAS)) $('#' + id).addEventListener('click', () => abrirAba(k));
$('.abas').addEventListener('keydown', (e) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    const chaves = Object.keys(ABAS);
    const atual = chaves.findIndex((k) => $('#' + ABAS[k]).getAttribute('aria-selected') === 'true');
    abrirAba(chaves[(atual + (e.key === 'ArrowRight' ? 1 : chaves.length - 1)) % chaves.length], { foco: true });
});
window.addEventListener('hashchange', () => abrirAba(location.hash.slice(1) in ABAS ? location.hash.slice(1) : 'visao'));

// ---------- período ----------
function marcarPeriodo() { $$('#periodos button').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.dias) === dias))); }
$$('#periodos button').forEach((b) => b.addEventListener('click', () => {
    dias = Number(b.dataset.dias);
    store('audicom.painel-periodo', dias);
    marcarPeriodo();
    desenhar();
}));
marcarPeriodo();

const noPeriodo = () => (dias ? testes.filter((t) => t.createdAt >= Date.now() - dias * 86400_000) : testes);

// ---------- dados ----------
async function carregar(mais = false) {
    const q = new URLSearchParams({ limit: '500' });
    if (mais && proximo) q.set('after', proximo);
    const r = await api('/api/me/tests?' + q);
    testes = mais ? testes.concat(r.items) : r.items;
    proximo = r.next;
}

const NOME_MODO = { rapido: 'Rápido', completo: 'Completo' };
const lugar = (t) => (t.place && t.place.label) || 'Sem local';
const aparelho = (t) => (t.device ? [t.device.type, t.device.os].filter(Boolean).join(', ') : '–');

function abrir(id) {
    abrirDetalhe({
        carregar: () => api('/api/me/tests/' + id),
        cfg,
        plano: perfil && perfil.planMbps,
        aoExcluir: async (t) => {
            await api('/api/me/tests/' + t.id, { method: 'DELETE' });
            testes = testes.filter((x) => x.id !== t.id);
            desenhar();
        },
    });
}

// ---------- visão geral ----------
function desenhar() {
    const total = testes.length;
    const primeiro = total ? testes[testes.length - 1].createdAt : null;
    $('#resumo').textContent = total
        ? `${total === 1 ? '1 teste' : `${fmtInt(total)} testes`}${proximo ? ' ou mais' : ''} desde ${fmtData(primeiro)}.`
        : 'Você ainda não tem testes guardados.';

    if (!total) {
        $('#com-dados').hidden = true;
        $('#periodos').hidden = true;
        const v = $('#vazio');
        v.hidden = false;
        setHtml(v, html`<div class="painel vazio" style="padding:56px 24px">${{ __raw: ICON.gauge }}
            <strong>Seu histórico começa no primeiro teste</strong>
            <span>Cada teste que você fizer conectado aparece aqui, com gráfico, mapa e horário.</span>
            <a class="botao botao-primario" href="/">Fazer meu primeiro teste</a></div>`);
        desenharHistorico();
        return;
    }
    $('#vazio').hidden = true;
    $('#com-dados').hidden = false;

    const sel = noPeriodo();
    const lista = sel.length ? sel : [];
    const med = (k) => median(lista.map((t) => t[k]).filter((v) => v != null));
    const dl = med('download'), ul = med('upload'), pg = med('ping'), jt = med('jitter');
    const plano = perfil.planMbps;
    const nomePeriodo = dias ? `nos últimos ${dias} dias` : 'em todo o histórico';
    setHtml($('#indicadores'), html`
        <div class="indicador"><dt><i class="chave-serie" style="--c:var(--serie-download)"></i>Download típico</dt><dd><b>${fmtMbps(dl)}</b><small>Mbps</small></dd></div>
        <div class="indicador"><dt><i class="chave-serie" style="--c:var(--serie-upload)"></i>Upload típico</dt><dd><b>${fmtMbps(ul)}</b><small>Mbps</small></dd></div>
        <div class="indicador"><dt>Ping típico</dt><dd><b>${fmtMs(pg)}</b><small>ms</small><span class="nota">jitter de ${fmtMs(jt)} ms</span></dd></div>
        <div class="indicador"><dt>Testes</dt><dd><b>${fmtInt(lista.length)}</b><span class="nota">${nomePeriodo}</span></dd></div>
        <div class="indicador"><dt>Do seu plano</dt><dd>${plano && dl != null
            ? html`<b>${fmtInt(Math.round((dl / plano) * 100))}%</b><span class="nota">de ${fmtInt(plano)} Mbps, no típico</span>`
            : html`<b>–</b><span class="nota"><a href="#conta">Informe seu plano</a> para comparar</span>`}</dd></div>`);
    $('#indicadores').style.setProperty('--colunas', '5');

    // velocidade no tempo (mais antigo -> mais novo)
    const cron = [...lista].reverse();
    const fmtX = (x) => (dias && dias <= 7 ? fmtDiaCurto(x) + ' ' + fmtHora(x) : fmtDiaCurto(x));
    graficoLinhas($('#g-tempo'), {
        series: [
            { nome: 'Download', cor: 'var(--serie-download)', pontos: cron.map((t) => ({ x: t.createdAt, y: t.download })), area: true },
            { nome: 'Upload', cor: 'var(--serie-upload)', pontos: cron.map((t) => ({ x: t.createdAt, y: t.upload })), tracejado: true },
        ],
        altura: 240, marcadores: cron.length <= 40,
        formatoY: (y) => `${fmtMbps(y)}`, formatoEixo: (y) => fmtNum(y, 0), formatoX: fmtX, formatoDica: (x) => fmtDataHora(x),
    });
    graficoLinhas($('#g-ping'), {
        series: [{ nome: 'Ping', cor: 'var(--serie-ping)', pontos: cron.map((t) => ({ x: t.createdAt, y: t.ping })) }],
        altura: 170, marcadores: cron.length <= 40,
        formatoY: (y) => `${fmtMs(y)} ms`, formatoEixo: (y) => fmtNum(y, 0), formatoX: fmtX, formatoDica: (x) => fmtDataHora(x),
    });

    // últimos
    setHtml($('#ultimos'), html`${testes.slice(0, 6).map((t) => html`<li><button type="button" data-id="${t.id}">
        <span class="quando">${fmtDiaCurto(t.createdAt)}, ${fmtHora(t.createdAt)}</span>
        <span class="vel">${fmtMbps(t.download)} <small>Mbps</small></span>
        <span class="onde">${lugar(t)}</span>
        <span class="sub">${fmtMbps(t.upload)} up, ${fmtMs(t.ping)} ms</span></button></li>`)}`);
    $$('#ultimos button').forEach((b) => b.addEventListener('click', () => abrir(b.dataset.id)));

    // melhor horário (média de download por hora do dia, horário de Brasília)
    const porHora = Array.from({ length: 24 }, () => []);
    const hora = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hourCycle: 'h23' });
    for (const t of lista) if (t.download != null) porHora[Number(hora.format(new Date(t.createdAt)))].push(t.download);
    const itens = porHora.map((a, h) => ({ x: `${h}h`, y: a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0, n: a.length, h }));
    const comDados = itens.filter((i) => i.n);
    if (comDados.length >= 2) {
        const melhor = comDados.reduce((a, b) => (b.y > a.y ? b : a));
        const pior = comDados.reduce((a, b) => (b.y < a.y ? b : a));
        $('#hora-texto').textContent = `Por volta das ${melhor.h}h a média foi ${fmtMbps(melhor.y)} Mbps; às ${pior.h}h, ${fmtMbps(pior.y)} Mbps.`;
    } else {
        $('#hora-texto').textContent = 'Teste em horários diferentes para descobrir quando a sua internet rende mais.';
    }
    graficoColunas($('#g-hora'), {
        itens, altura: 190, cor: 'var(--serie-download)',
        formatoY: (y) => fmtNum(y, 0), formatoEixo: (y) => fmtNum(y, 0),
        formatoDica: (i) => `<strong>${esc(i.x)}</strong>${i.n ? `${esc(fmtMbps(i.y))} Mbps de média em ${i.n} teste${i.n > 1 ? 's' : ''}` : 'Sem testes nesse horário'}`,
    });

    desenharMapa(lista);
    desenharHistorico();
}

async function desenharMapa(lista) {
    const pontos = lista.filter((t) => t.location).map((t) => ({ ...t, lat: t.location.lat, lng: t.location.lng }));
    const el = $('#mapa');
    if (!mapa) {
        const { criarMapa } = await import('../ui/mapa.js');
        mapa = criarMapa(el, cfg);
    }
    mapa.pontos(pontos, {
        popup: (p) => `<strong>${esc(fmtMbps(p.download))} Mbps</strong> de download<br>${esc(fmtMbps(p.upload))} de upload, ping ${esc(fmtMs(p.ping))} ms<br>${esc(fmtDataHora(p.createdAt))}<br>${esc(lugar(p))}`,
        aoClicar: null,
    });
    let aviso = el.querySelector('.mapa-vazio');
    if (!pontos.length) {
        if (!aviso) { aviso = document.createElement('div'); aviso.className = 'mapa-vazio'; el.appendChild(aviso); }
        aviso.innerHTML = 'Nenhum teste deste período tem a localização do aparelho.<br>Na página do teste, ligue "Registrar a localização do aparelho".';
        $('#mapa-texto').textContent = 'Testes com a localização do aparelho autorizada.';
    } else {
        if (aviso) aviso.remove();
        $('#mapa-texto').textContent = `${pontos.length} ${pontos.length === 1 ? 'teste' : 'testes'} com localização do aparelho.`;
    }
}

// ---------- histórico ----------
function desenharHistorico() {
    const modo = $('#h-modo').value;
    const lista = noPeriodo().filter((t) => !modo || t.mode === modo);
    $('#h-contagem').textContent = `${fmtInt(lista.length)} ${lista.length === 1 ? 'teste' : 'testes'} ${dias ? `nos últimos ${dias} dias` : 'no total'}`;
    if (!lista.length) {
        $('#h-linhas').innerHTML = '<tr><td colspan="9"><div class="vazio"><span>Nenhum teste neste período.</span></div></td></tr>';
    } else {
        setHtml($('#h-linhas'), html`${lista.map((t) => html`<tr class="clicavel" data-id="${t.id}" tabindex="0">
            <td>${fmtDataHora(t.createdAt)}</td><td>${NOME_MODO[t.mode] || t.mode}</td>
            <td class="n">${fmtMbps(t.download)}</td><td class="n">${fmtMbps(t.upload)}</td>
            <td class="n">${fmtMs(t.ping)}</td><td class="n">${fmtMs(t.jitter)}</td><td class="n">${t.loss != null ? fmtPct(t.loss) + '%' : '–'}</td>
            <td>${lugar(t)}</td><td class="fraco">${aparelho(t)}</td></tr>`)}`);
    }
    $$('#h-linhas tr.clicavel').forEach((tr) => {
        tr.addEventListener('click', () => abrir(tr.dataset.id));
        tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') abrir(tr.dataset.id); });
    });
    $('#h-mais').hidden = !proximo;
}
$('#h-modo').addEventListener('change', desenharHistorico);
$('#h-mais button').addEventListener('click', (e) => comCarga(e.currentTarget, async () => { await carregar(true); desenhar(); }));
$('#h-csv').innerHTML = ICON.fileDown + 'Baixar planilha';
$('#h-csv').addEventListener('click', () => {
    const modo = $('#h-modo').value;
    const lista = noPeriodo().filter((t) => !modo || t.mode === modo);
    const cab = ['protocolo', 'data_hora', 'tipo', 'download_mbps', 'upload_mbps', 'ping_ms', 'jitter_ms', 'perda_pct', 'local', 'aparelho'];
    const c = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const n = (v) => (v == null ? '' : String(Math.round(v * 100) / 100).replace('.', ','));
    const linhas = lista.map((t) => [t.protocol, fmtDataHora(t.createdAt), NOME_MODO[t.mode], n(t.download), n(t.upload), n(t.ping), n(t.jitter), n(t.loss), lugar(t), aparelho(t)].map(c).join(';'));
    baixarArquivo(`meus-testes-audicom-${new Date().toISOString().slice(0, 10)}.csv`, '﻿' + [cab.join(';')].concat(linhas).join('\r\n'), 'text/csv;charset=utf-8');
});

// ---------- meus dados ----------
function preencherDados() {
    $('#d-nome').value = perfil.name || '';
    $('#d-email').value = perfil.email || '';
    $('#s-usuario').value = perfil.email || ''; // gerenciador de senhas salva a nova senha na conta certa
    $('#d-email-ajuda').innerHTML = !sessao.me.mail ? 'Para trocar o e-mail, fale com o suporte da Audicom.'
        : sessao.user.emailVerified ? `${ICON.checkCircle.replace('<svg', '<svg width="14" height="14" style="display:inline;vertical-align:-2px;color:var(--ok)"')} E-mail confirmado. Para trocar o e-mail, fale com o suporte.`
        : 'E-mail ainda não confirmado. Veja o aviso no topo da página.';
    $('#d-tel').value = telefoneBonito(perfil.phone);
    $('#d-cidade').value = perfil.city || '';
    $('#d-plano').value = perfil.planMbps || '';
}
preencherDados();
$('#d-tel').addEventListener('input', (e) => {
    let d = e.target.value.replace(/\D/g, '').slice(0, 11);
    if (d.length > 6) d = `(${d.slice(0, 2)}) ${d.slice(2, d.length === 11 ? 7 : 6)}-${d.slice(d.length === 11 ? 7 : 6)}`;
    else if (d.length > 2) d = `(${d.slice(0, 2)}) ${d.slice(2)}`;
    e.target.value = d;
});
function erroDe(form, msg) { const p = form.querySelector('.erro-campo'); p.textContent = msg || ''; p.hidden = !msg; }

$('#form-dados').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = ev.currentTarget;
    const corpo = {
        name: $('#d-nome').value.trim(),
        phone: $('#d-tel').value.trim() || null,
        city: $('#d-cidade').value.trim() || null,
        planMbps: $('#d-plano').value ? Number($('#d-plano').value) : null,
    };
    if (corpo.name.length < 2) return erroDe(f, 'Informe seu nome.');
    erroDe(f, null);
    await comCarga(f.querySelector('button[type="submit"]'), async () => {
        try {
            const r = await api('/api/me', { method: 'PATCH', body: corpo });
            perfil = r.profile;
            preencherDados();
            $('#saudacao').textContent = `Olá, ${primeiroNome(perfil.name)}`;
            desenhar();
            toast('Dados salvos.');
        } catch (e) { erroDe(f, e.message); }
    });
});

$('#form-senha').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = ev.currentTarget;
    const atual = $('#s-atual').value, nova = $('#s-nova').value, nova2 = $('#s-nova2').value;
    if (!atual) return erroDe(f, 'Informe a senha atual.');
    if (nova.length < 8 || !/\p{L}/u.test(nova) || !/\d/.test(nova)) return erroDe(f, 'A nova senha precisa ter 8 caracteres ou mais, com letras e números.');
    if (nova !== nova2) return erroDe(f, 'As duas senhas novas não são iguais.');
    erroDe(f, null);
    await comCarga(f.querySelector('button[type="submit"]'), async () => {
        try {
            const r = await trocarSenha(atual, nova);
            f.reset();
            toast(r.sessoesEncerradas ? `Senha trocada. ${r.sessoesEncerradas} outro(s) aparelho(s) foram desconectados.` : 'Senha trocada.');
            carregarSessoes();
        } catch (e) { erroDe(f, e.message); }
    });
});

// ---------- sessões abertas ----------
async function carregarSessoes() {
    const ul = $('#sessoes');
    try {
        const { items } = await api('/api/me/sessions');
        setHtml(ul, html`${items.map((s) => html`<li>
            <span class="sessao-icone">${{ __raw: /Celular|Tablet/.test(s.device || '') ? ICON.phoneDevice : ICON.monitor }}</span>
            <div><strong>${s.device || 'Aparelho desconhecido'}</strong>${s.atual ? html` <span class="selo ok">Este aparelho</span>` : ''}
                <span>Último uso ${fmtRelativo(s.lastSeenAt)}${s.ip ? `, IP ${s.ip}` : ''}. Entrou em ${fmtDataHora(s.createdAt)}.</span></div>
            ${s.atual ? '' : html`<button type="button" class="botao botao-fantasma botao-pequeno" data-sessao="${s.id}">Encerrar</button>`}</li>`)}`);
        ul.querySelectorAll('[data-sessao]').forEach((b) => b.addEventListener('click', () => comCarga(b, async () => {
            try { await api('/api/me/sessions/' + b.dataset.sessao, { method: 'DELETE' }); toast('Sessão encerrada.'); carregarSessoes(); } catch (e) { toast(e.message, 'ruim'); }
        })));
    } catch (e) { ul.innerHTML = `<li><span class="suave">${esc(e.message)}</span></li>`; }
}
carregarSessoes();

$('#sair-todos').addEventListener('click', async (e) => {
    const ok = await confirmar({ titulo: 'Sair de todos os aparelhos?', texto: 'Você vai precisar entrar de novo em cada aparelho, inclusive neste.', acao: 'Encerrar todas' });
    if (!ok) return;
    await comCarga(e.currentTarget, async () => {
        try {
            await api('/api/me/logout-all', { method: 'POST' });
            location.href = '/entrar?saiu=1';
        } catch (err) { toast(err.message, 'ruim'); }
    });
});

$('#baixar-dados').innerHTML = ICON.fileDown + 'Baixar arquivo';
$('#baixar-dados').addEventListener('click', (e) => comCarga(e.currentTarget, async () => {
    try {
        const res = await api('/api/me/export', { bruto: true });
        baixarArquivo(`meus-dados-audicom-${new Date().toISOString().slice(0, 10)}.json`, await res.blob());
    } catch (err) { toast(err.message, 'ruim'); }
}));

$('#excluir-conta').addEventListener('click', async (e) => {
    const ok = await confirmar({
        titulo: 'Excluir sua conta?',
        texto: `A conta ${perfil.email} e todos os ${fmtInt(testes.length)} testes guardados serão apagados para sempre. Isso não pode ser desfeito.`,
        acao: 'Excluir para sempre', perigo: true,
    });
    if (!ok) return;
    await comCarga(e.currentTarget, async () => {
        try {
            await api('/api/me', { method: 'DELETE' });
            toast('Conta excluída.');
            setTimeout(() => { location.href = '/'; }, 800);
        } catch (err) { toast(err.message, 'ruim'); }
    });
});

// ---------- início ----------
try {
    await carregar();
} catch (e) {
    toast(e.message, 'ruim');
}
desenhar();
abrirAba(location.hash.slice(1) in ABAS ? location.hash.slice(1) : 'visao');
