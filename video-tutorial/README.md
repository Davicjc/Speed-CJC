# Vídeo tutorial do teste de velocidade da Audicom

Tutorial completo do sistema, gravado num computador (1920×1080), com narração
em português e legendas. São três partes, cada uma um projeto
[HyperFrames](https://hyperframes.heygen.com) (HTML que vira vídeo):

| Pasta | Parte | Duração |
|---|---|---|
| `usuario/` | Parte 1 · Para o cliente: fazer o teste, resultado, conta e painel | 3 min 14 s |
| `tecnico/` | Parte 2 · Para o técnico: diagnóstico, atendimento, NAT, MTU, rota e envio para o Zap | 2 min 7 s |
| `admin/` | Parte 3 · Para a administração: usuários, testes, técnicos, WhatsApp e servidor | 2 min 5 s |

As telas foram gravadas numa cópia do sistema com **dados fictícios** (Clara
Souza, Roberto Lima, Marcos Andrade…, IPs de documentação 203.0.113.x): nenhum
dado de cliente real aparece.

## Renderizar no seu computador

Precisa do **Node.js 22** ou mais novo ([nodejs.org](https://nodejs.org)). O
HyperFrames baixa sozinho o que precisa (Chrome e ffmpeg) na primeira vez.
Com placa de vídeo fica bem mais rápido.

```bash
git clone --branch audicom-telecom https://github.com/Davicjc/Speed-CJC.git
cd Speed-CJC/video-tutorial

cd usuario && npx hyperframes render -q delivery -o ../tutorial-usuario.mp4 && cd ..
cd tecnico && npx hyperframes render -q delivery -o ../tutorial-tecnico.mp4 && cd ..
cd admin   && npx hyperframes render -q delivery -o ../tutorial-admin.mp4   && cd ..
```

Cada parte vira um MP4. Para ter **um vídeo só, completo**, junte as três com o
ffmpeg (sem perder qualidade):

```bash
printf "file 'tutorial-usuario.mp4'\nfile 'tutorial-tecnico.mp4'\nfile 'tutorial-admin.mp4'\n" > lista.txt
ffmpeg -f concat -safe 0 -i lista.txt -c copy tutorial-audicom-completo.mp4
```

Opções úteis do `render`: `-w 4` (quantos processos em paralelo; o padrão usa
todos os núcleos), `-q draft` (rascunho rápido para conferir), `--gpu` (usa a
placa de vídeo para gerar o MP4).

## Ver e editar antes de renderizar

```bash
cd usuario && npx hyperframes preview
```

Abre o editor no navegador: dá para assistir, ajustar textos, tempos e cortes.

## Como é feito

- `assets/rec/` — as gravações de tela de cada cena (o cursor e o destaque
  amarelo foram gravados junto).
- `assets/voz/` — a narração de cada cena (voz sintética `pf_dora`, Kokoro,
  gerada localmente).
- `compositions/` — uma cena por arquivo: janela de navegador, título do passo,
  aproximação nas gavetas; `legendas.html` tem todas as legendas da parte.
- `index.html` — monta a parte: abertura, cenas, legendas e vozes em sequência.
- `_fonte/roteiro.json` — o roteiro (título e fala de cada cena) e
  `_fonte/montar.py` — o script que gerou os três projetos a partir das
  gravações (usa os caminhos do servidor onde foi feito).
