#!/usr/bin/env bash
# Instala (ou atualiza) e liga o serviço speed-cjc no systemd, a partir
# do modelo deploy/speed-cjc.service, com a pasta e o node desta máquina.
#
# Uso (como root):  bash server/tools/servico.sh
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NODE="$(command -v node || true)"
[ -n "$NODE" ] || { echo "node não encontrado. Rode antes: bash $DIR/tools/instalar.sh --so-preparar"; exit 1; }
[ "$(id -u)" = 0 ] || { echo "Rode como root."; exit 1; }

sed -e "s#@PASTA@#$DIR#g" -e "s#@NODE@#$NODE#g" "$DIR/deploy/speed-cjc.service" \
    | grep -v '^# ' > /etc/systemd/system/speed-cjc.service
systemctl daemon-reload
systemctl enable speed-cjc >/dev/null 2>&1 || true
systemctl restart speed-cjc

PORTA=$(sed -n 's/^PORT=//p' "$DIR/.env" 2>/dev/null | tail -1); PORTA=${PORTA:-8080}
for _ in $(seq 1 20); do curl -fs "http://127.0.0.1:$PORTA/api/health" >/dev/null 2>&1 && break; sleep 1; done
if curl -fs "http://127.0.0.1:$PORTA/api/health" >/dev/null 2>&1; then
    printf '\033[32m  ✓ serviço speed-cjc no ar (porta %s, node %s)\033[0m\n' "$PORTA" "$("$NODE" -v)"
else
    printf '\033[31m  ✗ o serviço não respondeu; veja: journalctl -u speed-cjc -n 50\033[0m\n'
    exit 1
fi
