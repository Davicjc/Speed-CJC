// Dados de demonstração para o tutorial (tudo fictício; IPs de documentação).
import { DatabaseSync } from 'node:sqlite';
import { newId } from '../../server/src/ids.js'; // id do teste = data invertida + aleatório (o sistema confere o formato)
const db = new DatabaseSync(process.argv[2]);
const B62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
let semente = 7;
const rnd = () => { semente = (semente * 16807) % 2147483647; return semente / 2147483647; };
const id = (n = 20) => Array.from({ length: n }, () => B62[Math.floor(rnd() * 62)]).join('');
const PROTO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const SP = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: '2-digit', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const proto = (ms) => { const p = Object.fromEntries(SP.formatToParts(new Date(ms)).map((x) => [x.type, x.value])); return `SPD-${p.year}${p.month}${p.day}-${p.hour}${p.minute}-${Array.from({ length: 4 }, () => PROTO[Math.floor(rnd() * PROTO.length)]).join('')}`; };
const r1 = (v) => Math.round(v * 10) / 10;
const agora = Date.now();
const DIA = 86400000;
const hora = (diasAtras, h, m = 0) => { const d = new Date(agora - diasAtras * DIA); const s = new Date(d.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' })); const delta = d - s; s.setHours(h, m, 0, 0); return s.getTime() + delta; };

const usuarios = Object.fromEntries(db.prepare('SELECT * FROM users').all().map((u) => [u.email, u]));
const clara = usuarios['clara@exemplo.com.br'], roberto = usuarios['roberto@exemplo.com.br'];
db.prepare('UPDATE users SET plan_mbps = 500, city = ? WHERE id = ?').run('Uberlândia', clara.id);
db.prepare('UPDATE users SET phone = ? WHERE id = ?').run('(34) 99800-1122', usuarios['marcos@exemplo.com.br'].id);

const modelos = db.prepare('SELECT * FROM tests ORDER BY created_at').all();
const [mRapido, mCompleto, mTecnico] = modelos;

const BAIRROS = [
  ['Santa Mônica', -18.9186, -48.2560], ['Centro', -18.9128, -48.2755], ['Tibery', -18.9006, -48.2369], ['Martins', -18.9170, -48.2800],
  ['Jardim Karaíba', -18.9550, -48.2860], ['Umuarama', -18.8850, -48.2580], ['Brasil', -18.9050, -48.2620], ['Laranjeiras', -18.9600, -48.2400],
  ['Granada', -18.9480, -48.2330], ['Planalto', -18.9200, -48.3150], ['Roosevelt', -18.8900, -48.2900], ['Segismundo Pereira', -18.9300, -48.2300],
];
const OPERADORAS = ['Minha Operadora', 'Minha Operadora', 'Minha Operadora', 'Minha Operadora', 'Claro', 'Vivo'];
let ipN = 20;
const ip = () => (rnd() < 0.5 ? `203.0.113.${ipN++ % 250 + 2}` : `198.51.100.${ipN++ % 250 + 2}`);

function rota(problema) {
  const base = [['172.21.1.1', 0.4], ['10.255.0.1', 0.9], ['10.40.0.1', 1.6], ['100.64.12.1', 2.4], ['10.80.3.1', 3.1]];
  const hops = base.map(([h, m], i) => ({ hop: i + 1, host: h, perda: 0, media: r1(m + rnd() * 0.6) }));
  hops.push({ hop: hops.length + 1, host: null, perda: 100, media: null });
  if (problema) hops[3].perda = 3;
  return hops;
}

function teste(modelo, { quando, user, mode, origem, dl, ul, ping, bairro, operadora, atendimento, problema }) {
  const d = JSON.parse(modelo.data);
  const [nome, lat, lng] = bairro;
  const meuIp = ip();
  const jitter = r1(0.4 + rnd() * 2.2), loss = rnd() < 0.85 ? 0 : r1(rnd() * 0.6), bb = r1(6 + rnd() * 30);
  Object.assign(d, { mode, download: r1(dl), upload: r1(ul), ping: r1(ping), jitter, loss, bufferbloat: bb, pingMin: r1(ping - 1), pingMax: r1(ping + 3 + rnd() * 5), ip: meuIp, ipFamily: 'IPv4', isp: operadora, asn: null, atendimento: atendimento || null });
  d.place = { label: `${nome}, Uberlândia - MG`, district: nome, city: 'Uberlândia', region: 'MG', source: rnd() < 0.8 ? 'aparelho' : 'ip' };
  if (d.loadedLatency) d.loadedLatency = { download: r1(ping + bb), upload: r1(ping + bb * 0.7) };
  if (mode === 'completo' && d.advanced) {
    const a = d.advanced;
    a.nat = problema
      ? { tipo: 'simétrico', motivoTipo: null, cgnat: false, duploNat: 'provável', motivo: '2 roteadores entre o aparelho e o IP público (o normal é 1): tem um roteador ligado atrás de outro', roteadoresInternos: 2, ipPrivado: false, metodo: 'ping', saltosAteServidor: 4, ipServidor: meuIp, ipStun: meuIp, ipMuda: true, ipsDiferentes: false }
      : { tipo: 'normal', motivoTipo: null, cgnat: false, duploNat: 'não', motivo: 'um roteador só entre o aparelho e a internet', roteadoresInternos: 1, ipPrivado: false, metodo: 'ping', saltosAteServidor: 4, ipServidor: meuIp, ipStun: meuIp, ipMuda: false, ipsDiferentes: false };
    a.mtu = problema
      ? { familia: 'IPv4', mss: 1460, mtuPeloMss: 1500, mssLimitado: false, pmtuTcp: 1500, mtuCaminho: 1492, metodo: 'ping', abaixoDe: null, motivo: null }
      : { familia: 'IPv4', mss: 1452, mtuPeloMss: 1492, mssLimitado: false, pmtuTcp: 1500, mtuCaminho: 1492, metodo: 'aviso do roteador', abaixoDe: null, motivo: null };
    a.rota = rota(problema);
    if (a.protocolos && a.protocolos.ipv4) a.protocolos.ipv4.ip = meuIp;
  }
  db.prepare(`INSERT INTO tests (id, protocol, created_at, user_id, mode, download, upload, ping, jitter, loss, bufferbloat, verified, ip, isp, city, region, place_label, lat, lng, claim_hash, claim_until, data, origem)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 'Uberlândia', 'MG', ?, ?, ?, NULL, NULL, ?, ?)`)
    .run(newId(quando), proto(quando), quando, user ? user.id : null, mode, d.download, d.upload, d.ping, jitter, loss, bb, meuIp, operadora, d.place.label, lat + (rnd() - 0.5) * 0.004, lng + (rnd() - 0.5) * 0.004, JSON.stringify(d), origem);
}

// mais clientes (não entram no sistema: senha inválida)
const NOMES = [['João Pedro Martins', 'joao.martins'], ['Fernanda Alves', 'fernanda.alves'], ['Lucas Rocha', 'lucas.rocha'], ['Patrícia Gomes', 'patricia.gomes'], ['Ana Beatriz Costa', 'ana.costa'], ['Rafael Teixeira', 'rafael.teixeira'], ['Juliana Prado', 'juliana.prado']];
const colsU = Object.keys(clara);
const outros = NOMES.map(([nome, usuario], i) => {
  const u = { ...clara, id: id(), email: `${usuario}@exemplo.com.br`, name: nome, phone: null, plan_mbps: [300, 500, 700, 1000][i % 4], password_hash: 'scrypt$demo$sem-senha', created_at: agora - (25 - i * 3) * DIA, last_login_at: agora - (i + 1) * 3600000, last_seen_at: agora - (i + 1) * 3600000 };
  db.prepare(`INSERT INTO users (${colsU.join(',')}) VALUES (${colsU.map(() => '?').join(',')})`).run(...colsU.map((k) => u[k] ?? null));
  return u;
});

// Clara: um mês de testes; à noite um pouco mais lento
const horasClara = [8, 12, 19, 21, 22, 9, 14, 20, 23, 7, 18, 21, 10, 16, 20, 22];
horasClara.forEach((h, i) => {
  const noite = h >= 19 && h <= 22;
  teste(i % 3 === 0 ? mCompleto : mRapido, { quando: hora(29 - i * 1.8, h, Math.floor(rnd() * 59)), user: clara, mode: i % 3 === 0 ? 'completo' : 'rapido', origem: 'cliente', dl: (noite ? 395 : 470) + rnd() * 35, ul: (noite ? 215 : 245) + rnd() * 20, ping: (noite ? 11 : 7) + rnd() * 3, bairro: BAIRROS[i % 3 === 0 ? 0 : i % 4], operadora: 'Minha Operadora' });
});
// outros clientes e testes sem conta
for (let i = 0; i < 26; i++) {
  const u = i % 4 === 3 ? null : outros[i % outros.length];
  const plano = u ? u.plan_mbps : 300;
  const h = [7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23][i % 11];
  teste(i % 5 === 0 ? mCompleto : mRapido, { quando: hora(28 - i, h, Math.floor(rnd() * 59)), user: u, mode: i % 5 === 0 ? 'completo' : 'rapido', origem: 'cliente', dl: plano * (0.78 + rnd() * 0.2), ul: plano * (0.4 + rnd() * 0.12), ping: 6 + rnd() * 9, bairro: BAIRROS[(i * 5) % BAIRROS.length], operadora: OPERADORAS[i % OPERADORAS.length] });
}
// atendimentos do técnico (o último com problema)
const ATEND = [['João Pedro Martins — contrato 3381', 300, 'Troca do roteador, teste no cabo'], ['Fernanda Alves — contrato 5120', 500, 'Wi-Fi 5 GHz no quarto'], ['Lucas Rocha — contrato 2207', 1000, 'Instalação nova, ONU no rack'], ['Patrícia Gomes — contrato 4410', 500, 'Cliente reclama de banco travando']];
ATEND.forEach(([cliente, plano, obs], i) => {
  const problema = i === ATEND.length - 1;
  teste(mTecnico, { quando: hora(8 - i * 2, 10 + i * 2, 15), user: roberto, mode: 'completo', origem: 'tecnico', dl: plano * (problema ? 0.62 : 0.92 + rnd() * 0.05), ul: plano * (problema ? 0.3 : 0.48), ping: problema ? 18 : 6 + rnd() * 3, bairro: BAIRROS[(i * 3 + 2) % BAIRROS.length], operadora: 'Minha Operadora', atendimento: { cliente, plano, obs }, problema });
});
// tira os modelos (feitos pela rede local)
for (const m of modelos) db.prepare('DELETE FROM tests WHERE id = ?').run(m.id);
console.log('testes:', db.prepare('SELECT COUNT(*) n FROM tests').get().n, '· usuários:', db.prepare('SELECT COUNT(*) n FROM users').get().n);
