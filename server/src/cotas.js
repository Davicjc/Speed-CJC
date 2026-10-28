// Cota diária de testes sem login: cada aparelho pode fazer ANON_TESTS_PER_DAY
// testes por dia (padrão 6); mais que isso, só entrando na conta. Um teto por
// IP (ANON_TESTS_PER_IP_DAY, padrão 60) segura robôs que trocam o id do
// aparelho, sem travar quem divide o mesmo IP (CGNAT, empresas, escolas).
//
// O banco guarda só o hash (com chave secreta) do IP e do id do aparelho, nunca
// os valores, e apaga os dias antigos (LGPD: o mínimo, pelo menor tempo).

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const diaDoBrasil = (ms = Date.now()) => new Date(ms - 3 * 3600_000).toISOString().slice(0, 10);
const APARELHO_VALIDO = /^[A-Za-z0-9_-]{16,64}$/;

export function createCotas({ db, dataDir, porAparelho = 6, porIp = 60, log = console }) {
    const arquivo = path.join(dataDir, 'cotas.key');
    let segredo;
    try { segredo = fs.readFileSync(arquivo, 'utf8').trim(); } catch { segredo = ''; }
    if (!/^[0-9a-f]{64}$/.test(segredo)) {
        segredo = crypto.randomBytes(32).toString('hex');
        fs.mkdirSync(dataDir, { recursive: true });
        fs.writeFileSync(arquivo, segredo + '\n', { mode: 0o600 });
    }
    const hash = (tipo, valor) => tipo + ':' + crypto.createHmac('sha256', segredo).update(String(valor)).digest('hex').slice(0, 32);
    const contagem = (chave) => (db.get('SELECT n FROM cotas WHERE chave = ? AND dia = ?', chave, diaDoBrasil()) || {}).n || 0;

    function chaves(ip, aparelho) {
        const disp = typeof aparelho === 'string' && APARELHO_VALIDO.test(aparelho) ? hash('disp', aparelho) : null;
        return { ip: hash('ip', ip), disp };
    }

    /** Pode começar mais um teste sem login? Sem id de aparelho, vale a cota de um aparelho para o IP. */
    function pode(ip, aparelho) {
        const k = chaves(ip, aparelho);
        if (contagem(k.ip) >= (k.disp ? porIp : porAparelho)) return false;
        return !k.disp || contagem(k.disp) < porAparelho;
    }

    function contar(ip, aparelho) {
        const k = chaves(ip, aparelho);
        const dia = diaDoBrasil();
        for (const chave of [k.ip, k.disp].filter(Boolean)) {
            db.run('INSERT INTO cotas (chave, dia, n) VALUES (?, ?, 1) ON CONFLICT (chave, dia) DO UPDATE SET n = n + 1', chave, dia);
        }
    }

    function limpar() {
        try { db.run('DELETE FROM cotas WHERE dia < ?', diaDoBrasil(Date.now() - 2 * 86400_000)); } catch (e) { log.warn('[cotas] limpeza falhou:', e.message); }
    }
    limpar();
    setInterval(limpar, 6 * 3600_000).unref();

    return { pode, contar, porAparelho };
}
