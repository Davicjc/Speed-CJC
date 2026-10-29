import { execFile } from 'node:child_process';
import net from 'node:net';

import { isPrivateIp } from './util.js';

// Diagnóstico de NAT — responde a pergunta do suporte: "o cliente está atrás
// de duplo NAT?". Três sinais independentes, porque nenhum sozinho é prova:
//
// 1. FAIXA DO IP: 100.64.0.0/10 (RFC 6598) é faixa de CGNAT — o cliente não
//    tem IP público próprio, está compartilhando o da operadora.
//
// 2. TTL: todo roteador no caminho diminui 1 do TTL do pacote. Os sistemas
//    saem com 64 (Android, iPhone, Linux, Mac) ou 128 (Windows). Comparamos
//    DUAS medidas que fazem o mesmo caminho até aqui:
//      - o TTL dos pacotes do aparelho (tcpdump): roteadores da casa + caminho;
//      - o TTL da resposta de ping do IP público (o roteador do cliente):
//        só o caminho.
//    A diferença é quantos roteadores existem DENTRO da casa: 1 é o normal (o
//    roteador dele); 2 ou mais é roteador atrás de roteador, o duplo NAT.
//    Se o roteador não responde ping, usamos o `mtr`, mas só quando o
//    próprio IP público aparece como último salto (senão a conta não fecha).
//
// 3. Saltos privados na rota (10.x, 192.168.x, 100.64.x) indicam NAT no
//    caminho da operadora.
//
// O tipo de NAT (simétrico etc.) é medido no navegador, via STUN — ver
// js/engine/client.js.

const CAPTURE_MS = 3000;
const CACHE_MS = 60_000;
const cache = new Map();

export function isCgnat(ip) {
    if (!net.isIPv4(ip)) return false;
    const [a, b] = ip.split('.').map(Number);
    return a === 100 && b >= 64 && b <= 127;
}

/** Primeiro TTL padrão acima do observado: 64 (Unix/Android/iOS) ou 128 (Windows). */
function initialTtl(observed) {
    for (const t of [64, 128, 255]) if (observed <= t) return t;
    return null;
}

/**
 * Lê o TTL (hop limit, no IPv6) dos pacotes que ESTE cliente está mandando.
 * Precisa de tráfego do cliente durante a janela — quem chama manda o
 * navegador gerar ruído em paralelo.
 */
function captureTtl(ip) {
    return new Promise((resolve) => {
        const v6 = net.isIPv6(ip);
        const args = ['-n', '-i', 'any', '-c', '6', '-v', '-Q', 'in', '-s', '128',
            `src host ${ip} and (tcp or udp)`];
        const child = execFile('tcpdump', args, { timeout: CAPTURE_MS + 1500, maxBuffer: 512 * 1024 }, (err, stdout, stderr) => {
            const text = String(stdout || '') + String(stderr || '');
            const re = v6 ? /hlim (\d+)/g : /ttl (\d+)/g;
            const vals = [...text.matchAll(re)].map(m => Number(m[1])).filter(n => n > 0 && n <= 255);
            if (!vals.length) return resolve(null);
            // maior TTL observado = caminho mais curto (o menos “atrapalhado”)
            resolve(Math.max(...vals));
        });
        setTimeout(() => { try { child.kill('SIGINT'); } catch { /* já terminou */ } }, CAPTURE_MS);
    });
}

/** Maior TTL das respostas de ping do IP público (o roteador do cliente), ou null. */
function pingTtl(ip) {
    return new Promise((resolve) => {
        execFile('ping', [net.isIPv6(ip) ? '-6' : '-4', '-n', '-c', '3', '-i', '0.2', '-W', '1', ip], { timeout: 4000 }, (err, stdout) => {
            const vals = [...String(stdout || '').matchAll(/ttl=(\d+)/gi)].map((m) => Number(m[1])).filter((n) => n > 0 && n <= 255);
            resolve(vals.length ? Math.max(...vals) : null);
        });
    });
}

/**
 * @param {string} ip IP público do cliente (o que o servidor enxerga)
 * @param {object|null} trace resultado do mtr (para contar os saltos)
 */
export async function analyzeNat(ip, trace) {
    if (!net.isIP(ip)) throw Object.assign(new Error('IP inválido'), { status: 400 });
    const hit = cache.get(ip);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;

    const v6 = net.isIPv6(ip);
    const cgnat = isCgnat(ip);
    // 100.64.x também é "privado", mas aqui é o roteador do cliente visto por
    // dentro da rede da operadora: dá para medir igual
    const privateIp = isPrivateIp(ip) && !cgnat;
    const [ttl, ttlRoteador] = await Promise.all([captureTtl(ip), pingTtl(ip)]);

    const start = ttl != null ? initialTtl(ttl) : null;
    const hopsFromClient = start != null ? start - ttl : null;

    // roteadores entre o IP público e este servidor (sem contar o próprio IP público)
    const hops = trace && Array.isArray(trace.hops) ? trace.hops : [];
    const ultimo = hops[hops.length - 1];
    let routersBetween = null;
    let metodo = null;
    if (ttlRoteador != null && initialTtl(ttlRoteador) != null) {
        routersBetween = initialTtl(ttlRoteador) - ttlRoteador;
        metodo = 'ping';
    } else if (ultimo && ultimo.host === ip) {
        routersBetween = ultimo.hop - 1;
        metodo = 'rota';
    } else {
        // o roteador do cliente não responde: estimamos que ele fica logo
        // depois do último salto da operadora que respondeu
        const ultimoQueResponde = [...hops].reverse().find((h) => h.host && h.host !== ip);
        if (ultimoQueResponde) { routersBetween = ultimoQueResponde.hop; metodo = 'rota estimada'; }
    }
    const hopsFromTrace = ultimo && ultimo.host === ip ? ultimo.hop : null;
    const innerRouters = hopsFromClient != null && routersBetween != null ? hopsFromClient - routersBetween : null;

    const privateHops = hops.filter(h => h.host && h.host !== ip && (isPrivateIp(h.host) || isCgnat(h.host))).map(h => ({ hop: h.hop, host: h.host }));

    let doubleNat = 'indeterminado';
    let reason = ttl == null ? 'o aparelho não mandou pacotes a tempo de medir o TTL'
        : 'o roteador do cliente não responde ping nem aparece na rota: não dá para contar os roteadores da casa';
    if (innerRouters != null) {
        const estimado = metodo === 'rota estimada';
        if (innerRouters >= 2) {
            // estimado pode errar para mais (um salto da operadora que também não responde): só "possível"
            doubleNat = estimado ? 'possível' : 'provável';
            reason = `${innerRouters} roteadores entre o aparelho e o IP público (o normal é 1): tem um roteador ligado atrás de outro${estimado ? '. Estimado, porque o roteador do cliente não responde ping: confira no local' : ''}`;
        } else if (innerRouters === 1) {
            doubleNat = 'não';
            reason = `um roteador só entre o aparelho e a internet${metodo === 'rota estimada' ? ' (estimado: o roteador do cliente não responde ping)' : ''}`;
        } else if (innerRouters === 0 && estimado) {
            reason = 'o roteador do cliente não responde ping e a estimativa pela rota não fecha';
        } else if (innerRouters === 0) {
            doubleNat = 'não';
            reason = 'o próprio aparelho tem o IP público (roteador em modo bridge ou discagem no aparelho)';
        } else {
            reason = 'o TTL não fecha: o roteador do cliente usa um TTL fora do padrão';
        }
    }
    if (v6) {
        doubleNat = 'não se aplica';
        reason = 'conexão por IPv6, que não usa NAT';
    } else if (cgnat) {
        // CGNAT é NAT da operadora: somado ao roteador de casa, o cliente já
        // está em duplo NAT mesmo que só exista um roteador na casa dele.
        doubleNat = 'sim (CGNAT)';
        reason = `IP na faixa de CGNAT (100.64.0.0/10): a operadora compartilha um IP público entre vários clientes${innerRouters >= 2 ? `, e há ${innerRouters} roteadores dentro da casa` : ''}`;
    } else if (privateIp) {
        doubleNat = 'rede local';
        reason = 'teste feito por dentro da rede (IP privado), sem passar pela internet';
    }

    const data = {
        ip,
        family: net.isIPv6(ip) ? 'IPv6' : 'IPv4',
        privateIp,
        cgnat,
        ttl,
        initialTtl: start,
        ttlRoteador,
        hopsFromClient,
        hopsFromTrace,
        routersBetween,
        metodo,
        innerRouters,
        privateHops,
        doubleNat,
        reason,
        measuredAt: Date.now(),
    };
    cache.set(ip, { at: Date.now(), data });
    if (cache.size > 2000) cache.delete(cache.keys().next().value);
    return data;
}
