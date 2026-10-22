// Rótulo curto do aparelho ("Celular, Android 14, Chrome 130") para listas
// do painel. O navegador manda o rótulo dele (mais preciso, com Client Hints);
// sem rótulo, sai do User-Agent.

export function parseUserAgent(ua = '') {
    const v = (re) => { const m = ua.match(re); return m ? m[1] : null; };
    let browser = null;
    if (/Edg\//.test(ua)) browser = 'Edge ' + v(/Edg\/(\d+)/);
    else if (/OPR\//.test(ua)) browser = 'Opera ' + v(/OPR\/(\d+)/);
    else if (/SamsungBrowser\//.test(ua)) browser = 'Samsung Internet ' + v(/SamsungBrowser\/(\d+)/);
    else if (/Chrome\//.test(ua)) browser = 'Chrome ' + v(/Chrome\/(\d+)/);
    else if (/Firefox\//.test(ua)) browser = 'Firefox ' + v(/Firefox\/(\d+)/);
    else if (/Safari\//.test(ua)) browser = 'Safari ' + (v(/Version\/(\d+)/) || '');
    let os = null;
    if (/Android/.test(ua)) os = 'Android ' + (v(/Android (\d+)/) || '');
    else if (/iPhone|iPad|iPod/.test(ua)) os = (/iPad/.test(ua) ? 'iPadOS ' : 'iOS ') + (v(/OS (\d+)/) || '');
    else if (/Windows NT/.test(ua)) os = 'Windows';
    else if (/Mac OS X/.test(ua)) os = 'macOS';
    else if (/CrOS/.test(ua)) os = 'ChromeOS';
    else if (/Linux/.test(ua)) os = 'Linux';
    const tablet = /iPad/.test(ua) || (/Android/.test(ua) && !/Mobi/.test(ua));
    const mobile = /Mobi|iPhone|iPod/.test(ua);
    return { type: tablet ? 'Tablet' : mobile ? 'Celular' : 'Computador', os: os && os.trim(), browser: browser && browser.trim() };
}

export function normalizeDeviceLabel(label, ua) {
    if (typeof label === 'string' && label.trim()) return label.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 80);
    const d = parseUserAgent(String(ua || ''));
    return [d.type, d.os, d.browser].filter(Boolean).join(', ').slice(0, 80) || null;
}
