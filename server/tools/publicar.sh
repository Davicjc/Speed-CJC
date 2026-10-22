#!/usr/bin/env bash
# Deixa esta máquina pronta para o site público, de uma vez:
#   .env do servidor, hora certa (NTP), HTTPS com Caddy, firewall, serviço e
#   o dono do sistema (administrador principal).
#
# Uso (como root):
#   bash /root/speedtest/server/tools/publicar.sh \
#        --dominio velocidadeteste.audicomtelecom.com.br \
#        [--ip <IP público>]  (IPv4 público que o roteador encaminha para cá; sem ele, vale o do DNS do domínio)
#        [--dono seu@email --dono-nome "Seu Nome"]   (cria o administrador principal e mostra o link da senha)
#        [--turnstile-site <chave do site> --turnstile-secret <chave secreta>] \
#        [--sem-ipv6]      (não há IPv6 público / não criou o nome v6.)
#        [--fechar-8080]   (fecha a porta TCP 8080 para fora; o site passa a ser só pelo domínio)
#        [--simular]       (mostra o que faria, sem mudar nada)
#
# Pode rodar de novo quando quiser: ele só ajusta o que for preciso.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$DIR/.env"
DOM=""; IP=""; TS_SITE=""; TS_SECRET=""; SEM_V6=0; FECHAR=0; SIMULAR=0; DONO=""; DONO_NOME=""
while [ $# -gt 0 ]; do
    case "$1" in
        --dominio) DOM="$2"; shift 2 ;;
        --ip) IP="$2"; shift 2 ;;
        --dono) DONO="$2"; shift 2 ;;
        --dono-nome) DONO_NOME="$2"; shift 2 ;;
        --turnstile-site) TS_SITE="$2"; shift 2 ;;
        --turnstile-secret) TS_SECRET="$2"; shift 2 ;;
        --sem-ipv6) SEM_V6=1; shift ;;
        --fechar-8080) FECHAR=1; shift ;;
        --simular) SIMULAR=1; shift ;;
        -h|--help) sed -n '2,17p' "$0"; exit 0 ;;
        *) echo "opção desconhecida: $1 (use --help)"; exit 1 ;;
    esac
done

verde() { printf '\033[32m%s\033[0m\n' "$*"; }
amarelo() { printf '\033[33m%s\033[0m\n' "$*"; }
vermelho() { printf '\033[31m%s\033[0m\n' "$*"; }
passo() { printf '\n\033[1m%s\033[0m\n' "$*"; }
faz() { if [ "$SIMULAR" = 1 ]; then echo "  [simulação] $*"; else "$@"; fi; }

[ -n "$DOM" ] || { vermelho "Informe o domínio: --dominio velocidadeteste.audicomtelecom.com.br"; exit 1; }
[[ "$DOM" =~ ^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$ ]] || { vermelho "Domínio inválido: $DOM"; exit 1; }
[ -z "$IP" ] || [[ "$IP" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]] || { vermelho "IP inválido (use o IPv4 público): $IP"; exit 1; }
if [ "$SIMULAR" != 1 ] && [ "$(id -u)" != 0 ]; then vermelho "Rode como root."; exit 1; fi
NODE_OK=$(node -e 'const [a,b]=process.versions.node.split(".").map(Number); console.log(a>22||(a===22&&b>=13)?1:0)' 2>/dev/null || echo 0)
[ "$NODE_OK" = 1 ] || { vermelho "Precisa do Node 22.13 ou mais novo. Instale com: bash $DIR/tools/instalar.sh --so-preparar"; exit 1; }
[ -d "$DIR/node_modules" ] || { vermelho "Dependências não instaladas. Rode: cd $DIR && npm ci --omit=dev"; exit 1; }
if { [ -n "$TS_SITE" ] && [ -z "$TS_SECRET" ]; } || { [ -z "$TS_SITE" ] && [ -n "$TS_SECRET" ]; }; then
    vermelho "Informe as duas chaves do Turnstile (--turnstile-site e --turnstile-secret)."; exit 1
fi
[ "$SIMULAR" = 1 ] && amarelo "Modo simulação: nada será alterado."

# ---------------------------------------------------------------- DNS
passo "1. DNS"
resolve() { getent ahostsv4 "$1" 2>/dev/null | awk '{print $1; exit}'; }
resolve6() { getent ahostsv6 "$1" 2>/dev/null | awk '$1 !~ /^::ffff:/ {print $1; exit}'; }
# IPv6 global desta máquina (sem NAT: é o próprio endereço público dela)
MEU_V6=$(ip -6 -o addr show scope global 2>/dev/null | awk '{sub(/\/.*/, "", $4); print $4; exit}' || true)
R=$(resolve "$DOM" || true)
if [ -z "$R" ]; then amarelo "  ! $DOM ainda não resolve. Crie o registro A (o HTTPS só sai depois disso)."
elif [ -n "$IP" ] && [ "$R" != "$IP" ]; then amarelo "  ! $DOM aponta para $R, não para $IP. Ajuste o registro A."
else echo "  · $DOM → $R (a conferência de que ele chega aqui é no fim)"; fi
R6M=$(resolve6 "$DOM" || true)
if [ "$SEM_V6" = 0 ] && [ -n "$MEU_V6" ]; then
    if [ "$R6M" = "$MEU_V6" ]; then verde "  ✓ $DOM (AAAA) → $MEU_V6"
    else amarelo "  ! registro AAAA de $DOM → $MEU_V6 (IPv6 desta máquina)${R6M:+ — hoje aponta para $R6M}; crie SÓ depois de liberar TCP 80/443 e UDP 8080 até ele no firewall da borda"; fi
fi
R4=$(resolve "v4.$DOM" || true)
[ -n "$R4" ] && verde "  ✓ v4.$DOM → $R4" || amarelo "  ! v4.$DOM ainda não existe (registro A só-IPv4, mesmo IP do $DOM, para o diagnóstico IPv4/IPv6)"
if [ "$SEM_V6" = 0 ]; then
    R6=$(resolve6 "v6.$DOM" || true)
    [ -n "$R6" ] && verde "  ✓ v6.$DOM → $R6" || amarelo "  ! v6.$DOM ainda não existe (registro AAAA só-IPv6${MEU_V6:+ → $MEU_V6}). Sem ele, use --sem-ipv6."
fi

# ---------------------------------------------------------------- .env
passo "2. Configuração do servidor ($ENV_FILE)"
ENV_ALVO="$ENV_FILE"
if [ "$SIMULAR" = 1 ]; then ENV_ALVO="$(mktemp)"; [ -f "$ENV_FILE" ] && cp "$ENV_FILE" "$ENV_ALVO"; fi
[ -f "$ENV_ALVO" ] || printf '# Configuração do servidor (gerada por tools/publicar.sh). Modelo completo: .env.example\n' > "$ENV_ALVO"
definir() {
    local chave="$1" valor="$2"
    if grep -qE "^${chave}=" "$ENV_ALVO"; then
        local tmp; tmp="$(mktemp)"
        awk -v k="$chave" -v v="$valor" 'BEGIN{FS=OFS="="} $1==k {print k "=" v; next} {print}' "$ENV_ALVO" > "$tmp" && cat "$tmp" > "$ENV_ALVO" && rm -f "$tmp"
    else
        echo "${chave}=${valor}" >> "$ENV_ALVO"
    fi
    if [[ "$chave" == *SECRET* ]]; then echo "  ✓ $chave=********"; else echo "  ✓ $chave=$valor"; fi
}
definir PORT 8080
definir PUBLIC_URL "https://$DOM"
definir TRUST_PROXY 1
definir PUBLIC_PORT 443
if [ -n "$IP" ]; then definir PUBLIC_IPV4 "$IP"
else sed -i '/^PUBLIC_IPV4=/d' "$ENV_ALVO"; echo "  ✓ PUBLIC_IPV4 automático (o IP do $DOM no DNS, conferido a cada 10 min)"; fi
definir IPV4_BASE_URL "https://v4.$DOM"
if [ "$SEM_V6" = 0 ]; then definir IPV6_BASE_URL "https://v6.$DOM"; else sed -i '/^IPV6_BASE_URL=/d' "$ENV_ALVO"; fi
if [ -n "$TS_SITE" ]; then definir TURNSTILE_SITE_KEY "$TS_SITE"; definir TURNSTILE_SECRET "$TS_SECRET"; fi
chmod 600 "$ENV_ALVO"
[ "$SIMULAR" = 1 ] && { echo "  (simulação: o .env ficaria assim)"; sed 's/^\(TURNSTILE_SECRET=\).*/\1********/' "$ENV_ALVO" | sed 's/^/    /'; rm -f "$ENV_ALVO"; }

# ---------------------------------------------------------------- hora
passo "3. Hora certa (NTP)"
if timedatectl show -p NTPSynchronized --value 2>/dev/null | grep -q yes; then verde "  ✓ relógio já sincronizado"
else
    dpkg -s systemd-timesyncd >/dev/null 2>&1 || faz apt-get install -y systemd-timesyncd
    # recém-instalado, o timedated ainda não enxerga o timesyncd ("NTP not supported")
    faz systemctl daemon-reload
    faz systemctl restart systemd-timedated || true
    faz timedatectl set-ntp true || faz systemctl enable --now systemd-timesyncd
    verde "  ✓ sincronização automática ligada (leva alguns minutos para acertar)"
fi

# ---------------------------------------------------------------- Caddy
passo "4. HTTPS com Caddy"
if ! command -v caddy >/dev/null 2>&1; then
    echo "  … instalando o Caddy"
    faz apt-get update
    if ! faz apt-get install -y caddy; then
        echo "  … pacote do Debian indisponível; usando o repositório oficial do Caddy"
        faz apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl gnupg
        if [ "$SIMULAR" = 1 ]; then echo "  [simulação] adicionar o repositório dl.cloudsmith.io/public/caddy/stable"
        else
            curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
            curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
        fi
        faz apt-get update
        faz apt-get install -y caddy
    fi
fi
CADDY_TMP="$(mktemp)"
sed "s/velocidadeteste\.audicomtelecom\.com\.br/$DOM/g" "$DIR/deploy/Caddyfile" > "$CADDY_TMP"
[ "$SEM_V6" = 1 ] && sed -i "s/^v4\.$DOM, v6\.$DOM {/v4.$DOM {/" "$CADDY_TMP"
# "interval" e "burst" do sob-demanda: obrigatórios no Caddy 2.6, descontinuados do 2.8 em diante
CADDY_VER=$(caddy version 2>/dev/null | sed -n 's/^v\{0,1\}\([0-9]*\)\.\([0-9]*\).*/\1 \2/p' || true)
if [ -n "$CADDY_VER" ] && [ "$(echo "$CADDY_VER" | awk '{print ($1>2 || ($1==2 && $2>=8)) ? 1 : 0}')" = 1 ]; then
    sed -i '/^\t\tinterval /d; /^\t\tburst /d; /exige estas duas/d' "$CADDY_TMP"
fi
if [ "$SIMULAR" = 1 ]; then
    echo "  [simulação] /etc/caddy/Caddyfile ficaria com os sites:"; grep -E '^[a-z0-9].*\{$' "$CADDY_TMP" | sed 's/^/    /'
else
    mkdir -p /etc/caddy /var/log/caddy
    [ -f /etc/caddy/Caddyfile ] && ! cmp -s /etc/caddy/Caddyfile "$CADDY_TMP" && cp /etc/caddy/Caddyfile "/etc/caddy/Caddyfile.antes-$(date +%Y%m%d-%H%M%S)"
    cp "$CADDY_TMP" /etc/caddy/Caddyfile
    chown -R caddy:caddy /var/log/caddy 2>/dev/null || true
    caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null
    systemctl enable caddy >/dev/null 2>&1 || true
    systemctl restart caddy
    verde "  ✓ Caddy configurado para $DOM (o certificado sai sozinho quando o DNS e a porta 80 estiverem certos)"
fi
rm -f "$CADDY_TMP"

# ---------------------------------------------------------------- firewall
passo "5. Firewall (ufw)"
if command -v ufw >/dev/null 2>&1; then
    faz ufw allow 80/tcp comment 'HTTP (certificado e redirecionamento)' >/dev/null
    faz ufw allow 443/tcp comment 'HTTPS teste de velocidade' >/dev/null
    faz ufw allow 8080/udp comment 'teste de velocidade: perda de pacotes (WebRTC)' >/dev/null
    verde "  ✓ liberadas: TCP 80, TCP 443, UDP 8080"
    if [ "$FECHAR" = 1 ]; then
        faz ufw delete allow 8080/tcp >/dev/null 2>&1 || true
        verde "  ✓ TCP 8080 fechada para fora (o site fica só pelo domínio, via Caddy)"
    elif ufw status 2>/dev/null | grep -qE '^8080/tcp +ALLOW'; then
        amarelo "  ! TCP 8080 continua aberta para fora. Quando o domínio estiver no ar, rode de novo com --fechar-8080."
    fi
else
    amarelo "  ! ufw não instalado: libere TCP 80, TCP 443 e UDP 8080 no firewall que estiver em uso"
fi
MEU_V4=$(ip -4 -o addr show scope global 2>/dev/null | awk '{sub(/\/.*/, "", $4); print $4; exit}' || true)
echo "  No roteador/firewall da borda: encaminhe TCP 80, TCP 443 e UDP 8080 do IP público ${IP:-do domínio} para esta máquina (${MEU_V4:-IP interno})."
[ -n "$MEU_V6" ] && echo "  Pelo IPv6 não há encaminhamento: só liberar TCP 80, TCP 443 e UDP 8080 até $MEU_V6 no firewall da borda."

# ---------------------------------------------------------------- serviço
passo "6. Serviço do site"
faz bash "$DIR/tools/servico.sh" || true

# ---------------------------------------------------------------- dono
passo "7. Dono do sistema (administrador principal)"
if [ -n "$DONO" ]; then
    if [ "$SIMULAR" = 1 ]; then echo "  [simulação] npm run admin -- dono $DONO"
    else (cd "$DIR" && node --disable-warning=ExperimentalWarning tools/admin.mjs dono "$DONO" "$DONO_NOME"); fi
else
    LISTA=$(cd "$DIR" && node --disable-warning=ExperimentalWarning tools/admin.mjs listar 2>/dev/null | grep -c '^dono' || true)
    if [ "${LISTA:-0}" -gt 0 ]; then verde "  ✓ já existe dono cadastrado (veja com: cd $DIR && npm run admin -- listar)"
    else amarelo "  ! nenhum dono ainda. Crie com: cd $DIR && npm run admin -- dono seu@email \"Seu Nome\""; fi
fi

# ---------------------------------------------------------------- conferência
passo "8. O domínio já chega neste servidor?"
NO_AR=0
if [ "$SIMULAR" = 1 ]; then echo "  [simulação] conferir http(s)://$DOM"
else
    for fam in 4 6; do
        [ "$fam" = 6 ] && { [ "$SEM_V6" = 1 ] || [ -z "$MEU_V6" ]; } && continue
        if [ "$fam" = 6 ] && [ -z "$R6M" ]; then amarelo "  ! IPv6: $DOM ainda não tem registro AAAA (→ $MEU_V6)"
        elif curl -s -m 8 -$fam "https://$DOM/api/health" 2>/dev/null | grep -q '"udpPeers"'; then verde "  ✓ IPv$fam: https://$DOM no ar, servido por esta máquina"; NO_AR=1
        elif curl -s -m 6 -$fam -o /dev/null -D - "http://$DOM/" 2>/dev/null | grep -qi '^server: caddy'; then amarelo "  ! IPv$fam: o domínio já chega aqui, mas o certificado ainda não saiu. Aguarde alguns minutos ou rode: systemctl reload caddy (logs: journalctl -u caddy -n 50)"
        else amarelo "  ! IPv$fam: $DOM ainda leva para OUTRO servidor (ou as portas 80/443 não chegam aqui). Falta o DNS e/ou o encaminhamento no roteador."; fi
    done
fi

passo "Pronto."
echo "  Site: https://$DOM   (saúde: https://$DOM/api/health)"
[ "$NO_AR" = 1 ] || echo "  Depois de mudar o DNS e o roteador, o certificado sai sozinho na primeira visita. Rode este script de novo para conferir."
echo "  E-mail (confirmação e \"esqueci a senha\"): opcional, veja a seção 7 do docs/MANUAL.md."
