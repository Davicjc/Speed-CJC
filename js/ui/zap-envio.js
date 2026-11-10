// "Enviar para o Zap" (técnico e administração): manda um teste guardado, com
// fotos, para um dos destinos que a administração liberou. O texto é montado
// no servidor; daqui só vão o teste, o destino, a observação e as fotos.
//
// As fotos são redesenhadas aqui antes de sair (no máximo 1600 px, JPEG): ficam
// leves para enviar pelo celular e perdem os dados escondidos da câmera, como
// a posição GPS (LGPD).

import { api } from '../core/auth.js';
import { ICON } from '../core/icons.js';
import { esc, evento, storage, store, toast } from '../core/util.js';

const MAX_FOTOS = 6;
const CHAVE_DESTINO = 'speedcjc.zap-destino'; // último grupo usado neste aparelho

function blobBase64(blob) {
    return new Promise((ok, falha) => {
        const r = new FileReader();
        r.onload = () => ok(String(r.result).split(',')[1]);
        r.onerror = () => falha(new Error('não foi possível ler a foto'));
        r.readAsDataURL(blob);
    });
}

async function redesenhar(bmp, lado, qualidade) {
    const escala = Math.min(1, lado / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(bmp.width * escala));
    c.height = Math.max(1, Math.round(bmp.height * escala));
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    return new Promise((ok) => c.toBlob(ok, 'image/jpeg', qualidade));
}

/** Foto pronta para enviar: JPEG reduzido (sem metadados) + miniatura + prévia. */
async function prepararFoto(arquivo) {
    const bmp = await createImageBitmap(arquivo, { imageOrientation: 'from-image' });
    let qualidade = 0.82;
    let grande = await redesenhar(bmp, 1600, qualidade);
    while (grande.size > 2.8 * 1024 * 1024 && qualidade > 0.4) { qualidade -= 0.15; grande = await redesenhar(bmp, 1600, qualidade); }
    const mini = await redesenhar(bmp, 96, 0.6);
    bmp.close && bmp.close();
    return { imagem: await blobBase64(grande), miniatura: await blobBase64(mini), previa: URL.createObjectURL(mini), tamanho: grande.size };
}

// Os destinos liberados mudam pouco: busca uma vez e reaproveita por 1 minuto,
// para a janela abrir na hora (o teste chama preparar() assim que termina).
let infoCache = null;
export function prepararEnvioZap() {
    if (!infoCache || Date.now() - infoCache.em > 60_000) {
        const p = api('/api/tecnico/zap');
        infoCache = { em: Date.now(), p };
        p.catch(() => { infoCache = null; });
    }
    return infoCache.p;
}

/** Abre a janela de envio para o teste `t` (precisa de id e protocolo). */
export async function abrirEnvioZap(t) {
    let info;
    try { info = await prepararEnvioZap(); } catch (e) { toast(e.message, 'ruim'); return; }
    const d = document.createElement('dialog');
    d.className = 'modal zap-modal';
    document.body.appendChild(d);
    const fotos = [];
    d.addEventListener('close', () => { fotos.forEach((f) => URL.revokeObjectURL(f.previa)); d.remove(); });

    if (!info.pronto) {
        d.innerHTML = `<div class="modal-corpo"><h2>Enviar para o Zap</h2>
            <p>${info.estado !== 'conectado' ? 'O WhatsApp da empresa não está conectado.' : 'Nenhum grupo ou contato foi liberado ainda.'} Um administrador resolve em <strong>Administração → WhatsApp</strong>.</p>
            <div class="modal-acoes"><button type="button" class="botao botao-primario" data-fechar>Entendi</button></div></div>`;
        d.querySelector('[data-fechar]').addEventListener('click', () => d.close());
        d.showModal();
        return;
    }

    const at = t.atendimento || {};
    const ultimo = storage(CHAVE_DESTINO, null);
    const escolhido = info.destinos.some((x) => x.jid === ultimo) ? ultimo : (info.padrao || info.destinos[0].jid);
    const comGps = t.place && t.place.source === 'aparelho';
    const semCliente = !at.cliente;
    d.innerHTML = `<form class="modal-corpo zap-form" method="dialog" novalidate>
        <div class="zap-topo">
            <h2>${ICON.whatsapp}Enviar para o Zap</h2>
            <button type="button" class="zap-x" data-fechar aria-label="Fechar">${ICON.x}</button>
        </div>
        <div class="zap-resumo">
            <div><strong id="zap-resumo-cliente">${esc(at.cliente || 'Cliente não informado')}</strong>
                <span>${at.codigo != null ? `Código ${esc(String(at.codigo))} · ` : ''}<span id="zap-resumo-plano">${at.plano ? `${esc(String(at.plano))} Mbps · ` : ''}</span>${esc(t.protocol || '')}</span></div>
            <button type="button" class="zap-link" data-editar aria-expanded="${semCliente}">${semCliente ? 'Fechar' : 'Mudar'}</button>
        </div>
        <div class="zap-campos" id="zap-editar" ${semCliente ? '' : 'hidden'}>
            <div class="campo"><label for="zap-cliente">Cliente (nome, código ou contrato)</label>
                <input class="entrada" id="zap-cliente" maxlength="80" autocomplete="off" value="${esc(at.cliente || '')}"></div>
            <div class="campo"><label for="zap-plano">Plano (Mbps)</label>
                <input class="entrada" id="zap-plano" type="number" min="1" max="100000" inputmode="numeric" autocomplete="off" placeholder="Ex.: 500" value="${at.plano ? esc(String(at.plano)) : ''}"></div>
        </div>

        <fieldset class="zap-passo">
            <legend><span class="zap-num">1</span>Para qual grupo?</legend>
            <div class="zap-opcoes">${info.destinos.map((x) => `<label class="zap-opcao"><input type="radio" name="zap-destino" value="${esc(x.jid)}" ${x.jid === escolhido ? 'checked' : ''}><span>${x.tipo === 'grupo' ? ICON.users : ICON.user}${esc(x.nome)}</span></label>`).join('')}</div>
        </fieldset>

        <fieldset class="zap-passo">
            <legend><span class="zap-num">2</span>Fotos <small>(se quiser, até ${MAX_FOTOS})</small></legend>
            <div class="zap-fotos" id="zap-fotos"></div>
            <label class="zap-foto-botao" id="zap-foto-botao">${ICON.plus}<span>Tirar ou escolher foto</span>
                <input type="file" accept="image/*" multiple id="zap-arquivos"></label>
        </fieldset>

        <fieldset class="zap-passo">
            <legend><span class="zap-num">3</span>O que foi feito? <small>(se quiser)</small></legend>
            <textarea class="entrada" id="zap-obs" rows="3" maxlength="500" placeholder="Escreva aqui. Ex.: troquei o conector, Wi-Fi 5 GHz na sala">${esc(at.obs || '')}</textarea>
        </fieldset>

        <p class="zap-gps ${comGps ? 'ok' : ''}">${ICON.pin}<span>${comGps ? `Vai com a localização do aparelho (${esc(t.place.label)})` : 'Sem a localização do aparelho'}</span></p>
        <p class="erro-campo" role="alert" hidden></p>
        <button type="submit" class="botao zap-enviar-grande" id="zap-enviar">${ICON.whatsapp}Enviar para o Zap</button>
    </form>`;

    const erro = d.querySelector('.erro-campo');
    const desenharFotos = () => {
        d.querySelector('#zap-fotos').innerHTML = fotos.map((f, i) => `<figure><img src="${f.previa}" alt="Foto ${i + 1}"><button type="button" data-tirar="${i}" aria-label="Tirar a foto ${i + 1}">${ICON.x}</button></figure>`).join('');
        d.querySelector('#zap-foto-botao span').textContent = fotos.length ? `Mais uma foto (${fotos.length} de ${MAX_FOTOS})` : 'Tirar ou escolher foto';
        d.querySelector('#zap-foto-botao').hidden = fotos.length >= MAX_FOTOS;
    };
    d.querySelector('[data-fechar]').addEventListener('click', () => d.close());
    d.querySelector('[data-editar]').addEventListener('click', (e) => {
        const caixa = d.querySelector('#zap-editar');
        caixa.hidden = !caixa.hidden;
        e.currentTarget.textContent = caixa.hidden ? 'Mudar' : 'Fechar';
        e.currentTarget.setAttribute('aria-expanded', String(!caixa.hidden));
        if (!caixa.hidden) d.querySelector('#zap-cliente').focus();
    });
    d.querySelector('#zap-cliente').addEventListener('input', (e) => { d.querySelector('#zap-resumo-cliente').textContent = e.target.value.trim() || 'Cliente não informado'; });
    d.querySelector('#zap-plano').addEventListener('input', (e) => { d.querySelector('#zap-resumo-plano').textContent = e.target.value ? `${e.target.value} Mbps · ` : ''; });
    d.querySelector('#zap-fotos').addEventListener('click', (e) => {
        const b = e.target.closest('[data-tirar]');
        if (!b) return;
        const [f] = fotos.splice(Number(b.dataset.tirar), 1);
        if (f) URL.revokeObjectURL(f.previa);
        desenharFotos();
    });
    d.querySelector('#zap-arquivos').addEventListener('change', async (e) => {
        const arquivos = [...e.target.files].slice(0, MAX_FOTOS - fotos.length);
        e.target.value = '';
        if (!arquivos.length) { toast(`No máximo ${MAX_FOTOS} fotos.`, 'info'); return; }
        const rotulo = d.querySelector('#zap-foto-botao span');
        rotulo.textContent = 'Preparando a foto…';
        for (const a of arquivos) {
            try { fotos.push(await prepararFoto(a)); } catch { toast(`Não deu para usar "${a.name}". Envie uma foto (JPEG, PNG ou similar).`, 'ruim'); }
        }
        desenharFotos();
    });
    d.querySelector('form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const botao = d.querySelector('#zap-enviar');
        const destino = (d.querySelector('input[name="zap-destino"]:checked') || {}).value;
        if (!destino) { erro.textContent = 'Escolha o grupo.'; erro.hidden = false; return; }
        botao.disabled = true;
        botao.innerHTML = `<span class="giro" aria-hidden="true"></span>${fotos.length ? `Enviando o teste e ${fotos.length === 1 ? 'a foto' : `${fotos.length} fotos`}…` : 'Enviando…'}`;
        erro.hidden = true;
        try {
            const r = await api('/api/tecnico/zap/enviar', { method: 'POST', body: {
                teste: t.id, destino,
                atendimento: { cliente: d.querySelector('#zap-cliente').value, plano: d.querySelector('#zap-plano').value ? Number(d.querySelector('#zap-plano').value) : null, obs: d.querySelector('#zap-obs').value, codigo: at.codigo ?? null },
                fotos: fotos.map((f) => ({ imagem: f.imagem, miniatura: f.miniatura })),
            } });
            store(CHAVE_DESTINO, destino);
            toast(`Enviado para ${r.destino}${r.fotos ? `, com ${r.fotos} foto(s)` : ''}.`, 'ok');
            evento('share', { method: 'whatsapp-empresa', content_type: 'teste-tecnico' });
            d.close();
        } catch (err) {
            erro.textContent = err.message;
            erro.hidden = false;
            botao.disabled = false;
            botao.innerHTML = `${ICON.whatsapp}Tentar de novo`;
        }
    });
    d.showModal();
    if (semCliente && !matchMedia('(hover: none)').matches) d.querySelector('#zap-cliente').focus();
}
