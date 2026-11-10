// Integração com o HubSoft (o sistema de clientes do provedor), SÓ LEITURA.
//
// O HubSoft é o cadastro inteiro da empresa, então as regras são duras:
// - Só três consultas, fixas no código e sempre GET: a sessão do Radius pelo
//   IP (extrato_conexao), o cliente pelo código e o cliente pelo IP fixo. O
//   único POST é o /oauth/token, que só autentica. Não existe passagem
//   genérica: quem chama não escolhe endereço, método nem parâmetro livre.
// - O endereço da API tem que ser https://<algo>.hubsoft.com.br, e os pedidos
//   não seguem redirecionamento: as credenciais e o token não vão para outro
//   servidor nem se alguém mexer no painel.
// - Credenciais criptografadas no banco (AES-256-GCM, chave em
//   data/hubsoft.key), nunca devolvidas ao navegador e nunca no log.
// - Do que o HubSoft devolve, só sai daqui o necessário para o técnico
//   confirmar o cliente: código, nome, plano, rua, bairro e "conectado desde".
//   CPF, telefone, e-mail, senha do PPPoE e o resto são descartados aqui.
// - Sem configuração (ou desligado), nada muda no sistema.

import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

const CAMINHO = {
    token: '/oauth/token',
    sessao: '/api/v1/integracao/cliente/extrato_conexao',
    cliente: '/api/v1/integracao/cliente',
};
const PRAZO_MS = 7000;
const MAX_RESPOSTA = 4 * 1024 * 1024;
const CACHE_IP_MS = 60_000;
const CACHE_CODIGO_MS = 5 * 60_000;

const erro = (status, message) => Object.assign(new Error(message), { status });

/** https://<nome>.hubsoft.com.br, sem usuário, porta, caminho ou consulta. */
export function urlValida(valor) {
    let u;
    try { u = new URL(String(valor || '').trim()); } catch { return null; }
    if (u.protocol !== 'https:' || u.username || u.password || u.port || u.search || u.hash) return null;
    if (u.pathname !== '/' && u.pathname !== '') return null;
    if (!/^([a-z0-9-]+\.)+hubsoft\.com\.br$/i.test(u.hostname)) return null;
    return `https://${u.hostname.toLowerCase()}`;
}

const texto = (v, max = 120) => (typeof v === 'string' && v.trim() ? v.trim().replace(/\s+/g, ' ').slice(0, max) : null);
const codigoValido = (v) => /^\d{1,9}$/.test(String(v ?? '')) ? Number(v) : null;

/** "20 Mbits" → 20; "1 Gbits" → 1000; "512 Kbits" → 0,5. */
export function mbpsDoTexto(v) {
    const m = /([\d]+(?:[.,]\d+)?)\s*([kmg])/i.exec(String(v || ''));
    if (!m) return null;
    const n = Number(m[1].replace(',', '.'));
    const f = { k: 0.001, m: 1, g: 1000 }[m[2].toLowerCase()];
    return Number.isFinite(n) && n > 0 ? Math.round(n * f * 1000) / 1000 : null;
}

/** "08/11/2026 17:53:37" → "08/11/2026 às 17:53". */
const dataBr = (v) => {
    const m = /^(\d{2}\/\d{2}\/\d{4})\s+(\d{2}:\d{2})/.exec(String(v || ''));
    return m ? `${m[1]} às ${m[2]}` : null;
};

/** Só o que o técnico precisa ver para confirmar o cliente. */
function resumo(cliente, servico, { via, ip, sessao = null }) {
    const s = servico || {};
    const uc = s.ultima_conexao || {};
    const end = s.endereco_instalacao || cliente.endereco_instalacao || {};
    const rua = [texto(end.endereco, 80), texto(end.numero, 10)].filter(Boolean).join(', ') || null;
    const download = mbpsDoTexto(s.velocidade_download);
    return {
        codigo: codigoValido(cliente.codigo_cliente),
        nome: texto(cliente.nome_razaosocial, 80) || texto(cliente.nome_fantasia, 80) || 'Cliente sem nome',
        plano: { nome: texto(s.nome, 60), download, upload: mbpsDoTexto(s.velocidade_upload) },
        situacao: texto(s.status, 40),
        habilitado: s.status_prefixo === 'servico_habilitado',
        rua,
        bairro: texto(end.bairro, 60),
        cidade: texto(end.cidade, 60),
        conectado: sessao ? true : uc.conectado === true,
        conectadoDesde: (sessao && dataBr(sessao.acctstarttimebr)) || (uc.conectado ? dataBr(uc.ultima_conexao) : null),
        ip: ip || texto(uc.ultimo_ipv4, 45),
        via,
    };
}

export function createHubsoft({ db, dataDir, log = console, agora = () => Date.now() }) {
    const ler = (chave, padrao) => { const r = db.get('SELECT valor FROM ajustes WHERE chave = ?', chave); try { return r ? JSON.parse(r.valor) : padrao; } catch { return padrao; } };
    const gravar = (chave, valor) => db.run('INSERT INTO ajustes (chave, valor) VALUES (?, ?) ON CONFLICT (chave) DO UPDATE SET valor = excluded.valor', chave, JSON.stringify(valor));
    const apagar = (chave) => db.run('DELETE FROM ajustes WHERE chave = ?', chave);

    // ---------- chave e credenciais ----------
    const arquivoChave = path.join(dataDir, 'hubsoft.key');
    function chave(criar) {
        try { const k = fs.readFileSync(arquivoChave); if (k.length === 32) return k; } catch { /* ainda não existe */ }
        if (!criar) return null;
        const k = crypto.randomBytes(32);
        fs.mkdirSync(dataDir, { recursive: true });
        fs.writeFileSync(arquivoChave, k, { mode: 0o600 });
        return k;
    }
    function cifrar(obj) {
        const iv = crypto.randomBytes(12);
        const c = crypto.createCipheriv('aes-256-gcm', chave(true), iv);
        const dado = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
        return { v: 1, iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), dado: dado.toString('base64') };
    }
    function decifrar(caixa) {
        const k = chave(false);
        if (!caixa || !k) return null;
        try {
            const d = crypto.createDecipheriv('aes-256-gcm', k, Buffer.from(caixa.iv, 'base64'));
            d.setAuthTag(Buffer.from(caixa.tag, 'base64'));
            return JSON.parse(Buffer.concat([d.update(Buffer.from(caixa.dado, 'base64')), d.final()]).toString('utf8'));
        } catch { return null; }
    }
    const credenciais = () => decifrar(ler('hubsoft.credenciais', null));

    // ---------- HTTP (só os caminhos fixos acima) ----------
    let token = null; // { valor, expira } só em memória
    let ultimoErro = null;
    let emUso = 0;

    async function pedir(cfg, caminho, { metodo = 'GET', consulta = null, corpo = null, autenticado = true } = {}) {
        if (!Object.values(CAMINHO).includes(caminho)) throw erro(500, 'consulta do HubSoft não permitida');
        if (metodo !== 'GET' && caminho !== CAMINHO.token) throw erro(500, 'o HubSoft só é consultado (GET)');
        const base = urlValida(cfg.url);
        if (!base) throw erro(503, 'Endereço do HubSoft inválido.');
        const u = new URL(caminho, base);
        if (consulta) for (const [k, v] of Object.entries(consulta)) u.searchParams.set(k, String(v));
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), PRAZO_MS);
        try {
            const headers = { Accept: 'application/json', 'User-Agent': 'speedtest-hubsoft/1.0 (somente leitura)' };
            if (autenticado) headers.Authorization = `Bearer ${await tokenAtual(cfg)}`;
            if (corpo) headers['Content-Type'] = 'application/json';
            const r = await fetch(u, { method: metodo, headers, body: corpo ? JSON.stringify(corpo) : undefined, redirect: 'error', signal: ctrl.signal });
            const bruto = await lerLimitado(r);
            let j = null;
            try { j = JSON.parse(bruto); } catch { /* sem JSON */ }
            return { status: r.status, j };
        } catch (e) {
            if (e.name === 'AbortError') throw erro(504, 'O HubSoft demorou para responder.');
            if (e.status) throw e;
            throw erro(502, 'Não deu para falar com o HubSoft.');
        } finally { clearTimeout(t); }
    }
    async function lerLimitado(r) {
        const leitor = r.body && r.body.getReader();
        if (!leitor) return '';
        const partes = [];
        let total = 0;
        for (;;) {
            const { done, value } = await leitor.read();
            if (done) break;
            total += value.length;
            if (total > MAX_RESPOSTA) { leitor.cancel().catch(() => {}); throw erro(502, 'Resposta do HubSoft grande demais.'); }
            partes.push(value);
        }
        return Buffer.concat(partes).toString('utf8');
    }
    async function tokenAtual(cfg, novo = false) {
        if (!novo && token && token.expira > agora() + 60_000) return token.valor;
        const r = await pedir(cfg, CAMINHO.token, {
            metodo: 'POST', autenticado: false,
            corpo: { client_id: cfg.clientId, client_secret: cfg.clientSecret, username: cfg.usuario, password: cfg.senha, grant_type: 'password' },
        });
        if (r.status !== 200 || !r.j || typeof r.j.access_token !== 'string') {
            token = null;
            throw erro(502, r.status === 401 || r.status === 400 ? 'O HubSoft recusou as credenciais.' : `O HubSoft não deu acesso (HTTP ${r.status}).`);
        }
        const validade = Math.min(Number(r.j.expires_in) || 3600, 7 * 86400) * 1000; // renova pelo menos uma vez por semana
        token = { valor: r.j.access_token, expira: agora() + validade };
        return token.valor;
    }
    async function consultar(cfg, caminho, consulta) {
        if (emUso >= 4) throw erro(503, 'Muitas consultas ao HubSoft agora. Tente em instantes.');
        emUso++;
        try {
            let r = await pedir(cfg, caminho, { consulta });
            if (r.status === 401) { token = null; await tokenAtual(cfg, true); r = await pedir(cfg, caminho, { consulta }); }
            if (r.status !== 200 || !r.j) throw erro(502, `O HubSoft respondeu com erro (HTTP ${r.status}).`);
            ultimoErro = null;
            return r.j;
        } catch (e) {
            ultimoErro = { em: agora(), msg: e.message };
            throw e;
        } finally { emUso--; }
    }

    const clientePorCodigo = async (cfg, codigo) => {
        const j = await consultar(cfg, CAMINHO.cliente, { busca: 'codigo_cliente', termo_busca: String(codigo), ultima_conexao: 'sim', relacoes: 'endereco_instalacao', limit: '1' });
        return (Array.isArray(j.clientes) ? j.clientes : []).find((c) => Number(c.codigo_cliente) === Number(codigo)) || null;
    };

    // ---------- cache curto (o técnico abre a página várias vezes) ----------
    const cache = new Map();
    const doCache = (k) => { const c = cache.get(k); if (c && c.ate > agora()) return c.v; cache.delete(k); return undefined; };
    const noCache = (k, v, ms) => { cache.set(k, { v, ate: agora() + ms }); if (cache.size > 2000) cache.delete(cache.keys().next().value); };

    function configAtiva() {
        if (!ler('hubsoft.ativo', false)) return null;
        const c = credenciais();
        return c && urlValida(c.url) ? c : null;
    }

    /**
     * Quem está usando este IP agora. No CGNAT o mesmo IP passa de um cliente
     * para outro, então só vale a sessão do Radius que ainda está aberta (sem
     * hora de término) ou o serviço cuja última conexão, ainda ativa, é este IP.
     */
    async function porIp(ip) {
        const cfg = configAtiva();
        if (!cfg) return null;
        if (!net.isIPv4(ip)) return { encontrado: false, motivo: 'ipv6' };
        const k = 'ip:' + ip;
        const c = doCache(k);
        if (c !== undefined) return c;

        const j = await consultar(cfg, CAMINHO.sessao, { busca: 'ipv4', termo_busca: ip });
        const regs = (Array.isArray(j.registros) ? j.registros : []).filter((r) => r && r.framedipaddress === ip && r.cliente && codigoValido(r.cliente.codigo_cliente) != null);
        regs.sort((a, b) => (a.acctstoptime == null ? 0 : 1) - (b.acctstoptime == null ? 0 : 1) || String(b.acctstarttime).localeCompare(String(a.acctstarttime)));
        const codigos = [...new Set(regs.map((r) => Number(r.cliente.codigo_cliente)))].slice(0, 3);
        let achou = null;
        for (const codigo of codigos) {
            const cli = await clientePorCodigo(cfg, codigo);
            if (!cli) continue;
            const aberta = regs.find((r) => Number(r.cliente.codigo_cliente) === codigo && r.acctstoptime == null) || null;
            const servicos = Array.isArray(cli.servicos) ? cli.servicos : [];
            const pelaConexao = servicos.find((s) => s.ultima_conexao && s.ultima_conexao.conectado === true && s.ultima_conexao.ultimo_ipv4 === ip);
            const pelaSessao = aberta && (servicos.find((s) => s.login && s.login === aberta.username) || servicos.find((s) => s.status_prefixo === 'servico_habilitado') || servicos[0]);
            const sv = pelaConexao || pelaSessao;
            if (sv) { achou = resumo(cli, sv, { via: 'radius', ip, sessao: pelaConexao ? null : aberta }); break; }
        }
        if (!achou) {
            // IP fixo cadastrado no serviço
            const f = await consultar(cfg, CAMINHO.cliente, { busca: 'ipv4', termo_busca: ip, ultima_conexao: 'sim', relacoes: 'endereco_instalacao', limit: '3' });
            for (const cli of Array.isArray(f.clientes) ? f.clientes : []) {
                const sv = (Array.isArray(cli.servicos) ? cli.servicos : []).find((s) => s.ipv4 === ip);
                if (sv) { achou = resumo(cli, sv, { via: 'ip-fixo', ip }); break; }
            }
        }
        const out = achou ? { encontrado: true, cliente: achou } : { encontrado: false, motivo: 'sem-sessao' };
        noCache(k, out, CACHE_IP_MS);
        return out;
    }

    /** O cliente pelo código (quando o técnico diz que não é o do IP). */
    async function porCodigo(codigoBruto) {
        const cfg = configAtiva();
        if (!cfg) return null;
        const codigo = codigoValido(codigoBruto);
        if (codigo == null) throw erro(400, 'O código do cliente tem só números.');
        const k = 'cod:' + codigo;
        const c = doCache(k);
        if (c !== undefined) return c;
        const cli = await clientePorCodigo(cfg, codigo);
        let out = { encontrado: false, motivo: 'codigo' };
        if (cli) {
            const servicos = Array.isArray(cli.servicos) ? cli.servicos : [];
            const sv = servicos.find((s) => s.status_prefixo === 'servico_habilitado') || servicos[0] || null;
            out = { encontrado: true, cliente: resumo(cli, sv, { via: 'codigo' }) };
        }
        noCache(k, out, CACHE_CODIGO_MS);
        return out;
    }

    // ---------- painel ----------
    const mascarar = (e) => { const s = String(e || ''); const [u, d] = s.split('@'); return d ? `${u.slice(0, 2)}${'•'.repeat(Math.max(1, u.length - 2))}@${d}` : s ? `${s.slice(0, 2)}•••` : null; };
    function estado() {
        const caixa = ler('hubsoft.credenciais', null);
        const c = credenciais();
        return {
            configurado: !!c,
            ilegivel: !!caixa && !c, // banco copiado sem a chave data/hubsoft.key
            ativo: !!ler('hubsoft.ativo', false) && !!c,
            url: c ? c.url : null,
            clientId: c ? c.clientId : null,
            usuario: c ? mascarar(c.usuario) : null,
            atualizadoEm: ler('hubsoft.atualizado', null),
            ultimoErro,
        };
    }

    /** Confere as credenciais (só pega um token) e, se der certo, guarda criptografado. */
    async function salvar({ url, clientId, clientSecret, usuario, senha }) {
        const atual = credenciais() || {};
        const cfg = {
            url: urlValida(url),
            clientId: texto(String(clientId ?? ''), 40),
            clientSecret: texto(clientSecret, 200) || atual.clientSecret || null,
            usuario: texto(usuario, 120) || atual.usuario || null,
            senha: (typeof senha === 'string' && senha ? senha.slice(0, 200) : null) || atual.senha || null,
        };
        if (!cfg.url) throw erro(400, 'Use o endereço da API do HubSoft, por exemplo https://api.suaempresa.hubsoft.com.br');
        if (!cfg.clientId || !cfg.clientSecret || !cfg.usuario || !cfg.senha) throw erro(400, 'Preencha o Client ID, o Client Secret, o usuário e a senha.');
        token = null;
        await tokenAtual(cfg, true); // erro aqui = nada é gravado
        gravar('hubsoft.credenciais', cifrar(cfg));
        gravar('hubsoft.atualizado', agora());
        gravar('hubsoft.ativo', true);
        cache.clear();
        ultimoErro = null;
        return estado();
    }

    async function testar() {
        const cfg = credenciais();
        if (!cfg) throw erro(400, 'O HubSoft ainda não foi configurado.');
        await tokenAtual(cfg, true);
        ultimoErro = null;
        return estado();
    }

    function ligar(sim) {
        if (sim && !credenciais()) throw erro(400, 'Configure o HubSoft antes de ligar.');
        gravar('hubsoft.ativo', !!sim);
        if (!sim) { token = null; cache.clear(); }
        return estado();
    }

    function remover() {
        apagar('hubsoft.credenciais');
        apagar('hubsoft.ativo');
        apagar('hubsoft.atualizado');
        token = null;
        cache.clear();
        return estado();
    }

    return { ativo: () => !!configAtiva(), porIp, porCodigo, estado, salvar, testar, ligar, remover };
}
