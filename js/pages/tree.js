// /tree: mapa com todos os caminhos do site, para quem cada um é, se a conta
// atual tem acesso, e botões para compartilhar.

import { ICON } from '../core/icons.js';
import { iniciarPagina } from '../core/shell.js';
import { $, copiar, esc, evento, toast } from '../core/util.js';

const sessao = await iniciarPagina({ pagina: 'tree' });
const me = sessao.me || null;

// acesso: publico | conta | tecnico | admin
const ARVORE = [
    {
        caminho: '/', titulo: 'Teste de velocidade', icone: ICON.gauge, acesso: 'publico',
        texto: 'Teste rápido (cerca de 30 s) ou diagnóstico completo, com guia e perguntas frequentes.',
        filhos: [
            { caminho: '/#guia', titulo: 'Como funciona o teste', acesso: 'publico', texto: 'O passo a passo e o que cada número significa.' },
            { caminho: '/#perguntas', titulo: 'Perguntas frequentes', acesso: 'publico', texto: 'Ping, jitter, perda de pacotes, Wi-Fi e mais.' },
            { caminho: '/r/…', titulo: 'Resultado compartilhado', acesso: 'publico', exemplo: true, texto: 'O link que cada teste ganha, com prévia para o WhatsApp. Sem nome, IP nem localização.' },
        ],
    },
    {
        caminho: '/como-medimos', titulo: 'Como medimos', icone: ICON.info, acesso: 'publico',
        texto: 'O método de cada medida e por que os números são confiáveis.',
    },
    {
        caminho: '/entrar', titulo: 'Entrar', icone: ICON.login, acesso: 'publico',
        texto: 'Entrar na conta, com "manter conectado" e "esqueci minha senha".',
        filhos: [
            { caminho: '/cadastro', titulo: 'Criar conta', acesso: 'publico', texto: 'Cadastro gratuito, com captcha.' },
        ],
    },
    {
        caminho: '/painel', titulo: 'Meu painel', icone: ICON.history, acesso: 'conta',
        texto: 'Histórico, gráfico ao longo do tempo, mapa e melhor horário.',
        filhos: [
            { caminho: '/painel#historico', titulo: 'Histórico de testes', acesso: 'conta', texto: 'Todos os testes, com filtros e planilha.' },
            { caminho: '/painel#conta', titulo: 'Meus dados', acesso: 'conta', texto: 'Cadastro, senha, aparelhos conectados, baixar e excluir dados.' },
        ],
    },
    {
        caminho: '/tecnico', titulo: 'Speed Teste Técnico', icone: ICON.sliders, acesso: 'tecnico',
        texto: 'Teste com todas as medidas, dados do atendimento e os testes de todos os clientes.',
    },
    {
        caminho: '/admin', titulo: 'Administração', icone: ICON.shield, acesso: 'admin',
        texto: 'Visão geral, ao vivo, testes, usuários, acessos, auditoria e sistema.',
        filhos: [
            { caminho: '/admin#geral', titulo: 'Visão geral', acesso: 'admin' },
            { caminho: '/admin#vivo', titulo: 'Ao vivo', acesso: 'admin', texto: 'Quem está no site e testando agora.' },
            { caminho: '/admin#testes', titulo: 'Testes', acesso: 'admin' },
            { caminho: '/admin#usuarios', titulo: 'Usuários', acesso: 'admin' },
            { caminho: '/admin#admins', titulo: 'Administradores', acesso: 'admin' },
            { caminho: '/admin#auditoria', titulo: 'Auditoria', acesso: 'admin' },
            { caminho: '/admin#sistema', titulo: 'Sistema', acesso: 'admin' },
        ],
    },
    {
        caminho: '/privacidade', titulo: 'Política de privacidade', icone: ICON.lock, acesso: 'publico',
        texto: 'Quais dados o teste guarda, por quanto tempo e seus direitos (LGPD).',
        filhos: [
            { caminho: '/privacidade#cookies', titulo: 'Cookies e estatísticas', acesso: 'publico' },
        ],
    },
    { caminho: '/termos', titulo: 'Termos de uso', icone: ICON.list, acesso: 'publico' },
    { caminho: '/tree', titulo: 'Mapa do site', icone: ICON.route, acesso: 'publico', texto: 'Esta página.' },
    {
        caminho: '/sitemap.xml', titulo: 'Para buscadores', icone: ICON.globe, acesso: 'publico',
        texto: 'Mapa do site para o Google e o Bing.',
        filhos: [{ caminho: '/robots.txt', titulo: 'robots.txt', acesso: 'publico' }],
    },
];

const NOME_ACESSO = { publico: 'Público', conta: 'Com conta', tecnico: 'Técnico', admin: 'Admin' };

function temAcesso(acesso) {
    if (acesso === 'publico') return true;
    if (!me) return false;
    if (acesso === 'conta') return true;
    if (acesso === 'tecnico') return !!me.isTecnico;
    return !!me.isAdmin;
}

const linkCompleto = (caminho) => location.origin + caminho;

function itemHtml(n, nivel) {
    const pode = temAcesso(n.acesso);
    const situacao = n.acesso === 'publico' ? '' : me ? (pode ? '<span class="tem-acesso">você tem acesso</span>' : '<span class="sem-acesso">sem acesso nesta conta</span>') : '<span class="sem-acesso">entre para ver</span>';
    const titulo = n.exemplo
        ? `<span class="arvore-link exemplo"><code>${esc(n.caminho)}</code><strong>${esc(n.titulo)}</strong></span>`
        : `<a class="arvore-link" href="${esc(n.caminho)}"><code>${esc(n.caminho)}</code><strong>${esc(n.titulo)}</strong></a>`;
    const compartilhar = n.exemplo ? '' : `<span class="arvore-botoes">
            <button type="button" class="botao botao-fantasma botao-icone" data-copiar="${esc(n.caminho)}" aria-label="Copiar o link de ${esc(n.titulo)}" title="Copiar link">${ICON.copy}</button>
            <a class="botao botao-fantasma botao-icone" href="https://wa.me/?text=${encodeURIComponent(`${n.titulo}, teste de velocidade Audicom: ${linkCompleto(n.caminho)}`)}" target="_blank" rel="noopener" aria-label="Enviar ${esc(n.titulo)} no WhatsApp" title="Enviar no WhatsApp">${ICON.whatsapp}</a>
        </span>`;
    const filhos = (n.filhos || []).length ? `<ul>${n.filhos.map((f) => itemHtml(f, nivel + 1)).join('')}</ul>` : '';
    return `<li class="nivel-${nivel}${pode ? '' : ' bloqueado'}">
        <div class="arvore-no">
            ${nivel === 0 && n.icone ? `<span class="arvore-icone" aria-hidden="true">${n.icone}</span>` : ''}
            <div class="arvore-info">${titulo}
                <span class="arvore-meta"><span class="acesso ${n.acesso}">${NOME_ACESSO[n.acesso]}</span>${situacao}</span>
                ${n.texto ? `<p>${esc(n.texto)}</p>` : ''}
            </div>
            ${compartilhar}
        </div>${filhos}</li>`;
}

$('#arvore').innerHTML = `<ul class="arvore-raiz">${ARVORE.map((n) => itemHtml(n, 0)).join('')}</ul>`;

$('#arvore').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-copiar]');
    if (!b) return;
    const ok = await copiar(linkCompleto(b.dataset.copiar));
    toast(ok ? 'Link copiado.' : 'Não foi possível copiar.', ok ? 'ok' : 'ruim');
    if (ok) evento('share', { method: 'copiar', content_type: 'caminho', item_id: b.dataset.copiar });
});

// compartilhar o mapa inteiro: menu do aparelho quando existe, senão copia
const urlMapa = linkCompleto('/tree');
const botao = $('#compartilhar-mapa');
botao.innerHTML = `${ICON.share}Compartilhar o mapa`;
botao.addEventListener('click', async () => {
    if (navigator.share) {
        try { await navigator.share({ title: 'Mapa do site: teste de velocidade Audicom', text: 'Todos os caminhos do teste de velocidade da Audicom', url: urlMapa }); evento('share', { method: 'nativo', content_type: 'mapa' }); return; }
        catch (err) { if (err && err.name === 'AbortError') return; }
    }
    const ok = await copiar(urlMapa);
    toast(ok ? 'Link do mapa copiado.' : 'Não foi possível copiar.', ok ? 'ok' : 'ruim');
    if (ok) evento('share', { method: 'copiar', content_type: 'mapa' });
});
const zap = $('#zap-mapa');
zap.innerHTML = `${ICON.whatsapp}WhatsApp`;
zap.href = 'https://wa.me/?text=' + encodeURIComponent(`Todos os caminhos do teste de velocidade da Audicom: ${urlMapa}`);
zap.addEventListener('click', () => evento('share', { method: 'whatsapp', content_type: 'mapa' }));
