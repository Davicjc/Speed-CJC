// Convite para instalar o teste como aplicativo (web app), no teste do cliente
// e no /tecnico. Cada aparelho tem o seu caminho:
// - Chrome, Edge, Samsung Internet e Opera (Android e computador): o navegador
//   avisa que dá para instalar (beforeinstallprompt) e "Instalar" abre a janela dele.
// - iPhone e iPad: a Apple não deixa o site instalar sozinho; mostramos o passo a
//   passo do navegador em uso (Safari, Chrome, Firefox, Edge). Dentro do
//   Instagram/Facebook/WhatsApp, pedimos para abrir no navegador.
// - Android sem o aviso (Firefox, Samsung, endereço sem HTTPS): passo a passo pelo menu.
// - Mac com Safari: Arquivo → Adicionar ao Dock.
// - Já aberto como app, ou navegador de computador sem suporte: não aparece.
// Pergunta uma vez; quem responde "Agora não" só vê de novo depois de 5 dias.

import { esc, evento, storage, store } from '../core/util.js';

const CHAVE = 'audicom.app';
const ESPERA_DIAS = 5;

const svg = (d) => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const IC = {
    compartilhar: svg('<path d="M12 3v12M8 7l4-4 4 4"/><path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1"/>'),
    mais: svg('<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M12 8v8M8 12h8"/>'),
    pontos: svg('<circle cx="12" cy="5" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="12" cy="19" r="1.4"/>'),
    pontosH: svg('<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>'),
    menu: svg('<path d="M4 7h16M4 12h16M4 17h16"/>'),
};

let aviso = null; // evento beforeinstallprompt guardado
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); aviso = e; });
window.addEventListener('appinstalled', () => { store(CHAVE, { r: 'instalado', em: Date.now() }); aviso = null; evento('app_instalado'); });
if ('serviceWorker' in navigator && window.isSecureContext) navigator.serviceWorker.register('/sw.js').catch(() => {});

const ua = navigator.userAgent;
const IOS = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
const ANDROID = /Android/.test(ua);
const DENTRO_DE_APP = /FBAN|FBAV|FB_IAB|Instagram|WhatsApp|Line\/|; wv\)|GSA\//.test(ua);
const MAC_SAFARI = !IOS && /Macintosh/.test(ua) && /Version\/\d+.*Safari/.test(ua) && !/Chrome|Chromium|Edg|OPR|Firefox/.test(ua);
const jaInstalado = () => matchMedia('(display-mode: standalone), (display-mode: fullscreen), (display-mode: minimal-ui)').matches || navigator.standalone === true;

/** Passo a passo manual do aparelho atual, ou null se ele não tem como instalar. */
function passos() {
    const tela = '<strong>Adicionar à Tela de Início</strong>';
    if (DENTRO_DE_APP) return { titulo: 'Abra no navegador primeiro', lista: [
        `Toque no menu ${IC.pontosH} ou ${IC.pontos} aqui no alto.`,
        `Escolha <strong>Abrir no ${IOS ? 'Safari' : 'navegador'}</strong>.`,
        'Lá, toque em instalar quando este convite aparecer.',
    ] };
    if (IOS) {
        if (/CriOS/.test(ua)) return { lista: [`Toque em Compartilhar ${IC.compartilhar} no alto, ao lado do endereço.`, `Escolha ${tela} ${IC.mais}.`, 'Toque em <strong>Adicionar</strong>.'] };
        if (/FxiOS/.test(ua)) return { lista: [`Toque no menu ${IC.menu} embaixo.`, `Toque em <strong>Compartilhar</strong> ${IC.compartilhar} e escolha ${tela}.`, 'Toque em <strong>Adicionar</strong>.'] };
        if (/EdgiOS/.test(ua)) return { lista: [`Toque no menu ${IC.pontosH} embaixo.`, `Toque em <strong>Compartilhar</strong> ${IC.compartilhar} e escolha ${tela}.`, 'Toque em <strong>Adicionar</strong>.'] };
        return { lista: [
            `Toque em Compartilhar ${IC.compartilhar} na barra do Safari (se não aparecer, abra o menu ${IC.pontosH} primeiro).`,
            `Role a lista e toque em ${tela} ${IC.mais}.`,
            'Toque em <strong>Adicionar</strong>. Pronto!',
        ] };
    }
    if (ANDROID) {
        if (/Firefox/.test(ua)) return { lista: [`Toque no menu ${IC.pontos} do Firefox.`, 'Toque em <strong>Instalar</strong> (ou <strong>Adicionar à tela inicial</strong>).', 'Confirme em <strong>Adicionar</strong>.'] };
        if (/SamsungBrowser/.test(ua)) return { lista: [`Toque no menu ${IC.menu} embaixo.`, 'Toque em <strong>Adicionar página a</strong> e escolha <strong>Tela inicial</strong>.', 'Confirme em <strong>Adicionar</strong>.'] };
        return { lista: [`Toque no menu ${IC.pontos} do navegador, no alto.`, 'Toque em <strong>Instalar app</strong> (ou <strong>Adicionar à tela inicial</strong>).', 'Confirme em <strong>Instalar</strong>.'] };
    }
    if (MAC_SAFARI) return { lista: ['No alto da tela, abra o menu <strong>Arquivo</strong>.', 'Clique em <strong>Adicionar ao Dock</strong>.', 'Clique em <strong>Adicionar</strong>. O teste vira um app no Dock.'] };
    return null; // computador sem o aviso do navegador (Firefox, por exemplo): não insiste
}

function podePerguntar() {
    if (jaInstalado()) return false;
    try { if (sessionStorage.getItem(CHAVE)) return false; } catch { /* modo privado */ }
    const s = storage(CHAVE);
    if (!s) return true;
    return s.r === 'depois' && Date.now() - s.em > ESPERA_DIAS * 86_400_000;
}

/**
 * Mostra o convite alguns segundos depois de abrir a página, quando não há
 * teste rodando nem outra janela aberta.
 */
export function convidarInstalar({ tecnico = false, ocupado = () => false } = {}) {
    if (!podePerguntar()) return;
    let tentativas = 0;
    const tentar = () => {
        if (!podePerguntar() || ++tentativas > 40) return;
        const livre = !ocupado() && !document.querySelector('dialog[open], .faixa-local:not([hidden])') && !document.hidden;
        if (!livre || (!aviso && !passos())) { setTimeout(tentar, 5000); return; }
        abrir(tecnico);
    };
    setTimeout(tentar, 6000);
}

function abrir(tecnico) {
    try { sessionStorage.setItem(CHAVE, '1'); } catch { /* modo privado */ }
    const manual = aviso && !IOS ? null : passos();
    const d = document.createElement('dialog');
    d.className = 'modal app-convite';
    d.setAttribute('aria-labelledby', 'app-convite-titulo');
    const nome = tecnico ? 'Speed Teste Técnico' : 'Teste Audicom';
    const frase = tecnico
        ? 'Abre direto no diagnóstico, em tela cheia, pronto para o próximo atendimento.'
        : 'Testa a sua internet com um toque, em tela cheia, como um aplicativo. Não ocupa espaço.';
    d.innerHTML = `<div class="app-convite-corpo">
        <div class="app-convite-icone" aria-hidden="true"><img src="/assets/icone-192.png" alt="" width="64" height="64"><svg class="app-brilho" viewBox="0 0 24 24" width="26" height="26"><path d="M12 2c.6 4.6 2.4 6.9 7 7.6-4.6.7-6.4 3-7 7.6-.6-4.6-2.4-6.9-7-7.6 4.6-.7 6.4-3 7-7.6Z"/><path d="M19.5 15c.3 2 1 2.8 3 3.1-2 .3-2.7 1.1-3 3.1-.3-2-1-2.8-3-3.1 2-.3 2.7-1.1 3-3.1Z"/></svg></div>
        <h2 id="app-convite-titulo">${manual && manual.titulo ? esc(manual.titulo) : `Leve o ${esc(nome)} na tela inicial?`}</h2>
        <p>${frase}</p>
        ${manual ? `<ol class="app-passos">${manual.lista.map((x) => `<li>${x}</li>`).join('')}</ol>` : ''}
        <div class="app-convite-acoes">
            ${manual ? '<button type="button" class="botao botao-primario" data-r="ok">Entendi</button>'
                : `<button type="button" class="botao botao-primario" data-r="instalar">${IC.mais}Instalar</button>`}
            <button type="button" class="botao botao-fantasma" data-r="depois">Agora não</button>
        </div></div>`;
    document.body.appendChild(d);
    const fechar = (r) => { store(CHAVE, { r, em: Date.now() }); d.close(); };
    d.addEventListener('close', () => d.remove());
    d.addEventListener('cancel', () => store(CHAVE, { r: 'depois', em: Date.now() }));
    d.addEventListener('click', async (e) => {
        if (e.target === d) return fechar('depois');
        const b = e.target.closest('[data-r]');
        if (!b) return;
        if (b.dataset.r !== 'instalar') return fechar(b.dataset.r === 'ok' ? 'viu-passos' : 'depois');
        b.disabled = true;
        try {
            aviso.prompt();
            const { outcome } = await aviso.userChoice;
            evento('app_convite', { resposta: outcome });
            fechar(outcome === 'accepted' ? 'instalado' : 'depois');
        } catch { fechar('depois'); }
        aviso = null;
    });
    d.showModal();
    evento('app_convite', { tipo: manual ? 'passos' : 'botao' });
}
