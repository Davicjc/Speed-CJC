import { isPrivateIp } from './util.js';

// Operadora/localização do IP que o SERVIDOR enxerga (o mesmo IP pelo qual o
// teste passou). Consulta feita daqui, não do navegador: um provedor só,
// chamado de cada celular, estoura limite gratuito rápido (o ipapi.co que o
// front usava já devolvia "RateLimited"). Cache de 24h + provedores em cadeia.

const TTL_MS = 24 * 60 * 60_000;
const cache = new Map();

async function getJson(url) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3500);
    try {
        const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'speed-cjc/1.0' } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
    } finally {
        clearTimeout(timer);
    }
}

const providers = [
    async (ip) => {
        const d = await getJson(`https://ipinfo.io/${ip}/json`);
        if (!d.org) throw new Error('sem org');
        const m = /^AS(\d+)\s+(.*)$/.exec(d.org);
        return { isp: m ? m[2] : d.org, asn: m ? Number(m[1]) : null, city: d.city || null, region: d.region || null, country: d.country || null, hostname: d.hostname || null };
    },
    async (ip) => {
        const d = await getJson(`https://ipwho.is/${ip}`);
        if (!d.success) throw new Error('falhou');
        return { isp: d.connection?.isp || d.connection?.org || null, asn: d.connection?.asn || null, city: d.city || null, region: d.region || null, country: d.country_code || null, hostname: null };
    },
    async (ip) => {
        const d = await getJson(`http://ip-api.com/json/${ip}?fields=status,isp,as,city,regionName,countryCode`);
        if (d.status !== 'success') throw new Error('falhou');
        const m = /^AS(\d+)/.exec(d.as || '');
        return { isp: d.isp || null, asn: m ? Number(m[1]) : null, city: d.city || null, region: d.regionName || null, country: d.countryCode || null, hostname: null };
    },
];

export async function lookupIsp(ip) {
    if (isPrivateIp(ip)) return { isp: 'Rede local (sem passar pela internet)', asn: null, city: null, region: null, country: null, hostname: null, private: true };
    const hit = cache.get(ip);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.data;
    for (const p of providers) {
        try {
            const data = { ...(await p(ip)), private: false };
            cache.set(ip, { at: Date.now(), data });
            if (cache.size > 20_000) cache.delete(cache.keys().next().value);
            return data;
        } catch { /* próximo provedor */ }
    }
    return { isp: null, asn: null, city: null, region: null, country: null, hostname: null, private: false };
}
