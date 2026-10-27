// Página pública de um resultado (/r/:id) — é o link que vai no WhatsApp.
// Renderizada no servidor, com tags Open Graph: a prévia do link já mostra
// download, upload e ping sem precisar abrir. Não mostra nome, e-mail, IP
// nem coordenadas: só o que a pessoa quis compartilhar.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf = (d) => new Intl.NumberFormat('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
const mbps = (v) => (v == null ? '–' : v >= 100 ? nf(0).format(v) : v >= 10 ? nf(1).format(v) : nf(2).format(v));
const ms = (v) => (v == null ? '–' : v >= 100 ? nf(0).format(v) : nf(1).format(v));
const pct = (v) => (v == null ? '–' : v === 0 ? '0' : v < 1 ? nf(2).format(v) : nf(1).format(v));
const MODO = { rapido: 'Teste rápido', completo: 'Diagnóstico completo' };
const FOOTER = '<script src="https://recursos.cjc.pics/projetos/footer-terceiros/paulog.js" defer></script>';

function cabeca({ title, desc, url, origin }) {
    return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta name="theme-color" content="#081535">
<meta name="robots" content="noindex">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Audicom Telecom">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
${url ? `<meta property="og:url" content="${esc(url)}">` : ''}
<meta property="og:image" content="${esc(origin)}/assets/og.png">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/favicon.ico">
<link rel="stylesheet" href="/css/base.css">
<link rel="stylesheet" href="/css/resultado.css">
</head>`;
}

function topo() {
    return `<header class="topo"><div class="topo-dentro">
<a class="marca" href="/" aria-label="Audicom Telecom, teste de velocidade — início">
<img class="simbolo" src="/assets/simbolo.webp" alt="" width="27" height="25">
<img class="palavra" src="/assets/logotipo.webp" alt="Audicom Telecom" width="86" height="25">
<span class="produto">Teste de<br>velocidade</span></a>
<nav class="nav" aria-label="Principal"><a href="/">Fazer um teste</a><a href="/como-medimos">Como medimos</a></nav>
</div></header>`;
}

export function renderResultPage(r, origin) {
    const fundo = '<div class="fundo" aria-hidden="true"></div>';
    if (!r) {
        return `${cabeca({ title: 'Resultado não encontrado | Audicom', desc: 'Este resultado não existe mais.', origin })}
<body>${fundo}${topo()}<main class="miolo publico">
<div class="publico-vazio"><h1>Resultado não encontrado</h1>
<p>O link está incompleto ou o teste foi apagado por quem fez.</p>
<a class="botao botao-primario" href="/">Fazer um teste agora</a></div></main>${FOOTER}</body></html>`;
    }
    const quando = new Date(r.createdAt);
    const data = quando.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: 'numeric', month: 'long', year: 'numeric' });
    const hora = quando.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
    const title = `${mbps(r.download)} Mbps de download e ${mbps(r.upload)} Mbps de upload | Teste Audicom`;
    const desc = `Ping ${ms(r.ping)} ms, jitter ${ms(r.jitter)} ms${r.loss != null ? `, perda de pacotes ${pct(r.loss)}%` : ''}. Medido em ${data} às ${hora}${r.city ? `, em ${r.city}` : ''}.`;
    const itens = [
        ['Ping', ms(r.ping), 'ms'],
        ['Jitter', ms(r.jitter), 'ms'],
        ['Perda de pacotes', pct(r.loss), '%'],
        ['Ping com a linha cheia', r.bufferbloat != null ? '+' + ms(r.bufferbloat) : '–', 'ms'],
    ];
    return `${cabeca({ title, desc, url: `${origin}/r/${r.id}`, origin })}
<body>${fundo}${topo()}
<main class="miolo publico">
    <p class="publico-quando">${esc(MODO[r.mode] || 'Teste')} feito em ${esc(data)} às ${esc(hora)}${r.city ? `, em ${esc(r.city)}` : ''}</p>
    <div class="publico-grandes">
        <div><span class="rotulo-serie"><i class="chave-serie" style="--c:var(--serie-download)"></i>Download</span><b class="num">${esc(mbps(r.download))}</b><small>Mbps</small></div>
        <div><span class="rotulo-serie"><i class="chave-serie" style="--c:var(--serie-upload)"></i>Upload</span><b class="num">${esc(mbps(r.upload))}</b><small>Mbps</small></div>
    </div>
    <dl class="publico-leituras">
        ${itens.map(([k, v, u]) => `<div><dt>${esc(k)}</dt><dd><b class="num">${esc(v)}</b><small>${esc(u)}</small></dd></div>`).join('')}
    </dl>
    <dl class="publico-info">
        <div><dt>Operadora</dt><dd>${esc(r.isp || 'Não identificada')}</dd></div>
        <div><dt>Servidor</dt><dd>${esc(r.server ? `${r.server.name}, ${r.server.location}` : 'Audicom Telecom')}</dd></div>
        <div><dt>Protocolo</dt><dd class="mono-copy">${esc(r.protocol)}</dd></div>
        <div><dt>Conferência</dt><dd>${r.verified ? 'Medidas conferidas pelo servidor da Audicom' : 'Não conferido pelo servidor'}</dd></div>
    </dl>
    <div class="publico-acoes">
        <a class="botao botao-primario" href="/">Testar a minha internet</a>
        <a class="botao botao-secundario" href="/como-medimos">Como medimos</a>
    </div>
</main>${FOOTER}
</body></html>`;
}
