// Teste de ponta a ponta do protocolo de medição (sem navegador).
// Sobe um servidor próprio (banco temporário):  npm test
// Cobre: eco de ping via WebSocket, hora NTP, fila de vagas, download,
// upload medido no servidor, perda UDP (WebRTC) e conferência do resultado.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { performance } from 'node:perf_hooks';
import ndc from 'node-datachannel';
import WebSocket from 'ws';
import { subirServidor } from './servidor.mjs';

let srv, BASE, WS_URL;

function abrirWs() {
    return new Promise((res, rej) => {
        const ws = new WebSocket(WS_URL);
        ws.once('open', () => res(ws));
        ws.once('error', rej);
    });
}
const proximoJson = (ws, type) => new Promise((res) => {
    const on = (d) => {
        const s = d.toString();
        if (s[0] === 'p') return;
        const m = JSON.parse(s);
        if (m.type === type) { ws.off('message', on); res(m); }
    };
    ws.on('message', on);
});

let ws, connId, vaga, uploadServidor;
before(async () => {
    srv = await subirServidor();
    BASE = srv.base;
    WS_URL = BASE.replace(/^http/, 'ws') + '/ws';
    ws = await abrirWs();
    ws.send(JSON.stringify({ type: 'hello' }));
    connId = (await proximoJson(ws, 'hello')).connId;
});
after(() => { ws && ws.close(); ndc.cleanup(); srv && srv.parar(); });

test('hello devolve o id da conexão', () => assert.ok(connId));

test('ping por WebSocket ecoa na hora', async () => {
    const rtts = [];
    for (let i = 0; i < 20; i++) {
        const t0 = performance.now();
        await new Promise((res) => {
            const on = (d) => { if (d.toString() === 'p' + i) { ws.off('message', on); res(); } };
            ws.on('message', on);
            ws.send('p' + i);
        });
        rtts.push(performance.now() - t0);
    }
    assert.ok(Math.min(...rtts) < 50);
});

test('hora do servidor vem do NTP', async () => {
    ws.send(JSON.stringify({ type: 'time', c: Date.now() }));
    const t = await proximoJson(ws, 'time');
    assert.ok(t.synced && t.s > 0);
});

test('download entrega bytes sem compressão e upload é medido no servidor', async () => {
    ws.send(JSON.stringify({ type: 'slot-request' }));
    vaga = await proximoJson(ws, 'slot-granted');
    const r = await fetch(`${BASE}/api/download?bytes=${20 * 1024 * 1024}&t=${vaga.token}`);
    assert.equal(r.headers.get('content-encoding'), null);
    let n = 0;
    for await (const c of r.body) n += c.length;
    assert.equal(n, 20 * 1024 * 1024);

    ws.send(JSON.stringify({ type: 'ul-begin', token: vaga.token }));
    const corpo = Buffer.alloc(16 * 1024 * 1024, 7);
    const up = await fetch(`${BASE}/api/upload?t=${vaga.token}`, { method: 'POST', body: corpo });
    assert.equal((await up.json()).bytes, corpo.length);
    ws.send(JSON.stringify({ type: 'ul-end', token: vaga.token, graceMs: 0 }));
    const ul = await proximoJson(ws, 'ul-result');
    assert.ok(ul.mbps > 0 && ul.totalBytes === corpo.length);
    uploadServidor = ul.mbps;
    ws.send(JSON.stringify({ type: 'slot-release', token: vaga.token }));
    const depois = await fetch(`${BASE}/api/download?bytes=10&t=${vaga.token}`);
    assert.equal(depois.status, 403, 'vaga liberada não serve mais');
});

test('perda de pacotes por UDP (WebRTC) responde', async () => {
    const pc = new ndc.PeerConnection('cliente', { iceServers: [] });
    const coletou = new Promise((res) => pc.onGatheringStateChange((s) => { if (s === 'complete') res(pc.localDescription()); }));
    const dc = pc.createDataChannel('loss', { unordered: true, maxRetransmits: 0 });
    const oferta = await coletou;
    const resp = await (await fetch(`${BASE}/api/rtc/offer`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'offer', sdp: oferta.sdp }) })).json();
    pc.setRemoteDescription(resp.sdp, 'answer');
    await new Promise((res, rej) => { dc.onOpen(res); setTimeout(() => rej(new Error('canal não abriu')), 5000); });
    let ecos = 0;
    dc.onMessage(() => { ecos++; });
    for (let i = 0; i < 60; i++) { dc.sendMessage(String(i)); await new Promise((r) => setTimeout(r, 5)); }
    await new Promise((r) => setTimeout(r, 800));
    pc.close();
    assert.ok(ecos > 50, `${ecos}/60 voltaram`);
});

test('resultado real é conferido e o upload do servidor prevalece', async () => {
    const r = await fetch(`${BASE}/api/results`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'rapido', connId, download: 100.5, upload: 50.2, ping: 8.1, jitter: 1.2, loss: 0, dlWindowMs: 1000 }),
    });
    const d = await r.json();
    assert.equal(r.status, 201, JSON.stringify(d));
    assert.equal(d.verified, true);
    assert.ok(Math.abs(d.upload - uploadServidor) < 1e-6);
    assert.equal(d.saved, 'anonymous');
    assert.ok(d.claimToken && d.claimToken.length > 20);
    const pub = await (await fetch(`${BASE}/api/results/${d.id}`)).json();
    assert.equal(pub.ip, undefined, 'link público não expõe IP');
    assert.equal(pub.location, undefined, 'link público não expõe coordenadas');
    const html = await (await fetch(`${BASE}${d.path}`)).text();
    assert.ok(html.includes('og:title'));
});

test('resultado forjado (sem teste) fica marcado como não conferido', async () => {
    const d = await (await fetch(`${BASE}/api/results`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'rapido', download: 900, upload: 900, ping: 1, jitter: 0 }),
    })).json();
    assert.equal(d.verified, false);
});

test('fila: com o limite cheio, os seguintes esperam e sobem quando abre vaga', async () => {
    const cfg = await (await fetch(`${BASE}/api/config`)).json();
    const max = cfg.maxConcurrentTests;
    const socks = await Promise.all(Array.from({ length: max + 2 }, abrirWs));
    const estados = await Promise.all(socks.map((s) => new Promise((res) => {
        s.on('message', (d) => { const m = JSON.parse(d.toString()); if (m.type === 'slot-granted' || m.type === 'slot-wait') res(m.type); });
        s.send(JSON.stringify({ type: 'slot-request' }));
    })));
    assert.equal(estados.filter((s) => s === 'slot-granted').length, max);
    const esperando = socks[estados.indexOf('slot-wait')];
    const promovido = proximoJson(esperando, 'slot-granted');
    socks[estados.indexOf('slot-granted')].close();
    await promovido;
    socks.forEach((s) => s.close());
});

test('sem login: cota diária de testes por aparelho, com teto por IP', async () => {
    const outro = await subirServidor({ ANON_TESTS_PER_DAY: '2', ANON_TESTS_PER_IP_DAY: '3' });
    const url = outro.base.replace(/^http/, 'ws') + '/ws';
    const abrir = () => new Promise((res, rej) => { const s = new WebSocket(url); s.once('open', () => res(s)); s.once('error', rej); });
    const pedir = async (aparelho) => {
        const s = await abrir();
        const resposta = new Promise((res) => s.on('message', (d) => {
            const t = d.toString();
            if (t[0] === 'p') return;
            const m = JSON.parse(t);
            if (m.type === 'slot-granted' || m.type === 'slot-denied') res(m);
        }));
        s.send(JSON.stringify({ type: 'slot-request', aparelho }));
        const m = await resposta;
        if (m.type === 'slot-granted') s.send(JSON.stringify({ type: 'slot-release', token: m.token }));
        s.close();
        return m;
    };
    try {
        const a = 'aparelho-A-1234567890', b = 'aparelho-B-1234567890';
        assert.equal((await pedir(a)).type, 'slot-granted');
        assert.equal((await pedir(a)).type, 'slot-granted');
        const negado = await pedir(a);
        assert.equal(negado.type, 'slot-denied', 'o 3º teste do mesmo aparelho no dia é recusado');
        assert.equal(negado.code, 'limite');
        assert.match(negado.reason, /2 testes hoje sem conta/);
        assert.equal((await pedir(b)).type, 'slot-granted', 'outro aparelho no mesmo IP (CGNAT) ainda testa');
        assert.equal((await pedir('aparelho-C-1234567890')).type, 'slot-denied', 'o teto por IP segura quem troca de id');
    } finally { outro.parar(); }
});
