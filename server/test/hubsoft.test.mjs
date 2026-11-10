// Integração com o HubSoft: só leitura, só o necessário, e o CGNAT não confunde clientes.
// O HubSoft aqui é falso (fetch trocado), com respostas no mesmo formato do real.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { createHubsoft, mbpsDoTexto, urlValida } from '../src/hubsoft.js';

function bancoFalso() {
    const d = new DatabaseSync(':memory:');
    d.exec('CREATE TABLE ajustes (chave TEXT PRIMARY KEY, valor TEXT NOT NULL)');
    return { get: (s, ...p) => d.prepare(s).get(...p) || null, run: (s, ...p) => d.prepare(s).run(...p) };
}

const servico = (o = {}) => ({
    nome: '37_20MB_Urbano', status: 'Serviço Habilitado', status_prefixo: 'servico_habilitado',
    velocidade_download: '20 Mbits', velocidade_upload: '10 Mbits', login: 'cliente97', senha: 'SEGREDO-PPPOE', mac_addr: 'AA:BB',
    ultima_conexao: { conectado: true, ultima_conexao: '08/11/2026 17:53:37', ultimo_ipv4: '100.65.37.54' },
    endereco_instalacao: { endereco: 'RUA DAS FLORES', numero: '12', bairro: 'CENTRO', cidade: 'UBERLÂNDIA', cep: '38400000', coordenadas: { latitude: -18.9 } },
    ...o,
});
const cliente = (codigo, nome, sv) => ({ codigo_cliente: codigo, nome_razaosocial: nome, cpf_cnpj: '12345678900', telefone_primario: '34999999999', email_principal: 'x@y.com', servicos: [sv] });

function hubsoftFalso(rotas) {
    const pedidos = [];
    globalThis.fetch = async (u, opts = {}) => {
        const url = new URL(u);
        pedidos.push({ metodo: opts.method || 'GET', caminho: url.pathname, q: Object.fromEntries(url.searchParams), redirect: opts.redirect, auth: (opts.headers || {}).Authorization });
        let corpo;
        if (url.pathname === '/oauth/token') corpo = { access_token: 'tok', expires_in: 3600 };
        else corpo = rotas(url) || { status: 'success', clientes: [], registros: [] };
        return new Response(JSON.stringify(corpo), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    return pedidos;
}

async function montar(rotas) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hubsoft-teste-'));
    const pedidos = hubsoftFalso(rotas);
    const hs = createHubsoft({ db: bancoFalso(), dataDir: dir, log: { info() {}, warn() {} } });
    await hs.salvar({ url: 'https://api.exemplo.hubsoft.com.br', clientId: '1', clientSecret: 'SECRET-X', usuario: 'api@exemplo.com', senha: 'SENHA-Y' });
    return { hs, pedidos, dir };
}

test('endereço da API: só https://….hubsoft.com.br, sem caminho, porta ou usuário', () => {
    assert.equal(urlValida('https://api.audicom.hubsoft.com.br'), 'https://api.audicom.hubsoft.com.br');
    assert.equal(urlValida('https://api.audicom.hubsoft.com.br/'), 'https://api.audicom.hubsoft.com.br');
    for (const ruim of ['http://api.x.hubsoft.com.br', 'https://hubsoft.com.br.evil.com', 'https://api.x.hubsoft.com.br:8443', 'https://u:p@api.x.hubsoft.com.br', 'https://api.x.hubsoft.com.br/oauth', 'https://evil.com/?a=hubsoft.com.br', 'javascript:alert(1)']) {
        assert.equal(urlValida(ruim), null, ruim);
    }
});

test('plano em Mbps a partir do texto do HubSoft', () => {
    assert.equal(mbpsDoTexto('20 Mbits'), 20);
    assert.equal(mbpsDoTexto('1 Gbits'), 1000);
    assert.equal(mbpsDoTexto('512 Kbits'), 0.512);
    assert.equal(mbpsDoTexto(''), null);
});

test('pelo IP: acha o cliente da sessão aberta e só devolve o necessário (sem CPF, telefone, senha)', async () => {
    const { hs, pedidos } = await montar((u) => {
        if (u.pathname.endsWith('/extrato_conexao')) return { status: 'success', registros: [{ framedipaddress: '100.65.37.54', acctstoptime: null, acctstarttime: '2026-11-08 17:53:37', acctstarttimebr: '08/11/2026 17:53:37', username: 'cliente97', cliente: { codigo_cliente: 97 } }] };
        if (u.searchParams.get('busca') === 'codigo_cliente') return { status: 'success', clientes: [cliente(97, 'FULANO DE TAL', servico())] };
        return null;
    });
    const r = await hs.porIp('100.65.37.54');
    assert.equal(r.encontrado, true);
    assert.deepEqual(Object.keys(r.cliente).sort(), ['bairro', 'cidade', 'codigo', 'conectado', 'conectadoDesde', 'habilitado', 'ip', 'nome', 'plano', 'rua', 'situacao', 'via'].sort());
    assert.equal(r.cliente.nome, 'FULANO DE TAL');
    assert.equal(r.cliente.codigo, 97);
    assert.equal(r.cliente.plano.download, 20);
    assert.equal(r.cliente.rua, 'RUA DAS FLORES, 12');
    assert.equal(r.cliente.bairro, 'CENTRO');
    assert.equal(r.cliente.conectadoDesde, '08/11/2026 às 17:53');
    const json = JSON.stringify(r);
    for (const segredo of ['12345678900', '34999999999', 'SEGREDO-PPPOE', 'x@y.com', 'AA:BB', '38400000']) assert.ok(!json.includes(segredo), `não pode sair: ${segredo}`);
    // só GET, fora o login do token; sem seguir redirecionamento
    for (const p of pedidos) {
        if (p.caminho === '/oauth/token') assert.equal(p.metodo, 'POST');
        else { assert.equal(p.metodo, 'GET'); assert.equal(p.auth, 'Bearer tok'); }
        assert.equal(p.redirect, 'error');
    }
});

test('CGNAT: sessão já encerrada com aquele IP não identifica ninguém (o IP pode ser de outro agora)', async () => {
    const { hs } = await montar((u) => {
        if (u.pathname.endsWith('/extrato_conexao')) return { status: 'success', registros: [{ framedipaddress: '100.65.12.178', acctstoptime: '2026-11-08 10:13:07', acctstarttime: '2026-11-05 08:17:33', username: 'cliente97', cliente: { codigo_cliente: 97 } }] };
        if (u.searchParams.get('busca') === 'codigo_cliente') return { status: 'success', clientes: [cliente(97, 'FULANO', servico())] }; // hoje ele está em 100.65.37.54
        return null;
    });
    const r = await hs.porIp('100.65.12.178');
    assert.equal(r.encontrado, false);
});

test('IPv6 não é consultado; sem configuração nada acontece', async () => {
    const { hs, pedidos } = await montar(() => null);
    const antes = pedidos.length;
    assert.deepEqual(await hs.porIp('2804:4ee4::1'), { encontrado: false, motivo: 'ipv6' });
    assert.equal(pedidos.length, antes, 'nenhum pedido ao HubSoft');
    hs.ligar(false);
    assert.equal(await hs.porIp('100.65.37.54'), null, 'desligado: não consulta');
    hs.remover();
    assert.equal(hs.ativo(), false);
});

test('pelo código: só números; o painel nunca recebe as credenciais', async () => {
    const { hs, dir } = await montar((u) => (u.searchParams.get('busca') === 'codigo_cliente' ? { status: 'success', clientes: [cliente(4521, 'CICRANO', servico())] } : null));
    await assert.rejects(() => hs.porCodigo('12; DROP'), /só números/);
    const r = await hs.porCodigo('4521');
    assert.equal(r.encontrado, true);
    assert.equal(r.cliente.nome, 'CICRANO');
    const e = JSON.stringify(hs.estado());
    assert.ok(!e.includes('SECRET-X') && !e.includes('SENHA-Y'), 'estado sem segredo');
    assert.match(hs.estado().usuario, /•/, 'usuário mascarado');
    assert.equal(fs.statSync(path.join(dir, 'hubsoft.key')).mode & 0o077, 0, 'chave só para o dono do processo');
});

test('credenciais recusadas: nada é gravado', async () => {
    hubsoftFalso(() => null);
    globalThis.fetch = async () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 401 });
    const hs = createHubsoft({ db: bancoFalso(), dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'hubsoft-teste-')), log: { info() {}, warn() {} } });
    await assert.rejects(() => hs.salvar({ url: 'https://api.exemplo.hubsoft.com.br', clientId: '1', clientSecret: 's', usuario: 'u', senha: 'p' }), /recusou/);
    assert.equal(hs.estado().configurado, false);
});
