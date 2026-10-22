// Quem está fazendo o pedido: lê o cookie de sessão, confere no banco e
// carrega a conta. Toda decisão de acesso do servidor passa por aqui.

const err = (status, message, code) => Object.assign(new Error(message), { status, code });

export function createAuthn({ sessions, users, log = console }) {
    /** { sess, profile } da sessão do cookie, ou null. */
    function atual(req, ip) {
        const token = sessions.lerToken(req);
        if (!token) return null;
        const sess = sessions.achar(token, { ip });
        if (!sess) return null;
        const profile = users.get(sess.user_id);
        if (!profile) return null;
        return { sess, profile, token };
    }

    /** Exige login. */
    function requireUser(req, ip) {
        const u = atual(req, ip);
        if (!u) throw err(401, 'Entre na sua conta para continuar.', 'login');
        if (u.profile.disabled) {
            sessions.encerrar(u.token);
            throw err(403, 'Esta conta está desativada. Fale com o suporte da Audicom.', 'disabled');
        }
        return u;
    }

    /** Login opcional: sem sessão, devolve null. */
    function optionalUser(req, ip) {
        const u = atual(req, ip);
        return u && !u.profile.disabled ? u : null;
    }

    /** Exige administrador. */
    function requireAdmin(req, ip) {
        const u = requireUser(req, ip);
        if (!users.isAdmin(u.profile)) {
            log.warn(`[admin] acesso negado a ${u.profile.email} (${ip})`);
            if (u.profile.role === 'admin' && !u.profile.email_verified) {
                throw err(403, 'Confirme seu e-mail para usar o painel de administração. O link foi enviado para a sua caixa de entrada.', 'verify_email');
            }
            throw err(403, 'Sua conta não tem acesso à administração.', 'forbidden');
        }
        return u;
    }

    /**
     * Ações sensíveis (dar/tirar admin, desativar, excluir) pedem a senha de
     * novo se ela não foi digitada nesta sessão nos últimos N minutos. Um
     * computador esquecido aberto não vira acesso total.
     */
    function requireRecentLogin(sess, maxAgeS = 15 * 60) {
        if (Date.now() - sess.reauth_at > maxAgeS * 1000) throw err(401, 'Por segurança, confirme sua senha para fazer isso.', 'reauth');
    }

    return { atual, requireUser, optionalUser, requireAdmin, requireRecentLogin };
}
