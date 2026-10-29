#!/usr/bin/env bash
# Instala o teste de velocidade numa VM Debian/Ubuntu crua, do zero.
#
#   curl -fsSL https://raw.githubusercontent.com/Davicjc/Speed-CJC/main/server/tools/instalar.sh | sudo bash
#       → instala e liga o site em http://IP-DA-VM:8080 (rede local, sem domínio)
#
#   curl -fsSL .../instalar.sh | sudo bash -s -- --dominio teste.seudominio.com.br --dono voce@email --dono-nome "Seu Nome"
#       → instala e publica com HTTPS no domínio (chama tools/publicar.sh)
#
# Opções:
#   --pasta DIR        onde instalar (padrão /opt/speed-cjc)
#   --repo URL         repositório git (padrão https://github.com/Davicjc/Speed-CJC.git)
#   --so-preparar      só instala dependências, Node e o projeto; não liga nada
#   --dono EMAIL / --dono-nome "Nome"   cria o administrador principal
#   qualquer outra opção (--dominio, --ip, --sem-ipv6, --turnstile-*, ...) vai para o publicar.sh
#
# Pode rodar de novo para atualizar: ele faz git pull e reinstala as dependências.
set -euo pipefail

PASTA=/opt/speed-cjc
REPO=https://github.com/Davicjc/Speed-CJC.git
SO_PREPARAR=0; DOMINIO=""; DONO=""; DONO_NOME=""; RESTO=()
while [ $# -gt 0 ]; do
    case "$1" in
        --pasta) PASTA="$2"; shift 2 ;;
        --repo) REPO="$2"; shift 2 ;;
        --so-preparar) SO_PREPARAR=1; shift ;;
        --dominio) DOMINIO="$2"; RESTO+=("$1" "$2"); shift 2 ;;
        --dono) DONO="$2"; RESTO+=("$1" "$2"); shift 2 ;;
        --dono-nome) DONO_NOME="$2"; RESTO+=("$1" "$2"); shift 2 ;;
        -h|--help) sed -n '2,19p' "${BASH_SOURCE[0]:-/dev/null}" 2>/dev/null || true; exit 0 ;;
        *) RESTO+=("$1"); shift ;;
    esac
done

verde() { printf '\033[32m%s\033[0m\n' "$*"; }
vermelho() { printf '\033[31m%s\033[0m\n' "$*"; }
passo() { printf '\n\033[1m%s\033[0m\n' "$*"; }

[ "$(id -u)" = 0 ] || { vermelho "Rode como root (sudo)."; exit 1; }
command -v apt-get >/dev/null || { vermelho "Este instalador é para Debian/Ubuntu (apt)."; exit 1; }
export DEBIAN_FRONTEND=noninteractive

# Rodando de dentro de uma cópia do projeto? Então usa ela em vez de baixar.
AQUI="$(cd "$(dirname "${BASH_SOURCE[0]:-.}")" 2>/dev/null && pwd || true)"
if [ -n "$AQUI" ] && [ -f "$AQUI/../package.json" ] && [ -f "$AQUI/../../index.html" ]; then
    PASTA="$(cd "$AQUI/../.." && pwd)"; REPO=""
fi

passo "1. Pacotes do sistema"
apt-get update -qq
apt-get install -y -qq ca-certificates curl git gnupg iproute2 iputils-ping mtr-tiny tcpdump >/dev/null
verde "  ✓ git, curl, mtr (rota) e tcpdump (diagnóstico de NAT)"

passo "2. Node.js 22"
node_ok() { command -v node >/dev/null && node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=13)?0:1)'; }
if node_ok; then verde "  ✓ já instalado: $(node -v)"
else
    # repositório oficial da NodeSource (método manual documentado por eles)
    mkdir -p /etc/apt/keyrings
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
    echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" > /etc/apt/sources.list.d/nodesource.list
    apt-get update -qq
    apt-get install -y -qq nodejs >/dev/null
    node_ok || { vermelho "  ✗ não foi possível instalar o Node 22.13+"; exit 1; }
    verde "  ✓ instalado: $(node -v)"
fi

passo "3. Projeto em $PASTA"
if [ -z "$REPO" ]; then verde "  ✓ usando esta cópia"
elif [ -d "$PASTA/.git" ]; then git -C "$PASTA" pull --ff-only -q; verde "  ✓ atualizado (git pull)"
else git clone -q "$REPO" "$PASTA"; verde "  ✓ baixado de $REPO"; fi
cd "$PASTA/server"
npm ci --omit=dev --no-audit --no-fund --no-update-notifier --loglevel=error
mkdir -p data && chmod 700 data
verde "  ✓ dependências instaladas"

if [ "$SO_PREPARAR" = 1 ]; then
    passo "Pronto (só preparação)."
    echo "  Para ligar na rede local:     bash $PASTA/server/tools/servico.sh"
    echo "  Para publicar com domínio:    bash $PASTA/server/tools/publicar.sh --dominio SEU.DOMINIO"
    exit 0
fi

if [ -n "$DOMINIO" ]; then
    passo "4. Publicação com HTTPS"
    exec bash "$PASTA/server/tools/publicar.sh" "${RESTO[@]}"
fi

passo "4. Serviço (rede local, porta 8080)"
bash "$PASTA/server/tools/servico.sh"
if command -v ufw >/dev/null && ufw status 2>/dev/null | grep -q "Status: active"; then
    ufw allow 8080/tcp comment 'teste de velocidade' >/dev/null
    ufw allow 8080/udp comment 'teste de velocidade: perda de pacotes (WebRTC)' >/dev/null
    verde "  ✓ firewall (ufw): TCP e UDP 8080 liberadas"
fi
if [ -n "$DONO" ]; then
    passo "5. Administrador principal"
    node --disable-warning=ExperimentalWarning tools/admin.mjs dono "$DONO" "$DONO_NOME"
fi

IP=$(ip -4 -o addr show scope global 2>/dev/null | awk '{sub(/\/.*/, "", $4); print $4; exit}' || true)
passo "Pronto."
echo "  Abra: http://${IP:-IP-DA-VM}:8080"
[ -n "$DONO" ] || echo "  Crie o administrador: cd $PASTA/server && npm run admin -- dono voce@email \"Seu Nome\""
echo "  Para o público (HTTPS no domínio): bash $PASTA/server/tools/publicar.sh --dominio SEU.DOMINIO"
