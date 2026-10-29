// Google Analytics 4 com consentimento (LGPD).
//
// O servidor só inclui este arquivo quando GA_MEASUREMENT_ID está configurado.
// Até a pessoa aceitar, o GA fica em "consentimento negado": não grava cookie
// nem identificador no aparelho. Os endereços vão sem a parte depois do "?",
// porque os links de nova senha e de confirmação de e-mail levam códigos
// secretos ali.
(function () {
    'use strict';
    var script = document.currentScript;
    var id = script && script.getAttribute('data-ga');
    if (!id) return;

    var CHAVE = 'speedcjc.cookies';
    function ler() { try { return localStorage.getItem(CHAVE); } catch (e) { return null; } }
    function gravar(v) { try { localStorage.setItem(CHAVE, v); } catch (e) { /* navegação privada: vale só nesta visita */ } }
    function semConsulta(u) { return u ? String(u).split('#')[0].split('?')[0] : u; }

    window.dataLayer = window.dataLayer || [];
    function gtag() { window.dataLayer.push(arguments); }
    window.gtag = gtag;

    var escolha = ler();
    gtag('consent', 'default', {
        analytics_storage: escolha === 'aceito' ? 'granted' : 'denied',
        ad_storage: 'denied',
        ad_user_data: 'denied',
        ad_personalization: 'denied',
        functionality_storage: 'granted',
        security_storage: 'granted',
        wait_for_update: 500,
    });
    gtag('set', 'ads_data_redaction', true);
    gtag('js', new Date());
    gtag('config', id, {
        page_location: location.origin + location.pathname,
        page_referrer: semConsulta(document.referrer) || undefined,
        allow_google_signals: false,
        allow_ad_personalization_signals: false,
    });

    function decidir(valor) {
        gravar(valor);
        gtag('consent', 'update', { analytics_storage: valor === 'aceito' ? 'granted' : 'denied' });
        var faixa = document.getElementById('faixa-cookies');
        if (faixa) faixa.remove();
    }

    function mostrarFaixa() {
        if (document.getElementById('faixa-cookies')) return;
        var faixa = document.createElement('section');
        faixa.id = 'faixa-cookies';
        faixa.className = 'faixa-cookies';
        faixa.setAttribute('aria-label', 'Cookies de estatística');
        faixa.innerHTML =
            '<p>Usamos cookies de estatística (Google Analytics) para saber como o site é usado e melhorar o teste. ' +
            'Nada de publicidade. <a href="/privacidade#cookies">Saiba mais</a></p>' +
            '<div class="faixa-cookies-acoes">' +
            '<button type="button" class="botao botao-fantasma botao-pequeno" data-cookies="recusado">Recusar</button>' +
            '<button type="button" class="botao botao-primario botao-pequeno" data-cookies="aceito">Aceitar</button>' +
            '</div>';
        faixa.addEventListener('click', function (e) {
            var b = e.target.closest('[data-cookies]');
            if (b) decidir(b.getAttribute('data-cookies'));
        });
        document.body.appendChild(faixa);
    }

    function iniciar() {
        if (!escolha) mostrarFaixa();
        var botoes = document.querySelectorAll('[data-rever-cookies]');
        for (var i = 0; i < botoes.length; i++) botoes[i].hidden = false;
        // "Rever minha escolha" na página de privacidade
        document.addEventListener('click', function (e) {
            if (e.target.closest('[data-rever-cookies]')) { e.preventDefault(); mostrarFaixa(); }
        });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
    else iniciar();
})();
