// Gaveta com todos os detalhes de um teste (painel do usuário e administração):
// tudo o que a página do teste mostrou na hora, inclusive o diagnóstico completo
// e a rota salto a salto.

import { NOMES_CONEXAO } from '../core/device.js';
import { ICON } from '../core/icons.js';
import { confirmar, copiar, esc, evento, fmtDataHora, fmtMbps, fmtMs, fmtNum, fmtPct, html, raw, setHtml, toast } from '../core/util.js';
import { planoParaCliente, veredito } from './qualidade.js';
import { NOME_MODO, desenharDiag, partesDiag, textoCompleto, usosHtml } from './relatorio.js';

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

const ms = (v) => (v != null ? `${fmtMs(v)} ms` : '–');

/**
 * tom 'cliente' (painel da pessoa): números completos, sem selos negativos, sem
 * NAT, rota nem conferência. tom 'tecnico' (administração e /tecnico): tudo.
 */
export async function abrirDetalhe({ carregar, cfg = {}, admin = false, tom = admin ? 'tecnico' : 'cliente', plano = null, aoExcluir, aoAbrirUsuario }) {
    const tecnico = tom === 'tecnico';
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
    const v = veredito(t, { tom });
    const at = t.atendimento || null;
    // técnico: o plano informado no atendimento vale mais que o da conta
    if (tecnico && at && at.plano) plano = at.plano;
    const pctPlano = tecnico ? (plano && t.download != null ? Math.round((t.download / plano) * 100) : null) : planoParaCliente(t.download, plano);
    const link = `${location.origin}/r/${t.id}`;
    const adv = t.advanced || {};
    const loc = t.location;
    const place = t.place;
    const ll = t.loadedLatency || {};
    const dev = t.device || {};
    const con = t.connection || {};
    const curva = t.curve && ((t.curve.download || []).length || (t.curve.upload || []).length) ? t.curve : null;
    const texto = textoCompleto(t, { link, plano, empresa: cfg.serverName || 'Audicom Telecom', tom });

    const blocos = [];
    blocos.push(html`<div class="det-cabeca">
        <span class="protocolo">Protocolo ${t.protocol}</span>
        <div class="linha-flex">
            <span class="selo azul">${NOME_MODO[t.mode] || t.mode}</span>
            ${tecnico ? raw(t.origem === 'tecnico' ? '<span class="selo origem-tecnico">Teste técnico</span>' : '<span class="selo">Página do cliente</span>') : ''}
            ${!tecnico ? '' : t.verified ? raw(`<span class="selo ok">${ICON.check}Conferido pelo servidor</span>`) : raw(`<span class="selo atencao">${ICON.alert}Não conferido</span>`)}
        </div></div>`);
    blocos.push(html`<dl class="det-leituras">
        <div><dt>Download</dt><dd>${fmtMbps(t.download)}<small>Mbps</small></dd></div>
        <div><dt>Upload</dt><dd>${fmtMbps(t.upload)}<small>Mbps</small></dd></div>
        <div><dt>Ping</dt><dd>${fmtMs(t.ping)}<small>ms</small></dd></div>
        <div><dt>Jitter</dt><dd>${fmtMs(t.jitter)}<small>ms</small></dd></div>
        <div><dt>Perda</dt><dd>${fmtPct(t.loss)}<small>%</small></dd></div>
        <div><dt>Linha cheia</dt><dd>${t.bufferbloat != null ? '+' + fmtMs(t.bufferbloat) : '–'}<small>ms</small></dd></div>
    </dl>`);

    blocos.push(html`<div class="det-secao"><h3>${v.titulo}</h3><p class="suave det-desc">${v.texto}</p>
        ${pctPlano != null ? html`<p class="det-plano">Recebeu <strong>${pctPlano}%</strong> do plano de ${plano} Mbps no download.</p>` : ''}
        <ul class="usos det-usos" aria-label="O que a conexão aguenta">${raw(usosHtml(t, { tom }))}</ul></div>`);
    if (tecnico && at) {
        blocos.push(html`<div class="det-secao"><h3>Atendimento</h3><dl class="dados">
            ${at.cliente ? html`<dt>Cliente</dt><dd>${at.cliente}</dd>` : ''}
            ${at.plano ? html`<dt>Plano</dt><dd>${at.plano} Mbps</dd>` : ''}
            ${at.obs ? html`<dt>Observação</dt><dd>${at.obs}</dd>` : ''}
        </dl></div>`);
    }

    if (curva) {
        blocos.push(raw(`<div class="det-secao"><div class="det-titulo-linha"><h3>Velocidade durante o teste</h3>
            <div class="legenda"><span><i style="background:var(--serie-download)"></i>Download</span><span><i class="tracejado" style="color:var(--serie-upload)"></i>Upload</span></div></div>
            <div id="det-curva"></div></div>`));
    }

    blocos.push(html`<div class="det-secao"><h3>Latência</h3><dl class="dados">
        <dt>Ping em repouso</dt><dd>${ms(t.ping)}${t.pingMin != null && t.pingMax != null ? ` (mínimo ${fmtMs(t.pingMin)}, máximo ${fmtMs(t.pingMax)})` : ''}</dd>
        <dt>Jitter (variação)</dt><dd>${ms(t.jitter)}</dd>
        <dt>Ping durante o download</dt><dd>${ms(ll.download)}</dd>
        <dt>Ping durante o upload</dt><dd>${ms(ll.upload)}</dd>
        <dt>Aumento com a linha cheia</dt><dd>${t.bufferbloat != null ? `+${fmtMs(t.bufferbloat)} ms` : '–'}</dd>
        <dt>Perda de pacotes (UDP)</dt><dd>${t.loss != null ? `${fmtPct(t.loss)}%` : 'Não medida'}</dd>
    </dl></div>`);

    if (admin && (t.user || t.uid)) {
        blocos.push(html`<div class="det-secao"><h3>Quem fez</h3><dl class="dados">
            <dt>Nome</dt><dd>${(t.user && t.user.name) || '–'}</dd>
            <dt>E-mail</dt><dd>${(t.user && t.user.email) || '–'}</dd>
        </dl>${t.uid && aoAbrirUsuario ? raw('<button type="button" class="botao botao-secundario botao-pequeno" data-usuario style="margin-top:10px">Ver a conta</button>') : ''}</div>`);
    } else if (admin) {
        blocos.push(html`<div class="det-secao"><h3>Quem fez</h3><p class="suave" style="font-size:var(--t-sm)">Teste feito sem login.</p></div>`);
    }

    blocos.push(html`<div class="det-secao"><h3>Onde</h3>
        <dl class="dados">
            <dt>Local</dt><dd>${place ? place.label : 'Não identificado'}${place ? raw(`<br><span class="suave" style="font-size:var(--t-xs)">${place.source === 'aparelho' ? 'Pela localização do aparelho' : 'Aproximado pelo endereço IP'}</span>`) : ''}</dd>
            ${loc ? html`<dt>Coordenadas</dt><dd>${fmtNum(loc.lat, 5)}, ${fmtNum(loc.lng, 5)}${loc.accuracy ? ` (precisão de ${fmtNum(loc.accuracy, 0)} m)` : ''}</dd>` : ''}
            ${t.ipLocation && t.ipLocation.city ? html`<dt>Cidade pelo IP</dt><dd>${[t.ipLocation.city, t.ipLocation.region, t.ipLocation.country].filter(Boolean).join(' - ')}</dd>` : ''}
        </dl>
        ${loc ? raw('<div class="mapa mini" id="det-mapa" style="margin-top:12px"></div>') : ''}</div>`);

    blocos.push(html`<div class="det-secao"><h3>Conexão</h3><dl class="dados">
        <dt>Operadora</dt><dd>${t.isp || 'Não identificada'}${t.asn ? raw(`<br><span class="suave" style="font-size:var(--t-xs)">${esc(String(t.asn))}</span>`) : ''}</dd>
        <dt>Endereço IP</dt><dd>${t.ip || '–'}${t.ipFamily ? ` (${t.ipFamily})` : ''}</dd>
        <dt>Tipo de conexão</dt><dd>${(con.type && (NOMES_CONEXAO[con.type] || con.type)) || 'O navegador não informou'}</dd>
        ${con.downlink != null || con.rtt != null ? html`<dt>Estimativa do navegador</dt><dd>${[con.downlink != null ? `${fmtNum(con.downlink, 1)} Mbps` : null, con.rtt != null ? `${fmtNum(con.rtt, 0)} ms` : null, con.effectiveType || null].filter(Boolean).join(', ')}</dd>` : ''}
        <dt>Servidor</dt><dd>${t.server ? `${t.server.name}, ${t.server.location}` : '–'}</dd>
    </dl></div>`);

    blocos.push(html`<div class="det-secao"><h3>Aparelho</h3><dl class="dados">
        <dt>Aparelho</dt><dd>${dev.model ? `${dev.type || ''} ${dev.model}`.trim() : dev.type || 'Não informado'}</dd>
        <dt>Sistema</dt><dd>${[dev.os, dev.osVersion].filter(Boolean).join(' ') || 'Não informado'}</dd>
        <dt>Navegador</dt><dd>${[dev.browser, dev.browserVersion].filter(Boolean).join(' ') || 'Não informado'}</dd>
        <dt>Processador</dt><dd>${dev.cores ? `${dev.cores} núcleos` : 'Não informado'}</dd>
        <dt>Memória</dt><dd>${dev.ram ? `${dev.ram} GB ou mais` : 'Não informada'}</dd>
        ${dev.screen ? html`<dt>Tela</dt><dd>${dev.screen}</dd>` : ''}
    </dl></div>`);

    const partes = t.mode === 'completo' ? partesDiag(tom).filter((k) => k in adv) : [];
    if (partes.length) {
        blocos.push(raw(`<div class="det-grupo"><h3 class="det-grupo-titulo">Diagnóstico completo</h3>${partes.map((k) => `<div class="det-secao" data-diag="${k}"></div>`).join('')}</div>`));
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
        <a class="botao botao-secundario botao-pequeno" href="https://wa.me/?text=${encodeURIComponent(texto)}" target="_blank" rel="noopener" data-whatsapp>${ICON.whatsapp}Enviar no WhatsApp</a>
        <button type="button" class="botao botao-secundario botao-pequeno" data-copiar>${ICON.copy}Copiar resultado</button>
        <a class="botao botao-secundario botao-pequeno" href="/r/${esc(t.id)}" target="_blank" rel="noopener">${ICON.external}Página pública</a>
        ${aoExcluir ? `<button type="button" class="botao botao-perigo botao-pequeno" data-excluir>${ICON.trash}Excluir teste</button>` : ''}
    </div>`));

    d.querySelector('#gaveta-titulo').textContent = `Teste de ${fmtDataHora(t.createdAt)}`;
    setHtml(d.querySelector('.gaveta-corpo'), raw(blocos.map(String).join('')));

    for (const k of partes) desenharDiag(d.querySelector(`[data-diag="${k}"]`), k, adv[k], { estilo: 'secao', tom });
    if (curva) {
        const { graficoLinhas } = await import('./graficos.js');
        const pontos = (a) => (a || []).map(([x, y]) => ({ x, y }));
        graficoLinhas(d.querySelector('#det-curva'), {
            series: [
                { nome: 'Download', cor: 'var(--serie-download)', pontos: pontos(curva.download), area: true },
                { nome: 'Upload', cor: 'var(--serie-upload)', pontos: pontos(curva.upload), tracejado: true },
            ],
            altura: 180,
            formatoY: (y) => fmtMbps(y),
            formatoEixo: (y) => fmtNum(y, y < 10 && y % 1 ? 1 : 0),
            formatoX: (x) => `${fmtNum(x, 0)} s`,
            formatoDica: (x) => `${fmtNum(x, 1)} s depois do início`,
        });
    }

    d.querySelector('[data-copiar]').addEventListener('click', async () => {
        const ok = await copiar(texto);
        toast(ok ? 'Resultado completo copiado.' : 'Não foi possível copiar.', ok ? 'ok' : 'ruim');
        if (ok) evento('share', { method: 'copiar', content_type: 'resultado' });
    });
    d.querySelector('[data-whatsapp]').addEventListener('click', () => evento('share', { method: 'whatsapp', content_type: 'resultado' }));
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
