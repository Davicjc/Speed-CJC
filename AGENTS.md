# Regras para quem mexe neste repositório (pessoas e agentes de IA)

Leia antes de mudar qualquer coisa. Vale para Claude Code, Codex, Cursor,
Copilot e qualquer outro agente.

## Os dois ramos

| Ramo | O que é |
|---|---|
| `main` | **Speed CJC**, a versão genérica e pública: cores de davicjc.com, marca configurável pelo `.env` (`SITE_NAME`, `SERVER_NAME`, `SUPPORT_*` …) |
| `audicom-telecom` | a versão em produção da **Audicom Telecom**: marca, cores, textos e contatos da Audicom |

- **Toda correção ou funcionalidade vai nos DOIS ramos** (faça num e leve para
  o outro com `git cherry-pick`, resolvendo as diferenças abaixo).
- Diferenças esperadas entre os ramos (não "corrija" uma para a outra):

  | | `main` | `audicom-telecom` |
  |---|---|---|
  | chaves do navegador | `speedcjc.*` | `audicom.*` |
  | cabeçalho anti-CSRF | `X-Speed` | `X-Audicom` |
  | banco / serviço | `speedcjc.db` / `speed-cjc` | `audicom.db` / `audicom-speedtest` |
  | protocolo dos testes | `SPD-…` (`PROTOCOL_PREFIX`) | `AUD-…` |
  | visual | grafite + verde de LED, Archivo + IBM Plex Sans | azul Audicom, Space Grotesk + Inter |

- **Nunca leve para a `main`** nome, logo, endereço, telefone, e-mail, domínio ou
  dados da Audicom. A `main` é pública e genérica.
- A produção da Audicom roda a partir do ramo `audicom-telecom`.
- Os dois ramos têm a regra "mudanças por pull request"; o dono do repositório
  pode enviar direto.

## Commits

- **Só em nome do dono do repositório (Davicjc).** Nada de `Co-Authored-By`,
  "Generated with …" ou assinatura de IA em commits, PRs e releases.
- Antes de commitar: `cd server && npm test` (todos passando).
- Nunca versionar: `server/.env`, `server/data/` (banco, cópias, chaves, sessão do
  WhatsApp), `NOTAS-DESTA-MAQUINA.md`, `.antigo/`, vídeos renderizados
  (`assets/tutorial/*.mp4`, `video-tutorial/*.mp4`, `renders/`). O `.gitignore`
  já cobre; confira com `git status` antes de enviar.
- IDs de analytics, senhas e chaves ficam só no `server/.env`.

## Regras do produto

- Tudo roda no próprio servidor (Node + SQLite). Nada de Firebase ou outro
  serviço externo obrigatório.
- **Segurança e LGPD vêm primeiro**: sem script inline (CSP), dados pessoais só
  o necessário, nada de dado real de cliente em capturas, vídeos ou testes.
- Rodapé obrigatório em **todas** as páginas e em `server/src/result-page.js`:
  `<script src="https://recursos.cjc.pics/projetos/footer-davi/footer_davicjc.js" defer></script>`
- Mudança no banco: migração nova em `server/src/db.js` e cópia do banco antes
  (`VACUUM INTO`).
- Interface e documentação em português do Brasil, linguagem simples.

## Vídeos tutoriais

- Ficam em `video-tutorial/` (projetos [HyperFrames](https://hyperframes.heygen.com)).
- **São renderizados no PC do dono, não no servidor**: o servidor não tem placa
  de vídeo e é compartilhado com o site em produção. Não rode `hyperframes
  render` (nem gravações pesadas) no servidor.
- Os MP4 prontos vão para um release do GitHub (ex.: `tutorial-v1`), não para o
  git; o site baixa com `server/tools/baixar-tutoriais.sh`.
