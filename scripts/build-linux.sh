#!/bin/sh
# Build Linux: testes num Linux arm64 nativo, bundle JS no host e AppImage x64 empacotado num container amd64.
set -eu
ROOT=$(cd "$(dirname "$0")/.." && pwd)
# o colima só compartilha o HOME com a VM do docker: /tmp ficaria vazio dentro do container
mkdir -p "$HOME/.cache"
WORK=$(mktemp -d "$HOME/.cache/gt-linux.XXXX")
trap 'rm -rf "$WORK"' EXIT
rsync -a --exclude node_modules --exclude out --exclude dist --exclude .superpowers --exclude .vitest "$ROOT/" "$WORK/"

echo "== 1/3 testes no Linux (arm64 nativo)"
docker run --rm --platform linux/arm64 -v "$WORK":/work -w /work node:22-bookworm sh scripts/linux-container.sh test

echo "== 2/3 bundle JS (independe de arquitetura)"
(cd "$ROOT" && npx electron-vite build)
rsync -a "$ROOT/out/" "$WORK/out/"

echo "== 3/3 AppImage x64"
docker run --rm --platform linux/amd64 -v "$WORK":/work -w /work node:22-bookworm sh scripts/linux-container.sh package
mkdir -p "$ROOT/dist"
cp "$WORK"/dist/*.AppImage "$ROOT/dist/"
echo "AppImage em: $(ls "$ROOT"/dist/*.AppImage)"
