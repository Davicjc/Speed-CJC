/* Resolve o desafio do captcha próprio (prova de trabalho), numa thread à
 * parte para a página não travar. O servidor entregou o hash SHA-256 de
 * (sal + número) e o tamanho do intervalo; aqui testamos número por número
 * até achar o que gera o mesmo hash. SHA-256 escrito à mão porque o
 * crypto.subtle é assíncrono e lento demais para milhões de tentativas. */
'use strict';

const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
const H0 = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
const W = new Int32Array(64);
const bloco = new Uint8Array(64);

/** SHA-256 de uma mensagem curta (até 55 bytes, um bloco só); compara com o alvo. */
function confere(msg, len, alvo) {
    bloco.fill(0);
    bloco.set(msg.subarray(0, len));
    bloco[len] = 0x80;
    const bits = len * 8;
    bloco[62] = (bits >>> 8) & 0xff;
    bloco[63] = bits & 0xff;
    for (let t = 0; t < 16; t++) W[t] = (bloco[t * 4] << 24) | (bloco[t * 4 + 1] << 16) | (bloco[t * 4 + 2] << 8) | bloco[t * 4 + 3];
    for (let t = 16; t < 64; t++) {
        const x = W[t - 15], y = W[t - 2];
        const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
        const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
        W[t] = (W[t - 16] + s0 + W[t - 7] + s1) | 0;
    }
    let a = H0[0], b = H0[1], c = H0[2], d = H0[3], e = H0[4], f = H0[5], g = H0[6], h = H0[7];
    for (let t = 0; t < 64; t++) {
        const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
        const ch = (e & f) ^ (~e & g);
        const t1 = (h + S1 + ch + K[t] + W[t]) | 0;
        const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
        const maj = (a & b) ^ (a & c) ^ (b & c);
        const t2 = (S0 + maj) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    return ((a + H0[0]) >>> 0) === alvo[0] && ((b + H0[1]) >>> 0) === alvo[1] && ((c + H0[2]) >>> 0) === alvo[2]
        && ((d + H0[3]) >>> 0) === alvo[3] && ((e + H0[4]) >>> 0) === alvo[4] && ((f + H0[5]) >>> 0) === alvo[5]
        && ((g + H0[6]) >>> 0) === alvo[6] && ((h + H0[7]) >>> 0) === alvo[7];
}

onmessage = (ev) => {
    const { salt, challenge, maxnumber } = ev.data;
    const alvo = new Uint32Array(8);
    for (let i = 0; i < 8; i++) alvo[i] = parseInt(challenge.substr(i * 8, 8), 16) >>> 0;
    const sal = new TextEncoder().encode(salt);
    if (sal.length > 45) { postMessage({ erro: 'desafio inválido' }); return; }
    const msg = new Uint8Array(64);
    msg.set(sal);
    const t0 = performance.now();
    for (let n = 0; n <= maxnumber; n++) {
        const s = String(n);
        for (let j = 0; j < s.length; j++) msg[sal.length + j] = s.charCodeAt(j);
        if (confere(msg, sal.length + s.length, alvo)) {
            postMessage({ numero: n, ms: Math.round(performance.now() - t0) });
            return;
        }
        if ((n & 0xffff) === 0) postMessage({ progresso: n / maxnumber });
    }
    postMessage({ erro: 'não foi possível resolver o desafio' });
};
