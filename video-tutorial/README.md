# Vídeo tutorial do Speed CJC

Kit para gerar o tutorial em vídeo **desta versão** (a genérica, do ramo `main`):
três partes, para o cliente, para o técnico e para a administração, gravadas da
tela de verdade, com narração em português e legendas. Foi com estas mesmas
ferramentas que o tutorial da versão da Audicom (ramo `audicom-telecom`) foi feito.

## Assistir

O vídeo toca direto no navegador, na
[página do tutorial](https://davicjc.github.io/Speed-CJC/tutorial/):

[![Assistir o vídeo tutorial](../docs/img/tutorial-capa.webp)](https://davicjc.github.io/Speed-CJC/tutorial/)

- [Vídeo completo](https://davicjc.github.io/Speed-CJC/tutorial/): 7 min 59 s
- [Parte 1 · Cliente](https://davicjc.github.io/Speed-CJC/tutorial/#parte1): 3 min 31 s
- [Parte 2 · Técnico](https://davicjc.github.io/Speed-CJC/tutorial/#parte2): 2 min 14 s
- [Parte 3 · Administração](https://davicjc.github.io/Speed-CJC/tutorial/#parte3): 2 min 14 s

Os MP4 para baixar ficam no
[release `tutorial-speedcjc-v1`](https://github.com/Davicjc/Speed-CJC/releases/tag/tutorial-speedcjc-v1).
A página (`docs/tutorial/`, publicada pelo GitHub Pages) toca o vídeo direto
desse release.

## Gerar de novo

> **Faça tudo no seu PC.** Gravar e renderizar pesa; o servidor de produção não
> tem placa de vídeo e é compartilhado com o site. Funciona no Linux, no macOS e
> no Windows (no Git Bash; veja a nota no fim).

## O que precisa

- **Node.js 22** ou mais novo, **ffmpeg** e **Python 3**.
- **Chrome ou Chromium** (caminho na variável `CHROME`, padrão `/usr/bin/chromium`).
- Para a voz: o `edge-tts` (voz neural da Microsoft, precisa de internet):

  ```bash
  pip install edge-tts
  ```

## Passo a passo

Os comandos partem da raiz do repositório. Tudo o que é gerado (banco de
demonstração, gravações, vozes) fica em `video-tutorial/trabalho/`, fora do git.

### 1. Servidor de demonstração (com dados fictícios)

```bash
cd server && npm ci
PORT=8098 DATA_DIR=../video-tutorial/trabalho/demo-data \
ANON_TESTS_PER_DAY=1000 ANON_TESTS_PER_IP_DAY=1000 npm start
```

Deixe rodando. **Nunca grave com dados de clientes reais.**

### 2. Contas de demonstração

Em outro terminal (senha das contas: a da variável `TUT_SENHA`, padrão `Demo2026speed`):

```bash
cd server
DATA_DIR=../video-tutorial/trabalho/demo-data npm run admin -- dono marcos@exemplo.com.br "Marcos Andrade"
# abra o link mostrado trocando o domínio por http://localhost:8098 e crie a senha Demo2026speed

cd ../video-tutorial/ferramentas && npm install
node demo-contas.mjs        # cria Roberto Lima (técnico) e Clara Souza (cliente) pelo cadastro
cd ../../server && DATA_DIR=../video-tutorial/trabalho/demo-data npm run admin -- tecnico roberto@exemplo.com.br
```

### 3. Histórico de exemplo

```bash
cd video-tutorial/ferramentas
node demo-modelos.mjs       # faz 3 testes de verdade (modelos), com a rede limitada a 500/250 Mbps
# pare o servidor (Ctrl+C no primeiro terminal) e então:
node semear.mjs ../trabalho/demo-data/speedcjc.db   # um mês de testes, outros clientes e atendimentos
# ligue o servidor de novo (passo 1)
```

### 4. Narração

```bash
node vozes.mjs              # uma fala por cena, voz Thalita (pt-BR), volume igualado
```

Para trocar a voz, apague `trabalho/voz-cenas` e rode de novo com, por exemplo,
`TUT_VOZ=pt-BR-FranciscaNeural` ou `TUT_VOZ=pt-BR-AntonioNeural`. As gravações
seguem o tempo de cada fala, então grave as telas depois de gerar as vozes.

O texto de cada cena está em `roteiro.json` (`legenda` aparece na tela; `fala`,
quando existe, é a versão escrita do jeito que a voz pronuncia, ex.: "I P v 4").

### 5. Gravar as telas

```bash
node rec-usuario.mjs        # Parte 1 (22 cenas)
node rec-tecnico.mjs        # Parte 2 (14 cenas)
node rec-admin.mjs          # Parte 3 (15 cenas; a cena do terminal é desenhada na montagem)
```

A cena t13 anexa duas fotos do atendimento: antes da Parte 2, coloque duas
fotos fictícias (sem marcas, pessoas ou endereços) em `trabalho/fotos/foto1.jpg`
e `trabalho/fotos/foto2.jpg`.

Cada cena é gravada no ritmo da sua fala, com um cursor animado e um destaque
amarelo no que está sendo explicado. Para regravar só algumas cenas:
`node rec-usuario.mjs u19 u20`. O WhatsApp aparece simulado (o servidor de
demonstração não tem um conectado).

### 6. Montar os três projetos

```bash
python3 montar.py           # cria video-tutorial/usuario, tecnico e admin
```

Variável útil: `TUT_DOMINIO` (o endereço mostrado na barra da janela, padrão
`teste.minhaempresa.com.br`).

### 7. Ver e renderizar

```bash
cd ../usuario && npx hyperframes preview          # ver e ajustar no navegador
npx hyperframes render -q delivery -o ../tutorial-usuario.mp4
cd ../tecnico && npx hyperframes render -q delivery -o ../tutorial-tecnico.mp4
cd ../admin   && npx hyperframes render -q delivery -o ../tutorial-admin.mp4
```

Um vídeo só, com as três partes:

```bash
cd .. && printf "file 'tutorial-usuario.mp4'\nfile 'tutorial-tecnico.mp4'\nfile 'tutorial-admin.mp4'\n" > lista.txt
ffmpeg -f concat -safe 0 -i lista.txt -c copy tutorial-speedcjc-completo.mp4
```

### 8. Publicar

Os MP4 não vão para o git: crie um release no GitHub com eles (o desta versão é
`tutorial-speedcjc-v1`; o `tutorial-v1` é o da versão da Audicom). Para o site mostrar os vídeos (página do teste e Administração →
Tutoriais), baixe-os para `assets/tutorial/` no servidor.

## Variáveis

| Variável | Para quê | Padrão |
|---|---|---|
| `TUT_DIR` | pasta de trabalho | `video-tutorial/trabalho` |
| `TUT_URL` | endereço do servidor de demonstração | `http://localhost:8098` |
| `TUT_SENHA` | senha das contas de demonstração | `Demo2026speed` |
| `TUT_DB` | banco de demonstração (para achar o atendimento de exemplo) | `trabalho/demo-data/speedcjc.db` |
| `TUT_DOMINIO` | endereço mostrado na barra da janela | `teste.minhaempresa.com.br` |
| `CHROME` | caminho do Chrome/Chromium | `/usr/bin/chromium` |
| `TUT_VOZ` | voz do edge-tts | `pt-BR-ThalitaMultilingualNeural` |
| `TUT_PYTHON` | Python com o edge-tts | `python3` (`python` no Windows) |

## No Windows

Use o Git Bash e aponte para o Chrome instalado:

```bash
export CHROME="/c/Program Files/Google/Chrome/Application/chrome.exe"
```

Troque `python3` por `python` nos comandos. Parar o servidor com Ctrl+C às
vezes deixa o `node` vivo: confira se a porta 8098 ficou livre antes de rodar o
`semear.mjs`.
