// Aparelho, sistema e navegador — só o que o navegador informa por conta
// própria (User-Agent + Client Hints no Chrome/Edge/Android). Nada inventado:
// o que não dá pra saber fica em branco.

function parseUA(ua = navigator.userAgent) {
    const v = (re) => { const m = ua.match(re); return m ? m[1] : null; };
    let browser = null, browserVersion = null;
    if (/Edg\//.test(ua)) { browser = 'Edge'; browserVersion = v(/Edg\/(\d+)/); }
    else if (/OPR\//.test(ua)) { browser = 'Opera'; browserVersion = v(/OPR\/(\d+)/); }
    else if (/SamsungBrowser\//.test(ua)) { browser = 'Samsung Internet'; browserVersion = v(/SamsungBrowser\/(\d+)/); }
    else if (/CriOS\//.test(ua)) { browser = 'Chrome'; browserVersion = v(/CriOS\/(\d+)/); }
    else if (/Chrome\//.test(ua)) { browser = 'Chrome'; browserVersion = v(/Chrome\/(\d+)/); }
    else if (/Firefox\//.test(ua)) { browser = 'Firefox'; browserVersion = v(/Firefox\/(\d+)/); }
    else if (/Safari\//.test(ua)) { browser = 'Safari'; browserVersion = v(/Version\/(\d+)/); }

    let os = null, osVersion = null;
    if (/Android/.test(ua)) { os = 'Android'; osVersion = v(/Android (\d+)/); }
    else if (/iPhone|iPod/.test(ua)) { os = 'iOS'; osVersion = (v(/OS (\d+[_\d]*)/) || '').split('_')[0] || null; }
    else if (/iPad/.test(ua)) { os = 'iPadOS'; osVersion = (v(/OS (\d+[_\d]*)/) || '').split('_')[0] || null; }
    else if (/Windows NT/.test(ua)) { os = 'Windows'; osVersion = { '10.0': '10', '6.3': '8.1', '6.1': '7' }[v(/Windows NT ([\d.]+)/)] || null; }
    else if (/Mac OS X/.test(ua)) { os = 'macOS'; }
    else if (/CrOS/.test(ua)) os = 'ChromeOS';
    else if (/Linux/.test(ua)) os = 'Linux';

    // iPad recente se apresenta como Mac: tela de toque denuncia
    if (os === 'macOS' && navigator.maxTouchPoints > 1) os = 'iPadOS';
    const tablet = os === 'iPadOS' || (/Android/.test(ua) && !/Mobi/.test(ua));
    const mobile = /Mobi|iPhone|iPod/.test(ua);
    return { type: tablet ? 'Tablet' : mobile ? 'Celular' : 'Computador', os, osVersion, browser, browserVersion };
}

let cache = null;
export async function coletarAparelho() {
    if (cache) return cache;
    const d = { ...parseUA(), model: null };
    const uad = navigator.userAgentData;
    if (uad && uad.getHighEntropyValues) {
        try {
            const h = await uad.getHighEntropyValues(['platform', 'platformVersion', 'model', 'fullVersionList']);
            if (h.platform) d.os = { 'Chrome OS': 'ChromeOS', 'Chromium OS': 'ChromeOS' }[h.platform] || h.platform;
            if (h.platformVersion) {
                const major = parseInt(h.platformVersion, 10);
                // no Windows a versão vem "13.0.0" (ou mais) para o 11 e "10.0.0" para o 10
                d.osVersion = d.os === 'Windows' ? (major >= 13 ? '11' : major > 0 ? '10' : d.osVersion) : String(major || '') || d.osVersion;
            }
            if (h.model) d.model = h.model;
            const full = (h.fullVersionList || []).find((b) => !/Not.?A.?Brand|Chromium/i.test(b.brand));
            if (full) { d.browser = full.brand.replace(/^Google /, '').replace(/^Microsoft /, ''); d.browserVersion = String(full.version).split('.')[0]; }
            if (uad.mobile && d.type === 'Computador') d.type = 'Celular';
        } catch { /* fica o que o User-Agent deu */ }
    }
    d.cores = navigator.hardwareConcurrency || null;
    d.ram = navigator.deviceMemory || null;
    d.screen = `${screen.width}×${screen.height}`;
    d.label = [d.model ? `${d.type} ${d.model}` : d.type, d.os ? `${d.os}${d.osVersion ? ' ' + d.osVersion : ''}` : null, d.browser ? `${d.browser}${d.browserVersion ? ' ' + d.browserVersion : ''}` : null]
        .filter(Boolean).join(', ');
    cache = d;
    return d;
}

/** Tipo de conexão segundo o navegador (só Chrome/Android informam). */
export function conexaoDoNavegador() {
    const c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (!c) return { type: null, effectiveType: null, downlink: null, rtt: null };
    return { type: c.type || null, effectiveType: c.effectiveType || null, downlink: c.downlink ?? null, rtt: c.rtt ?? null };
}

export const NOMES_CONEXAO = { wifi: 'Wi-Fi', cellular: 'Dados móveis', ethernet: 'Cabo de rede', none: 'Sem rede', bluetooth: 'Bluetooth', wimax: 'WiMAX' };
