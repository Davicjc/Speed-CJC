# Servidor do teste de velocidade Audicom

Um processo Node só: serve o site, faz as medições e guarda contas, sessões e
testes num banco SQLite (`data/audicom.db`, com o `node:sqlite` embutido no
Node). Nada de Firebase ou outro serviço obrigatório. Configuração em
`server/.env` (modelo: `.env.example`). Guia de implantação:
[../docs/INSTALAR.md](../docs/INSTALAR.md) (do zero, numa VM crua) e [../docs/MANUAL.md](../docs/MANUAL.md) (operação).

```bash
npm ci
npm start
npm run admin -- dono seu@email "Seu nome"
```

## Módulos (`src/`)

| Arquivo | O que faz |
|---|---|
| `server.js` | rotas, páginas, cabeçalhos de segurança (CSP por página), proteção CSRF, gravação do resultado |
| `config.js` | variáveis de ambiente (lê `server/.env`) |
| `db.js` | banco SQLite (WAL, chaves estrangeiras), migrações, cópia de segurança diária (`VACUUM INTO`) |
| `senhas.js` | embaralhamento de senha com scrypt e conferência em tempo constante |
| `sessions.js` | sessões em cookie HttpOnly (`__Host-` em HTTPS), "manter conectado", links de uso único (confirmação e nova senha) |
| `authn.js` | quem está logado, exigências de login, de administrador e de senha recente |
| `users.js` | contas, papéis (`user`, `admin`, `owner`), desativação, último acesso, auditoria |
| `mail.js` | e-mail por SMTP (opcional, nodemailer): confirmação e nova senha |
| `tests-store.js` | testes no banco, agregados por dia/hora/operadora/cidade, "pegar" teste feito sem login, retenção |
| `ids.js` | ids em ordem cronológica inversa, protocolo `AUD-…` |
| `routes-account.js` | cadastro com captcha, login, sessão, e-mail, nova senha, perfil, aparelhos conectados, histórico, exportação e exclusão (LGPD), presença |
| `routes-tecnico.js` | o /tecnico: lista e detalhe dos testes de todos os clientes (só leitura, técnico ou admin) |
| `busca-testes.js` | busca de testes por protocolo, id, nome ou e-mail, com filtros (admin e técnico) |
| `routes-admin.js` | visão geral, ao vivo (SSE), testes, planilha, usuários, papéis, link de senha, auditoria, sistema |
| `captcha.js` | Cloudflare Turnstile ou desafio próprio (prova de trabalho), resposta de uso único |
| `presence.js` | quem está online agora + canal ao vivo dos administradores |
| `geo.js` | endereço aproximado da coordenada (Nominatim, com fila e cache) |
| `results.js` | validação do resultado e do cadastro; conferência contra o que o servidor mediu |
| `result-page.js` | página pública `/r/<id>` com prévia para WhatsApp |
| `static.js` | arquivos do site (lista fechada: nada de `server/`, `.env`, banco, `.md`) |
| `slots.js`, `transfer.js`, `ws.js`, `measurements.js` | fila de vagas, download/upload, WebSocket (ping, hora, upload medido aqui), registro do que foi medido |
| `webrtc.js` | eco UDP para perda de pacotes (anuncia o IP público: `PUBLIC_IPV4` ou o do domínio no DNS) |
| `ntp.js` | hora oficial pelo NTP.br |
| `trace.js`, `nat.js` | rota (mtr) e diagnóstico de duplo NAT / CGNAT |
| `platforms.js` | endereços de borda (CDN) das plataformas e bancos, conferidos a cada 6 h |
| `isp.js` | operadora e cidade do IP (vários provedores, cache de 24 h) |
| `util.js`, `ua.js` | utilidades (IP real só do proxy local, JSON, limites) e leitura do aparelho |

## Ferramentas (`tools/`)

| Comando | O que faz |
|---|---|
| `npm run admin -- dono email "Nome"` | cria (ou promove) um dono e mostra o link para escolher a senha |
| `npm run admin -- link email` | link de nova senha (24 h, uso único) |
| `npm run admin -- listar` | donos e administradores |
| `npm run admin -- rebaixar email` | tira o papel de dono |
| `npm run admin -- reativar email` | reativa uma conta desativada |
| `npm run admin -- tecnico email` / `sem-tecnico email` | dá ou tira o acesso ao /tecnico |
| `bash tools/instalar.sh [--dominio …] [--dono …]` | VM crua → site no ar: pacotes, Node 22, projeto, dependências, serviço (e publicação, com `--dominio`) |
| `bash tools/publicar.sh --dominio … [--ip …] [--dono …]` | publica: `.env`, NTP, Caddy, firewall, serviço e dono (`--simular` só mostra) |
| `bash tools/servico.sh` | instala/atualiza e liga o serviço do systemd a partir do modelo `deploy/audicom-speedtest.service` |
| `npm run build:vendor` | empacota o Leaflet em `../vendor/` |

## Banco de dados

Tabelas: `users` (contas; senha só como hash scrypt), `sessions` (hash do token
do cookie, aparelho, IP, validade, última vez que a senha foi digitada),
`tokens` (hash dos links de confirmação e nova senha), `tests` (resultados) e
`audit` (ações de administrador). Excluir uma conta apaga em cascata as sessões,
os links e os testes dela.

Cópia automática por dia em `data/backups/` (`BACKUP_DAYS`, padrão 14).
Restaurar: ver a seção 12 do `docs/MANUAL.md`.

## O que é medido e como

| Medida | Como | Por que assim |
|---|---|---|
| Ping / jitter | eco por WebSocket persistente, dentro de um Web Worker; 5 de aquecimento + 30 amostras; ping = mediana, jitter = média das diferenças entre pings consecutivos (RFC 3550) | o worker isola a medição da animação da tela; WebSocket não paga handshake por amostra |
| Download | 6 fluxos HTTP paralelos com bytes aleatórios, 10 s; os 2 s iniciais ficam fora da conta | mesmo método de LibreSpeed e Cloudflare; bytes aleatórios não comprimem |
| Upload | 4 envios paralelos, 10 s; a velocidade é contada **no servidor**, descartando 3 s iniciais | o progresso do navegador superestima |
| Ping com a linha cheia | pings a cada 200 ms durante download e upload, contra o ping em repouso | é o bufferbloat |
| Perda de pacotes | 200 pacotes UDP numerados por WebRTC DataChannel sem retransmissão | TCP esconde perda reenviando |
| Relógio do aparelho | troca estilo NTP pelo WebSocket contra a hora do NTP.br | precisão de milissegundos |
| IPv4 × IPv6 | download separado em nomes só-A e só-AAAA | o sistema do cliente não consegue escolher a outra família |
| Rota | `mtr` do servidor até o IP do cliente | mostra onde está o problema |
| Aplicativos / bancos / PIX | `fetch` sem CORS com a conexão aberta, contra endereços servidos pela borda (CDN); fica o menor de 3 | endereços que vão à origem somariam ~150 ms que não são da conexão |
| NAT | TTL dos pacotes × saltos do mtr (roteadores dentro da casa), faixa CGNAT, e tipo de NAT por STUN no navegador | nenhum sinal sozinho é prova |

**Vários clientes ao mesmo tempo:** só `MAX_CONCURRENT_TESTS` (padrão 6) medem
banda juntos; os demais esperam numa fila com a posição na tela.

**Capacidade medida (22/09/2026, esta VM, placa de 10 Gbps):** a mediana do ping
de 30 clientes não se mexe até ~6 Gbps servidos no total. Mantenha
`MAX_CONCURRENT_TESTS × plano mais rápido` abaixo de ~6 Gbps.

**Conferência dos resultados:** o navegador envia o id da conexão em que testou.
O servidor grava o upload que **ele** mediu e marca como "não conferido" um
download maior do que os bytes que entregou, ou um resultado sem teste real.

## Portas

A mesma porta serve **TCP** (site, API, WebSocket) e **UDP** (perda de pacotes).
Atrás do Caddy, só a UDP precisa ser exposta direto (`ufw allow 8080/udp`).

## API (resumo)

Toda chamada que muda algo (POST, PATCH, DELETE) precisa vir do próprio site:
cabeçalho `X-Audicom: 1`, ou `Sec-Fetch-Site: same-origin`, ou `Origin` igual ao
host. As exceções são `/api/upload` e `/api/rtc/offer` (medição).

Páginas: todo HTML passa pelo servidor, que troca `{{ORIGEM}}` pelo endereço do
site e acrescenta o Google Analytics quando `GA_MEASUREMENT_ID` está no `.env`
(menos na administração). `GET /robots.txt` e `/sitemap.xml` são gerados.
`GET /api/tls-ask?domain=` responde 200 só para os nomes do site (o Caddy
pergunta antes de pedir um certificado sob demanda).

Públicas: `GET /api/config`, `/api/whoami`, `/api/time`, `/api/platforms`,
`/api/health`, `/api/trace`, `/api/nat`, `/api/captcha/challenge`,
`/api/results/<id>`; `POST /api/rtc/offer`, `/api/results`.

Contas: `POST /api/auth/signup`, `/api/auth/login`, `/api/auth/logout`,
`/api/auth/verify`, `/api/auth/verify/resend`, `/api/auth/forgot`,
`/api/auth/reauth`; `GET /api/auth/session`; `GET` e `POST /api/auth/reset`.

Com login (cookie de sessão): `/api/me` (GET, PATCH, DELETE),
`/api/me/password`, `/api/me/sessions` (+ `DELETE /api/me/sessions/<id>`),
`/api/me/logout-all`, `/api/me/export`, `/api/me/tests`, `/api/me/tests/<id>`,
`/api/presence`, `POST /api/results/<id>/claim`.

Técnico (login + acesso técnico ou admin): `GET /api/tecnico/tests` (`q`, `origem`, `mode`, `after`) e `/api/tecnico/tests/<id>`.

Administração (login + papel admin, e e-mail confirmado se houver SMTP):
`/api/admin/overview`, `/map`, `/online`, `/stream` (SSE), `/system`, `/tests`,
`/tests.csv`, `/tests/<id>`, `/users`, `/users/invite`, `/users/<uid>`
(GET, DELETE; + `/role`, `/tecnico`, `/status`, `/revoke`, `/reset-link`), `/audit`.
Ações sensíveis respondem `code: "reauth"` se a senha não foi digitada nos
últimos 15 minutos.

## Testes

```bash
npm test
```

`test/servidor.mjs` sobe um servidor isolado em porta aleatória, com banco
temporário, e o derruba no fim. `protocolo.test.mjs` cobre a medição;
`seguranca.test.mjs` cobre arquivos internos, cabeçalhos, CSRF, captcha, senhas,
bloqueio de login, isolamento entre contas, papéis, sessões, links de senha,
planilha e exclusão.

## Bibliotecas do navegador

`../vendor/` é gerado a partir do npm (sem CDN de terceiros):

```bash
npm install && npm run build:vendor
```
