// Gaveta com todos os detalhes de um teste (painel do usuário e administração).

import { ICON } from '../core/icons.js';
import { confirmar, copiar, esc, fmtDataHora, fmtMbps, fmtMs, fmtNum, fmtPct, html, raw, setHtml, toast } from '../core/util.js';
import { veredito } from './qualidade.js';

const NOME_MODO = { rapido: 'Teste rápido', completo: 'Diagnóstico completo' };
const NOME_CONEXAO = { wifi: 'Wi-Fi', cellular: 'Dados móveis', ethernet: 'Cabo de rede', none: 'Sem rede' };

function dialogo() {
    let d = document.getElementById('gaveta-teste');
    if (!d) {
        d = document.createElement('dialog');
        d.id = 'gaveta-teste';
        d.className = 'gaveta';
        d.setAttribute('aria-labelledby', 'gaveta-titulo');
        document.body.appendChild(d);
        d.addEventListener('click', (e) => { if (e.target === d) d.close(); }); // clique fora fecha
    }
    return d;
}

export async function abrirDetalhe({ carregar, cfg, admin = false, aoExcluir, aoAbrirUsuario }) {
    const d = dialogo();
    d.innerHTML = `<div class="gaveta-topo"><h2 id="gaveta-titulo">Carregando teste…</h2><button type="button" class="botao botao-fantasma botao-icone" data-fechar aria-label="Fechar">${ICON.x}</button></div>
        <div class="gaveta-corpo"><div class="esqueleto" style="height:90px"></div><div class="esqueleto" style="height:200px"></div></div>`;
    d.querySelector('[data-fechar]').addEventListener('click', () => d.close());
    if (!d.open) d.showModal();
    let t;
    try {
        t = await carregar();
    } catch (e) {
        d.querySelector('.gaveta-corpo').innerHTML = `<div class="aviso ruim">${ICON.alert}<div>${esc(e.message)}</div></div>`;
        d.querySelector('#gaveta-titulo').textContent = 'Teste indisponível';
        return;
    }
    const v = veredito(t);
    const link = `${location.origin}/r/${t.id}`;
    const adv = t.advanced || {};
    const loc = t.location;
    const place = t.place;
    const ll = t.loadedLatency || {};

    const blocos = [];
    blocos.push(html`<div class="det-cabeca">
        <span class="protocolo">Protocolo ${t.protocol}</span>
        <div class="linha-flex">
            <span class="selo azul">${NOME_MODO[t.mode] || t.mode}</span>
            ${t.verified ? raw(`<span class="selo ok">${ICON.check}Conferido pelo servidor</span>`) : raw(`<span class="selo atencao">${ICON.alert}Não conferido</span>`)}
        </div></div>`);
    blocos.push(html`<dl class="det-leituras">
        <div><dt>Download</dt><dd>${fmtMbps(t.download)}<small>Mbps</small></dd></div>
        <div><dt>Upload</dt><dd>${fmtMbps(t.upload)}<small>Mbps</small></dd></div>
        <div><dt>Ping</dt><dd>${fmtMs(t.ping)}<small>ms</small></dd></div>
        <div><dt>Jitter</dt><dd>${fmtMs(t.jitter)}<small>ms</small></dd></div>
        <div><dt>Perda</dt><dd>${fmtPct(t.loss)}<small>%</small></dd></div>
        <div><dt>Linha cheia</dt><dd>${t.bufferbloat != null ? '+' + fmtMs(t.bufferbloat) : '–'}<small>ms</small></dd></div>
    </dl>`);
    blocos.push(html`<div class="det-secao"><h3>${v.titulo}</h3><p class="suave" style="font-size:var(--t-sm)">${v.texto}</p></div>`);

    if (admin && (t.user || t.uid)) {
        blocos.push(html`<div class="det-secao"><h3>Quem fez</h3><dl class="dados">
            <dt>Nome</dt><dd>${(t.user && t.user.name) || '–'}</dd>
            <dt>E-mail</dt><dd>${(t.user && t.user.email) || '–'}</dd>
        </dl>${t.uid ? raw('<button type="button" class="botao botao-secundario botao-pequeno" data-usuario style="margin-top:10px">Ver a conta</button>') : ''}</div>`);
    } else if (admin) {
        blocos.push(html`<div class="det-secao"><h3>Quem fez</h3><p class="suave" style="font-size:var(--t-sm)">Teste feito sem login.</p></div>`);
    }

    blocos.push(html`<div class="det-secao"><h3>Onde</h3>
        <dl class="dados">
            <dt>Local</dt><dd>${place ? place.label : 'Não identificado'}${place ? raw(`<br><span class="suave" style="font-size:var(--t-xs)">${place.source === 'aparelho' ? 'Pela localização do aparelho' : 'Aproximado pelo endereço IP'}</span>`) : ''}</dd>
            ${loc ? html`<dt>Coordenadas</dt><dd>${fmtNum(loc.lat, 5)}, ${fmtNum(loc.lng, 5)}${loc.accuracy ? ` (precisão de ${fmtNum(loc.accuracy, 0)} m)` : ''}</dd>` : ''}
        </dl>
        ${loc ? raw('<div class="mapa mini" id="det-mapa" style="margin-top:12px"></div>') : ''}</div>`);

    blocos.push(html`<div class="det-secao"><h3>Conexão e aparelho</h3><dl class="dados">
        <dt>Operadora</dt><dd>${t.isp || 'Não identificada'}</dd>
        <dt>Endereço IP</dt><dd>${t.ip || '–'}${t.ipFamily ? ` (${t.ipFamily})` : ''}</dd>
        <dt>Tipo de conexão</dt><dd>${(t.connection && NOME_CONEXAO[t.connection.type]) || 'O navegador não informou'}</dd>
        <dt>Aparelho</dt><dd>${t.device ? [t.device.model ? `${t.device.type} ${t.device.model}` : t.device.type, [t.device.os, t.device.osVersion].filter(Boolean).join(' '), [t.device.browser, t.device.browserVersion].filter(Boolean).join(' ')].filter(Boolean).join(', ') : '–'}</dd>
        <dt>Ping durante o download</dt><dd>${ll.download != null ? fmtMs(ll.download) + ' ms' : '–'}</dd>
        <dt>Ping durante o upload</dt><dd>${ll.upload != null ? fmtMs(ll.upload) + ' ms' : '–'}</dd>
        <dt>Servidor</dt><dd>${t.server ? `${t.server.name}, ${t.server.location}` : '–'}</dd>
    </dl></div>`);

    if (t.mode === 'completo' && Object.keys(adv).length) {
        const linhas = [];
        const pr = adv.protocolos;
        if (pr) {
            const f = (x) => (!x ? '–' : x.alcance === null ? 'não verificável' : x.alcance ? `funciona${x.mbps != null ? `, ${fmtMbps(x.mbps)} Mbps` : ''}` : 'sem acesso');
            linhas.push(html`<dt>IPv4</dt><dd>${f(pr.ipv4)}</dd><dt>IPv6</dt><dd>${f(pr.ipv6)}</dd>`);
        }
        if (adv.nat) linhas.push(html`<dt>Tipo de NAT</dt><dd>${adv.nat.tipo || 'não medido'}</dd><dt>Duplo NAT</dt><dd>${adv.nat.duploNat || 'não medido'}${adv.nat.cgnat ? ' (CGNAT)' : ''}</dd>`);
        if (adv.relogio) linhas.push(html`<dt>Relógio do aparelho</dt><dd>${Math.abs(adv.relogio.offsetS) < 2 ? 'certo' : `${adv.relogio.offsetS > 0 ? 'adiantado' : 'atrasado'} ${fmtNum(Math.abs(adv.relogio.offsetS), 1)} s`}</dd>`);
        const lista = (arr) => (arr || []).map((s) => `${esc(s.label)}: ${s.ms != null ? s.ms + ' ms' : 'falhou'}`).join('<br>');
        if (adv.servicos) linhas.push(html`<dt>Aplicativos</dt><dd>${raw(lista(adv.servicos))}</dd>`);
        if (adv.bancos) linhas.push(html`<dt>Bancos e PIX</dt><dd>${raw(lista(adv.bancos))}</dd>`);
        if (adv.rota) linhas.push(html`<dt>Rota</dt><dd>${adv.rota.length} saltos até a conexão</dd>`);
        blocos.push(html`<div class="det-secao"><h3>Diagnóstico</h3><dl class="dados">${linhas}</dl></div>`);
    }

    if (admin) {
        const vf = t.verification || {};
        blocos.push(html`<div class="det-secao"><h3>Conferência do servidor</h3><dl class="dados">
            <dt>Situação</dt><dd>${t.verified ? 'Conferido' : `Não conferido${vf.reason ? `: ${vf.reason}` : ''}`}</dd>
            <dt>Bytes entregues no download</dt><dd>${vf.dlServedBytes != null ? fmtNum(vf.dlServedBytes / 1048576, 0) + ' MB' : '–'}</dd>
            <dt>Upload medido no servidor</dt><dd>${vf.uploadFromClient != null ? `sim (o navegador informou ${fmtMbps(vf.uploadFromClient)} Mbps)` : 'sim'}</dd>
            <dt>Navegador</dt><dd style="font-size:var(--t-xs)">${t.userAgent || '–'}</dd>
        </dl></div>`);
    }

    blocos.push(raw(`<div class="det-acoes">
        <a class="botao botao-secundario botao-pequeno" href="/r/${esc(t.id)}" target="_blank" rel="noopener">${ICON.external}Abrir página pública</a>
        <button type="button" class="botao botao-secundario botao-pequeno" data-copiar>${ICON.copy}Copiar link</button>
        <a class="botao botao-secundario botao-pequeno" href="https://wa.me/?text=${encodeURIComponent(`Teste de velocidade Audicom: ${fmtMbps(t.download)} Mbps de download, ${fmtMbps(t.upload)} Mbps de upload, ping ${fmtMs(t.ping)} ms. ${link}`)}" target="_blank" rel="noopener">${ICON.whatsapp}WhatsApp</a>
        ${aoExcluir ? `<button type="button" class="botao botao-perigo botao-pequeno" data-excluir>${ICON.trash}Excluir teste</button>` : ''}
    </div>`));

    d.querySelector('#gaveta-titulo').textContent = `Teste de ${fmtDataHora(t.createdAt)}`;
    setHtml(d.querySelector('.gaveta-corpo'), raw(blocos.map(String).join('')));

    d.querySelector('[data-copiar]').addEventListener('click', async () => {
        toast((await copiar(link)) ? 'Link copiado.' : 'Não foi possível copiar.');
    });
    const bu = d.querySelector('[data-usuario]');
    if (bu && aoAbrirUsuario) bu.addEventListener('click', () => { d.close(); aoAbrirUsuario(t.uid); });
    const bx = d.querySelector('[data-excluir]');
    if (bx) bx.addEventListener('click', async () => {
        const ok = await confirmar({ titulo: 'Excluir este teste?', texto: `O teste ${t.protocol} sai do histórico e o link público deixa de funcionar. Não dá para desfazer.`, acao: 'Excluir', perigo: true });
        if (!ok) return;
        try { await aoExcluir(t); d.close(); toast('Teste excluído.'); } catch (e) { toast(e.message, 'ruim'); }
    });
    if (loc) {
        const { criarMapa } = await import('./mapa.js');
        const m = criarMapa(d.querySelector('#det-mapa'), cfg, { zoom: 14 });
        m.pontos([{ lat: loc.lat, lng: loc.lng }], {});
        m.circulo(loc.lat, loc.lng, loc.accuracy);
        d.addEventListener('close', () => m.destruir(), { once: true });
    }
}
