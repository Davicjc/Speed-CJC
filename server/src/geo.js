// Endereço aproximado (bairro, cidade, UF) de uma coordenada — só quando a
// pessoa autorizou a localização do aparelho no teste.
//
// Usa o Nominatim (OpenStreetMap). A política de uso dele pede no máximo
// 1 consulta por segundo e identificação do sistema, então tudo passa por uma
// fila com intervalo e cache (coordenadas arredondadas em ~100 m). Se a fila
// estiver cheia ou o serviço não responder, o teste é salvo só com a
// coordenada e a cidade vinda do IP — nunca atrasa nem derruba o resultado.

const CACHE_MAX = 5000;
const GAP_MS = 1100;
const MAX_QUEUE = 15;

export function createGeocoder({ provider = 'nominatim', url, userAgent, log = console }) {
    const cache = new Map();
    let chain = Promise.resolve();
    let queued = 0;
    let lastAt = 0;

    async function lookup(lat, lng) {
        const wait = Math.max(0, lastAt + GAP_MS - Date.now());
        if (wait) await new Promise(r => setTimeout(r, wait));
        lastAt = Date.now();
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 4000);
        try {
            const res = await fetch(`${url}/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=16&addressdetails=1&accept-language=pt-BR`, {
                signal: ctrl.signal,
                headers: { 'User-Agent': userAgent, 'Accept-Language': 'pt-BR' },
            });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const d = await res.json();
            const a = d.address || {};
            const city = a.city || a.town || a.village || a.municipality || a.county || null;
            const district = a.suburb || a.neighbourhood || a.quarter || a.city_district || null;
            const uf = (a['ISO3166-2-lvl4'] || '').replace(/^BR-/, '') || a.state || null;
            return {
                street: a.road || null,
                district,
                city,
                region: uf,
                country: (a.country_code || '').toUpperCase() || null,
                label: [district, city && uf ? `${city} - ${uf}` : city].filter(Boolean).join(', ') || d.display_name || null,
            };
        } finally {
            clearTimeout(t);
        }
    }

    return {
        /** Resolve com o endereço ou null (nunca rejeita). */
        reverse(lat, lng, { timeoutMs = 2500 } = {}) {
            if (provider !== 'nominatim') return Promise.resolve(null);
            if (!Number.isFinite(lat) || !Number.isFinite(lng)) return Promise.resolve(null);
            const key = `${lat.toFixed(3)},${lng.toFixed(3)}`;
            if (cache.has(key)) return Promise.resolve(cache.get(key));
            if (queued >= MAX_QUEUE) return Promise.resolve(null);
            queued++;
            const job = chain.then(() => lookup(+lat.toFixed(5), +lng.toFixed(5)))
                .then((r) => {
                    cache.set(key, r);
                    if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
                    return r;
                })
                .catch((e) => { log.warn('[geo] endereço indisponível:', e.message); return null; })
                .finally(() => { queued--; });
            chain = job.then(() => {}, () => {});
            return Promise.race([job, new Promise(r => setTimeout(() => r(null), timeoutMs))]);
        },
    };
}
