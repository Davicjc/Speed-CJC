// Moldura comum das páginas: topo (marca, navegação, conta), rodapé,
// navegação do celular, fundo de constelação, sessão e "sinal de vida".

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
        return `<a class="marca" href="/tecnico" aria-label="Audicom Telecom, speed teste técnico — início">
        <img class="simbolo" src="/assets/simbolo.webp" alt="" width="27" height="25">
        <img class="palavra" src="/assets/logotipo.webp" alt="Audicom Telecom" width="86" height="25">
        <span class="produto">Speed teste<br><span class="selo-tecnico">Técnico</span></span></a>`;
    }
    return `<a class="marca" href="/" aria-label="Audicom Telecom, teste de velocidade — início">
        <img class="simbolo" src="/assets/simbolo.webp" alt="" width="27" height="25">
        <img class="palavra" src="/assets/logotipo.webp" alt="Audicom Telecom" width="86" height="25">
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
                <a role="menuitem" class="so-celular" href="/"${pagina === 'teste' ? ' aria-current="page"' : ''}>${ICON.gauge}Fazer um teste</a>
                <a role="menuitem" href="/painel"${pagina === 'painel' ? ' aria-current="page"' : ''}>${ICON.history}Meu painel</a>
                <a role="menuitem" href="/painel#conta">${ICON.user}Meus dados</a>
                <a role="menuitem" class="so-celular" href="/como-medimos"${pagina === 'como' ? ' aria-current="page"' : ''}>${ICON.info}Como medimos</a>
                ${tecnico ? `<a role="menuitem" href="/tecnico"${pagina === 'tecnico' ? ' aria-current="page"' : ''}>${ICON.sliders}Speed teste técnico</a>` : ''}
                ${admin ? `<a role="menuitem" href="/admin"${pagina === 'admin' ? ' aria-current="page"' : ''}>${ICON.shield}Administração</a>` : ''}
                <button role="menuitem" type="button" id="botao-sair">${ICON.logout}Sair</button>
            </div></div>`;
    } else {
        // sem conta: no computador, o botão Entrar; no celular, um menu no canto com tudo
        const entrar = `/entrar${pagina === 'teste' ? '' : '?next=' + encodeURIComponent(location.pathname)}`;
        conta = `${semContas ? '' : `<a class="botao botao-secundario botao-pequeno so-desktop" href="${entrar}">${ICON.login}Entrar</a>`}
            <div class="menu-wrap so-celular">
            <button class="conta-botao menu-botao" id="conta-botao" aria-haspopup="menu" aria-expanded="false" aria-controls="menu-conta" aria-label="Menu">${ICON.menu}</button>
            <div class="menu-conta" id="menu-conta" role="menu" hidden>
                <a role="menuitem" href="/"${pagina === 'teste' ? ' aria-current="page"' : ''}>${ICON.gauge}Fazer um teste</a>
                ${semContas ? '' : `<a role="menuitem" href="/entrar?next=%2Fpainel">${ICON.history}Meu histórico</a>`}
                <a role="menuitem" href="/como-medimos"${pagina === 'como' ? ' aria-current="page"' : ''}>${ICON.info}Como medimos</a>
                ${semContas ? '' : `<a role="menuitem" href="${entrar}">${ICON.login}Entrar ou criar conta</a>`}
            </div></div>`;
    }

    topo.innerHTML = `<div class="topo-dentro">${marcaHtml(pagina)}<nav class="nav" aria-label="Principal">${nav}</nav><div class="conta-area">${conta}</div></div>`;

    $('#nav-celular')?.remove(); // barra de baixo antiga (o menu do canto faz o papel dela)

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
        // sem conta o menu não tem "Sair"
        $('#botao-sair')?.addEventListener('click', async () => {
            await sair();
            location.href = '/';
        });
    }
}

function renderRodape(cfg) {
    const r = $('#rodape');
    if (!r) return;
    const sup = (cfg && cfg.support) || {};
    const wa = sup.whatsapp ? `https://wa.me/${encodeURIComponent(sup.whatsapp)}` : null;
    r.innerHTML = `<div class="rodape-dentro">
        <div>
            <div class="marca-rodape"><img src="/assets/logotipo.webp" alt="Audicom Telecom" width="96" height="28"></div>
            <p>Teste de velocidade da Audicom Telecom. Mede a sua conexão até o nosso servidor em ${esc((cfg && cfg.serverLocation) || 'Uberlândia, MG')}, com o mesmo método para todo mundo.</p>
            <p style="margin-top:10px">Av. Anselmo Alves dos Santos, 1542, Uberlândia, MG</p>
        </div>
        <div><strong>Ajuda</strong><ul>
            <li><a href="/como-medimos">Como medimos</a></li>
            ${wa ? `<li><a href="${wa}" target="_blank" rel="noopener">Suporte pelo WhatsApp</a></li>` : ''}
            ${sup.central ? `<li><a href="${esc(sup.central)}" target="_blank" rel="noopener">Central do cliente</a></li>` : ''}
            ${sup.phone ? `<li><a href="tel:${esc(String(sup.phone).replace(/\D/g, ''))}">${esc(sup.phone)}</a></li>` : ''}
        </ul></div>
        <div><strong>Audicom Telecom</strong><ul>
            <li><a href="${esc(sup.site || 'https://audicomtelecom.com.br')}" target="_blank" rel="noopener">Site da Audicom</a></li>
            <li><a href="/privacidade">Política de privacidade</a></li>
            <li><a href="/termos">Termos de uso</a></li>
            <li><a href="/tree">Mapa do site</a></li>
            <li>© ${new Date().getFullYear()} Audicom Telecom</li>
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
