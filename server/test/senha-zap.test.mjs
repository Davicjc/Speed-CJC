// "Esqueci a senha" pelo WhatsApp: o código só vai para o número da conta, vale
// uma vez, trava depois de 5 erros e os limites seguram quem tenta inundar.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSenhaZap } from '../src/senha-zap.js';
import { createRateLimiter } from '../src/util.js';

const contas = {
    ana: { id: 'u1', email: 'ana@teste.local', phone: '+5534991234567', role: 'user' },
    beto: { id: 'u2', email: 'beto@teste.local', phone: null, role: 'user' },
    dono: { id: 'u3', email: 'dono@teste.local', phone: '+5534990000000', role: 'owner' },
    gemeo1: { id: 'u4', email: 'g1@teste.local', phone: '+5534995555555', role: 'user' },
    gemeo2: { id: 'u5', email: 'g2@teste.local', phone: '+5534995555555', role: 'user' },
};
const users = {
    getByEmail: (e) => Object.values(contas).find((c) => c.email === e) || null,
    getByPhone: (f) => Object.values(contas).filter((c) => c.phone === f),
    isOwner: (u) => u.role === 'owner',
};
function montar() {
    const enviados = [];
    const zap = {
        estado: () => ({ estado: 'conectado' }),
        contato: async (n) => ({ jid: `${n}@s.whatsapp.net` }),
        enviar: async (jid, texto) => { enviados.push({ jid, texto }); },
    };
    const sz = createSenhaZap({ users, zap, createRateLimiter, nomeSite: 'Teste', log: { info() {}, warn() {} } });
    return { sz, enviados };
}
const esperar = () => new Promise((r) => setTimeout(r, 20));
const codigoDe = (texto) => /\*(\d{6})\*/.exec(texto)[1];

test('o código vai só para o WhatsApp da conta e vale uma vez', async () => {
    const { sz, enviados } = montar();
    sz.pedir({ login: 'ana@teste.local', ip: '1.1.1.1' });
    await esperar();
    assert.equal(enviados.length, 1);
    assert.equal(enviados[0].jid, '5534991234567@s.whatsapp.net', 'para o número que já estava na conta');
    const c = codigoDe(enviados[0].texto);
    assert.throws(() => sz.conferir({ login: 'ana@teste.local', codigo: c === '000000' ? '111111' : '000000' }), /errado/);
    assert.equal(sz.conferir({ login: 'ana@teste.local', codigo: c }).id, 'u1');
    assert.throws(() => sz.conferir({ login: 'ana@teste.local', codigo: c }), /errado ou vencido/, 'uso único');
});

test('pelo número também funciona, mas só se ele for de uma conta só', async () => {
    const { sz, enviados } = montar();
    sz.pedir({ login: '(34) 99123-4567', ip: '1.1.1.2' });
    sz.pedir({ login: '(34) 99555-5555', ip: '1.1.1.2' }); // duas contas com o mesmo número
    await esperar();
    assert.equal(enviados.length, 1);
    assert.equal(enviados[0].jid, '5534991234567@s.whatsapp.net');
});

test('conta sem WhatsApp, conta de dono e conta que não existe: nada é enviado (e ninguém fica sabendo)', async () => {
    const { sz, enviados } = montar();
    for (const login of ['beto@teste.local', 'dono@teste.local', 'ninguem@teste.local']) assert.equal(sz.pedir({ login, ip: '1.1.1.3' }), undefined);
    await esperar();
    assert.equal(enviados.length, 0);
});

test('5 tentativas erradas e o código deixa de valer, mesmo acertando depois', async () => {
    const { sz, enviados } = montar();
    sz.pedir({ login: 'ana@teste.local', ip: '1.1.1.4' });
    await esperar();
    const c = codigoDe(enviados[0].texto);
    const errado = c === '999999' ? '888888' : '999999';
    for (let i = 0; i < 4; i++) assert.throws(() => sz.conferir({ login: 'ana@teste.local', codigo: errado }), /errado/);
    assert.throws(() => sz.conferir({ login: 'ana@teste.local', codigo: errado }), /Muitas tentativas/);
    assert.throws(() => sz.conferir({ login: 'ana@teste.local', codigo: c }), /errado ou vencido/);
});

test('inundar não funciona: um código por minuto por conta e limite por IP', async () => {
    const { sz, enviados } = montar();
    for (let i = 0; i < 3; i++) sz.pedir({ login: 'ana@teste.local', ip: '2.2.2.2' });
    await esperar();
    assert.equal(enviados.length, 1, 'pedidos seguidos não mandam outro código');
    for (let i = 0; i < 2; i++) sz.pedir({ login: 'ninguem@teste.local', ip: '2.2.2.2' });
    assert.throws(() => sz.pedir({ login: 'ana@teste.local', ip: '2.2.2.2' }), /Muitos pedidos/, '6º pedido do mesmo IP na hora');
});

test('WhatsApp desligado: avisa, sem enviar nada', () => {
    const sz = createSenhaZap({ users, zap: { estado: () => ({ estado: 'desligado' }) }, createRateLimiter, log: { info() {}, warn() {} } });
    assert.equal(sz.disponivel(), false);
    assert.throws(() => sz.pedir({ login: 'ana@teste.local', ip: '3.3.3.3' }), /fora do ar/);
});
