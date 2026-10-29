#!/usr/bin/env bash
# Baixa os vídeos tutoriais (release tutorial-speedcjc-v1 do GitHub) para assets/tutorial/,
# de onde o próprio site os serve (página do teste e Administração → Tutoriais).
# Os MP4 ficam fora do git (.gitignore); rode de novo para atualizar.
set -euo pipefail
DIR="$(cd "$(dirname "$0")/../.." && pwd)/assets/tutorial"
BASE="${TUTORIAL_URL:-https://github.com/Davicjc/Speed-CJC/releases/download/tutorial-speedcjc-v1}"
mkdir -p "$DIR"
for f in tutorial-usuario.mp4 tutorial-tecnico.mp4 tutorial-admin.mp4 tutorial-speedcjc-completo.mp4; do
  printf '  %s… ' "$f"
  curl -fsSL --retry 3 -o "$DIR/$f.tmp" "$BASE/$f" && mv "$DIR/$f.tmp" "$DIR/$f" && echo "ok ($(du -h "$DIR/$f" | cut -f1))"
done
