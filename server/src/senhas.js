import crypto from 'node:crypto';
import { promisify } from 'node:util';

// Senhas guardadas com scrypt (resistente a força bruta com placa de vídeo):
// cada senha tem sal próprio e o banco guarda só o resultado. Formato:
//   scrypt$<log2 N>$<r>$<p>$<sal base64>$<hash base64>
// Os parâmetros ficam no próprio texto: dá para endurecer no futuro sem
// invalidar as senhas antigas (precisaRefazer avisa quando refazer no login).

const scrypt = promisify(crypto.scrypt);
const LOG_N = 15, R = 8, P = 1, TAM = 64;
const MAXMEM = 128 * 1024 * 1024;

export async function gerarHash(senha) {
    const sal = crypto.randomBytes(16);
    const h = await scrypt(String(senha).normalize('NFKC'), sal, TAM, { N: 2 ** LOG_N, r: R, p: P, maxmem: MAXMEM });
    return `scrypt$${LOG_N}$${R}$${P}$${sal.toString('base64')}$${h.toString('base64')}`;
}

export async function conferir(senha, guardado) {
    const partes = String(guardado || '').split('$');
    if (partes.length !== 6 || partes[0] !== 'scrypt') return false;
    const [, logN, r, p, salB64, hashB64] = partes;
    const esperado = Buffer.from(hashB64, 'base64');
    let h;
    try {
        h = await scrypt(String(senha).normalize('NFKC'), Buffer.from(salB64, 'base64'), esperado.length, { N: 2 ** Number(logN), r: Number(r), p: Number(p), maxmem: MAXMEM });
    } catch { return false; }
    return h.length === esperado.length && crypto.timingSafeEqual(h, esperado);
}

export const precisaRefazer = (guardado) => !String(guardado || '').startsWith(`scrypt$${LOG_N}$${R}$${P}$`);

// Hash de mentira, para gastar o mesmo tempo quando o e-mail não existe
// (sem isso, a demora da resposta revelaria quais e-mails têm conta).
let fantasma = null;
export async function conferirFantasma(senha) {
    if (!fantasma) fantasma = await gerarHash(crypto.randomBytes(12).toString('hex'));
    await conferir(senha, fantasma);
    return false;
}
