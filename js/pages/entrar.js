import { MARCA } from '../core/marca.js';
import { ApiError, cadastrar, conferirLinkSenha, confirmarEmail, entrar, novaSenhaComCodigo, redefinirSenha, sair } from '../core/auth.js';
import { ICON } from '../core/icons.js';
import { reivindicarPendentes } from '../core/pendentes.js';
import { iniciarPagina } from '../core/shell.js';
import { $, $$, esc, toast } from '../core/util.js';
import { montarCaptcha } from '../ui/captcha.js';

const params = new URLSearchParams(location.search);
// só caminhos internos: nada de redirecionar para outro site depois do login
const destino = (() => {
    const n = params.get('next') || '';
    return /^\/(?!\/)[\w\-/#?=&%.]*$/.test(n) && !n.startsWith('/entrar') ? n : '/painel';
})();

const sessao = await iniciarPagina({ pagina: 'conta' });
const cfg = sessao.cfg || {};
const sup = cfg.support || {};
const whatsapp = sup.whatsapp ? `https://wa.me/${encodeURIComponent(sup.whatsapp)}` : null;

const PAINEIS = ['formularios', 'form-esqueci', 'form-nova-senha', 'mensagem', 'ja-logado', 'indisponivel'];
function mostrar(id) {
    PAINEIS.forEach((p) => { $('#' + p).hidden = p !== id; });
    const foco = $('#' + id).querySelector('h1');
    if (foco) { foco.tabIndex = -1; foco.focus({ preventScroll: true }); }
}

function mensagem({ titulo, texto, icone = ICON.checkCircle, atencao = false, acoes = [] }) {
    $('#mensagem-icone').innerHTML = icone;
    $('#mensagem-icone').className = 'mensagem-icone' + (atencao ? ' atencao' : '');
    $('#mensagem-titulo').textContent = titulo;
    $('#mensagem-texto').textContent = texto;
    const a = $('#mensagem-acoes');
    a.innerHTML = '';
    for (const x of acoes) {
        const el = document.createElement(x.href ? 'a' : 'button');
        el.className = 'botao ' + (x.primario ? 'botao-primario' : 'botao-secundario');
        el.textContent = x.rotulo;
        if (x.href) { el.href = x.href; if (x.novaAba) { el.target = '_blank'; el.rel = 'noopener'; } } else { el.type = 'button'; el.addEventListener('click', x.acao); }
        a.appendChild(el);
    }
    mostrar('mensagem');
}

// ---------- abas ----------
function aba(qual) {
    const criar = qual === 'criar';
    $('#aba-entrar').setAttribute('aria-selected', String(!criar));
    $('#aba-criar').setAttribute('aria-selected', String(criar));
    $('#aba-entrar').tabIndex = criar ? -1 : 0;
    $('#aba-criar').tabIndex = criar ? 0 : -1;
    $('#form-entrar').hidden = criar;
    $('#form-criar').hidden = !criar;
    mostrar('formularios');
    const busca = new URLSearchParams(location.search);
    for (const k of ['confirmar', 'nova-senha']) busca.delete(k);
    history.replaceState(null, '', (criar ? '/cadastro' : '/entrar') + (busca.toString() ? '?' + busca : ''));
    document.title = (criar ? 'Criar conta' : 'Entrar') + ` | ${MARCA}`;
    if (criar) prepararCaptcha();
}
$('#aba-entrar').addEventListener('click', () => aba('entrar'));
$('#aba-criar').addEventListener('click', () => aba('criar'));
$('.abas').addEventListener('keydown', (e) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    const criar = $('#aba-criar').getAttribute('aria-selected') === 'true';
    aba(criar ? 'entrar' : 'criar');
    (criar ? $('#aba-entrar') : $('#aba-criar')).focus();
});
$$('[data-ir]').forEach((b) => b.addEventListener('click', () => aba(b.dataset.ir)));
$('#ir-esqueci').addEventListener('click', () => {
    if (!cfg.mail) {
        mensagem({
            titulo: 'Esqueceu a senha?',
            texto: 'Fale com o suporte pelo WhatsApp: eles conferem que a conta é sua e mandam um link para você criar uma senha nova.',
            icone: ICON.support,
            acoes: [...(whatsapp ? [{ rotulo: 'Falar no WhatsApp', primario: true, href: whatsapp, novaAba: true }] : []), { rotulo: 'Voltar para entrar', acao: () => aba('entrar') }],
        });
        return;
    }
    $('#r-email').value = $('#e-email').value;
    mostrar('form-esqueci');
    $('#r-email').focus();
});

// mostrar/esconder senha
$$('.ver-senha').forEach((b) => {
    b.innerHTML = ICON.eye;
    b.addEventListener('click', () => {
        const inp = b.parentElement.querySelector('input');
        const ver = inp.type === 'password';
        inp.type = ver ? 'text' : 'password';
        b.innerHTML = ver ? ICON.eyeOff : ICON.eye;
        b.setAttribute('aria-pressed', String(ver));
        b.setAttribute('aria-label', ver ? 'Esconder senha' : 'Mostrar senha');
    });
});

// ---------- utilidades de formulário ----------
function erroForm(form, msg) {
    const p = form.querySelector('.erro-form');
    p.textContent = msg || '';
    p.hidden = !msg;
}
const marcarInvalido = (input, invalido) => input.setAttribute('aria-invalid', invalido ? 'true' : 'false');
async function ocupado(form, fn) {
    const b = form.querySelector('button[type="submit"]');
    const t = b.innerHTML;
    b.disabled = true;
    b.innerHTML = '<span class="giro" aria-hidden="true"></span> Aguarde…';
    try { return await fn(); } finally { b.disabled = false; b.innerHTML = t; }
}
const emailValido = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
function problemaSenha(s, email) {
    if (s.length < 8) return 'A senha precisa ter pelo menos 8 caracteres.';
    if (!/\p{L}/u.test(s) || !/\d/.test(s)) return 'Use letras e números na senha.';
    const u = (email || '').split('@')[0].toLowerCase();
    if (u.length >= 4 && s.toLowerCase().includes(u)) return 'A senha não pode conter o seu e-mail.';
    return null;
}
function forca(s) {
    let n = 0;
    if (s.length >= 8) n++;
    if (s.length >= 12) n++;
    if (/[a-z]/.test(s) && /[A-Z]/.test(s)) n++;
    if (/\d/.test(s) && /[^\w\s]/.test(s)) n++;
    return s ? Math.max(1, Math.min(4, n)) : 0;
}

// ---------- entrar ----------
$('#form-entrar').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = ev.currentTarget;
    const email = $('#e-email').value.trim();
    const senha = $('#e-senha').value;
    marcarInvalido($('#e-email'), !emailValido(email));
    marcarInvalido($('#e-senha'), !senha);
    if (!emailValido(email)) return erroForm(f, 'Informe um e-mail válido.');
    if (!senha) return erroForm(f, 'Informe a senha.');
    erroForm(f, null);
    await ocupado(f, async () => {
        try {
            await entrar(email, senha, { lembrar: $('#e-lembrar').checked });
        } catch (e) {
            return erroForm(f, e.message);
        }
        await reivindicarPendentes().catch(() => {});
        location.href = destino;
    });
});

// ---------- criar conta ----------
let captcha = null;
async function prepararCaptcha() {
    if (captcha) return;
    try {
        captcha = await montarCaptcha($('#captcha'), cfg.captcha);
    } catch (e) {
        $('#captcha').innerHTML = `<p class="erro-form">${esc(e.message)}. Recarregue a página.</p>`;
    }
}

$('#c-senha').addEventListener('input', () => { $('#forca').dataset.nivel = String(forca($('#c-senha').value)); });
$('#c-tel').addEventListener('input', (e) => {
    let d = e.target.value.replace(/\D/g, '').slice(0, 11);
    if (d.length > 6) d = `(${d.slice(0, 2)}) ${d.slice(2, d.length === 11 ? 7 : 6)}-${d.slice(d.length === 11 ? 7 : 6)}`;
    else if (d.length > 2) d = `(${d.slice(0, 2)}) ${d.slice(2)}`;
    else if (d.length) d = `(${d}`;
    e.target.value = d;
});

$('#form-criar').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = ev.currentTarget;
    const nome = $('#c-nome').value.replace(/\s+/g, ' ').trim();
    const email = $('#c-email').value.trim().toLowerCase();
    const tel = $('#c-tel').value.trim();
    const senha = $('#c-senha').value;
    const senha2 = $('#c-senha2').value;
    const checagens = [
        [$('#c-nome'), nome.length < 2 || !/\p{L}/u.test(nome), 'Informe seu nome.'],
        [$('#c-email'), !emailValido(email), 'Informe um e-mail válido.'],
        [$('#c-tel'), tel && ![10, 11].includes(tel.replace(/\D/g, '').length), 'Informe o telefone com DDD, ou deixe em branco.'],
        [$('#c-senha'), !!problemaSenha(senha, email), problemaSenha(senha, email)],
        [$('#c-senha2'), senha !== senha2, 'As duas senhas não são iguais.'],
    ];
    for (const [inp, ruim] of checagens) marcarInvalido(inp, ruim);
    const primeiro = checagens.find((c) => c[1]);
    if (primeiro) { erroForm(f, primeiro[2]); primeiro[0].focus(); return; }
    if (!$('#c-termos').checked) return erroForm(f, 'Para criar a conta, aceite os termos de uso e a política de privacidade.');
    const resposta = captcha && captcha.resposta();
    if (!resposta) return erroForm(f, cfg.captcha && cfg.captcha.provider === 'turnstile' ? 'Conclua a verificação de segurança.' : 'Clique em "Não sou um robô" para confirmar.');
    erroForm(f, null);

    await ocupado(f, async () => {
        let r;
        try {
            r = await cadastrar({ name: nome, email, phone: tel || null, password: senha, terms: true, website: $('#c-site').value, captcha: resposta, lembrar: true });
        } catch (e) {
            if (!(e instanceof ApiError) || e.code !== 'exists') captcha && captcha.reiniciar();
            return erroForm(f, e.message);
        }
        await reivindicarPendentes({ avisar: false }).catch(() => {});
        mensagem({
            titulo: 'Conta criada',
            texto: r.emailSent
                ? `Você já está conectado. Enviamos um link de confirmação para ${email}; confirme quando puder.`
                : 'Você já está conectado. A partir de agora, todo teste que você fizer fica guardado no seu painel.',
            acoes: [{ rotulo: destino === '/painel' ? 'Ir para o meu painel' : 'Continuar', primario: true, href: destino }, { rotulo: 'Fazer um teste agora', href: '/' }],
        });
    });
});

// ---------- esqueci a senha (com e-mail ligado) ----------
$('#form-esqueci').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = ev.currentTarget;
    const email = $('#r-email').value.trim();
    if (!emailValido(email)) { marcarInvalido($('#r-email'), true); return erroForm(f, 'Informe um e-mail válido.'); }
    erroForm(f, null);
    await ocupado(f, async () => {
        try {
            await redefinirSenha(email);
        } catch (e) {
            return erroForm(f, e.message);
        }
        mensagem({
            titulo: 'Confira seu e-mail',
            texto: `Se existir uma conta com ${email}, enviamos um link para criar uma nova senha. Ele vale por 1 hora; olhe também a caixa de spam.`,
            icone: ICON.mail,
            acoes: [{ rotulo: 'Voltar para entrar', primario: true, acao: () => aba('entrar') }],
        });
    });
});

// ---------- links (confirmar e-mail, criar nova senha) ----------
async function tratarLink() {
    const confirmar = params.get('confirmar');
    if (confirmar) {
        try {
            await confirmarEmail(confirmar);
            mensagem({ titulo: 'E-mail confirmado', texto: 'Obrigado. Sua conta está completa.', acoes: [{ rotulo: sessao.user ? 'Ir para o meu painel' : 'Entrar', primario: true, ...(sessao.user ? { href: '/painel' } : { acao: () => aba('entrar') }) }] });
        } catch (e) {
            mensagem({ titulo: 'Não foi possível confirmar', texto: e.message, icone: ICON.alert, atencao: true, acoes: [{ rotulo: 'Ir para o painel', href: '/painel' }] });
        }
        return true;
    }
    const codigo = params.get('nova-senha');
    if (codigo) {
        let info;
        try { info = await conferirLinkSenha(codigo); } catch (e) {
            mensagem({
                titulo: 'Link inválido', texto: e.message, icone: ICON.alert, atencao: true,
                acoes: cfg.mail ? [{ rotulo: 'Pedir um novo link', primario: true, acao: () => mostrar('form-esqueci') }] : (whatsapp ? [{ rotulo: 'Falar com o suporte', primario: true, href: whatsapp, novaAba: true }] : []),
            });
            return true;
        }
        $('#nova-senha-email').textContent = `Para a conta ${info.email}.`;
        mostrar('form-nova-senha');
        $('#form-nova-senha').addEventListener('submit', async (ev) => {
            ev.preventDefault();
            const f = ev.currentTarget;
            const s1 = $('#n-senha').value, s2 = $('#n-senha2').value;
            if (s1.length < 8 || !/\p{L}/u.test(s1) || !/\d/.test(s1)) return erroForm(f, 'A senha precisa ter 8 caracteres ou mais, com letras e números.');
            if (s1 !== s2) return erroForm(f, 'As duas senhas não são iguais.');
            erroForm(f, null);
            await ocupado(f, async () => {
                let r;
                try { r = await novaSenhaComCodigo(codigo, s1); } catch (e) { return erroForm(f, e.message); }
                $('#e-email').value = r.email || '';
                mensagem({ titulo: 'Senha criada', texto: 'Pronto. Agora entre com a senha nova. Por segurança, as outras sessões abertas foram encerradas.', acoes: [{ rotulo: 'Entrar', primario: true, acao: () => { aba('entrar'); $('#e-senha').focus(); } }] });
            });
        });
        return true;
    }
    return false;
}

// ---------- início ----------
if (!cfg.accounts) {
    mostrar('indisponivel');
} else if (await tratarLink()) {
    // já tratou o link
} else if (sessao.user) {
    $('#ja-logado-texto').textContent = `Conectado como ${sessao.user.email}.`;
    $('#ja-logado-ir').href = destino;
    $('#ja-logado-sair').addEventListener('click', async () => { await sair(); location.reload(); });
    mostrar('ja-logado');
} else {
    aba(location.pathname === '/cadastro' ? 'criar' : 'entrar');
    const alvo = location.pathname === '/cadastro' ? $('#c-nome') : $('#e-email');
    alvo.focus({ preventScroll: true });
}
if (params.get('saiu')) toast('Você saiu da conta.', 'info');
