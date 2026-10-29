// Moldura comum das páginas: topo (marca, navegação, conta), rodapé,
// navegação do celular, fundo de constelação, sessão e "sinal de vida".

import { EMPRESA, MARCA } from './marca.js';
import { aoMudarSessao, api, enviarConfirmacao, getConfig, sair, sessaoAtual } from './auth.js';
import { coletarAparelho } from './device.js';
import { ICON } from './icons.js';
import { $, esc, html, iniciais, primeiroNome, setHtml, toast } from './util.js';

const NAV = [
    { id: 'teste', href: '/', rotulo: 'Teste', icone: ICON.gauge },
    { id: 'painel', href: '/painel', rotulo: 'Meu painel', icone: ICON.history, login: true },
    { id: 'como', href: '/como-medimos', rotulo: 'Como medimos', icone: ICON.info },
    { id: 'tecnico', href: '/tecnico', rotulo: 'Técnico', icone: ICON.sliders, tecnico: true },
    { id: 'admin', href: '/admin', rotulo: 'Administração', icone: ICON.shield, admin: true },
];

function marcaHtml(pagina) {
    if (pagina === 'tecnico') {
        return `<a class="marca" href="/tecnico" aria-label="${esc(MARCA)}, teste técnico — início">
        <img class="simbolo" src="/assets/simbolo.webp" alt="" width="27" height="25">
        <img class="palavra" src="/assets/logotipo.webp" alt="${esc(MARCA)}" width="129" height="25">
        <span class="produto">Teste<br><span class="selo-tecnico">Técnico</span></span></a>`;
    }
    return `<a class="marca" href="/" aria-label="${esc(MARCA)}, teste de velocidade — início">
        <img class="simbolo" src="/assets/simbolo.webp" alt="" width="27" height="25">
        <img class="palavra" src="/assets/logotipo.webp" alt="${esc(MARCA)}" width="129" height="25">
        <span class="produto">Teste de<br>velocidade</span></a>`;
}

function renderTopo(pagina, sessao) {
    const topo = $('#topo');
    if (!topo) return;
    const logado = sessao && sessao.user;
    const admin = logado && sessao.me && sessao.me.isAdmin;
    const tecnico = logado && sessao.me && sessao.me.isTecnico;
    const semContas = sessao && sessao.contasLigadas === false;
    const itens = NAV.filter((n) => (!n.admin || admin) && (!n.tecnico || tecnico) && !(semContas && n.login));
    const nav = itens.map((n) => {
        const href = n.login && !logado ? '/entrar?next=' + encodeURIComponent(n.href) : n.href;
        return `<a href="${href}"${n.id === pagina ? ' aria-current="page"' : ''}>${esc(n.id === 'painel' && !logado ? 'Meu histórico' : n.rotulo)}</a>`;
    }).join('');

    let conta;
    if (sessao === 'carregando') {
        conta = '<span class="avatar esqueleto" aria-hidden="true"></span>';
    } else if (logado) {
        const p = (sessao.me && sessao.me.profile) || {};
        const nome = p.name || sessao.user.displayName || sessao.user.email;
        conta = `<div class="menu-wrap">
            <button class="conta-botao" id="conta-botao" aria-haspopup="menu" aria-expanded="false" aria-controls="menu-conta">
                <span class="avatar" aria-hidden="true">${esc(iniciais(nome, sessao.user.email))}</span>
                <span class="nome-curto">${esc(primeiroNome(nome) || 'Minha conta')}</span>
                ${ICON.chevronDown.replace('<svg', '<svg width="16" height="16"')}
            </button>
            <div class="menu-conta" id="menu-conta" role="menu" hidden>
                <div class="quem"><strong>${esc(nome)}</strong><span>${esc(sessao.user.email)}</span></div>
                <a role="menuitem" href="/painel">${ICON.history}Meu painel</a>
                <a role="menuitem" href="/painel#conta">${ICON.user}Meus dados</a>
                ${tecnico ? `<a role="menuitem" href="/tecnico">${ICON.sliders}Speed teste técnico</a>` : ''}
                ${admin ? `<a role="menuitem" href="/admin">${ICON.shield}Administração</a>` : ''}
                <button role="menuitem" type="button" id="botao-sair">${ICON.logout}Sair</button>
            </div></div>`;
    } else if (sessao && sessao.contasLigadas === false) {
        conta = '';
    } else {
        conta = `<a class="botao botao-secundario botao-pequeno" href="/entrar${pagina === 'teste' ? '' : '?next=' + encodeURIComponent(location.pathname)}">${ICON.login}Entrar</a>`;
    }

    topo.innerHTML = `<div class="topo-dentro">${marcaHtml(pagina)}<nav class="nav" aria-label="Principal">${nav}</nav><div class="conta-area">${conta}</div></div>`;

    // navegação do celular
    let cel = $('#nav-celular');
    if (!cel) {
        cel = document.createElement('nav');
        cel.id = 'nav-celular';
        cel.className = 'nav-celular';
        cel.setAttribute('aria-label', 'Navegação');
        document.body.appendChild(cel);
        document.body.classList.add('com-nav-celular');
    }
    const celItens = semContas ? [
        { id: 'teste', href: '/', rotulo: 'Teste', icone: ICON.gauge },
        { id: 'como', href: '/como-medimos', rotulo: 'Como medimos', icone: ICON.info },
    ] : [
        { id: 'teste', href: '/', rotulo: 'Teste', icone: ICON.gauge },
        { id: 'painel', href: logado ? '/painel' : '/entrar?next=%2Fpainel', rotulo: 'Histórico', icone: ICON.history },
        ...(tecnico ? [{ id: 'tecnico', href: '/tecnico', rotulo: 'Técnico', icone: ICON.sliders }] : []),
        ...(admin ? [{ id: 'admin', href: '/admin', rotulo: 'Admin', icone: ICON.shield }] : []),
        { id: 'conta', href: logado ? '/painel#conta' : '/entrar', rotulo: logado ? 'Conta' : 'Entrar', icone: ICON.user },
    ];
    cel.innerHTML = celItens.map((n) => `<a href="${n.href}"${n.id === pagina ? ' aria-current="page"' : ''}>${n.icone}<span>${n.rotulo}</span></a>`).join('');

    const botao = $('#conta-botao');
    if (botao) {
        const menu = $('#menu-conta');
        const fechar = () => { menu.hidden = true; botao.setAttribute('aria-expanded', 'false'); };
        botao.addEventListener('click', (e) => {
            e.stopPropagation();
            const abrir = menu.hidden;
            menu.hidden = !abrir;
            botao.setAttribute('aria-expanded', String(abrir));
            if (abrir) menu.querySelector('a,button').focus();
        });
        document.addEventListener('click', (e) => { if (!menu.contains(e.target)) fechar(); });
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !menu.hidden) { fechar(); botao.focus(); } });
        $('#botao-sair').addEventListener('click', async () => {
            await sair();
            location.href = '/';
        });
    }
}

function renderRodape(cfg) {
    const r = $('#rodape');
    if (!r) return;
    const sup = (cfg && cfg.support) || {};
    const empresa = (cfg && cfg.serverName) || EMPRESA;
    const wa = sup.whatsapp ? `https://wa.me/${encodeURIComponent(sup.whatsapp)}` : null;
    r.innerHTML = `<div class="rodape-dentro">
        <div>
            <div class="marca-rodape"><img src="/assets/logotipo.webp" alt="${esc(MARCA)}" width="144" height="28"></div>
            <p>Teste de velocidade ${esc(empresa)}. Mede a sua conexão até o nosso servidor${cfg && cfg.serverLocation ? ` em ${esc(cfg.serverLocation)}` : ''}, com o mesmo método para todo mundo.</p>
            ${sup.address ? `<p style="margin-top:10px">${esc(sup.address)}</p>` : ''}
        </div>
        <div><strong>Ajuda</strong><ul>
            <li><a href="/como-medimos">Como medimos</a></li>
            ${wa ? `<li><a href="${wa}" target="_blank" rel="noopener">Suporte pelo WhatsApp</a></li>` : ''}
            ${sup.central ? `<li><a href="${esc(sup.central)}" target="_blank" rel="noopener">Central do cliente</a></li>` : ''}
            ${sup.phone ? `<li><a href="tel:${esc(String(sup.phone).replace(/\D/g, ''))}">${esc(sup.phone)}</a></li>` : ''}
        </ul></div>
        <div><strong>${esc(empresa)}</strong><ul>
            ${sup.site ? `<li><a href="${esc(sup.site)}" target="_blank" rel="noopener">Site da empresa</a></li>` : ''}
            ${sup.email ? `<li><a href="mailto:${esc(sup.email)}">${esc(sup.email)}</a></li>` : ''}
            <li><a href="/privacidade">Política de privacidade</a></li>
            <li><a href="/termos">Termos de uso</a></li>
            <li><a href="/tree">Mapa do site</a></li>
            <li>© ${new Date().getFullYear()} ${esc(empresa)}</li>
        </ul></div></div>`;
}

// ---------- sinal de vida (quem está online, para o painel do admin) ----------
let estadoAtual = 'online';
let paginaAtual = null;
let presencaLigada = false;
async function batida() {
    try {
        const aparelho = await coletarAparelho();
        await api('/api/presence', { method: 'POST', body: { page: paginaAtual, state: document.hidden ? 'hidden' : estadoAtual, device: aparelho.label } });
    } catch { /* sem sessão: nada a fazer */ }
}
function ligarPresenca(pagina) {
    paginaAtual = pagina;
    if (presencaLigada) return;
    presencaLigada = true;
    batida();
    setInterval(batida, 30_000);
    document.addEventListener('visibilitychange', batida);
}

/** Faixa "confirme seu e-mail" (só quando o servidor manda e-mails). */
export function faixaConfirmacao(alvo, user, me) {
    if (!alvo || !user || user.emailVerified || !(me && me.mail)) return;
    alvo.innerHTML = '';
    const el = document.createElement('div');
    el.className = 'aviso atencao';
    el.setAttribute('role', 'status');
    setHtml(el, html`${{ __raw: ICON.mail }}<div><strong>Confirme seu e-mail.</strong> Enviamos um link para ${user.email}. Sem a confirmação, algumas funções ficam bloqueadas.</div>
        <div class="acoes"><button class="botao botao-secundario botao-pequeno" data-a="reenviar">Reenviar link</button>
        <button class="botao botao-fantasma botao-pequeno" data-a="ja">Já confirmei</button></div>`);
    el.querySelector('[data-a="reenviar"]').addEventListener('click', async (ev) => {
        ev.currentTarget.disabled = true;
        try { await enviarConfirmacao(); toast('Link enviado. Confira também a caixa de spam.'); } catch (e) { toast(e.message || 'Não foi possível enviar agora.', 'ruim'); }
    });
    el.querySelector('[data-a="ja"]').addEventListener('click', async () => {
        const atual = await sessaoAtual({ recarregar: true }).catch(() => null);
        if (atual && atual.emailVerified) { toast('E-mail confirmado.'); location.reload(); }
        else toast('Ainda não recebemos a confirmação. Abra o link do e-mail.', 'info');
    });
    alvo.appendChild(el);
}

/**
 * Monta a página. Resolve com { cfg, user, me, definirEstado }.
 * exigirLogin manda para /entrar quem não está logado.
 */
export async function iniciarPagina({ pagina, exigirLogin = false, fundo = true } = {}) {
    renderTopo(pagina, 'carregando');
    if (fundo) import('../ui/constelacao.js').then((m) => m.iniciarConstelacao()).catch(() => {});

    let cfg = null;
    try { cfg = await getConfig(); } catch { /* servidor fora */ }
    renderRodape(cfg);

    if (!cfg || !cfg.accounts) {
        renderTopo(pagina, { user: null, contasLigadas: !!(cfg && cfg.accounts) });
        if (exigirLogin) return { cfg, user: null, me: null, indisponivel: true, definirEstado() {} };
        return { cfg, user: null, me: null, definirEstado() {} };
    }

    const doMe = (m) => (m ? { uid: m.profile.uid, email: m.profile.email, name: m.profile.name, emailVerified: !!m.emailVerified } : null);
    let me = await sessaoAtual().catch(() => null);
    let user = doMe(me);
    renderTopo(pagina, { user, me });

    if (exigirLogin && !user) {
        location.replace('/entrar?next=' + encodeURIComponent(location.pathname + location.search + location.hash));
        return new Promise(() => {});
    }
    if (user) {
        ligarPresenca(pagina);
        import('./pendentes.js').then((m) => m.temPendentes() && m.reivindicarPendentes()).catch(() => {});
    }

    // entrou ou saiu em outra aba: o topo acompanha; a página que exige login
    // volta para o início
    aoMudarSessao(async (tipo) => {
        if (tipo === 'saiu' && exigirLogin) { location.href = '/'; return; }
        me = await sessaoAtual({ recarregar: true }).catch(() => null);
        user = doMe(me);
        renderTopo(pagina, { user, me });
        if (user) ligarPresenca(pagina);
    });

    return {
        cfg, user, me,
        definirEstado(estado) { estadoAtual = estado; if (user) batida(); },
        async atualizarMe() { me = await sessaoAtual({ recarregar: true }); renderTopo(pagina, { user: doMe(me), me }); return me; },
    };
}
