/**
 * Banner simples de consentimento (LGPD), compartilhado por todas as páginas.
 * Aceite fica salvo em localStorage — sem cookies, sem backend.
 */
(function () {
    'use strict';
    const KEY = 'audicom_consent_v1';
    try { if (localStorage.getItem(KEY) === 'accepted') return; } catch (e) { return; }

    const style = document.createElement('style');
    style.textContent = `
        #consentBanner {
            position: fixed; left: 0; right: 0; bottom: 0; z-index: 9999;
            background: linear-gradient(180deg, rgba(10,29,66,0.98), rgba(8,21,53,1));
            border-top: 1px solid rgba(0,36,156,0.4);
            padding: 16px 20px;
            display: flex; align-items: center; justify-content: center; gap: 16px; flex-wrap: wrap;
            font-family: 'Inter', sans-serif;
            animation: consentIn .4s ease-out;
        }
        @keyframes consentIn { from { transform: translateY(100%); } to { transform: translateY(0); } }
        #consentBanner p { color: #8F99A8; font-size: 0.82rem; max-width: 640px; margin: 0; line-height: 1.5; }
        #consentBanner a { color: #3B82F6; text-decoration: underline; }
        #consentBanner button {
            font-family: inherit; font-weight: 600; font-size: 0.82rem;
            padding: 10px 20px; border-radius: 8px; border: none; cursor: pointer;
            background: linear-gradient(135deg, #00249C 0%, #3B82F6 100%); color: #fff;
            white-space: nowrap;
        }
    `;
    document.head.appendChild(style);

    const banner = document.createElement('div');
    banner.id = 'consentBanner';
    const base = document.currentScript && document.currentScript.src.includes('/js/lib/')
        ? document.currentScript.src.split('/js/lib/')[0] : '.';
    banner.innerHTML = `
        <p>Usamos os dados deste teste apenas para diagnóstico da sua conexão, conforme a LGPD.
        <a href="${base}/como-funciona/index.html#privacidade">Saiba mais</a>.</p>
        <button id="consentAccept">Entendi</button>
    `;
    document.body.appendChild(banner);

    document.getElementById('consentAccept').addEventListener('click', () => {
        try { localStorage.setItem(KEY, 'accepted'); } catch (e) {}
        banner.remove();
    });
})();
