import { execFile } from 'node:child_process';
import net from 'node:net';

// MTU e MSS da conexão do cliente. O navegador não manda pacote de tamanho
// escolhido, então as duas medidas são feitas aqui no servidor:
//
// - MSS: lido da própria conexão TCP do cliente (ss -ti, o mesmo tcp_info do
//   kernel). O "mss" do kernel é o que o cliente anunciou no SYN (já com o
//   MSS clamping do roteador/concentrador) menos as opções TCP (12 bytes de
//   timestamp). Daí sai o MTU que a rede do cliente diz ter.
// - MTU do caminho: ping com "não fragmentar" (-M do) até o IP que o servidor
//   vê, em busca binária; é o "ping -f -l 1472" que o técnico faz à mão. Se um
//   roteador no meio avisar "Frag needed (mtu = N)", usamos o N direto.
//
// Se o MSS anunciado passa do que o caminho aguenta, pacotes grandes somem
// (sites que abrem pela metade, VPN e bancos travando): é o problema que este
// teste existe para pegar. Sempre execFile com argumentos fixos + IP validado.

const CACHE_MS = 60_000;
const TS = 12; // opção de timestamp TCP, descontada do MSS pelo kernel

const semMapeado = (ip) => String(ip || '').replace(/^::ffff:/, '');

function executar(cmd, args, timeout) {
    return new Promise((resolve) => {
        execFile(cmd, args, { timeout, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => resolve({ ok: !err, saida: `${stdout || ''}${stderr || ''}` }));
    });
}

/** tcp_info das conexões do cliente que chegam nas portas do site. */
async function lerMss(ip, porta, portasLocais) {
    const { saida } = await executar('ss', ['-tinH', 'state', 'established', ...(porta ? ['dport', '=', `:${porta}`] : [])], 4000);
    const linhas = saida.split('\n');
    const achadas = [];
    for (let i = 0; i < linhas.length - 1; i++) {
        const cab = linhas[i].trim().split(/\s+/);
        if (cab.length < 4 || !/mss:\d+/.test(linhas[i + 1])) continue;
        const sep = (s) => { const k = s.lastIndexOf(':'); return [semMapeado(s.slice(0, k).replace(/^\[|\]$/g, '')), Number(s.slice(k + 1))]; };
        const [, portaLocal] = sep(cab[cab.length - 2]);
        const [ipRemoto, portaRemota] = sep(cab[cab.length - 1]);
        if (ipRemoto !== ip || !portasLocais.has(portaLocal)) continue;
        const info = linhas[i + 1];
        const n = (k) => { const m = new RegExp(`\\b${k}:(\\d+)`).exec(info); return m ? Number(m[1]) : null; };
        achadas.push({ exata: portaRemota === porta, mss: n('mss'), pmtu: n('pmtu'), advmss: n('advmss'), rcvmss: n('rcvmss'), ts: /(^|\s)ts(\s|$)/.test(info) });
        i++;
    }
    return achadas.find((a) => a.exata) || achadas[0] || null;
}

/** MTU que o kernel aprendeu para este destino (aviso "Frag needed" recebido durante o teste), ou null. */
async function mtuAprendido(ip) {
    const { saida } = await executar('ip', ['route', 'get', ip], 2000);
    const m = /\bmtu (\d+)/.exec(saida);
    return m ? Number(m[1]) : null;
}

/** Busca binária do maior pacote que passa com "não fragmentar". */
async function mtuDoCaminho(ip) {
    const v6 = net.isIPv6(ip);
    const cab = v6 ? 48 : 28; // IP + ICMP
    const ping = async (mtu) => {
        const r = await executar('ping', [v6 ? '-6' : '-4', '-M', 'do', '-c', '1', '-W', '1', '-s', String(mtu - cab), ip], 3000);
        const aviso = /mtu\s*=\s*(\d+)/i.exec(r.saida); // Frag needed (mtu = N) / message too long, mtu=N
        return { passou: r.ok && /bytes from/i.test(r.saida), avisado: aviso ? Number(aviso[1]) : null };
    };
    if (!(await ping(cab + 56)).passou) return { mtu: null, motivo: 'o equipamento não respondeu ao ping' };
    const cheio = await ping(1500);
    if (cheio.passou) return { mtu: 1500, metodo: 'ping' };
    let lo = v6 ? 1280 : 1200;
    let hi = Math.min(1499, cheio.avisado || 1499);
    if (cheio.avisado && (await ping(cheio.avisado)).passou) return { mtu: cheio.avisado, metodo: 'aviso do roteador' };
    if (!(await ping(lo)).passou) return { mtu: null, abaixoDe: lo, motivo: `nem pacotes de ${lo} bytes passaram` };
    while (hi - lo > 1) {
        const meio = Math.floor((lo + hi) / 2);
        if ((await ping(meio)).passou) lo = meio; else hi = meio;
    }
    if ((await ping(hi)).passou) lo = hi;
    return { mtu: lo, metodo: 'ping' };
}

export function createMtu({ portas, maxConcurrent = 4, log = console }) {
    const portasLocais = new Set(portas);
    const cache = new Map();
    let rodando = 0;

    return {
        /** ip: IP do cliente; porta: porta TCP de origem dele nesta requisição (se conhecida). */
        async medir(ip, porta) {
            ip = semMapeado(ip);
            if (!net.isIP(ip)) throw Object.assign(new Error('IP inválido'), { status: 400 });
            const v6 = net.isIPv6(ip);
            const tcp = await lerMss(ip, porta, portasLocais).catch(() => null);
            // acima de 9000 (jumbo) só existe na interface interna: teste feito no próprio servidor
            const local = tcp && tcp.mss > 9000;
            // o kernel desconta as opções TCP (timestamp, 12 bytes) do mss e do advmss. Nem todo
            // ss mostra "ts", então a conta vem do advmss: (pmtu − cabeçalhos) − advmss = opções
            const opcoes = tcp && tcp.pmtu && tcp.advmss ? tcp.pmtu - (v6 ? 60 : 40) - tcp.advmss : null;
            const desconto = opcoes != null && opcoes >= 0 && opcoes <= 40 ? opcoes : tcp && tcp.ts ? TS : 0;
            const mssCliente = tcp && tcp.mss && !local ? tcp.mss + desconto : null;
            let caminho = cache.get(ip);
            if (!caminho || Date.now() - caminho.em > CACHE_MS) {
                if (rodando >= maxConcurrent) caminho = { r: { mtu: null, motivo: 'servidor ocupado, tente de novo' } };
                else {
                    rodando++;
                    try { caminho = { r: await mtuDoCaminho(ip), em: Date.now() }; cache.set(ip, caminho); }
                    catch (e) { log.warn('[mtu] falhou:', e.message); caminho = { r: { mtu: null, motivo: 'falhou' } }; }
                    finally { rodando--; }
                }
            }
            if (cache.size > 2000) cache.clear();
            // o roteador do cliente não responde ping: vale o MTU que o kernel aprendeu
            // com o próprio teste (download em pacotes cheios), se algum roteador avisou
            let r = caminho.r;
            if (r.mtu == null) {
                const aprendido = (await mtuAprendido(ip).catch(() => null)) || (tcp && tcp.pmtu && tcp.pmtu < 1500 ? tcp.pmtu : null);
                if (aprendido) r = { mtu: aprendido, metodo: 'aviso durante o teste' };
            }
            return {
                familia: v6 ? 'IPv6' : 'IPv4',
                mss: mssCliente,
                mtuPeloMss: mssCliente ? mssCliente + (v6 ? 60 : 40) : null,
                // o servidor já aprendeu um MTU menor para este cliente: o mss lido é o limite do
                // servidor, e o do aparelho pode ser maior
                mssLimitado: !!(mssCliente && tcp.pmtu && tcp.pmtu < 1500 && mssCliente + (v6 ? 60 : 40) === tcp.pmtu),
                pmtuTcp: tcp ? tcp.pmtu : null,
                mtuCaminho: r.mtu,
                metodo: r.metodo || null,
                abaixoDe: r.abaixoDe || null,
                motivo: local ? 'teste feito no próprio servidor' : r.motivo || (tcp ? null : 'conexão TCP não encontrada'),
            };
        },
    };
}
