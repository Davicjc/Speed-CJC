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
//    saem com 64 (Android, iPhone, Linux, Mac) ou 128 (Windows). Sabendo com
//    quanto chegou aqui, sabemos quantos roteadores o pacote atravessou. Se
//    esse número for MAIOR que o número de saltos que o `mtr` enxerga até o
//    IP público do cliente, a diferença são roteadores DENTRO da casa — é
//    exatamente isso que caracteriza o duplo NAT (roteador do cliente ligado
//    atrás do roteador da operadora).
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

/**
 * @param {string} ip IP público do cliente (o que o servidor enxerga)
 * @param {object|null} trace resultado do mtr (para contar os saltos)
 */
export async function analyzeNat(ip, trace) {
    if (!net.isIP(ip)) throw Object.assign(new Error('IP inválido'), { status: 400 });
    const hit = cache.get(ip);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;

    const privateIp = isPrivateIp(ip);
    const cgnat = isCgnat(ip);
    const ttl = privateIp ? null : await captureTtl(ip);

    const hopsFromTrace = trace && Array.isArray(trace.hops) && trace.hops.length ? trace.hops.length : null;
    const start = ttl != null ? initialTtl(ttl) : null;
    const hopsFromClient = start != null ? start - ttl : null;

    // saltos do cliente até aqui MENOS saltos que o mtr vê até o IP público:
    // sobra = roteadores dentro da casa do cliente. 1 é o normal (o roteador
    // dele). 2 ou mais = tem outro roteador atrás, ou seja, duplo NAT.
    const innerRouters = hopsFromClient != null && hopsFromTrace != null ? hopsFromClient - hopsFromTrace : null;

    const privateHops = hopsFromTrace
        ? trace.hops.filter(h => h.host && (isPrivateIp(h.host) || isCgnat(h.host))).map(h => ({ hop: h.hop, host: h.host }))
        : [];

    let doubleNat = 'indeterminado';
    let reason = 'não foi possível medir o TTL dos pacotes deste cliente';
    if (privateIp) {
        doubleNat = 'rede local';
        reason = 'teste feito de dentro da rede, sem passar pela internet';
    } else if (innerRouters != null) {
        if (innerRouters >= 2) {
            doubleNat = 'provável';
            reason = `${innerRouters} roteadores entre o aparelho e o IP público (o normal é 1)`;
        } else if (innerRouters >= 0) {
            doubleNat = 'não';
            reason = innerRouters === 1 ? 'um roteador só entre o aparelho e a internet' : 'aparelho praticamente direto no IP público';
        } else {
            doubleNat = 'indeterminado';
            reason = 'ida e volta seguem caminhos diferentes; contagem de saltos não fecha';
        }
    }
    if (cgnat) {
        // CGNAT é NAT da operadora: somado ao roteador de casa, o cliente já
        // está em duplo NAT mesmo que só exista um roteador na casa dele.
        doubleNat = doubleNat === 'provável' ? 'provável' : 'sim (CGNAT)';
        reason = 'IP na faixa de CGNAT (100.64.0.0/10): a operadora compartilha um IP público entre vários clientes';
    }

    const data = {
        ip,
        family: net.isIPv6(ip) ? 'IPv6' : 'IPv4',
        privateIp,
        cgnat,
        ttl,
        initialTtl: start,
        hopsFromClient,
        hopsFromTrace,
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
