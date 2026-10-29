import { MARCA } from '../core/marca.js';
import { api } from '../core/auth.js';
import { ICON } from '../core/icons.js';
import { iniciarPagina } from '../core/shell.js';
import {
    $, $$, baixarArquivo, comCarga, confirmar, esc, fmtData, fmtDataHora, fmtDiaCurto, fmtHora, fmtInt, fmtMbps, fmtMs,
    copiar, fmtNum, fmtPct, fmtRelativo, html, iniciais, raw, setHtml, sleep, telefoneBonito, toast,
} from '../core/util.js';
import { abrirDetalhe } from '../ui/detalhe.js';
import { barrasHorizontais, graficoColunas, graficoLinhas } from '../ui/graficos.js';

const sessao = await iniciarPagina({ pagina: 'admin', exigirLogin: true });
const cfg = sessao.cfg || {};
$('#carregando').hidden = true;

// ---------- acesso ----------
if (!sessao.me || !sessao.me.isAdmin) {
    const p = sessao.me && sessao.me.profile;
    const semConfirmar = p && p.role === 'admin' && sessao.me.mail && !sessao.user.emailVerified;
    $('#negado-icone').innerHTML = semConfirmar ? ICON.mail : ICON.lock;
    $('#negado-titulo').textContent = semConfirmar ? 'Confirme seu e-mail para entrar' : 'Sua conta não tem acesso à administração';
    $('#negado-texto').textContent = semConfirmar
        ? `Enviamos um link de confirmação para ${sessao.user.email}. Depois de confirmar, saia e entre de novo.`
        : 'Peça a um administrador para liberar o seu acesso.';
    $('#negado').hidden = false;
    throw new Error('sem acesso');
}
$('#casca').hidden = false;
const eu = sessao.me.profile;

// ícones declarados no HTML
$$('[data-i]').forEach((s) => { s.outerHTML = ICON[s.dataset.i] || ''; });
$('#geral-atualizar').innerHTML = ICON.refresh + 'Atualizar';
$('#sistema-atualizar').innerHTML = ICON.refresh + 'Atualizar';
$('#testes-csv').innerHTML = ICON.fileDown + 'Baixar planilha';
$('#usuarios-adicionar').innerHTML = ICON.plus + 'Adicionar pessoa';

const NOME_MODO = { rapido: 'Rápido', completo: 'Completo' };
const NOME_PAGINA = { teste: 'Na página do teste', painel: 'No painel dele', admin: 'Na administração', conta: 'Na tela de entrar', como: 'Lendo como medimos' };
const lugar = (t) => (t.place && t.place.label) || '–';
const quem = (t) => (t.user ? html`<div class="quem"><span class="avatar" aria-hidden="true">${iniciais(t.user.name, t.user.email)}</span><div><strong>${t.user.name || t.user.email}</strong><span>${t.user.email || ''}</span></div></div>` : html`<span class="fraco">Sem conta</span>`);

// ---------- navegação ----------
const VISTAS = ['geral', 'vivo', 'testes', 'usuarios', 'admins', 'auditoria', 'zap', 'tutoriais', 'sistema'];
const carregadas = new Set();
function abrirVista(v, { historico = true } = {}) {
    if (!VISTAS.includes(v)) v = 'geral';
    for (const x of VISTAS) $('#v-' + x).hidden = x !== v;
    $$('#admin-nav button').forEach((b) => { if (b.dataset.v === v) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
    if (historico && location.hash !== '#' + v) history.replaceState(null, '', '#' + v);
    if (!carregadas.has(v)) { carregadas.add(v); CARREGAR[v] && CARREGAR[v](); }
    if (v === 'geral' && mapa) setTimeout(() => mapa.mapa.invalidateSize(), 50);
}
$$('#admin-nav button').forEach((b) => b.addEventListener('click', () => abrirVista(b.dataset.v)));
$$('[data-ir]').forEach((b) => b.addEventListener('click', () => abrirVista(b.dataset.ir)));
window.addEventListener('hashchange', () => abrirVista(location.hash.slice(1), { historico: false }));

function erroEm(alvo, e) {
    setHtml(alvo, html`<div class="aviso ruim">${raw(ICON.alert)}<div>${e.message}</div></div>`);
}

// ---------- visão geral ----------
let mapa = null;
let ultimoLive = null;
async function carregarGeral(fresco = false) {
    try {
        const d = await api('/api/admin/overview' + (fresco ? '?fresh=1' : ''));
        desenharGeral(d);
    } catch (e) { erroEm($('#geral-avisos'), e); }
    carregarMapa();
    api('/api/admin/system').then(avisosSistema).catch(() => {});
}
$('#geral-atualizar').addEventListener('click', (e) => comCarga(e.currentTarget, () => carregarGeral(true)));

function avisosSistema(s) {
    const avisos = [];
    if (s.mail && s.mail.enabled && !/^ok|não verificado/.test(s.mail.estado)) avisos.push(`O envio de e-mail está com problema: ${s.mail.estado}. Confira o SMTP no arquivo server/.env.`);
    if (s.db && !s.db.backups) avisos.push('Ainda não há cópia de segurança do banco. A primeira sai alguns minutos depois que o servidor liga.');
    if (s.clock && !s.clock.synced) avisos.push('O servidor ainda não sincronizou a hora com o NTP.br.');
    setHtml($('#geral-avisos'), html`${avisos.map((a) => html`<div class="aviso atencao" style="margin-bottom:8px">${raw(ICON.alert)}<div>${a}</div></div>`)}`);
}

function desenharGeral(d) {
    const t = d.totals, per = d.period;
    $('#geral-atualizado').textContent = `Atualizado às ${fmtHora(d.generatedAt)}. Médias dos últimos 30 dias.`;
    setHtml($('#geral-indicadores'), html`
        <div class="indicador"><dt>Usuários</dt><dd><b>${fmtInt(t.users)}</b><span class="nota">${fmtInt(t.admins)} administrador${t.admins === 1 ? '' : 'es'}</span></dd></div>
        <div class="indicador vivo"><dt>Online agora</dt><dd><b id="geral-online">${fmtInt(d.live.online)}</b><span class="nota">com conta</span></dd></div>
        <div class="indicador"><dt>Testes em 24 h</dt><dd><b>${fmtInt(t.tests24h)}</b><span class="nota">${fmtInt(t.tests)} no total</span></dd></div>
        <div class="indicador"><dt>Testes em 7 dias</dt><dd><b>${fmtInt(t.tests7d)}</b><span class="nota">${per.newUsers ? `${fmtInt(per.newUsers)} cadastros em 30 dias` : 'sem cadastros em 30 dias'}</span></dd></div>
        <div class="indicador"><dt><i class="chave-serie" style="--c:var(--serie-download)"></i>Download</dt><dd><b>${fmtMbps(per.avgDownload)}</b><small>Mbps</small><span class="nota">média; upload ${fmtMbps(per.avgUpload)}</span></dd></div>
        <div class="indicador"><dt>Ping</dt><dd><b>${fmtMs(per.avgPing)}</b><small>ms</small><span class="nota">média${per.verifiedShare != null ? `; ${fmtInt(Math.round(per.verifiedShare * 100))}% conferidos` : ''}</span></dd></div>`);

    const dias = d.daily;
    graficoColunas($('#g-dia'), {
        itens: dias.map((x) => ({ x: x.date.slice(8, 10) + '/' + x.date.slice(5, 7), y: x.tests, d: x })),
        altura: 210, cor: 'var(--serie-volume)', formatoY: (y) => fmtInt(y),
        formatoDica: (i) => `<strong>${esc(i.x)}</strong>${fmtInt(i.d.tests)} testes<br>${fmtInt(i.d.testsUsers)} com conta, ${fmtInt(i.d.testsAnon)} sem conta${i.d.newUsers ? `<br>${fmtInt(i.d.newUsers)} cadastros` : ''}`,
    });
    graficoLinhas($('#g-media'), {
        series: [{ nome: 'Download médio', cor: 'var(--serie-download)', pontos: dias.map((x, i) => ({ x: i, y: x.avgDownload })), area: true }],
        altura: 200, marcadores: true,
        formatoY: (y) => `${fmtMbps(y)} Mbps`, formatoEixo: (y) => fmtNum(y, 0),
        formatoX: (i) => (dias[Math.round(i)] ? dias[Math.round(i)].date.slice(8, 10) + '/' + dias[Math.round(i)].date.slice(5, 7) : ''),
    });
    desenharAgora(d.live);
    barrasHorizontais($('#geral-isps'), d.topIsps.map((x) => ({ nome: x.name, valor: x.count })), { formato: fmtInt, cor: 'var(--serie-volume)' });
    if (!d.topIsps.length) $('#geral-isps').innerHTML = '<p class="suave">Sem testes no período.</p>';
    barrasHorizontais($('#geral-cidades'), d.topCities.map((x) => ({ nome: x.name, valor: x.count })), { formato: fmtInt, cor: 'var(--serie-volume)' });
    if (!d.topCities.length) $('#geral-cidades').innerHTML = '<p class="suave">Sem testes no período.</p>';

    const maxH = Math.max(1, ...d.hours);
    $('#geral-horas').innerHTML = d.hours.map((n, h) => `<div style="--a:${(0.06 + (n / maxH) * 0.94).toFixed(2)}" title="${h}h: ${n} teste${n === 1 ? '' : 's'}"><span class="sr-only">${h} horas: ${n} testes</span></div>`).join('');
    $('#geral-horas-rotulos').innerHTML = d.hours.map((_, h) => `<span>${h}h</span>`).join('');

    setHtml($('#geral-recentes'), html`${d.recent.map(linhaRecente)}`);
    ligarLinhas($('#geral-recentes'));
}

function linhaRecente(t, novo = false) {
    return html`<tr class="clicavel${novo ? ' novo' : ''}" data-id="${t.id}" tabindex="0"><td>${fmtDiaCurto(t.createdAt)}, ${fmtHora(t.createdAt)}</td><td>${quem(t)}</td>
        <td class="n">${fmtMbps(t.download)}</td><td class="n">${fmtMbps(t.upload)}</td><td class="n">${fmtMs(t.ping)}</td><td>${lugar(t)}</td><td class="fraco">${t.isp || '–'}</td></tr>`;
}

function desenharAgora(l) {
    ultimoLive = l;
    setHtml($('#geral-agora'), html`
        <dt>Testes medindo agora</dt><dd>${l.activeTests} de ${l.maxConcurrent}</dd>
        <dt>Na fila</dt><dd>${l.queued ? `${l.queued} pessoa${l.queued > 1 ? 's' : ''}` : 'ninguém'}</dd>
        <dt>Medindo perda de pacotes</dt><dd>${l.udpPeers}</dd>
        <dt>Pessoas online com conta</dt><dd>${l.online}</dd>`);
    const g = $('#geral-online');
    if (g) g.textContent = fmtInt(l.online);
    $('#n-online').textContent = l.online;
    desenharIndicadoresVivo();
}

async function carregarMapa() {
    try {
        const { points } = await api('/api/admin/map');
        if (!mapa) {
            const { criarMapa } = await import('../ui/mapa.js');
            mapa = criarMapa($('#mapa'), cfg, { zoom: 10 });
        }
        mapa.pontos(points, {
            popup: (p) => `<strong>${esc(fmtMbps(p.download))} Mbps</strong> de download<br>${esc(fmtMbps(p.upload))} de upload, ping ${esc(fmtMs(p.ping))} ms<br>${esc(p.user ? p.user.name || p.user.email : 'Sem conta')}<br>${esc(fmtDataHora(p.createdAt))}<br>${esc(p.place ? p.place.label : '')}<br><a href="#" data-teste="${esc(p.id)}">Ver detalhes</a>`,
        });
        $('#mapa').addEventListener('click', (e) => {
            const a = e.target.closest('[data-teste]');
            if (a) { e.preventDefault(); abrirTeste(a.dataset.teste); }
        });
        $('#mapa-texto').textContent = points.length ? `${points.length} dos testes mais recentes têm a localização do aparelho.` : 'Nenhum teste recente com a localização do aparelho.';
    } catch (e) { $('#mapa-texto').textContent = e.message; }
}

// ---------- detalhes ----------
function abrirTeste(id) {
    abrirDetalhe({
        carregar: () => api('/api/admin/tests/' + id), cfg, admin: true,
        aoExcluir: async (t) => {
            await api('/api/admin/tests/' + t.id, { method: 'DELETE' });
            $$(`tr[data-id="${t.id}"]`).forEach((tr) => tr.remove());
        },
        aoAbrirUsuario: (uid) => abrirUsuario(uid),
    });
}
function ligarLinhas(tbody) {
    tbody.querySelectorAll('tr.clicavel').forEach((tr) => {
        if (tr.dataset.ligada) return;
        tr.dataset.ligada = '1';
        const ir = () => (tr.dataset.uid ? abrirUsuario(tr.dataset.uid) : abrirTeste(tr.dataset.id));
        tr.addEventListener('click', ir);
        tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') ir(); });
    });
}

// ---------- ao vivo (Server-Sent Events com o token no cabeçalho) ----------
let online = [];
const feed = [];
function desenharIndicadoresVivo() {
    const l = ultimoLive || { activeTests: 0, maxConcurrent: 0, queued: 0 };
    const testando = online.filter((o) => o.state === 'testing').length;
    setHtml($('#vivo-indicadores'), html`
        <div class="indicador vivo"><dt>Online com conta</dt><dd><b>${online.length}</b></dd></div>
        <div class="indicador"><dt>Fazendo teste agora</dt><dd><b>${testando}</b><span class="nota">com conta</span></dd></div>
        <div class="indicador"><dt>Medições no servidor</dt><dd><b>${l.activeTests}</b><span class="nota">de ${l.maxConcurrent} simultâneas; ${l.queued} na fila</span></dd></div>
        <div class="indicador"><dt>Usaram a conta em 24 h</dt><dd><b>${l.logados24h ?? '–'}</b><span class="nota">pessoas com sessão ativa</span></dd></div>`);
}
function desenharOnline() {
    $('#n-online').textContent = online.length;
    const g = $('#geral-online');
    if (g) g.textContent = fmtInt(online.length);
    desenharIndicadoresVivo();
    if (!online.length) {
        $('#vivo-online').innerHTML = '<div class="vazio" style="grid-column:1/-1"><span>Ninguém conectado na conta agora.</span></div>';
        return;
    }
    setHtml($('#vivo-online'), html`${online.map((o) => html`<button type="button" class="online-cartao" data-uid="${o.uid}" style="text-align:left;color:inherit;cursor:pointer">
        <span class="avatar">${iniciais(o.name, o.email)}</span><strong>${o.name || o.email}</strong><span class="email">${o.email || ''}</span>
        <span class="meta">
            ${o.state === 'testing' ? raw('<span class="selo ok ponto vivo">Fazendo um teste</span>') : o.state === 'hidden' ? raw('<span class="selo">Aba em segundo plano</span>') : html`<span class="selo azul">${NOME_PAGINA[o.page] || 'No site'}</span>`}
            ${o.admin ? raw('<span class="selo">Administrador</span>') : ''}
            ${o.device ? html`<span class="selo">${o.device}</span>` : ''}
            ${o.city ? html`<span class="selo">${o.city}</span>` : ''}
            <span class="selo">${o.ip || ''}</span>
            <span class="selo">online ${fmtRelativo(o.since).replace('há ', 'há ')}</span>
        </span></button>`)}`);
    $$('#vivo-online [data-uid]').forEach((b) => b.addEventListener('click', () => abrirUsuario(b.dataset.uid)));
}
function noFeed(item) {
    feed.unshift(item);
    feed.length = Math.min(feed.length, 80);
    setHtml($('#vivo-feed'), feed.length ? html`${feed.map((f, i) => html`<li class="${i === 0 && f.novo ? 'novo' : ''}">
        <span class="icone ${f.tipo === 'signup' ? 'ok' : ''}">${raw(f.tipo === 'signup' ? ICON.user : ICON.gauge)}</span>
        <div><strong>${f.titulo}</strong><span>${f.texto}</span></div><time>${fmtHora(f.at)}</time></li>`)}` : html``);
    feed.forEach((f) => { f.novo = false; });
}

async function aoVivo() {
    for (;;) {
        try {
            const res = await fetch('/api/admin/stream', { credentials: 'same-origin', cache: 'no-store' });
            if (!res.ok || !res.body) throw new Error('canal ao vivo recusado');
            $('#vivo-estado').className = 'selo ok ponto vivo';
            $('#vivo-estado').textContent = 'Conectado';
            const leitor = res.body.pipeThrough(new TextDecoderStream()).getReader();
            let buf = '';
            for (;;) {
                const { value, done } = await leitor.read();
                if (done) break;
                buf += value;
                let i;
                while ((i = buf.indexOf('\n\n')) >= 0) {
                    const bloco = buf.slice(0, i);
                    buf = buf.slice(i + 2);
                    let tipo = 'message', dados = '';
                    for (const linha of bloco.split('\n')) {
                        if (linha.startsWith('event: ')) tipo = linha.slice(7);
                        else if (linha.startsWith('data: ')) dados += linha.slice(6);
                    }
                    if (dados) evento(tipo, JSON.parse(dados));
                }
            }
        } catch { /* reconecta abaixo */ }
        $('#vivo-estado').className = 'selo atencao ponto';
        $('#vivo-estado').textContent = 'Reconectando…';
        await sleep(4000);
    }
}

function evento(tipo, d) {
    if (tipo === 'presence') { online = d.items || []; desenharOnline(); }
    if (tipo === 'live') desenharAgora({ ...(ultimoLive || {}), ...d });
    if (tipo === 'test') {
        const tb = $('#geral-recentes');
        if (tb) {
            tb.insertAdjacentHTML('afterbegin', String(linhaRecente(d, true)));
            while (tb.children.length > 15) tb.lastElementChild.remove();
            ligarLinhas(tb);
        }
        noFeed({ tipo: 'test', at: d.createdAt, novo: true, titulo: `${fmtMbps(d.download)} Mbps de download, ${fmtMbps(d.upload)} de upload`, texto: [d.user ? d.user.name || d.user.email : 'Sem conta', d.place && d.place.label, d.isp].filter(Boolean).join(', ') });
    }
    if (tipo === 'signup') noFeed({ tipo: 'signup', at: d.at, novo: true, titulo: 'Nova conta criada', texto: `${d.name} (${d.email})` });
}

// a situação do servidor (fila, medições) chega pelo canal; reforço a cada 20 s
setInterval(() => { api('/api/admin/online').then((r) => { online = r.items; desenharOnline(); desenharAgora({ ...(ultimoLive || {}), ...r.live }); }).catch(() => {}); }, 20_000);

// ---------- testes ----------
let testesProximo = null;
function filtrosTestes() {
    const q = new URLSearchParams();
    const v = (id) => $(id).value.trim();
    if (v('#f-q')) q.set('q', v('#f-q'));
    if (v('#f-modo')) q.set('mode', v('#f-modo'));
    if (v('#f-quem')) q.set('uid', v('#f-quem'));
    if (v('#f-origem')) q.set('origem', v('#f-origem'));
    // datas no fuso de Brasília
    if (v('#f-de')) q.set('from', String(Date.parse(v('#f-de') + 'T00:00:00-03:00')));
    if (v('#f-ate')) q.set('to', String(Date.parse(v('#f-ate') + 'T23:59:59-03:00')));
    return q;
}
async function carregarTestes(mais = false) {
    const q = filtrosTestes();
    q.set('limit', '50');
    if (mais && testesProximo) q.set('after', testesProximo);
    const tb = $('#testes-linhas');
    if (!mais) tb.innerHTML = '<tr><td colspan="9"><div class="esqueleto" style="height:120px"></div></td></tr>';
    try {
        const r = await api('/api/admin/tests?' + q);
        testesProximo = r.next;
        const linhas = html`${r.items.map((t) => html`<tr class="clicavel" data-id="${t.id}" tabindex="0">
            <td>${fmtDataHora(t.createdAt)}<br><span class="fraco">${t.protocol} ${NOME_MODO[t.mode] ? '(' + NOME_MODO[t.mode] + ')' : ''}</span>${t.origem === 'tecnico' ? raw(' <span class="selo origem-tecnico">Técnico</span>') : ''}</td><td>${quem(t)}${t.atendimento && t.atendimento.cliente ? html`<br><span class="fraco">Cliente: ${t.atendimento.cliente}</span>` : ''}</td>
            <td class="n">${fmtMbps(t.download)}</td><td class="n">${fmtMbps(t.upload)}</td><td class="n">${fmtMs(t.ping)}</td><td class="n">${t.loss != null ? fmtPct(t.loss) + '%' : '–'}</td>
            <td>${lugar(t)}</td><td class="fraco">${t.isp || '–'}</td>
            <td>${t.verified ? raw('<span class="selo ok">Sim</span>') : raw('<span class="selo atencao">Não</span>')}</td></tr>`)}`;
        if (mais) tb.insertAdjacentHTML('beforeend', String(linhas)); else setHtml(tb, linhas);
        if (!mais && !r.items.length) tb.innerHTML = '<tr><td colspan="9"><div class="vazio"><span>Nenhum teste encontrado com esses filtros.</span></div></td></tr>';
        ligarLinhas(tb);
        $('#testes-mais').hidden = !testesProximo;
        const mu = r.matchedUsers;
        if (mu && mu.length) {
            setHtml($('#testes-usuarios'), html`<div class="aviso">${raw(ICON.users)}<div>Mostrando os testes de <strong>${mu[0].name}</strong> (${mu[0].email}).${mu.length > 1 ? html` Outras contas encontradas: ${mu.slice(1).map((u) => html`<button type="button" class="link-botao" data-uid-filtro="${u.uid}" style="background:none;border:0;color:var(--azul-claro);text-decoration:underline;cursor:pointer">${u.name}</button> `)}` : ''}</div></div>`);
            $$('[data-uid-filtro]').forEach((b) => b.addEventListener('click', async () => {
                const q2 = filtrosTestes(); q2.delete('q'); q2.set('uid', b.dataset.uidFiltro); q2.set('limit', '50');
                const r2 = await api('/api/admin/tests?' + q2);
                testesProximo = null;
                setHtml(tb, html`${r2.items.map((t) => linhaRecente(t))}`);
                ligarLinhas(tb);
            }));
        } else $('#testes-usuarios').innerHTML = '';
    } catch (e) {
        tb.innerHTML = `<tr><td colspan="9"><div class="aviso ruim">${ICON.alert}<div>${esc(e.message)}</div></div></td></tr>`;
    }
}
$('#testes-filtros').addEventListener('submit', (e) => { e.preventDefault(); carregarTestes(); });
$('#testes-mais button').addEventListener('click', (e) => comCarga(e.currentTarget, () => carregarTestes(true)));
$('#testes-csv').addEventListener('click', (e) => comCarga(e.currentTarget, async () => {
    try {
        const q = filtrosTestes();
        q.delete('q');
        const res = await api('/api/admin/tests.csv?' + q, { bruto: true });
        baixarArquivo(`testes-${new Date().toISOString().slice(0, 10)}.csv`, await res.blob());
    } catch (err) { toast(err.message, 'ruim'); }
}));

// ---------- usuários ----------
let usuariosProximo = null;
// um selo só por pessoa: o acesso mais alto (administrador já usa o /tecnico)
const papel = (u) => raw(u.owner || u.isOwnerEmail ? '<span class="selo azul papel">Dono</span>'
    : u.role === 'admin' ? '<span class="selo azul papel">Administrador</span>'
    : u.tecnico ? '<span class="selo origem-tecnico papel">Técnico</span>'
    : '<span class="selo papel">Usuário</span>');
const situacao = (u) => raw((u.disabled ? '<span class="selo ruim">Desativada</span>'
    : u.online ? '<span class="selo ok ponto vivo">Online</span>' : '<span class="selo ok">Ativa</span>')
    + (cfg.mail && !u.emailVerified && !u.disabled ? '<span class="nota-cel atencao">e-mail não confirmado</span>' : ''));
async function carregarUsuarios(mais = false) {
    const q = new URLSearchParams({ limit: '50' });
    if ($('#u-q').value.trim()) q.set('q', $('#u-q').value.trim());
    if ($('#u-papel').value) q.set('role', $('#u-papel').value);
    if (mais && usuariosProximo) q.set('after', usuariosProximo);
    const tb = $('#usuarios-linhas');
    if (!mais) tb.innerHTML = '<tr><td colspan="6"><div class="esqueleto" style="height:120px"></div></td></tr>';
    try {
        const r = await api('/api/admin/users?' + q);
        usuariosProximo = r.next;
        const linhas = html`${r.items.map((u) => html`<tr class="clicavel" data-uid="${u.uid}" tabindex="0">
            <td>${html`<div class="quem"><span class="avatar" aria-hidden="true">${iniciais(u.name, u.email)}</span><div><strong>${u.name}</strong><span>${u.email}</span></div></div>`}</td>
            <td class="selos">${papel(u)}</td><td class="n">${fmtInt(u.testsCount)}</td><td class="sem-quebra">${fmtData(u.createdAt)}</td>
            <td class="sem-quebra">${u.lastSeenAt || u.lastLoginAt ? fmtRelativo(Math.max(u.lastSeenAt || 0, u.lastLoginAt || 0)) : 'nunca'}</td><td class="selos">${situacao(u)}</td></tr>`)}`;
        if (mais) tb.insertAdjacentHTML('beforeend', String(linhas)); else setHtml(tb, linhas);
        if (!mais && !r.items.length) tb.innerHTML = '<tr><td colspan="6"><div class="vazio"><span>Nenhuma conta encontrada.</span></div></td></tr>';
        ligarLinhas(tb);
        $('#usuarios-mais').hidden = !usuariosProximo;
    } catch (e) {
        tb.innerHTML = `<tr><td colspan="6"><div class="aviso ruim">${ICON.alert}<div>${esc(e.message)}</div></div></td></tr>`;
    }
}
$('#usuarios-filtros').addEventListener('submit', (e) => { e.preventDefault(); carregarUsuarios(); });
$('#usuarios-mais button').addEventListener('click', (e) => comCarga(e.currentTarget, () => carregarUsuarios(true)));

async function abrirUsuario(uid) {
    let d = document.getElementById('gaveta-usuario');
    if (!d) {
        d = document.createElement('dialog');
        d.id = 'gaveta-usuario';
        d.className = 'gaveta';
        d.setAttribute('aria-labelledby', 'gu-titulo');
        d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
        document.body.appendChild(d);
    }
    d.innerHTML = `<div class="gaveta-topo"><h2 id="gu-titulo">Carregando…</h2><button type="button" class="botao botao-fantasma botao-icone" data-fechar aria-label="Fechar">${ICON.x}</button></div><div class="gaveta-corpo"><div class="esqueleto" style="height:240px"></div></div>`;
    d.querySelector('[data-fechar]').addEventListener('click', () => d.close());
    if (!d.open) d.showModal();
    let r;
    try { r = await api('/api/admin/users/' + encodeURIComponent(uid)); } catch (e) {
        d.querySelector('.gaveta-corpo').innerHTML = `<div class="aviso ruim">${ICON.alert}<div>${esc(e.message)}</div></div>`;
        d.querySelector('#gu-titulo').textContent = 'Conta indisponível';
        return;
    }
    const u = r.user;
    const souEu = u.uid === eu.uid;
    const dono = u.owner;
    d.querySelector('#gu-titulo').textContent = u.name;
    const acoes = [];
    if (dono) acoes.push(html`<p class="suave" style="font-size:var(--t-sm)">Conta de dono: só pode ser alterada pelo comando <code>npm run admin</code> no servidor.</p>`);
    else if (souEu) acoes.push(html`<p class="suave" style="font-size:var(--t-sm)">Esta é a sua conta. Outro administrador precisa fazer alterações nela.</p>`);
    else {
        acoes.push(raw(`<div class="linha-acao"><div><strong>${u.role === 'admin' ? 'Tirar acesso de administrador' : 'Tornar administrador'}</strong><p>${u.role === 'admin' ? 'A pessoa volta a ver só os próprios testes.' : 'Vê todos os testes e usuários e pode dar acesso a outras pessoas.'}${cfg.mail && !u.emailVerified && u.role !== 'admin' ? ' Só passa a valer depois que ela confirmar o e-mail.' : ''}</p></div>
            <button type="button" class="botao botao-secundario botao-pequeno" data-a="papel">${u.role === 'admin' ? 'Tirar acesso' : 'Tornar administrador'}</button></div>`));
        if (u.role !== 'admin') {
            acoes.push(raw(`<div class="linha-acao"><div><strong>${u.tecnico ? 'Tirar acesso técnico' : 'Dar acesso técnico'}</strong><p>${u.tecnico ? 'A pessoa deixa de usar o Speed Teste Técnico (/tecnico).' : 'Usa o Speed Teste Técnico (/tecnico), com todas as medidas, e vê os testes de todos os clientes. Não mexe em usuários nem acessos.'}</p></div>
            <button type="button" class="botao botao-secundario botao-pequeno" data-a="tecnico">${u.tecnico ? 'Tirar acesso' : 'Dar acesso técnico'}</button></div>`));
        }
        acoes.push(raw(`<div class="linha-acao"><div><strong>Link para nova senha</strong><p>Para quem esqueceu a senha. Você copia e manda pelo WhatsApp${cfg.mail ? ' (ou enviamos por e-mail)' : ''}. Vale 3 dias e funciona uma vez.</p></div>
            <button type="button" class="botao botao-secundario botao-pequeno" data-a="link">Gerar link</button></div>`));
        acoes.push(raw(`<div class="linha-acao"><div><strong>Encerrar sessões</strong><p>Desconecta a pessoa de todos os aparelhos.</p></div>
            <button type="button" class="botao botao-secundario botao-pequeno" data-a="sessoes">Encerrar</button></div>`));
        acoes.push(raw(`<div class="linha-acao"><div><strong>${u.disabled ? 'Reativar conta' : 'Desativar conta'}</strong><p>${u.disabled ? 'A pessoa volta a conseguir entrar.' : 'A pessoa não consegue mais entrar. Os testes continuam guardados.'}</p></div>
            <button type="button" class="botao ${u.disabled ? 'botao-secundario' : 'botao-perigo'} botao-pequeno" data-a="status">${u.disabled ? 'Reativar' : 'Desativar'}</button></div>`));
        acoes.push(raw(`<div class="linha-acao"><div><strong>Excluir conta</strong><p>Apaga a conta e os ${u.testsCount} testes dela. Não dá para desfazer.</p></div>
            <button type="button" class="botao botao-perigo botao-pequeno" data-a="excluir">Excluir</button></div>`));
    }
    setHtml(d.querySelector('.gaveta-corpo'), html`
        <div class="linha-flex"><span class="avatar grande">${iniciais(u.name, u.email)}</span>
            <div style="min-width:0"><strong style="display:block">${u.email}</strong><div class="linha-flex" style="gap:6px;margin-top:6px">${papel(u)} ${situacao(u)}</div></div></div>
        <div class="det-secao"><h3>Cadastro</h3><dl class="dados">
            <dt>Telefone</dt><dd>${u.phone ? telefoneBonito(u.phone) : '–'}</dd>
            <dt>Cidade</dt><dd>${u.city || '–'}</dd>
            <dt>Plano informado</dt><dd>${u.planMbps ? `${fmtInt(u.planMbps)} Mbps` : '–'}</dd>
            <dt>Conta criada</dt><dd>${fmtDataHora(u.createdAt)} ${u.createdVia === 'admin' ? '(por um administrador)' : u.createdVia === 'terminal' ? '(pelo terminal do servidor)' : '(pelo site, com captcha)'}</dd>
            <dt>Último login</dt><dd>${u.lastLoginAt ? fmtDataHora(u.lastLoginAt) : 'nunca'}</dd>
            <dt>Último acesso</dt><dd>${u.lastSeenAt ? fmtDataHora(u.lastSeenAt) : '–'}</dd>
            <dt>Último IP</dt><dd>${u.lastIp || '–'}${u.lastCity ? `, ${u.lastCity}` : ''}</dd>
            <dt>Senha trocada em</dt><dd>${u.passwordChangedAt ? fmtDataHora(u.passwordChangedAt) : '–'}</dd>
        </dl></div>
        <div class="det-secao"><h3>Conectado em (${r.sessions.length})</h3>
            ${r.sessions.length ? html`<ul class="lista-sessoes">${r.sessions.map((s) => html`<li>
                <span class="sessao-icone">${raw(/Celular|Tablet/.test(s.device || '') ? ICON.phoneDevice : ICON.monitor)}</span>
                <div><strong>${s.device || 'Aparelho desconhecido'}</strong><span>Último uso ${fmtRelativo(s.lastSeenAt)}${s.ip ? `, IP ${s.ip}` : ''}. Entrou em ${fmtDataHora(s.createdAt)}${s.persistente ? ', manter conectado' : ''}.</span></div><span></span></li>`)}</ul>`
                : html`<p class="suave" style="font-size:var(--t-sm)">Nenhuma sessão aberta agora.</p>`}
        </div>
        <div class="det-secao"><h3>Testes (${fmtInt(u.testsCount)})</h3>
            ${r.tests.items.length ? html`<ul class="lista-testes">${r.tests.items.slice(0, 12).map((t) => html`<li><button type="button" data-teste="${t.id}">
                <span class="quando">${fmtDataHora(t.createdAt)}</span><span class="vel">${fmtMbps(t.download)} <small>Mbps</small></span>
                <span class="onde">${lugar(t)}</span><span class="sub">${fmtMbps(t.upload)} up, ${fmtMs(t.ping)} ms</span></button></li>`)}</ul>` : html`<p class="suave" style="font-size:var(--t-sm)">Nenhum teste ainda.</p>`}
        </div>
        <div class="det-secao"><h3>Ações</h3>${acoes}</div>`);
    d.querySelectorAll('[data-teste]').forEach((b) => b.addEventListener('click', () => { d.close(); abrirTeste(b.dataset.teste); }));

    const acao = async (botao, fn, ok) => comCarga(botao, async () => {
        try { await fn(); toast(ok); carregadas.delete('usuarios'); carregadas.delete('admins'); abrirUsuario(uid); if (!$('#v-usuarios').hidden) carregarUsuarios(); if (!$('#v-admins').hidden) carregarAdmins(); } catch (e) { toast(e.message, 'ruim'); }
    });
    const b = (n) => d.querySelector(`[data-a="${n}"]`);
    if (b('papel')) b('papel').addEventListener('click', async (e) => {
        const tornar = u.role !== 'admin';
        if (!(await confirmar({ titulo: tornar ? `Tornar ${u.name} administrador?` : `Tirar o acesso de ${u.name}?`, texto: tornar ? 'A pessoa vai ver todos os testes e todos os usuários.' : 'A pessoa perde o acesso à administração na hora.', acao: tornar ? 'Tornar administrador' : 'Tirar acesso', perigo: !tornar }))) return;
        acao(e.currentTarget, () => api(`/api/admin/users/${encodeURIComponent(uid)}/role`, { method: 'POST', body: { role: tornar ? 'admin' : 'user' } }), tornar ? 'Acesso de administrador concedido.' : 'Acesso de administrador removido.');
    });
    if (b('tecnico')) b('tecnico').addEventListener('click', async (e) => {
        const dar = !u.tecnico;
        if (!(await confirmar({ titulo: dar ? `Dar acesso técnico a ${u.name}?` : `Tirar o acesso técnico de ${u.name}?`, texto: dar ? 'A pessoa vai usar o Speed Teste Técnico e ver os testes de todos os clientes.' : 'A pessoa perde o acesso ao /tecnico na hora.', acao: dar ? 'Dar acesso técnico' : 'Tirar acesso', perigo: !dar }))) return;
        acao(e.currentTarget, () => api(`/api/admin/users/${encodeURIComponent(uid)}/tecnico`, { method: 'POST', body: { tecnico: dar } }), dar ? 'Acesso técnico concedido.' : 'Acesso técnico removido.');
    });
    if (b('link')) b('link').addEventListener('click', (e) => comCarga(e.currentTarget, async () => {
        try {
            const r2 = await api(`/api/admin/users/${encodeURIComponent(uid)}/reset-link`, { method: 'POST', body: { enviar: false } });
            mostrarLink({ titulo: `Link para ${u.name} criar a senha`, link: r2.link, para: u, telefone: u.phone });
        } catch (err) { toast(err.message, 'ruim'); }
    }));
    if (b('sessoes')) b('sessoes').addEventListener('click', async (e) => {
        if (!(await confirmar({ titulo: 'Encerrar as sessões?', texto: `${u.name} vai precisar entrar de novo em todos os aparelhos.`, acao: 'Encerrar' }))) return;
        acao(e.currentTarget, () => api(`/api/admin/users/${encodeURIComponent(uid)}/revoke`, { method: 'POST' }), 'Sessões encerradas.');
    });
    if (b('status')) b('status').addEventListener('click', async (e) => {
        const desativar = !u.disabled;
        if (!(await confirmar({ titulo: desativar ? `Desativar a conta de ${u.name}?` : `Reativar a conta de ${u.name}?`, texto: desativar ? 'A pessoa é desconectada e não consegue mais entrar até ser reativada.' : '', acao: desativar ? 'Desativar' : 'Reativar', perigo: desativar }))) return;
        acao(e.currentTarget, () => api(`/api/admin/users/${encodeURIComponent(uid)}/status`, { method: 'POST', body: { disabled: desativar } }), desativar ? 'Conta desativada.' : 'Conta reativada.');
    });
    if (b('excluir')) b('excluir').addEventListener('click', async (e) => {
        if (!(await confirmar({ titulo: `Excluir a conta de ${u.name}?`, texto: `A conta ${u.email} e os ${u.testsCount} testes dela serão apagados para sempre.`, acao: 'Excluir para sempre', perigo: true }))) return;
        comCarga(e.currentTarget, async () => {
            try {
                await api(`/api/admin/users/${encodeURIComponent(uid)}`, { method: 'DELETE' });
                d.close();
                toast('Conta excluída.');
                carregarUsuarios();
            } catch (err) { toast(err.message, 'ruim'); }
        });
    });
}

// adicionar pessoa (conta nova ou já existente)
function dialogoAdicionar() {
    const d = document.createElement('dialog');
    d.className = 'modal';
    d.innerHTML = `<form class="modal-corpo" novalidate>
        <h2>Adicionar pessoa</h2>
        <p>Se o e-mail ainda não tem conta, criamos uma e geramos um link para a pessoa escolher a senha.</p>
        <div class="campo"><label for="ad-email">E-mail</label><input class="entrada" id="ad-email" type="email" required></div>
        <div class="campo"><label for="ad-nome">Nome</label><input class="entrada" id="ad-nome" maxlength="80"></div>
        <div class="campo"><label for="ad-papel">Papel</label><select class="entrada" id="ad-papel"><option value="user">Usuário</option><option value="admin">Administrador</option></select></div>
        <p class="erro-campo" role="alert" hidden></p>
        <div class="modal-acoes"><button type="button" class="botao botao-fantasma" data-cancelar>Cancelar</button><button type="submit" class="botao botao-primario">Adicionar</button></div></form>`;
    document.body.appendChild(d);
    d.querySelector('[data-cancelar]').addEventListener('click', () => d.close());
    d.addEventListener('close', () => d.remove());
    d.querySelector('form').addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const erro = d.querySelector('.erro-campo');
        const email = d.querySelector('#ad-email').value.trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { erro.textContent = 'Informe um e-mail válido.'; erro.hidden = false; return; }
        await comCarga(d.querySelector('button[type="submit"]'), async () => {
            try {
                await convidar(email, d.querySelector('#ad-nome').value.trim(), d.querySelector('#ad-papel').value);
                d.close();
                carregarUsuarios();
            } catch (e) { erro.textContent = e.message; erro.hidden = false; }
        });
    });
    d.showModal();
    d.querySelector('#ad-email').focus();
}
async function convidar(email, nome, role) {
    const r = await api('/api/admin/users/invite', { method: 'POST', body: { email, name: nome, role } });
    if (r.created) {
        mostrarLink({ titulo: 'Conta criada', link: r.link, para: r.user, enviado: r.emailSent });
    } else toast(role === 'admin' ? `${email} agora é administrador.` : 'Pessoa atualizada.');
    return r;
}

/** Mostra um link de "criar senha" para copiar ou mandar pelo WhatsApp. */
function mostrarLink({ titulo, link, para, enviado = false, telefone = null }) {
    const d = document.createElement('dialog');
    d.className = 'modal';
    const fone = telefone ? String(telefone).replace(/\D/g, '') : '';
    const texto = `Olá, ${para.name}! Para criar a sua senha no teste de velocidade ${MARCA}, abra este link (vale 3 dias e funciona uma vez): ${link}`;
    setHtml(d, html`<div class="modal-corpo">
        <h2>${titulo}</h2>
        <p>${enviado ? `Enviamos o link por e-mail para ${para.email}. Se preferir, mande também pelo WhatsApp.` : `Mande este link para ${para.name} (${para.email}). Ele vale 3 dias e só funciona uma vez.`}</p>
        <div class="link-gerado"><code>${link}</code></div>
        <div class="modal-acoes">
            <button type="button" class="botao botao-fantasma" data-fechar>Fechar</button>
            <a class="botao botao-secundario" target="_blank" rel="noopener" href="https://wa.me/${fone ? '55' + fone.replace(/^55/, '') : ''}?text=${encodeURIComponent(texto)}">${raw(ICON.whatsapp)}WhatsApp</a>
            <button type="button" class="botao botao-primario" data-copiar>${raw(ICON.copy)}Copiar link</button>
        </div></div>`);
    document.body.appendChild(d);
    d.querySelector('[data-fechar]').addEventListener('click', () => d.close());
    d.querySelector('[data-copiar]').addEventListener('click', async () => toast((await copiar(link)) ? 'Link copiado.' : 'Não foi possível copiar.'));
    d.addEventListener('close', () => d.remove());
    d.showModal();
}
$('#usuarios-adicionar').addEventListener('click', dialogoAdicionar);

// ---------- administradores ----------
async function carregarAdmins() {
    const tb = $('#admins-linhas');
    try {
        const [adm, tec] = await Promise.all([api('/api/admin/users?role=admin&limit=200'), api('/api/admin/users?role=tecnico&limit=200')]);
        const ordem = (u) => (u.owner ? 0 : u.role === 'admin' ? 1 : 2);
        const todos = [...adm.items, ...tec.items.filter((t) => !adm.items.some((a) => a.uid === t.uid))]
            .sort((a, b) => ordem(a) - ordem(b) || a.name.localeCompare(b.name, 'pt-BR'));
        setHtml(tb, html`${todos.map((u) => html`<tr class="clicavel" data-uid="${u.uid}" tabindex="0">
            <td>${html`<div class="quem"><span class="avatar" aria-hidden="true">${iniciais(u.name, u.email)}</span><div><strong>${u.name}</strong><span>${u.email}</span></div></div>`}</td>
            <td class="selos">${papel(u)}${u.disabled ? raw('<span class="nota-cel atencao">conta desativada</span>') : cfg.mail && !u.emailVerified && u.role === 'admin' ? raw('<span class="nota-cel atencao">falta confirmar o e-mail</span>') : ''}</td>
            <td class="sem-quebra">${u.lastSeenAt ? fmtRelativo(u.lastSeenAt) : 'nunca'}</td>
            <td class="sem-quebra">${u.uid === eu.uid ? raw('<span class="fraco">Você</span>') : ''}</td></tr>`)}`);
        if (!todos.length) tb.innerHTML = '<tr><td colspan="4"><span class="fraco">Nenhum administrador ou técnico além dos donos.</span></td></tr>';
        ligarLinhas(tb);
    } catch (e) { tb.innerHTML = `<tr><td colspan="4">${esc(e.message)}</td></tr>`; }
}
$('#admins-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = ev.currentTarget;
    const erro = f.querySelector('.erro-campo');
    const email = $('#a-email').value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { erro.textContent = 'Informe um e-mail válido.'; erro.hidden = false; return; }
    erro.hidden = true;
    if (!(await confirmar({ titulo: `Dar acesso de administrador a ${email}?`, texto: 'A pessoa vai ver todos os testes, todos os usuários e poderá dar acesso a outras pessoas.', acao: 'Dar acesso' }))) return;
    await comCarga(f.querySelector('button[type="submit"]'), async () => {
        try {
            await convidar(email, $('#a-nome').value.trim(), 'admin');
            f.reset();
            carregarAdmins();
        } catch (e) { erro.textContent = e.message; erro.hidden = false; }
    });
});

// ---------- auditoria ----------
let auditoriaProximo = null;
async function carregarAuditoria(mais = false) {
    const q = new URLSearchParams({ limit: '50' });
    if (mais && auditoriaProximo) q.set('after', auditoriaProximo);
    const tb = $('#auditoria-linhas');
    try {
        const r = await api('/api/admin/audit?' + q);
        auditoriaProximo = r.next;
        const linhas = html`${r.items.map((x) => html`<tr><td>${fmtDataHora(x.at)}</td><td>${x.actor ? x.actor.email : 'sistema'}</td>
            <td>${x.action}${x.detail ? html`<br><span class="fraco">${Object.entries(x.detail).map(([k, v]) => `${k}: ${v}`).join(', ')}</span>` : ''}</td>
            <td>${x.target ? x.target.email || x.target.uid : '–'}</td><td class="fraco">${x.ip || '–'}</td></tr>`)}`;
        if (mais) tb.insertAdjacentHTML('beforeend', String(linhas)); else setHtml(tb, linhas);
        if (!mais && !r.items.length) tb.innerHTML = '<tr><td colspan="5"><div class="vazio"><span>Nenhuma ação registrada ainda.</span></div></td></tr>';
        $('#auditoria-mais').hidden = !auditoriaProximo;
    } catch (e) { tb.innerHTML = `<tr><td colspan="5">${esc(e.message)}</td></tr>`; }
}
$('#auditoria-mais button').addEventListener('click', (e) => comCarga(e.currentTarget, () => carregarAuditoria(true)));

// ---------- sistema ----------
async function carregarSistema() {
    try {
        const s = await api('/api/admin/system');
        const ok = (cond, sim, nao) => raw(cond ? `<span class="selo ok">${esc(sim)}</span>` : `<span class="selo atencao">${esc(nao)}</span>`);
        const horas = Math.floor(s.uptimeS / 3600), min = Math.floor((s.uptimeS % 3600) / 60);
        setHtml($('#sistema-estado'), html`
            <div class="estado-item"><span>Banco de dados</span><strong>${ok(true, 'Funcionando', '')} ${s.db.sizeMB != null ? `${fmtNum(s.db.sizeMB, 1)} MB` : ''}</strong><span>${s.db.file}</span></div>
            <div class="estado-item"><span>Cópias de segurança</span><strong>${ok(s.db.backups > 0, `${s.db.backups} guardada${s.db.backups === 1 ? '' : 's'}`, 'Nenhuma ainda')}</strong><span>${s.db.lastBackup ? 'última: ' + s.db.lastBackup : 'uma por dia, em data/backups'}</span></div>
            <div class="estado-item"><span>E-mail (SMTP)</span><strong>${s.mail.enabled ? ok(s.mail.estado === 'ok', 'Funcionando', 'Com problema') : raw('<span class="selo">Desligado</span>')}</strong><span>${s.mail.enabled ? s.mail.estado : 'links de nova senha são gerados aqui no painel'}</span></div>
            <div class="estado-item"><span>Captcha do cadastro</span><strong>${raw(`<span class="selo ok">${s.captcha === 'turnstile' ? 'Cloudflare Turnstile' : 'Desafio próprio do servidor'}</span>`)}</strong><span>${s.captcha === 'turnstile' ? 'conferido junto da Cloudflare' : 'sem depender de serviço externo'}</span></div>
            <div class="estado-item"><span>Hora oficial (NTP.br)</span><strong>${ok(s.clock.synced, 'Sincronizada', 'Sem sincronizar')}</strong><span>${s.clock.systemClockErrorMs != null ? `relógio da máquina ${Math.abs(s.clock.systemClockErrorMs) < 1000 ? 'certo' : `${fmtNum(Math.abs(s.clock.systemClockErrorMs) / 1000, 1)} s ${s.clock.systemClockErrorMs > 0 ? 'atrasado' : 'adiantado'} (o teste usa a hora do NTP.br)`}` : ''}</span></div>
            <div class="estado-item"><span>Servidor</span><strong>No ar há ${horas} h ${min} min</strong><span>${s.memoryMB} MB de memória, Node ${s.node}</span></div>
            <div class="estado-item"><span>Testes já servidos desde que ligou</span><strong>${fmtInt(s.served)}</strong><span>${s.live.activeTests} medindo agora, máximo ${s.live.maxConcurrent} juntos</span></div>
            <div class="estado-item"><span>Painéis ao vivo abertos</span><strong>${s.liveClients}</strong><span>administradores com esta tela aberta</span></div>`);
        const c = s.settings;
        setHtml($('#sistema-config'), html`
            <dt>Endereço público</dt><dd>${c.publicUrl || 'não definido (PUBLIC_URL)'}</dd>
            <dt>Atrás de proxy (HTTPS)</dt><dd>${c.trustProxy ? 'sim' : 'não'}</dd>
            <dt>IP público anunciado</dt><dd>${c.publicIPv4 || '–'} (UDP ${c.udpPort})</dd>
            <dt>Teste IPv4</dt><dd>${c.ipv4Base || 'automático'}</dd>
            <dt>Teste IPv6</dt><dd>${c.ipv6Base || 'automático'}</dd>
            <dt>Testes simultâneos</dt><dd>${c.maxConcurrentTests}</dd>
            <dt>Testes sem conta guardados por</dt><dd>${c.anonRetentionDays} dias</dd>
            <dt>Endereço pelo GPS</dt><dd>${s.geocoder === 'nominatim' ? 'OpenStreetMap (Nominatim)' : 'desligado'}</dd>
            <dt>Sessão "manter conectado"</dt><dd>${c.sessionDays} dias</dd>
            <dt>Donos</dt><dd>${s.owners.join(', ') || 'nenhum (crie com npm run admin -- dono)'}</dd>`);
        const alvos = s.platforms.targets || {};
        setHtml($('#sistema-plataformas'), html`${Object.entries(alvos).map(([k, u]) => html`<dt>${k}</dt><dd style="font-size:var(--t-xs)">${u ? u : raw('<span class="selo atencao">fora do teste</span>')}</dd>`)}
            <dt>Conferido em</dt><dd>${s.platforms.checkedAt ? fmtDataHora(s.platforms.checkedAt) : 'ainda não'}</dd>`);
    } catch (e) { erroEm($('#sistema-estado'), e); }
}
$('#sistema-atualizar').addEventListener('click', (e) => comCarga(e.currentTarget, carregarSistema));

const CARREGAR = {
    geral: () => carregarGeral(),
    vivo: () => api('/api/admin/online').then((r) => { online = r.items; desenharOnline(); desenharAgora({ ...(ultimoLive || {}), ...r.live }); }).catch(() => desenharOnline()),
    testes: () => carregarTestes(),
    usuarios: () => carregarUsuarios(),
    admins: () => carregarAdmins(),
    auditoria: () => carregarAuditoria(),
    sistema: () => carregarSistema(),
    zap: () => import('../ui/zap-admin.js').then((m) => m.iniciarZapAdmin()),
};

// "Recarregar" em cada aba, para não precisar apertar F5 (Visão geral e Sistema já têm o "Atualizar")
for (const v of VISTAS) {
    const titulo = document.querySelector(`#v-${v} .admin-titulo`);
    if (!titulo || titulo.querySelector('[id$="-atualizar"]')) continue;
    const acoes = document.createElement('div');
    acoes.className = 'admin-titulo-acoes';
    [...titulo.children].slice(1).forEach((el) => acoes.appendChild(el));
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'botao botao-secundario botao-pequeno';
    b.innerHTML = ICON.refresh + 'Recarregar';
    b.addEventListener('click', () => comCarga(b, async () => { await CARREGAR[v](); toast('Lista atualizada.'); }));
    acoes.prepend(b);
    titulo.appendChild(acoes);
}

abrirVista(location.hash.slice(1) || 'geral', { historico: false });
if (!$('#vivo-feed').children.length) $('#vivo-feed').innerHTML = '<li style="display:block"><span>Nada ainda. Os próximos testes e cadastros aparecem aqui na hora.</span></li>';
aoVivo();
