/**
 * Checagens "ao vivo" do modo avançado — cada uma é isolada e nunca
 * lança exceção pra fora: se falhar, resolve com um estado de erro
 * legível, pra interface nunca travar por causa de uma checagem opcional.
 */
window.LiveChecks = (function () {

    function withTimeout(promise, ms, fallback) {
        return Promise.race([
            promise,
            new Promise(resolve => setTimeout(() => resolve(fallback), ms))
        ]);
    }

    function noCorsReachable(url, ms = 3500) {
        return new Promise((resolve) => {
            const controller = new AbortController();
            const timer = setTimeout(() => { controller.abort(); resolve(false); }, ms);
            fetch(url + '?t=' + Date.now(), { mode: 'no-cors', cache: 'no-store', signal: controller.signal })
                .then(() => { clearTimeout(timer); resolve(true); })
                .catch(() => { clearTimeout(timer); resolve(false); });
        });
    }

    /** IPv4/IPv6: tenta alcançar hosts que só respondem por A ou só por AAAA. */
    async function checkIPStack() {
        try {
            const [v4, v6] = await Promise.all([
                noCorsReachable('https://ipv4.icanhazip.com/'),
                noCorsReachable('https://ipv6.icanhazip.com/')
            ]);
            return { v4, v6, error: null };
        } catch (e) {
            return { v4: null, v6: null, error: 'Não foi possível verificar' };
        }
    }

    /** Relógio do dispositivo: compara com o header Date da própria origem (sem CORS, sem terceiros). */
    async function checkClockSkew() {
        try {
            const localBefore = Date.now();
            const res = await withTimeout(
                fetch(window.location.origin + window.location.pathname, { method: 'HEAD', cache: 'no-store' }),
                3500, null
            );
            if (!res || !res.headers) return { skewSeconds: null, error: 'Servidor não respondeu' };
            const serverDateHeader = res.headers.get('date');
            if (!serverDateHeader) return { skewSeconds: null, error: 'Servidor não informou horário' };
            const serverTime = new Date(serverDateHeader).getTime();
            const localAfter = Date.now();
            const localApprox = (localBefore + localAfter) / 2;
            const skewSeconds = Math.round((localApprox - serverTime) / 1000);
            return { skewSeconds, error: null };
        } catch (e) {
            return { skewSeconds: null, error: 'Não foi possível verificar' };
        }
    }

    /** Geolocalização: exige permissão do usuário; nunca trava se ele negar/demorar. */
    function getGeolocation(timeoutMs = 8000) {
        return new Promise((resolve) => {
            if (!('geolocation' in navigator)) {
                resolve({ ok: false, reason: 'Navegador sem suporte a geolocalização' });
                return;
            }
            const timer = setTimeout(() => resolve({ ok: false, reason: 'Tempo esgotado ou sem resposta' }), timeoutMs);
            navigator.geolocation.getCurrentPosition(
                (pos) => {
                    clearTimeout(timer);
                    resolve({ ok: true, lat: pos.coords.latitude, lon: pos.coords.longitude, accuracy: pos.coords.accuracy });
                },
                (err) => {
                    clearTimeout(timer);
                    const reason = err.code === 1 ? 'Permissão negada' : err.code === 2 ? 'Posição indisponível' : 'Tempo esgotado';
                    resolve({ ok: false, reason });
                },
                { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 60000 }
            );
        });
    }

    /** Reverse geocoding best-effort (OpenStreetMap Nominatim); se falhar, quem chamou usa a cidade via IP como fallback. */
    async function reverseGeocode(lat, lon) {
        try {
            const res = await withTimeout(
                fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=10`),
                4000, null
            );
            if (!res || !res.ok) return null;
            const data = await res.json();
            const a = data.address || {};
            return [a.city || a.town || a.village, a.state].filter(Boolean).join(', ') || null;
        } catch (e) {
            return null;
        }
    }

    /**
     * Roda uma fila de tarefas assíncronas com no máximo `concurrency` em paralelo,
     * em vez de disparar tudo de uma vez — mais gentil com a rede do cliente e
     * (pensando à frente) com o servidor, quando várias pessoas testarem ao mesmo tempo.
     * tasks: array de funções () => Promise. onItemDone(result, index) é chamado a cada conclusão.
     */
    function runQueue(tasks, concurrency, onItemDone) {
        return new Promise((resolve) => {
            const results = new Array(tasks.length);
            let nextIndex = 0;
            let activeCount = 0;
            let doneCount = 0;

            function pump() {
                if (doneCount === tasks.length) { resolve(results); return; }
                while (activeCount < concurrency && nextIndex < tasks.length) {
                    const idx = nextIndex++;
                    activeCount++;
                    Promise.resolve()
                        .then(() => tasks[idx]())
                        .catch(() => null)
                        .then((r) => {
                            results[idx] = r;
                            activeCount--;
                            doneCount++;
                            onItemDone && onItemDone(r, idx);
                            pump();
                        });
                }
            }
            pump();
        });
    }

    return { checkIPStack, checkClockSkew, getGeolocation, reverseGeocode, withTimeout, runQueue };
})();
