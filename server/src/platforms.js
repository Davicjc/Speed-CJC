// Endereços usados no "tempo de resposta das plataformas" do modo avançado.
//
// O navegador mede o tempo de um pedido HTTPS até cada plataforma. Pra isso
// refletir a CONEXÃO do cliente (e não a demora do servidor da plataforma), o
// endereço tem que ser respondido pelo servidor de borda (CDN) mais próximo:
//  - www.facebook.com/favicon.ico, por exemplo, é repassado ao servidor central
//    da Meta e leva ~150 ms a mais — com ping real de 8 ms. Media errado.
//  - Um arquivo estático "immutable" do CDN da Meta volta direto da borda.
//
// Os arquivos da Meta têm hash no nome e podem sair do ar; se isso acontecesse
// sem aviso, a borda passaria a consultar a origem e o número voltaria a
// inflar. Por isso este módulo confere tudo periodicamente e, se o arquivo da
// Meta sumir, descobre o atual na página do Instagram. Se não conseguir, a
// plataforma sai do teste ("não verificável") em vez de mostrar número errado.

const CHECK_EVERY_MS = 6 * 60 * 60_000;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0 Safari/537.36';
const META_HOSTS = { facebook: 'static.xx.fbcdn.net', instagram: 'static.cdninstagram.com', whatsapp: 'static.whatsapp.net' };

// sem parâmetro na URL de propósito: "?cachebust" faria o CDN ir buscar na origem
const FIXED = {
    google: 'https://www.google.com/generate_204',
    youtube: 'https://www.youtube.com/generate_204',
    netflix: 'https://assets.nflxext.com/favicon.ico',
    govbr: 'https://www.gov.br/favicon.ico',
    cloudflare: 'https://www.cloudflare.com/cdn-cgi/trace',

    // Bancos e PIX — a reclamação mais comum do suporte. Endereços escolhidos
    // por responderem da borda no Brasil (medidos: 11–45 ms daqui), não do
    // servidor central: assim o número é o caminho até o banco, não a demora
    // interna dele. api.bb.com.br e api.mercadopago.com ficaram de fora por
    // responderem só da origem (~130 ms), o que mediria coisa errada.
    caixa: 'https://internetbanking.caixa.gov.br/favicon.ico',
    bb: 'https://www.bb.com.br/favicon.ico',
    // cartoes.itau.com.br/favicon.ico passou a redirecionar para um 403 do firewall (falhava em alguns navegadores): CSS pequeno, 200 e cache público na borda
    itau: 'https://www.itau.com.br/fonts/itautext.css',
    bradesco: 'https://banco.bradesco/favicon.ico',
    santander: 'https://www.santander.com.br/favicon.ico',
    nubank: 'https://prod-s0-webapp-proxy.nubank.com.br/api/discovery',
    inter: 'https://www.inter.co/favicon.ico',
    pix: 'https://www.bcb.gov.br/favicon.ico',
};

// Bancos protegidos por WAF respondem 403/301 a um pedido simples — a resposta
// chega igual (é o tempo dela que interessa), então só um erro de servidor
// (5xx) ou nenhuma resposta tira o endereço do teste.

async function request(url, { method = 'HEAD', timeoutMs = 5000 } = {}) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        return await fetch(url, { method, redirect: 'manual', signal: ctrl.signal, headers: { 'User-Agent': UA } });
    } finally {
        clearTimeout(t);
    }
}

/** Arquivo servido da borda: 200 + cache público "immutable". */
async function isEdgeCached(url) {
    try {
        const r = await request(url);
        return r.status === 200 && /immutable/i.test(r.headers.get('cache-control') || '');
    } catch {
        return false;
    }
}

async function discoverMetaAsset() {
    const r = await request('https://www.instagram.com/', { method: 'GET', timeoutMs: 8000 });
    const html = (await r.text()).replace(/\\\//g, '/');
    const paths = [...new Set(html.match(/\/rsrc\.php\/[\w\-/]+\.(?:ico|png)/g) || [])];
    for (const p of paths.slice(0, 10)) {
        if (await isEdgeCached(`https://${META_HOSTS.instagram}${p}`)) return p;
    }
    return null;
}

export function createPlatformTargets({ metaAssetPath = '/rsrc.php/y4/r/QaBlI0OZiks.ico', log = console } = {}) {
    let metaPath = metaAssetPath;
    let urls = { ...FIXED, ...Object.fromEntries(Object.entries(META_HOSTS).map(([k, h]) => [k, `https://${h}${metaPath}`])) };
    let checkedAt = null;

    async function check() {
        const next = { ...urls };
        // Meta: o mesmo arquivo serve nos três domínios (mesmo CDN)
        if (!(await isEdgeCached(`https://${META_HOSTS.instagram}${metaPath}`))) {
            let found = null;
            try { found = await discoverMetaAsset(); } catch { /* sem acesso ao Instagram agora */ }
            if (found) {
                log.info(`[plataformas] arquivo de referência da Meta trocado: ${metaPath} -> ${found}`);
                metaPath = found;
            } else {
                log.warn('[plataformas] nenhum arquivo de borda da Meta válido; Facebook/Instagram/WhatsApp fora do teste até a próxima checagem');
                metaPath = null;
            }
        }
        for (const [k, h] of Object.entries(META_HOSTS)) {
            next[k] = metaPath && (await isEdgeCached(`https://${h}${metaPath}`)) ? `https://${h}${metaPath}` : null;
        }
        for (const [k, url] of Object.entries(FIXED)) {
            try {
                const r = await request(url, { method: 'GET' });
                next[k] = r.status > 0 && r.status < 500 ? url : null;
            } catch {
                next[k] = null;
            }
            if (!next[k]) log.warn(`[plataformas] ${k} não respondeu à checagem (${url}); fora do teste por enquanto`);
        }
        urls = next;
        checkedAt = Date.now();
    }

    const timer = setInterval(() => check().catch(() => {}), CHECK_EVERY_MS);
    timer.unref();

    return {
        check,
        list() { return { checkedAt, targets: urls }; },
        stop() { clearInterval(timer); },
    };
}
