// "Enviar para o Zap" (técnico e administração): manda um teste guardado, com
// fotos, para um dos destinos que a administração liberou. O texto é montado
// no servidor; daqui só vão o teste, o destino, a observação e as fotos.
//
// As fotos são redesenhadas aqui antes de sair (no máximo 1600 px, JPEG): ficam
// leves para enviar pelo celular e perdem os dados escondidos da câmera, como
// a posição GPS (LGPD).

import { api } from '../core/auth.js';
import { ICON } from '../core/icons.js';
import { esc, evento, toast } from '../core/util.js';

const MAX_FOTOS = 6;

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

/** Abre a janela de envio para o teste `t` (precisa de id e protocolo). */
export async function abrirEnvioZap(t) {
    let info;
    try { info = await api('/api/tecnico/zap'); } catch (e) { toast(e.message, 'ruim'); return; }
    const d = document.createElement('dialog');
    d.className = 'modal';
    d.style.width = 'min(560px, calc(100% - 32px))';
    document.body.appendChild(d);
    d.addEventListener('close', () => { fotos.forEach((f) => URL.revokeObjectURL(f.previa)); d.remove(); });
    const fotos = [];

    if (!info.pronto) {
        d.innerHTML = `<div class="modal-corpo"><h2>Enviar para o Zap</h2>
            <p>${info.estado !== 'conectado' ? 'O WhatsApp da empresa não está conectado.' : 'Nenhum grupo ou contato foi liberado ainda.'} Um administrador resolve em <strong>Administração → WhatsApp</strong>.</p>
            <div class="modal-acoes"><button type="button" class="botao botao-primario" data-fechar>Entendi</button></div></div>`;
        d.querySelector('[data-fechar]').addEventListener('click', () => d.close());
        d.showModal();
        return;
    }

    const at = t.atendimento || {};
    const local = t.place && t.place.label
        ? (t.place.source === 'aparelho' ? { ok: true, texto: `Com localização do aparelho: ${t.place.label}` } : { ok: false, texto: `Sem localização do aparelho (cidade pelo IP: ${t.place.label})` })
        : { ok: false, texto: 'Sem localização' };
    d.innerHTML = `<form class="modal-corpo" method="dialog" novalidate>
        <h2>Enviar para o Zap</h2>
        <p class="suave" style="font-size:var(--t-sm)">Teste ${esc(t.protocol || '')}. Vai com todas as medidas, quem fez o teste e quem está enviando.</p>
        <p class="zap-local ${local.ok ? 'ok' : ''}">${ICON.pin}<span>${esc(local.texto)}</span></p>
        <div class="campo"><label for="zap-destino">Para</label>
            <select class="entrada" id="zap-destino">${info.destinos.map((x) => `<option value="${esc(x.jid)}" ${x.jid === info.padrao ? 'selected' : ''}>${x.tipo === 'grupo' ? 'Grupo: ' : ''}${esc(x.nome)}</option>`).join('')}</select></div>
        <div class="zap-campos">
            <div class="campo"><label for="zap-cliente">Cliente (nome, código ou contrato)</label>
                <input class="entrada" id="zap-cliente" maxlength="80" autocomplete="off" value="${esc(at.cliente || '')}"></div>
            <div class="campo"><label for="zap-plano">Plano (Mbps)</label>
                <input class="entrada" id="zap-plano" type="number" min="1" max="100000" inputmode="numeric" autocomplete="off" placeholder="Ex.: 500" value="${at.plano ? esc(String(at.plano)) : ''}"></div>
        </div>
        <div class="campo"><label for="zap-obs">Observação</label>
            <textarea class="entrada" id="zap-obs" rows="2" maxlength="500" placeholder="Ex.: troquei o conector, Wi-Fi 5 GHz na sala">${esc(at.obs || '')}</textarea></div>
        <div class="campo"><span class="rotulo-campo">Fotos (até ${MAX_FOTOS})</span>
            <label class="botao botao-secundario botao-pequeno zap-escolher">${ICON.plus}Anexar fotos
                <input type="file" accept="image/*" multiple id="zap-arquivos"></label>
            <div class="zap-fotos" id="zap-fotos"></div></div>
        <p class="erro-campo" role="alert" hidden></p>
        <div class="modal-acoes">
            <button type="button" class="botao botao-fantasma" data-fechar>Cancelar</button>
            <button type="submit" class="botao botao-primario" id="zap-enviar">${ICON.whatsapp}Enviar</button>
        </div></form>`;
    const erro = d.querySelector('.erro-campo');
    const desenharFotos = () => {
        d.querySelector('#zap-fotos').innerHTML = fotos.map((f, i) => `<figure><img src="${f.previa}" alt="Foto ${i + 1}"><button type="button" data-tirar="${i}" aria-label="Tirar a foto ${i + 1}">${ICON.x}</button></figure>`).join('');
    };
    d.querySelector('[data-fechar]').addEventListener('click', () => d.close());
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
        for (const a of arquivos) {
            try { fotos.push(await prepararFoto(a)); } catch { toast(`Não deu para usar "${a.name}". Envie uma foto (JPEG, PNG ou similar).`, 'ruim'); }
        }
        desenharFotos();
    });
    d.querySelector('form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const botao = d.querySelector('#zap-enviar');
        botao.disabled = true;
        botao.textContent = fotos.length ? `Enviando ${fotos.length} foto(s)…` : 'Enviando…';
        erro.hidden = true;
        try {
            const r = await api('/api/tecnico/zap/enviar', { method: 'POST', body: {
                teste: t.id, destino: d.querySelector('#zap-destino').value,
                atendimento: { cliente: d.querySelector('#zap-cliente').value, plano: d.querySelector('#zap-plano').value ? Number(d.querySelector('#zap-plano').value) : null, obs: d.querySelector('#zap-obs').value },
                fotos: fotos.map((f) => ({ imagem: f.imagem, miniatura: f.miniatura })),
            } });
            toast(`Enviado para ${r.destino}${r.fotos ? `, com ${r.fotos} foto(s)` : ''}.`, 'ok');
            evento('share', { method: 'whatsapp-empresa', content_type: 'teste-tecnico' });
            d.close();
        } catch (err) {
            erro.textContent = err.message;
            erro.hidden = false;
            botao.disabled = false;
            botao.innerHTML = `${ICON.whatsapp}Enviar`;
        }
    });
    d.showModal();
}
