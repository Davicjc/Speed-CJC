// Administração pelo terminal do servidor (só quem tem acesso SSH usa).
//
//   cd /root/speedtest/server
//   npm run admin -- dono voce@email.com "Nome da Pessoa"   cria (ou promove) um dono
//   npm run admin -- link email@dominio                           link para criar nova senha
//   npm run admin -- listar                                       donos e administradores
//   npm run admin -- rebaixar email@dominio                       dono -> administrador comum
//   npm run admin -- reativar email@dominio                       reativa conta desativada
//
// Dono = administrador principal: não pode ser rebaixado, desativado nem
// excluído pelo painel. O primeiro dono só pode ser criado por aqui.

import crypto from 'node:crypto';
import { config } from '../src/config.js';
import { openDatabase } from '../src/db.js';
import { createSessions } from '../src/sessions.js';
import { createUsers } from '../src/users.js';
import { validateEmail } from '../src/results.js';

const silencioso = { info() {}, warn: (...a) => console.warn(...a), error: (...a) => console.error(...a) };
const db = openDatabase(config.dbFile, silencioso);
const users = createUsers({ db, mailEnabled: !!config.mail.host, log: silencioso });
const sessions = createSessions({ db, sessionDays: config.sessionDays, log: silencioso });

const [cmd, ...args] = process.argv.slice(2);
const base = (config.publicUrl || `http://${config.publicIPv4 || 'IP-DO-SERVIDOR'}:${config.port}`).replace(/\/$/, '');
const verde = (s) => `\x1b[32m${s}\x1b[0m`;
const negrito = (s) => `\x1b[1m${s}\x1b[0m`;
const sair = (msg) => { console.error('\x1b[31m' + msg + '\x1b[0m'); process.exit(1); };

function link(u, horas) {
    const codigo = sessions.criarCodigo(u.id, 'reset', horas * 3600_000, 'terminal do servidor');
    return `${base}/entrar?nova-senha=${codigo}`;
}

function alvo(email) {
    let e;
    try { e = validateEmail(email); } catch { sair('Informe um e-mail válido.'); }
    const u = users.getByEmail(e);
    if (!u) sair(`Não existe conta com ${e}.`);
    return u;
}

switch (cmd) {
    case 'dono': {
        let email;
        try { email = validateEmail(args[0]); } catch { sair('Uso: npm run admin -- dono email@dominio "Nome"'); }
        let u = users.getByEmail(email);
        if (u) {
            u = users.update(u.id, { role: 'owner', emailVerified: true, disabled: false });
            console.log(verde(`✓ ${u.email} agora é dono do sistema.`));
            users.audit({ actor: null, action: 'virou dono (pelo terminal)', target: users.view(u) });
        } else {
            const nome = (args.slice(1).join(' ').replace(/\s+/g, ' ').trim() || email.split('@')[0]).slice(0, 80);
            u = await users.create({ email, name: nome, password: crypto.randomBytes(24).toString('base64url'), createdVia: 'terminal', role: 'owner', emailVerified: true });
            console.log(verde(`✓ Conta de dono criada: ${u.email} (${u.name}).`));
            users.audit({ actor: null, action: 'criou dono (pelo terminal)', target: users.view(u) });
            console.log(`\nAbra este link para escolher a senha (vale 24 horas, funciona uma vez):\n${negrito(link(u, 24))}\n`);
        }
        break;
    }
    case 'link': {
        const u = alvo(args[0]);
        console.log(`\nLink para ${u.email} criar uma nova senha (vale 24 horas, funciona uma vez):\n${negrito(link(u, 24))}\n`);
        users.audit({ actor: null, action: 'gerou link de nova senha (pelo terminal)', target: users.view(u) });
        break;
    }
    case 'listar': {
        const rows = db.all("SELECT email, name, role, disabled, last_login_at FROM users WHERE role IN ('owner', 'admin') ORDER BY role DESC, email");
        if (!rows.length) console.log('Nenhum administrador. Crie o primeiro dono: npm run admin -- dono email@dominio "Nome"');
        for (const r of rows) {
            console.log(`${r.role === 'owner' ? 'dono ' : 'admin'}  ${r.email.padEnd(36)} ${r.name}${r.disabled ? '  [desativada]' : ''}  último login: ${r.last_login_at ? new Date(r.last_login_at).toLocaleString('pt-BR') : 'nunca'}`);
        }
        console.log(`\n${db.get('SELECT COUNT(*) n FROM users').n} conta(s), ${db.get('SELECT COUNT(*) n FROM tests').n} teste(s) no banco.`);
        break;
    }
    case 'rebaixar': {
        const u = alvo(args[0]);
        users.update(u.id, { role: 'admin' });
        console.log(verde(`✓ ${u.email} agora é administrador comum (pode ser alterado pelo painel).`));
        users.audit({ actor: null, action: 'deixou de ser dono (pelo terminal)', target: users.view(u) });
        break;
    }
    case 'reativar': {
        const u = alvo(args[0]);
        users.update(u.id, { disabled: false });
        console.log(verde(`✓ Conta ${u.email} reativada.`));
        users.audit({ actor: null, action: 'reativou conta (pelo terminal)', target: users.view(u) });
        break;
    }
    default:
        console.log(`Comandos:
  npm run admin -- dono email@dominio "Nome"   cria ou promove um dono (administrador principal)
  npm run admin -- link email@dominio          gera um link para a pessoa criar nova senha
  npm run admin -- listar                      mostra donos e administradores
  npm run admin -- rebaixar email@dominio      tira o "dono" (vira administrador comum)
  npm run admin -- reativar email@dominio      reativa uma conta desativada`);
}
db.close();
