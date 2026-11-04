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
    fechar: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
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

/** Como instalar no aparelho atual, numa frase (sem o botão Instalar), ou null se ele não tem como. */
function passos() {
    const tela = '<strong>Adicionar à Tela de Início</strong>';
    if (DENTRO_DE_APP) return { titulo: 'Abra no navegador para instalar', texto: `Toque em ${IOS ? IC.pontosH : IC.pontos} e em <strong>Abrir no ${IOS ? 'Safari' : 'navegador'}</strong>.` };
    if (IOS) {
        if (/CriOS/.test(ua)) return { texto: `Toque em ${IC.compartilhar}, ao lado do endereço, e em ${tela}.` };
        if (/FxiOS/.test(ua)) return { texto: `Toque em ${IC.menu}, em <strong>Compartilhar</strong> e em ${tela}.` };
        if (/EdgiOS/.test(ua)) return { texto: `Toque em ${IC.pontosH}, em <strong>Compartilhar</strong> e em ${tela}.` };
        return { texto: `Toque em ${IC.compartilhar} e depois em ${tela}.` };
    }
    if (ANDROID) {
        if (/Firefox/.test(ua)) return { texto: `Toque em ${IC.pontos} e em <strong>Instalar</strong>.` };
        if (/SamsungBrowser/.test(ua)) return { texto: `Toque em ${IC.menu}, em <strong>Adicionar página a</strong> e em <strong>Tela inicial</strong>.` };
        return { texto: `Toque em ${IC.pontos} e em <strong>Instalar app</strong>.` };
    }
    if (MAC_SAFARI) return { texto: 'No menu <strong>Arquivo</strong>, clique em <strong>Adicionar ao Dock</strong>.' };
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
    const celular = IOS || ANDROID;
    const titulo = (manual && manual.titulo) || (tecnico ? 'Instale o teste técnico' : celular ? 'Instale o teste no celular' : 'Instale o teste no computador');
    const texto = manual ? manual.texto : tecnico ? 'Abre direto no diagnóstico, em tela cheia.' : 'Abre direto da tela inicial, em tela cheia.';
    const f = document.createElement('aside');
    f.className = 'app-faixa';
    f.setAttribute('role', 'region');
    f.setAttribute('aria-label', 'Instalar o app');
    f.innerHTML = `<img src="/assets/icone-192.png" alt="" width="44" height="44">
        <div class="app-faixa-texto"><strong>${esc(titulo)}</strong><span>${texto}</span></div>
        ${manual ? '' : '<button type="button" class="botao botao-primario botao-pequeno" data-r="instalar">Instalar</button>'}
        <button type="button" class="app-faixa-fechar" data-r="depois" aria-label="Agora não">${IC.fechar}</button>`;
    document.body.appendChild(f);
    const fechar = (r) => { store(CHAVE, { r, em: Date.now() }); f.remove(); document.removeEventListener('keydown', esc_); };
    const esc_ = (e) => { if (e.key === 'Escape') fechar('depois'); };
    document.addEventListener('keydown', esc_);
    f.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-r]');
        if (!b) return;
        if (b.dataset.r !== 'instalar') return fechar('depois');
        b.disabled = true;
        try {
            aviso.prompt();
            const { outcome } = await aviso.userChoice;
            evento('app_convite', { resposta: outcome });
            fechar(outcome === 'accepted' ? 'instalado' : 'depois');
        } catch { fechar('depois'); }
        aviso = null;
    });
    evento('app_convite', { tipo: manual ? 'passos' : 'botao' });
}
