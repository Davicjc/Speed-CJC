import crypto from 'node:crypto';

// Identificadores em ordem cronológica INVERSA: o começo do id é
// (MAX - instante) em base 36. Assim, ordenar pelo id no Firestore já devolve
// "mais novo primeiro", e um intervalo de datas vira um intervalo de ids —
// nenhuma consulta precisa de índice composto (nada para criar no console).

const MAX_TS = 36 ** 9 - 1; // ~ano 5188
const B62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const PROTO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sem 0/O e 1/I: dá pra ditar por telefone

function rand(len, alphabet) {
    const out = [];
    const limit = 256 - (256 % alphabet.length); // evita viés de módulo
    while (out.length < len) {
        for (const b of crypto.randomBytes(len * 2)) {
            if (b < limit && out.length < len) out.push(alphabet[b % alphabet.length]);
        }
    }
    return out.join('');
}

export const revPrefix = (ms) => Math.max(0, MAX_TS - Math.floor(ms)).toString(36).padStart(9, '0');

/** Id novo (15 caracteres): prefixo de tempo invertido + 6 aleatórios. */
export const newId = (ms = Date.now()) => revPrefix(ms) + rand(6, B62);

/** Instante (ms) embutido num id. */
export const idTime = (id) => MAX_TS - parseInt(String(id).slice(0, 9), 36);

/**
 * Limites de id para "criado entre from e to" (ms). Como o tempo é invertido,
 * o mais NOVO (to) é o limite inferior. '~' fica depois de qualquer caractere
 * usado nos ids.
 */
export function idRange(from, to) {
    return {
        low: to != null ? revPrefix(to) : null,
        high: from != null ? revPrefix(from) + '~' : null,
    };
}

export const isId = (s) => typeof s === 'string' && /^[0-9a-z]{9}[0-9A-Za-z]{6}$/.test(s);

const SP = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: '2-digit', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

/** Prefixo do protocolo (PROTOCOL_PREFIX no .env, 2 a 6 letras/números; padrão SPD). */
export const prefixoProtocolo = () => {
    const p = String(process.env.PROTOCOL_PREFIX || '').trim().toUpperCase();
    return /^[A-Z0-9]{2,6}$/.test(p) ? p : 'SPD';
};

/** Número de protocolo legível: SPD-AAMMDD-HHMM-XXXX (hora de Brasília). */
export function protocol(ms) {
    const p = Object.fromEntries(SP.formatToParts(new Date(ms)).map(x => [x.type, x.value]));
    return `${prefixoProtocolo()}-${p.year}${p.month}${p.day}-${p.hour}${p.minute}-${rand(4, PROTO)}`;
}

const DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' });
const HOUR = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hourCycle: 'h23' });

/** Dia (AAAA-MM-DD) e hora (00-23) no fuso de Brasília. */
export const dayKey = (ms) => DAY.format(new Date(ms));
export const hourKey = (ms) => HOUR.format(new Date(ms)).padStart(2, '0');

export const randomToken = (bytes = 24) => crypto.randomBytes(bytes).toString('base64url');
export const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
