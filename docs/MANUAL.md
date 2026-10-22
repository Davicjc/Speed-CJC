# Manual de operação

Tudo sobre o teste de velocidade depois de instalado: como funciona, domínio e
HTTPS, configuração, e-mail, captcha, administração, banco e cópias de
segurança, segurança, LGPD e solução de problemas.

> Ainda não instalou? Comece pelo **[INSTALAR.md](INSTALAR.md)** (da VM crua ao
> site no ar). Os exemplos aqui usam a pasta `/opt/audicom-speedtest` e o domínio
> `velocidade.seuprovedor.com.br`: troque pelos seus.

---

## Sumário

1. [Como funciona](#1-como-funciona)
2. [Instalação](#2-instalação)
3. [O primeiro administrador (dono)](#3-o-primeiro-administrador-dono)
4. [Domínio, DNS e portas](#4-domínio-dns-e-portas)
5. [HTTPS com o Caddy](#5-https-com-o-caddy)
6. [Configuração do servidor (.env)](#6-configuração-do-servidor-env)
7. [E-mail (opcional)](#7-e-mail-opcional)
8. [Captcha do cadastro](#8-captcha-do-cadastro)
9. [Hora certa do servidor](#9-hora-certa-do-servidor)
10. [Administração no dia a dia](#10-administração-no-dia-a-dia)
11. [Comandos do terminal (`npm run admin`)](#11-comandos-do-terminal-npm-run-admin)
12. [Banco de dados e cópias de segurança](#12-banco-de-dados-e-cópias-de-segurança)
13. [Como a segurança funciona](#13-como-a-segurança-funciona)
14. [LGPD](#14-lgpd)
15. [Atualizar, reiniciar e ver os logs](#15-atualizar-reiniciar-e-ver-os-logs)
16. [Testes automatizados](#16-testes-automatizados)
17. [Solução de problemas](#17-solução-de-problemas)
18. [Conferência final](#18-conferência-final)
19. [Personalizar para o seu provedor](#19-personalizar-para-o-seu-provedor)
20. [SEO, Google e estatísticas](#20-seo-google-e-estatísticas)

---

## 1. Como funciona

```
 Navegador                              A sua VM
 ─────────                              ────────
 Teste de velocidade ─── medição ────▶  Node.js (server/src)
                         (WebSocket,    · mede ping, download, upload, perda
                          HTTP, UDP)    · confere o resultado
 Entrar / criar conta ── cookie ─────▶  · contas, sessões, senhas (scrypt)
 Meu painel / Admin  ── de sessão ───▶  · banco SQLite: server/data/audicom.db
                                        · cópia de segurança diária
                                        · e-mail pelo seu SMTP (opcional)
```

- **Um processo só** (`audicom-speedtest`, porta 8080) serve o site, mede,
  guarda contas e testes e responde à administração.
- **Banco de dados:** um arquivo SQLite, `server/data/audicom.db`. Não precisa
  instalar nada: o SQLite vem dentro do Node.
- **Senhas:** guardadas com scrypt (embaralhamento de mão única, resistente a
  força bruta). Ninguém, nem o administrador, consegue ler uma senha.
- **Sessão:** cookie HttpOnly e SameSite, sem acesso pelo JavaScript da página.
  Cada pessoa vê e encerra no painel os aparelhos onde está conectada.
- **Administradores:** o primeiro (dono) é criado pelo terminal do servidor; os
  outros são dados pelo painel.
- **E-mail é opcional:** com SMTP configurado, o site manda a confirmação de
  cadastro e o "esqueci minha senha". Sem ele, o administrador gera o link de
  nova senha no painel e manda pelo WhatsApp.

---

## 2. Instalação

Está toda no **[INSTALAR.md](INSTALAR.md)**: requisitos da VM, instalador de um
comando, passo a passo manual, publicação com HTTPS, atualização e remoção.

---

## 3. O primeiro administrador (dono)

O **dono** é o administrador principal. Ele:

- vê tudo, dá e tira acesso de administrador de outras pessoas;
- **não pode ser rebaixado, desativado nem excluído pelo painel**, nem por
  outro administrador;
- só é criado (ou removido) pelo terminal do servidor, por quem tem acesso SSH.

Criar o dono:

```bash
cd /opt/audicom-speedtest/server
npm run admin -- dono voce@email.com "Seu Nome"
```

Se o e-mail ainda não tem conta, o comando cria e mostra um **link para escolher
a senha** (vale 24 horas e funciona uma vez). Se já tem conta (a pessoa se
cadastrou pelo site antes), ela só vira dona.

Outros administradores são dados pelo painel: *Administração → Administradores →
Dar acesso de administrador*, ou *Usuários → (pessoa) → Tornar administrador*.

---

## 4. Domínio, DNS e portas

### 4.1 DNS

No DNS do seu domínio:

| Nome | Tipo | Valor | Para quê |
|---|---|---|---|
| `velocidade` | A | IPv4 público que chega na VM | o site |
| `v4.velocidade` | A | mesmo IPv4 (**sem** AAAA) | diagnóstico IPv4 |
| `velocidade` | AAAA | IPv6 público da VM | o site por IPv6 (opcional) |
| `v6.velocidade` | AAAA | IPv6 público da VM (**sem** A) | diagnóstico IPv6 (opcional) |

Os nomes `v4.` e `v6.` servem só para o diagnóstico completo medir cada versão
do protocolo separadamente. Sem eles, o site funciona e o diagnóstico mostra
"não verificável" no IPv6.

**Só crie os AAAA se o IPv6 da VM recebe conexões de fora de verdade.** É comum
o firewall da borda liberar IPv6 só para alguns servidores. Com o AAAA criado e
a entrada bloqueada, quem acessa por IPv6 espera a conexão falhar até o
navegador tentar o IPv4. Sem IPv6 liberado, use `--sem-ipv6` no `publicar.sh`.

### 4.2 Portas

No roteador ou firewall da borda, encaminhe para a VM:

- **TCP 80** (emissão do certificado e redirecionamento para HTTPS)
- **TCP 443** (o site)
- **UDP 8080** (teste de perda de pacotes; o Caddy não carrega UDP, então vai direto)

O `publicar.sh` libera as mesmas portas no `ufw` da VM. No IPv6 não há
encaminhamento: basta o firewall da borda deixar passar as mesmas portas até o
endereço da VM.

---

## 5. HTTPS com o Caddy

HTTPS é obrigatório para o site público: sem ele o navegador marca "não seguro",
**bloqueia a localização do aparelho** e as senhas trafegariam sem criptografia.

O `publicar.sh` instala e configura o Caddy. Para fazer à mão:

```bash
apt install caddy        # se não houver no apt, veja https://caddyserver.com/docs/install
sed "s/velocidadeteste\.audicomtelecom\.com\.br/velocidade.seuprovedor.com.br/g" \
    /opt/audicom-speedtest/server/deploy/Caddyfile > /etc/caddy/Caddyfile
systemctl reload caddy
```

**Certificado sob demanda.** O Caddy só pede o certificado (Let's Encrypt) na
primeira visita pelo domínio e o renova sozinho. Antes de pedir, ele pergunta ao
próprio site (`/api/tls-ask`) se o nome é dele: só o domínio do `PUBLIC_URL` e
os nomes `v4.` e `v6.` ganham certificado. Na prática:

- dá para configurar tudo antes de o DNS apontar para a VM, sem tentativas
  falhas;
- quando o DNS passa a apontar, o primeiro acesso leva uns segundos a mais e já
  sai com o cadeado;
- o Let's Encrypt aceita 5 tentativas falhas por hora para cada nome. Se
  aparecer "too many failed authorizations" no log, espere 1 hora.

Logs: `journalctl -u caddy -n 50`.

Outras duas escolhas do `deploy/Caddyfile`:

- **Só HTTP/1.1 com o navegador:** assim cada fluxo paralelo do teste usa uma
  conexão TCP própria. Com HTTP/2 os 6 fluxos dividiriam uma conexão só, e
  conexões rápidas seriam subestimadas.
- **Só Let's Encrypt** (`cert_issuer acme`): o ZeroSSL de reserva do Caddy 2.6 do
  Debian não funciona mais.

Com o Caddy na frente, o `.env` precisa de `TRUST_PROXY=1` (o `publicar.sh` já
coloca). O servidor só aceita o IP repassado pelo Caddy quando o pedido vem da
própria máquina: quem acessar a porta 8080 direto não consegue fingir outro IP.

---

## 6. Configuração do servidor (.env)

Tudo fica em `server/.env` (modelo comentado: `server/.env.example`). Depois de
mudar: `systemctl restart audicom-speedtest`.

| Variável | Padrão | Para quê |
|---|---|---|
| `PUBLIC_URL` | — | endereço do site; usado nos links (WhatsApp, e-mails, links de senha) |
| `TRUST_PROXY` | 0 | 1 com o Caddy na frente |
| `PUBLIC_PORT` | 8080 | 443 com HTTPS |
| `PUBLIC_IPV4` | o IP do domínio no DNS (com `PUBLIC_URL`) | IP público anunciado no teste de perda de pacotes (WebRTC). Sem ele, vale o registro A do domínio, conferido a cada 10 min |
| `IPV4_BASE_URL` / `IPV6_BASE_URL` | automático | nomes só-IPv4 e só-IPv6 do diagnóstico |
| `MAX_CONCURRENT_TESTS` | 6 | testes de velocidade simultâneos (banda do servidor ÷ maior plano) |
| `SMTP_*`, `MAIL_FROM` | desligado | e-mail (seção 7) |
| `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET` | desligado | captcha da Cloudflare (seção 8) |
| `SESSION_DAYS` | 30 | duração do "manter conectado" |
| `BACKUP_DAYS` | 14 | quantos dias de cópias de segurança guardar |
| `ANON_RETENTION_DAYS` | 365 | testes feitos sem conta são apagados depois disso |
| `SIGNUP_LIMIT_PER_HOUR` | 6 | cadastros por IP por hora |
| `GEOCODER` | nominatim | endereço a partir do GPS (`off` desliga) |
| `GA_MEASUREMENT_ID` | desligado | Google Analytics 4 (ex.: `G-ABC123XYZ`); só registra depois do aceite dos cookies (seção 20) |

---

## 7. E-mail (opcional)

Com e-mail ligado:

- quem se cadastra recebe um link para **confirmar o e-mail**;
- "**Esqueci minha senha**" manda um link (vale 1 hora, funciona uma vez);
- administradores precisam ter o e-mail confirmado para entrar na administração;
- os links de senha gerados no painel também podem ir por e-mail.

Sem e-mail, tudo funciona igual, com duas diferenças: não há confirmação de
e-mail, e quem esquece a senha fala com o suporte, que gera o link no painel
(*Usuários → pessoa → Link para nova senha*) e manda pelo WhatsApp.

### Como ligar

Use uma conta de e-mail só para isso (ex.:
`naoresponda@seuprovedor.com.br`). No `server/.env`:

```
SMTP_HOST=smtp.seuprovedor.com.br
SMTP_PORT=587
SMTP_SECURE=0
SMTP_USER=naoresponda@seuprovedor.com.br
SMTP_PASS=a-senha-dessa-conta
MAIL_FROM=Seu Provedor <naoresponda@seuprovedor.com.br>
```

Valores comuns:

| Provedor | `SMTP_HOST` | `SMTP_PORT` | `SMTP_SECURE` | Observação |
|---|---|---|---|---|
| Servidor de e-mail próprio / hospedagem | o do seu provedor (veja no painel de e-mail) | 587 | 0 | ou 465 com `SMTP_SECURE=1` |
| Google Workspace / Gmail | `smtp.gmail.com` | 465 | 1 | use uma **senha de app** (Conta Google → Segurança → Senhas de app) |
| Microsoft 365 | `smtp.office365.com` | 587 | 0 | a conta precisa ter "SMTP autenticado" liberado |

Reinicie e confira: `journalctl -u audicom-speedtest -n 20` e *Administração →
Sistema → E-mail (SMTP)* devem mostrar "Funcionando". Para testar de verdade,
use "Esqueci minha senha" com a sua conta.

Para os e-mails não caírem no spam, o domínio do remetente precisa de SPF/DKIM
configurados no provedor de e-mail.

---

## 8. Captcha do cadastro

O cadastro **sempre** tem captcha. O padrão é o **desafio próprio do servidor**:
a pessoa clica em "Não sou um robô" e o navegador resolve uma conta pesada por
alguns segundos. Isso não depende de nenhum serviço externo e encarece a criação
de contas em massa. A resposta é conferida no servidor, vale uma vez só e expira
em 10 minutos. Além disso:

- limite de 6 cadastros por hora por IP;
- campo-armadilha invisível que só robô preenche;
- login com bloqueio: 8 senhas erradas em 15 minutos travam a conta por 15
  minutos (e 30 tentativas por IP).

**Opcional:** o **Cloudflare Turnstile** (gratuito) é mais forte contra robôs
sofisticados. Para ligar:

1. Conta gratuita em <https://dash.cloudflare.com/sign-up> (não precisa mudar o DNS).
2. Menu **Turnstile → Adicionar widget**: nome `Cadastro teste de velocidade`,
   hostname `velocidade.seuprovedor.com.br`, modo **Gerenciado**.
3. Copie a **chave do site** e a **chave secreta** para o `.env`
   (`TURNSTILE_SITE_KEY` e `TURNSTILE_SECRET`), ou rode o `publicar.sh` com
   `--turnstile-site` e `--turnstile-secret`.
4. `systemctl restart audicom-speedtest`.

---

## 9. Hora certa do servidor

O teste não depende do relógio da VM (ele usa a hora oficial do NTP.br), mas
certificados HTTPS e a validade dos links de senha dependem da hora certa. O
`publicar.sh` liga a sincronização automática. Para fazer à mão:

```bash
apt install systemd-timesyncd
systemctl daemon-reload && systemctl restart systemd-timedated   # se der "NTP not supported"
timedatectl set-ntp true
timedatectl          # "System clock synchronized: yes"
```

*Administração → Sistema* mostra a diferença entre o relógio da VM e o NTP.br.

---

## 10. Administração no dia a dia

Tudo em `https://velocidade.seuprovedor.com.br/admin`:

| Tela | O que tem |
|---|---|
| **Visão geral** | usuários, online agora, testes em 24 h e 7 dias, médias, testes por dia, operadoras, cidades, horários, mapa, últimos testes (os novos entram na hora) |
| **Ao vivo** | quem está com o site aberto agora (página, aparelho, cidade, IP, "fazendo um teste"), e o que está acontecendo (testes e cadastros na hora) |
| **Testes** | todos os testes de todos os usuários; busca por protocolo `AUD-…`, e-mail ou nome; filtros; planilha |
| **Usuários** | todas as contas; abrir uma pessoa mostra dados, aparelhos conectados, testes e as ações |
| **Administradores** | quem tem acesso; dar acesso pelo e-mail (se a pessoa não tem conta, ela é criada e você recebe o link da senha) |
| **Auditoria** | toda ação de administrador: quem, o quê, com quem, quando, IP |
| **Sistema** | banco, cópias de segurança, e-mail, captcha, hora, servidor, configuração |

Ações em uma pessoa (*Usuários → pessoa*):

- **Tornar administrador / Tirar acesso**
- **Link para nova senha:** para quem esqueceu a senha. Vale 3 dias e funciona
  uma vez. Tem botão de copiar e de mandar pelo WhatsApp.
- **Encerrar sessões:** desconecta a pessoa de todos os aparelhos.
- **Desativar / Reativar:** desativada, a pessoa é desconectada na hora e não entra mais.
- **Excluir:** apaga a conta e todos os testes dela.

Ações sensíveis pedem a **sua senha de novo** se você não a digitou nos últimos
15 minutos.

---

## 11. Comandos do terminal (`npm run admin`)

```bash
cd /opt/audicom-speedtest/server
npm run admin -- dono email@dominio "Nome"   # cria ou promove um dono
npm run admin -- link email@dominio          # link para a pessoa criar nova senha (24 h)
npm run admin -- listar                      # donos e administradores
npm run admin -- rebaixar email@dominio      # tira o "dono" (vira administrador comum)
npm run admin -- reativar email@dominio      # reativa uma conta desativada
```

Úteis quando ninguém consegue entrar na administração (por exemplo, o dono
esqueceu a senha e o e-mail não está configurado): `npm run admin -- link
voce@email.com`.

---

## 12. Banco de dados e cópias de segurança

- **Banco:** `server/data/audicom.db` (com os arquivos `-wal` e `-shm` ao lado).
  Permissão 600: só o root lê.
- **Cópia de segurança automática:** uma por dia em `server/data/backups/`
  (`audicom-AAAA-MM-DD.db`), guardadas por 14 dias (`BACKUP_DAYS`). A cópia é
  feita com o site no ar, de forma consistente.
- **Recomendado:** copie a pasta `server/data/backups/` para **outra máquina**
  todo dia (se este disco morrer, as cópias locais vão junto). Exemplo, rodando
  em outro servidor:

  ```bash
  rsync -az root@IP-DO-SERVIDOR:/opt/audicom-speedtest/server/data/backups/ /backup/speedtest/
  ```

**Restaurar uma cópia:**

```bash
systemctl stop audicom-speedtest
cd /opt/audicom-speedtest/server/data
mkdir -p antes-da-restauracao && mv audicom.db* antes-da-restauracao/
cp backups/audicom-2026-10-21.db audicom.db
chmod 600 audicom.db
systemctl start audicom-speedtest
```

Também guarde uma cópia de `server/data/captcha.key` e do `server/.env`
(contêm segredos: guarde em lugar seguro).

---

## 13. Como a segurança funciona

| Proteção | Onde |
|---|---|
| Senhas com scrypt (sal próprio, resistente a força bruta); o banco nunca guarda a senha | `server/src/senhas.js` |
| Sessão em cookie HttpOnly + SameSite=Lax (+ Secure e prefixo `__Host-` em HTTPS); o banco guarda só o hash do token | `server/src/sessions.js` |
| Pedidos que mudam algo só são aceitos se vierem do próprio site (proteção contra CSRF) | `mesmaOrigem` em `server.js` |
| Bloqueio de login: 8 erros por conta e 30 por IP em 15 min; mesma resposta e mesmo tempo para e-mail que existe ou não | `routes-account.js`, `senhas.js` |
| Cadastro com captcha conferido no servidor, uma vez só; limite por IP; campo-armadilha | `captcha.js`, `routes-account.js` |
| Links de e-mail e de senha: aleatórios, de uso único, com prazo; o banco guarda só o hash | `sessions.js` |
| Trocar ou redefinir a senha desconecta os outros aparelhos | `routes-account.js` |
| Papel de administrador decidido no servidor, lendo o banco a cada pedido | `users.js`, `authn.js` |
| Dono protegido; ninguém altera a própria conta pelo painel; ações sensíveis pedem senha de novo | `routes-admin.js` |
| Conta desativada: todas as sessões apagadas na hora | `routes-admin.js` |
| Auditoria de toda ação de administrador | tabela `audit` |
| Resultado conferido contra o que o servidor mediu | `results.js` |
| Política de segurança de conteúdo (CSP) por página, sem script inline; HSTS em HTTPS; página não abre dentro de outro site | `securityHeaders` em `server.js` |
| Só os arquivos do site são servidos (nada de `server/`, `.git`, `.env`, banco, `.md`) | `static.js` |
| IP real só aceito do Caddy local (ninguém forja o IP acessando a porta direto) | `util.js` |
| Planilha exportada sem fórmulas (nome que começa com `=` vira texto) | `routes-admin.js` |
| Link público do resultado sem nome, e-mail, IP nem coordenadas | `publicResult` em `server.js` |

---

## 14. LGPD

- A pessoa **baixa todos os dados** dela (*Meu painel → Meus dados → Baixar meus
  dados*), **corrige** o cadastro e **exclui** a conta com todos os testes.
- Localização precisa só com o consentimento (a pessoa liga a opção no teste e o
  navegador pede permissão).
- Google Analytics (se ligado) só grava cookies depois que a pessoa aceita na
  faixa de cookies; a escolha pode ser revista em `/privacidade#cookies`.
- Testes feitos sem conta são apagados depois de 12 meses.
- Contas e testes ficam só na sua VM. Dois serviços externos recebem dados
  durante o uso: o **Nominatim** (OpenStreetMap) recebe a coordenada para
  devolver o endereço aproximado (`GEOCODER=off` desliga), e consultas de
  operadora e cidade recebem o IP de quem testa (`server/src/isp.js`).
  Cite isso na sua política de privacidade.
- Textos em `/privacidade` e `/termos`: **vale uma revisão do jurídico** antes de
  publicar.

---

## 15. Atualizar, reiniciar e ver os logs

```bash
systemctl restart audicom-speedtest          # reiniciar
systemctl status audicom-speedtest           # está no ar?
journalctl -u audicom-speedtest -f           # logs ao vivo
curl -s http://127.0.0.1:8080/api/health     # saúde
```

O serviço sobe sozinho com a máquina (`systemctl enable audicom-speedtest`).

Atualizar o mapa (Leaflet) para uma versão nova:
`cd /opt/audicom-speedtest/server && npm install && npm run build:vendor`.

---

## 16. Testes automatizados

```bash
cd /opt/audicom-speedtest/server && npm test
```

Sobem um servidor de teste com banco temporário (nada toca no banco real) e
conferem 24 itens: a medição (ping, download, upload medido no servidor, UDP,
fila, conferência) e a segurança (arquivos internos, cabeçalhos, CSRF, captcha
de uso único, senha forte, senha embaralhada no banco, bloqueio de tentativas,
isolamento entre contas, dono protegido, senha pedida de novo, conta desativada,
sessões, links de senha, planilha sem fórmulas, exclusão de conta).

---

## 17. Solução de problemas

| O que aparece | Causa provável | Como resolver |
|---|---|---|
| Ninguém tem acesso à administração | não há dono | `npm run admin -- dono seu@email "Nome"` |
| O dono esqueceu a senha | — | `npm run admin -- link email-do-dono` |
| "Muitas tentativas para esta conta" | 8 senhas erradas em 15 min | esperar 15 min, ou o admin gera um link de nova senha (ele também tira o bloqueio) |
| "Pedido recusado: ele não veio deste site" | página aberta por outro endereço/porta, ou extensão do navegador alterando pedidos | abrir pelo endereço oficial; testar sem extensões |
| E-mails não chegam | SMTP errado, ou caindo no spam | *Administração → Sistema → E-mail*; logs; SPF/DKIM do domínio |
| "Registrar a localização" desativado, com aviso de HTTPS | site aberto por `http://` | usar o endereço com HTTPS (seção 5) |
| Diagnóstico: IPv6 "Não verificável" | sem o nome `v6.` | criar `v6.velocidade` (só AAAA) ou usar `--sem-ipv6` |
| Perda de pacotes: "UDP bloqueado ou filtrado" | UDP 8080 fechado, ou `PUBLIC_IPV4` errado | liberar UDP 8080 até a máquina; conferir o IP público no `.env` |
| Todo mundo aparece com o IP `127.0.0.1` | `TRUST_PROXY` desligado atrás do Caddy | `TRUST_PROXY=1` e reiniciar |
| Certificado não sai | DNS ainda não aponta, porta 80 fechada, ou o `PUBLIC_URL` do `.env` não é o domínio | `journalctl -u caddy -n 50`; `curl "http://127.0.0.1:8080/api/tls-ask?domain=SEU.DOMINIO"` deve dar 200 |
| "too many failed authorizations" no log do Caddy | 5 tentativas de certificado falharam na última hora | esperar 1 hora |
| O domínio abre outro site | o DNS ou o encaminhamento ainda levam para outra máquina | seção 4; confira com o `publicar.sh` (passo 8) |
| Mapa vazio | testes sem a localização do aparelho | ligar a opção no teste (precisa de HTTPS) |

---

## 18. Conferência final

Com o site no domínio:

- [ ] `https://velocidade.seuprovedor.com.br` abre com o cadeado.
- [ ] `/api/health` responde `"ok":true`.
- [ ] *Administração → Sistema*: banco "Funcionando", hora "Sincronizada", e-mail
      "Funcionando" (se configurado).
- [ ] Teste **sem login**: o resultado aparece, ganha um protocolo `AUD-…`, e o
      link copiado abre a página pública.
- [ ] **Criar uma conta** de teste (com o captcha): ela já entra conectada; o
      teste feito sem login vai para o histórico dela.
- [ ] Conectado, ligar "Registrar a localização do aparelho" e testar: o teste
      aparece em *Meu painel*, no mapa e no histórico.
- [ ] *Administração → Ao vivo*: a conta de teste aparece online e "Fazendo um
      teste" durante o teste.
- [ ] *Usuários → conta de teste*: **Link para nova senha** → abrir o link →
      criar senha → entrar com ela.
- [ ] **Desativar** → a conta de teste cai na hora → **Reativar** → **Excluir**.
- [ ] *Auditoria* mostra as ações acima.

---

## 19. Personalizar para o seu provedor

O projeto vem com a identidade da Audicom Telecom. Para usar em outro provedor:

| O quê | Onde |
|---|---|
| Nome e cidade do servidor, WhatsApp, telefone, e-mail, site e central do assinante | `server/.env`: `SERVER_NAME`, `SERVER_LOCATION`, `SUPPORT_WHATSAPP`, `SUPPORT_PHONE`, `SUPPORT_EMAIL`, `SUPPORT_SITE`, `SUPPORT_CENTRAL` |
| Logotipos, ícones e imagem de prévia do WhatsApp | `assets/` (mesmos nomes de arquivo) |
| Cores e fontes | `css/base.css` (variáveis no início do arquivo) |
| Rodapé (endereço) e menu | `js/core/shell.js` |
| Textos das páginas | `index.html`, `como-medimos.html`, `privacidade.html`, `termos.html` |
| Domínio do HTTPS | `--dominio` do `publicar.sh` (ele ajusta o Caddyfile) |

Os textos de privacidade e termos citam a Audicom: troque pelos do seu provedor
e passe pelo seu jurídico.

---

## 20. SEO, Google e estatísticas

### O que já vem pronto

- **Página inicial otimizada** para buscas como "teste de velocidade", "teste de
  velocidade da internet", "medir internet", "teste de ping": título, descrição,
  "Teste de velocidade da internet" no H1 e uma seção de conteúdo visível (como
  funciona, o que cada número significa, velocidade por uso, dicas e 11
  perguntas frequentes).
- **Dados estruturados** (schema.org, JSON-LD): organização, site, aplicativo
  gratuito, página e perguntas frequentes; nas páginas de texto, artigo e
  trilha de navegação.
- **Endereço canônico, Open Graph e Twitter** em todas as páginas públicas. O
  endereço vem do `PUBLIC_URL` (o servidor troca `{{ORIGEM}}` no HTML).
- **`/sitemap.xml` e `/robots.txt`** gerados pelo servidor, com o endereço certo.
- **`noindex`** nas páginas que não devem aparecer no Google: entrar, painel,
  administração, 404 e os links de resultado (`/r/...`).
- **Velocidade**: HTML comprimido, fontes locais com pré-carregamento, nenhum
  framework no navegador.

### Google Search Console (faça uma vez, depois do site no ar)

1. Abra <https://search.google.com/search-console> com a conta Google da empresa.
2. **Adicionar propriedade → Domínio** → o seu domínio, por exemplo
   `seuprovedor.com.br` (vale para todos os subdomínios).
3. O Google mostra um registro **TXT**: crie no DNS do domínio e clique em
   **Verificar**.
4. Menu **Sitemaps** → envie `https://velocidade.seuprovedor.com.br/sitemap.xml`.
5. Menu **Inspeção de URL** → cole o endereço do site → **Solicitar indexação**.

Repita o passo 4 no **Bing Webmaster Tools** (<https://www.bing.com/webmasters>),
que pode importar direto do Search Console.

### Google Analytics 4

1. No `server/.env`: `GA_MEASUREMENT_ID=G-XXXXXXXXXX` (no GA: *Administrador →
   Fluxos de dados → o fluxo do site → ID da métrica*).
2. `systemctl restart audicom-speedtest`.

Como funciona:

- Na primeira visita aparece uma **faixa de cookies** (Aceitar / Recusar). Até a
  pessoa aceitar, o GA fica em *consentimento negado* (Modo de Consentimento
  v2): não grava cookie nem identificador. Sinais de publicidade ficam sempre
  desligados.
- Os endereços vão ao GA **sem a parte depois do `?`**, porque os links de nova
  senha e de confirmação de e-mail levam códigos secretos ali.
- A **administração** fica fora das estatísticas.
- Eventos enviados (em *Relatórios → Engajamento → Eventos*):

| Evento | Quando | Parâmetros |
|---|---|---|
| `teste_iniciado` | clique em Iniciar | `modo` |
| `teste_concluido` | fim do teste | `modo`, `download_mbps`, `upload_mbps`, `ping_ms` |
| `share` | enviar no WhatsApp ou copiar o resultado | `method` (`whatsapp` ou `copiar`) |

Para ver `download_mbps` e os outros números em relatórios, cadastre-os em
*Administrador → Definições personalizadas → Métricas personalizadas*.

