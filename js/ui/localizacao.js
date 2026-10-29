// Localização do aparelho nos testes: pergunta com calma e lembra a escolha.
//
//  - Ativou e o navegador autorizou: fica ligada sempre (guardado no aparelho).
//  - "Agora não": volta a perguntar de vez em quando, sem insistir: só depois
//    de alguns dias e só em parte das visitas, nunca duas vezes seguidas.
//  - O navegador bloqueou: não pergunta mais (só a pessoa libera, nas
//    configurações do site no navegador).
//
// A localização precisa de HTTPS: em HTTP a chave fica desligada e nada é perguntado.

import { ICON } from '../core/icons.js';
import { storage, store, toast } from '../core/util.js';

const CHAVE = 'speedcjc.local';            // 'sim' | 'nao' | 'bloqueado'
const QUANDO = 'speedcjc.local-perguntado'; // última vez que perguntamos (ms)
const INTERVALO_MS = 4 * 24 * 3600_000;
const CHANCE = 0.35;

const disponivel = () => window.isSecureContext && 'geolocation' in navigator;

async function permissao() {
    try { return (await navigator.permissions.query({ name: 'geolocation' })).state; } catch { return null; }
}

/** Pede a posição uma vez (é o que faz o navegador mostrar o pedido de permissão). */
export function pedirPosicao({ alta = true, limite = 14000 } = {}) {
    return new Promise((resolve) => {
        const t = setTimeout(() => resolve({ ok: false, codigo: 3 }), limite + 1000);
        navigator.geolocation.getCurrentPosition(
            (p) => { clearTimeout(t); resolve({ ok: true, posicao: { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy } }); },
            (e) => { clearTimeout(t); resolve({ ok: false, codigo: e.code }); },
            { enableHighAccuracy: alta, timeout: limite, maximumAge: 120000 },
        );
    });
}

/**
 * Liga a chave "Registrar a localização" da página do teste a esta regra.
 * `ajuda` é o parágrafo de explicação abaixo da chave.
 */
export async function iniciarLocalizacao({ chave, rotulo, ajuda, ocupado = () => false }) {
    if (!disponivel()) {
        chave.checked = false;
        chave.disabled = true;
        if (rotulo) rotulo.style.opacity = '0.6';
        if (ajuda) ajuda.textContent = 'A localização do aparelho só funciona quando o site é aberto por HTTPS. O teste usa a cidade aproximada do seu IP.';
        return;
    }
    // quem já tinha ligado a chave antes desta versão continua com ela ligada
    if (storage(CHAVE, null) == null && storage('speedcjc.usar-local', false) === true) store(CHAVE, 'sim');

    const estadoNavegador = await permissao();
    if (estadoNavegador === 'denied') store(CHAVE, 'bloqueado');
    else if (storage(CHAVE, null) === 'bloqueado') store(CHAVE, null); // a pessoa liberou no navegador
    chave.checked = storage(CHAVE, null) === 'sim';

    const ativar = async () => {
        const r = await pedirPosicao({ alta: false, limite: 10000 });
        if (r.ok || r.codigo !== 1) {
            store(CHAVE, 'sim');
            chave.checked = true;
            toast('Localização ativada. Os próximos testes já saem com o local no seu histórico.', 'ok');
        } else {
            store(CHAVE, 'bloqueado');
            chave.checked = false;
            toast('O navegador não liberou a localização. Dá para liberar nas configurações do site, no cadeado da barra de endereço.', 'info');
        }
    };

    chave.addEventListener('change', async () => {
        if (chave.checked) {
            if (storage(CHAVE, null) === 'bloqueado' || (await permissao()) === 'denied') {
                chave.checked = false;
                toast('A localização está bloqueada no navegador. Libere nas configurações do site (cadeado da barra de endereço) e ligue de novo.', 'info');
                return;
            }
            await ativar();
        } else {
            store(CHAVE, 'nao');
            store(QUANDO, Date.now());
        }
    });

    // perguntar agora?
    const estado = storage(CHAVE, null);
    if (estado === 'sim' || estado === 'bloqueado') return;
    const ultima = Number(storage(QUANDO, 0)) || 0;
    const primeiraVez = estado == null;
    if (!primeiraVez && (Date.now() - ultima < INTERVALO_MS || Math.random() > CHANCE)) return;

    const mostrar = () => {
        if (ocupado() || document.getElementById('faixa-local')) return;
        store(QUANDO, Date.now());
        const faixa = document.createElement('section');
        faixa.id = 'faixa-local';
        faixa.className = 'faixa-local';
        faixa.setAttribute('aria-label', 'Localização nos testes');
        faixa.innerHTML = `<span class="faixa-local-icone" aria-hidden="true">${ICON.pin}</span>
            <div class="faixa-local-texto"><strong>Marcar seus testes no mapa?</strong>
            <p>Com a localização, cada teste fica com o bairro no seu histórico, e o provedor entende melhor a rede da sua região. Dá para desligar quando quiser.</p></div>
            <div class="faixa-local-acoes">
                <button type="button" class="botao botao-fantasma botao-pequeno" data-local="nao">Agora não</button>
                <button type="button" class="botao botao-primario botao-pequeno" data-local="sim">Ativar localização</button>
            </div>`;
        faixa.addEventListener('click', async (e) => {
            const b = e.target.closest('[data-local]');
            if (!b) return;
            faixa.remove();
            if (b.dataset.local === 'sim') await ativar();
            else store(CHAVE, 'nao');
        });
        document.body.appendChild(faixa);
    };
    // nunca junto com a faixa de cookies: espera ela sair
    const esperar = () => {
        if (!document.getElementById('faixa-cookies')) { setTimeout(mostrar, 900); return; }
        const obs = new MutationObserver(() => {
            if (!document.getElementById('faixa-cookies')) { obs.disconnect(); setTimeout(mostrar, 900); }
        });
        obs.observe(document.body, { childList: true });
    };
    setTimeout(esperar, 1200);
}
