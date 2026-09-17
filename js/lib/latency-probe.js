/**
 * Latência HTTP REAL a serviços populares, usando fetch em modo 'no-cors'.
 * Não é ICMP (navegadores não permitem), mas é o tempo real de uma
 * requisição HTTPS até o serviço — sem depender de nenhum backend nosso.
 */
window.LatencyProbe = (function () {

    const TARGETS = [
        { key: 'google', label: 'Google', icon: '🔍', url: 'https://www.google.com/favicon.ico' },
        { key: 'youtube', label: 'YouTube', icon: '▶️', url: 'https://www.youtube.com/favicon.ico' },
        { key: 'whatsapp', label: 'WhatsApp', icon: '💬', url: 'https://web.whatsapp.com/favicon.ico' },
        { key: 'instagram', label: 'Instagram', icon: '📷', url: 'https://www.instagram.com/favicon.ico' },
        { key: 'facebook', label: 'Facebook', icon: '👍', url: 'https://www.facebook.com/favicon.ico' },
        { key: 'netflix', label: 'Netflix', icon: '🎬', url: 'https://www.netflix.com/favicon.ico' },
        { key: 'caixa', label: 'Caixa (Internet Banking)', icon: '🏦', url: 'https://www.caixa.gov.br/favicon.ico' },
        { key: 'cloudflare', label: 'Cloudflare', icon: '☁️', url: 'https://www.cloudflare.com/favicon.ico' }
    ];

    function probeOne(target, timeoutMs = 4000) {
        return new Promise((resolve) => {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), timeoutMs);
            const start = performance.now();

            fetch(target.url + '?cachebust=' + Date.now(), {
                mode: 'no-cors',
                cache: 'no-store',
                signal: controller.signal
            }).then(() => {
                clearTimeout(timer);
                resolve({ ...target, ms: Math.round(performance.now() - start), ok: true });
            }).catch(() => {
                clearTimeout(timer);
                resolve({ ...target, ms: null, ok: false });
            });
        });
    }

    /**
     * onEach(result) é chamado a cada serviço concluído. Roda no máximo `concurrency`
     * por vez (padrão 3) em vez de disparar as 8 requisições de uma só vez.
     */
    function probeAll(onEach, concurrency = 3) {
        const tasks = TARGETS.map(t => () => probeOne(t));
        return window.LiveChecks
            ? window.LiveChecks.runQueue(tasks, concurrency, onEach)
            : Promise.all(tasks.map(fn => fn().then(r => { onEach && onEach(r); return r; })));
    }

    function classify(ms) {
        if (ms == null) return 'erro';
        if (ms < 120) return 'otimo';
        if (ms < 300) return 'bom';
        return 'lento';
    }

    return { TARGETS, probeAll, probeOne, classify };
})();
