/**
 * Coleta dados REAIS que o navegador expõe voluntariamente (sem backend).
 * Tudo aqui é dado de verdade — nada é simulado.
 */
window.DeviceInfo = (function () {

    function parseUserAgent(ua) {
        ua = ua || navigator.userAgent;
        let browser = 'Desconhecido';
        if (/Edg\//.test(ua)) browser = 'Microsoft Edge';
        else if (/OPR\//.test(ua)) browser = 'Opera';
        else if (/Chrome\//.test(ua) && !/Chromium/.test(ua)) browser = 'Chrome';
        else if (/Firefox\//.test(ua)) browser = 'Firefox';
        else if (/Safari\//.test(ua) && !/Chrome/.test(ua)) browser = 'Safari';

        let os = 'Desconhecido';
        if (/Android/.test(ua)) os = 'Android';
        else if (/iPhone|iPad|iPod/.test(ua)) os = 'iOS';
        else if (/Windows NT/.test(ua)) os = 'Windows';
        else if (/Mac OS X/.test(ua)) os = 'macOS';
        else if (/Linux/.test(ua)) os = 'Linux';

        const isMobile = /Mobi|Android|iPhone|iPad/.test(ua);
        return { browser, os, deviceType: isMobile ? 'Celular/Tablet' : 'Computador' };
    }

    function getGPU() {
        try {
            const canvas = document.createElement('canvas');
            const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
            if (!gl) return 'Não disponível';
            const ext = gl.getExtension('WEBGL_debug_renderer_info');
            if (!ext) return 'Não disponível (bloqueado pelo navegador)';
            return gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || 'Não disponível';
        } catch (e) {
            return 'Não disponível';
        }
    }

    function getConnection() {
        const c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
        if (!c) return { supported: false };
        return {
            supported: true,
            effectiveType: c.effectiveType || null,
            downlink: c.downlink || null,
            rtt: c.rtt || null,
            saveData: !!c.saveData,
            type: c.type || null // 'wifi' | 'cellular' | ... — só em alguns navegadores Android
        };
    }

    function collectSync() {
        const uaData = parseUserAgent();
        return {
            browser: uaData.browser,
            os: uaData.os,
            deviceType: uaData.deviceType,
            screen: `${window.screen.width}×${window.screen.height} @${window.devicePixelRatio || 1}x`,
            cpuCores: navigator.hardwareConcurrency || null,
            ramGB: navigator.deviceMemory || null,
            touch: 'ontouchstart' in window || navigator.maxTouchPoints > 0,
            language: navigator.language,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            gpu: getGPU(),
            connection: getConnection(),
            online: navigator.onLine
        };
    }

    /** Busca IP público + ISP via API pública (não é backend nosso). Nunca trava: timeout de 5s. */
    async function fetchPublicIp() {
        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 5000);
            const res = await fetch('https://ipapi.co/json/', { signal: controller.signal, cache: 'no-store' });
            clearTimeout(timer);
            if (!res.ok) throw new Error('bad response');
            const data = await res.json();
            return {
                ip: data.ip || null,
                isp: data.org || data.asn || null,
                city: data.city || null,
                region: data.region || null,
                country: data.country_name || null,
                isIPv6: (data.ip || '').includes(':')
            };
        } catch (e) {
            return { ip: null, isp: null, city: null, region: null, country: null, isIPv6: null };
        }
    }

    return { collectSync, fetchPublicIp, parseUserAgent, getConnection };
})();
