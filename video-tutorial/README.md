# Vídeo tutorial do Speed CJC

Kit para gerar o tutorial em vídeo **desta versão** (a genérica, do ramo `main`):
três partes, para o cliente, para o técnico e para a administração, gravadas da
tela de verdade, com narração em português e legendas. Foi com estas mesmas
ferramentas que o tutorial da versão da Audicom (ramo `audicom-telecom`) foi feito.

> **Faça tudo no seu PC.** Gravar e renderizar pesa; o servidor de produção não
> tem placa de vídeo e é compartilhado com o site. Linux ou macOS (no Windows,
> use o WSL).

## O que precisa

- **Node.js 22** ou mais novo, **ffmpeg** e **Python 3**.
- **Chrome ou Chromium** (caminho na variável `CHROME`, padrão `/usr/bin/chromium`).
- Para a voz: um Python com `kokoro-onnx` e `soundfile`:

  ```bash
  python3 -m venv ~/.venv-voz && ~/.venv-voz/bin/pip install kokoro-onnx soundfile
  export HYPERFRAMES_PYTHON=~/.venv-voz/bin/python
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
node vozes.mjs              # uma fala por cena, voz pf_dora, volume igualado
```

O texto de cada cena está em `roteiro.json` (`legenda` aparece na tela; `fala`,
quando existe, é a versão escrita do jeito que a voz pronuncia, ex.: "I P v 4").

### 5. Gravar as telas

```bash
node rec-usuario.mjs        # Parte 1 (22 cenas)
node rec-tecnico.mjs        # Parte 2 (14 cenas)
node rec-admin.mjs          # Parte 3 (15 cenas; a cena do terminal é desenhada na montagem)
```

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
ffmpeg -f concat -safe 0 -i lista.txt -c copy tutorial-completo.mp4
```

### 8. Publicar

Os MP4 não vão para o git: crie um release no GitHub (ex.: `tutorial-v1`) com
eles. Para o site mostrar os vídeos (página do teste e Administração →
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
| `HYPERFRAMES_PYTHON` | Python com o kokoro-onnx (voz) | — |
