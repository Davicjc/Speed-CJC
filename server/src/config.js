import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

// Lê server/.env (se existir) antes de tudo — assim dá pra configurar sem
// mexer no arquivo do systemd. Variável já definida no ambiente tem prioridade.
(function loadDotEnv() {
    const file = path.join(here, '..', '.env');
    let text;
    try { text = fs.readFileSync(file, 'utf8'); } catch { return; }
    for (const raw of text.split('\n')) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;
        const i = line.indexOf('=');
        if (i < 1) continue;
        const key = line.slice(0, i).trim();
        let val = line.slice(i + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
        if (process.env[key] == null) process.env[key] = val;
    }
})();

function int(name, def) {
    const v = process.env[name];
    if (v == null || v === '') return def;
    const n = Number.parseInt(v, 10);
    if (!Number.isFinite(n)) throw new Error(`${name} precisa ser um número inteiro (recebido "${v}")`);
    return n;
}
function str(name, def) {
    const v = process.env[name];
    return v == null || v === '' ? def : v;
}
function bool(name, def) {
    const v = process.env[name];
    if (v == null || v === '') return def;
    return /^(1|true|yes|sim|on)$/i.test(v);
}

// Primeiro endereço "de verdade" de cada família nas interfaces da máquina —
// usado como padrão pros testes separados de IPv4 e IPv6 enquanto
// PUBLIC_IPV4 / PUBLIC_IPV6 não forem configurados (rede local).
function detectAddress(family) {
    for (const list of Object.values(os.networkInterfaces())) {
        for (const a of list || []) {
            if (a.internal || a.family !== family) continue;
            if (family === 'IPv6' && (a.address.startsWith('fe80') || a.scopeid)) continue;
            return a.address;
        }
    }
    return null;
}

const port = int('PORT', 8080);
const dataDir = path.resolve(str('DATA_DIR', path.join(here, '..', 'data')));

export const config = {
    port,
    host: str('HOST', '::'),
    publicPort: int('PUBLIC_PORT', port),
    udpPort: int('UDP_PORT', port),
    publicIPv4: str('PUBLIC_IPV4', detectAddress('IPv4')),
    // sem PUBLIC_IPV4, o IP público anunciado no teste UDP é o do domínio no DNS (registro A)
    publicIPv4FromDns: !process.env.PUBLIC_IPV4 && Boolean(process.env.PUBLIC_URL),
    publicIPv6: str('PUBLIC_IPV6', detectAddress('IPv6')),
    // URLs completas pros testes separados de IPv4/IPv6 (ex.: https://v4.velocidadeteste.audicomtelecom.com.br).
    ipv4Base: str('IPV4_BASE_URL', null),
    ipv6Base: str('IPV6_BASE_URL', null),
    // Endereço público do site (links de compartilhamento e prévia no WhatsApp).
    publicUrl: str('PUBLIC_URL', null),
    serverName: str('SERVER_NAME', 'Audicom Telecom'),
    serverLocation: str('SERVER_LOCATION', 'Uberlândia, MG'),
    staticDir: path.resolve(str('STATIC_DIR', path.join(here, '..', '..'))),
    dataDir,
    trustProxy: bool('TRUST_PROXY', false),
    maxConcurrentTests: int('MAX_CONCURRENT_TESTS', 6),
    slotTtlMs: int('SLOT_TTL_MS', 90_000),
    maxTransferBytes: int('MAX_TRANSFER_BYTES', 256 * 1024 * 1024),
    maxPeers: int('MAX_WEBRTC_PEERS', 40),
    maxTraces: int('MAX_CONCURRENT_TRACES', 4),
    ntpServers: str('NTP_SERVERS', 'a.st1.ntp.br,b.st1.ntp.br,c.st1.ntp.br,d.st1.ntp.br,pool.ntp.org')
        .split(',').map(s => s.trim()).filter(Boolean),

    // Banco de dados (SQLite, um arquivo só): contas, sessões e testes.
    dbFile: path.resolve(str('DB_FILE', path.join(dataDir, 'audicom.db'))),
    // Cópia de segurança diária do banco, guardada por N dias em data/backups.
    backupDays: int('BACKUP_DAYS', 14),

    // Sessão de login (cookie). "Manter conectado" dura isto; sem marcar,
    // a sessão acaba ao fechar o navegador (e no máximo em 1 dia).
    sessionDays: int('SESSION_DAYS', 30),

    // E-mail (opcional). Com SMTP configurado, o site manda confirmação de
    // cadastro e o link de "esqueci minha senha". Sem ele, o administrador
    // gera o link de nova senha no painel e manda pelo WhatsApp.
    mail: {
        host: str('SMTP_HOST', null),
        port: int('SMTP_PORT', 587),
        secure: bool('SMTP_SECURE', false),   // true para a porta 465
        user: str('SMTP_USER', null),
        pass: str('SMTP_PASS', null),
        from: str('MAIL_FROM', null),         // ex.: "Audicom Telecom <naoresponda@audicomtelecom.com.br>"
    },

    captcha: {
        // Cloudflare Turnstile (recomendado em produção). Sem as chaves, o
        // cadastro usa o desafio próprio do servidor (prova de trabalho).
        turnstileSiteKey: str('TURNSTILE_SITE_KEY', null),
        turnstileSecret: str('TURNSTILE_SECRET', null),
        powMax: int('CAPTCHA_POW_MAX', 1_200_000),
    },

    // cadastros por IP por hora (com CGNAT, vários clientes dividem um IP)
    signupPerHour: int('SIGNUP_LIMIT_PER_HOUR', 6),

    geocoder: str('GEOCODER', 'nominatim'),           // 'nominatim' | 'off'
    nominatimUrl: str('NOMINATIM_URL', 'https://nominatim.openstreetmap.org'),

    // Mapa base. Padrão: OpenStreetMap (sem chave), escurecido no navegador
    // para combinar com o site. Uso leve é permitido pela política do OSM;
    // para volume alto, troque por um provedor com chave (ver docs/MANUAL.md, seção 6).
    map: {
        tiles: str('MAP_TILES_URL', 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'),
        subdomains: str('MAP_TILES_SUBDOMAINS', ''),
        attribution: str('MAP_TILES_ATTRIBUTION', '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>'),
        escuro: bool('MAP_TILES_ESCURECER', true),
    },

    // Testes feitos sem login são apagados depois deste prazo (LGPD: guardar
    // só pelo tempo necessário). Testes de quem tem conta ficam até a pessoa
    // apagar ou excluir a conta.
    anonRetentionDays: int('ANON_RETENTION_DAYS', 365),

    // Google Analytics 4 (ex.: G-ABC123XYZ). Vazio = desligado. Só registra
    // depois que a pessoa aceita os cookies de estatística (LGPD).
    gaId: /^G-[A-Z0-9]{4,20}$/.test(str('GA_MEASUREMENT_ID', '')) ? str('GA_MEASUREMENT_ID', '') : null,

    support: {
        whatsapp: str('SUPPORT_WHATSAPP', '553491339002'),
        phone: str('SUPPORT_PHONE', '(34) 3222-6800'),
        email: str('SUPPORT_EMAIL', 'contato@audicomtelecom.com.br'),
        site: str('SUPPORT_SITE', 'https://audicomtelecom.com.br'),
        central: str('SUPPORT_CENTRAL', 'https://central.audicom.hubsoft.com.br/'),
    },
};
