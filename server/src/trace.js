import { execFile } from 'node:child_process';
import net from 'node:net';

// "Rota até você": o servidor dispara um mtr até o IP que ele vê do cliente e
// devolve cada salto com latência e perda. É a visão do caminho que o suporte
// usa pra saber se o problema está na casa do cliente, na rede da operadora ou
// pra fora dela. Sempre execFile com argumentos fixos + IP validado — nada de
// shell, nada de string montada com entrada do usuário.

const CACHE_MS = 60_000;

export function createTracer({ maxConcurrent, log = console }) {
    let running = 0;
    const cache = new Map();

    function run(ip) {
        return new Promise((resolve, reject) => {
            const args = ['--json', '-n', '-c', '5', '-i', '0.2', '-m', '24', '--gracetime', '1',
                net.isIPv6(ip) ? '-6' : '-4', ip];
            execFile('mtr', args, { timeout: 20_000, maxBuffer: 1024 * 1024 }, (err, stdout) => {
                if (err) return reject(new Error('mtr falhou'));
                try {
                    const hubs = JSON.parse(stdout).report.hubs || [];
                    resolve(hubs.map(h => ({
                        hop: h.count,
                        host: h.host === '???' ? null : h.host,
                        lossPct: h['Loss%'],
                        sent: h.Snt,
                        avgMs: h['Loss%'] >= 100 ? null : h.Avg,
                        bestMs: h['Loss%'] >= 100 ? null : h.Best,
                        worstMs: h['Loss%'] >= 100 ? null : h.Wrst,
                    })));
                } catch {
                    reject(new Error('saída do mtr ilegível'));
                }
            });
        });
    }

    return {
        async trace(ip) {
            if (!net.isIP(ip)) throw Object.assign(new Error('IP inválido'), { status: 400 });
            const hit = cache.get(ip);
            if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;
            if (running >= maxConcurrent) throw Object.assign(new Error('muitos rastreamentos ao mesmo tempo, tente em instantes'), { status: 503 });
            running++;
            try {
                const hops = await run(ip);
                const data = { target: ip, hops, measuredAt: Date.now() };
                cache.set(ip, { at: Date.now(), data });
                if (cache.size > 2000) cache.delete(cache.keys().next().value);
                return data;
            } finally {
                running--;
            }
        },
    };
}
