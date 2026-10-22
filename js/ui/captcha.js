// Captcha do cadastro. Com Cloudflare Turnstile configurado no servidor,
// mostra o widget deles; sem, mostra o desafio próprio ("Não sou um robô"),
// resolvido por prova de trabalho num worker. Nos dois casos a resposta é
// conferida pelo servidor no momento do cadastro.

import { ICON } from '../core/icons.js';

const TURNSTILE_JS = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

function carregarScript(src) {
    return new Promise((resolve, reject) => {
        if (window.turnstile) return resolve();
        const s = document.createElement('script');
        s.src = src;
        s.async = true;
        s.onload = () => resolve();
        s.onerror = () => reject(new Error('não foi possível carregar o captcha'));
        document.head.appendChild(s);
    });
}

/** Monta o captcha em `alvo`. Devolve { resposta(), reiniciar() }. */
export async function montarCaptcha(alvo, cfg) {
    if (cfg && cfg.provider === 'turnstile' && cfg.siteKey) return turnstile(alvo, cfg.siteKey);
    return provaDeTrabalho(alvo);
}

async function turnstile(alvo, siteKey) {
    let token = null;
    let id = null;
    await carregarScript(TURNSTILE_JS);
    id = window.turnstile.render(alvo, {
        sitekey: siteKey,
        action: 'signup',
        theme: 'dark',
        language: 'pt-br',
        size: 'flexible',
        callback: (t) => { token = t; alvo.dispatchEvent(new CustomEvent('captcha', { detail: true })); },
        'expired-callback': () => { token = null; },
        'error-callback': () => { token = null; },
    });
    return {
        resposta: () => token,
        reiniciar() { token = null; if (id != null) window.turnstile.reset(id); },
    };
}

function provaDeTrabalho(alvo) {
    let resposta = null;
    let worker = null;
    alvo.innerHTML = `<button type="button" class="captcha-pow" data-estado="novo" aria-describedby="captcha-texto">
        <span class="caixa">${ICON.check}</span>
        <span class="textos"><strong id="captcha-titulo">Não sou um robô</strong><small id="captcha-texto">Clique para confirmar. Leva alguns segundos.</small></span>
        <span class="selo-captcha">${ICON.shield}<span>verificação<br>Audicom</span></span>
        <span class="barra" aria-hidden="true"></span></button>`;
    const botao = alvo.querySelector('button');
    const titulo = alvo.querySelector('#captcha-titulo');
    const texto = alvo.querySelector('#captcha-texto');
    const barra = alvo.querySelector('.barra');

    function estado(e, t1, t2) {
        botao.dataset.estado = e;
        titulo.textContent = t1;
        texto.textContent = t2;
        botao.disabled = e === 'resolvendo' || e === 'ok';
        botao.setAttribute('aria-pressed', String(e === 'ok'));
    }

    async function resolver() {
        estado('resolvendo', 'Verificando…', 'Seu navegador está resolvendo um desafio.');
        barra.style.width = '4%';
        try {
            const res = await fetch('/api/captcha/challenge', { cache: 'no-store' });
            const d = await res.json();
            if (!res.ok) throw new Error(d.error || 'tente de novo');
            if (worker) worker.terminate();
            worker = new Worker('/js/engine/pow-worker.js');
            const numero = await new Promise((ok, falha) => {
                worker.onmessage = (ev) => {
                    if (ev.data.progresso != null) barra.style.width = Math.max(4, Math.round(ev.data.progresso * 100)) + '%';
                    if (ev.data.numero != null) ok(ev.data.numero);
                    if (ev.data.erro) falha(new Error(ev.data.erro));
                };
                worker.onerror = () => falha(new Error('o navegador não conseguiu resolver'));
                worker.postMessage({ salt: d.salt, challenge: d.challenge, maxnumber: d.maxnumber });
            });
            worker.terminate();
            worker = null;
            resposta = btoa(JSON.stringify({ algorithm: d.algorithm, challenge: d.challenge, salt: d.salt, signature: d.signature, number: numero }));
            barra.style.width = '100%';
            setTimeout(() => { barra.style.width = '0'; }, 400);
            estado('ok', 'Verificado', 'Pode continuar o cadastro.');
            alvo.dispatchEvent(new CustomEvent('captcha', { detail: true }));
            // o desafio vale 10 minutos
            setTimeout(() => { if (resposta) reiniciar('A verificação expirou. Clique para confirmar de novo.'); }, 9 * 60_000);
        } catch (e) {
            barra.style.width = '0';
            estado('novo', 'Não sou um robô', `Não deu certo (${e.message}). Clique para tentar de novo.`);
        }
    }

    function reiniciar(msg) {
        resposta = null;
        estado('novo', 'Não sou um robô', msg || 'Clique para confirmar. Leva alguns segundos.');
    }

    botao.addEventListener('click', resolver);
    return { resposta: () => resposta, reiniciar };
}
