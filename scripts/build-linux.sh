#!/bin/sh
# Build Linux: testes num Linux arm64 nativo, bundle JS no host, .deb/.rpm x64 empacotados num container amd64
# e instalação de cada pacote num Debian e num Fedora limpos (as dependências têm que vir sozinhas).
set -eu
ROOT=$(cd "$(dirname "$0")/.." && pwd)
# o colima só compartilha o HOME com a VM do docker: /tmp ficaria vazio dentro do container
mkdir -p "$HOME/.cache"
WORK=$(mktemp -d "$HOME/.cache/gt-linux.XXXX")
trap 'rm -rf "$WORK"' EXIT
# sem .git: numa worktree ele é um arquivo que aponta para fora (o container não vê) e quebra até o git config --global
rsync -a --exclude node_modules --exclude out --exclude dist --exclude .superpowers --exclude .vitest --exclude .git --exclude promo-videos "$ROOT/" "$WORK/"

echo "== 1/3 testes no Linux (arm64 nativo)"
docker run --rm --platform linux/arm64 -v "$WORK":/work -w /work node:22-bookworm sh scripts/linux-container.sh test

echo "== 2/3 bundle JS (independe de arquitetura)"
(cd "$ROOT" && npx electron-vite build)
rsync -a "$ROOT/out/" "$WORK/out/"

echo "== 3/4 pacotes .deb, .rpm e AppImage (x64)"
docker run --rm --platform linux/amd64 -v "$WORK":/work -w /work node:22-bookworm sh scripts/linux-container.sh package
# o MCP do líder vem no pacote (rodar o binário x64 aqui não dá: sob emulação no Apple Silicon o Electron morre)
npx --yes @electron/asar list "$WORK/dist/linux-unpacked/resources/app.asar" | grep -q "out/main/gt-mcp.js" \
  || { echo "gt-mcp.js ausente do pacote"; exit 1; }
echo "gt-mcp no pacote: ok"
mkdir -p "$ROOT/dist"
rm -f "$ROOT"/dist/*.deb "$ROOT"/dist/*.rpm "$ROOT"/dist/*.AppImage
cp "$WORK"/dist/*.deb "$WORK"/dist/*.rpm "$WORK"/dist/*.AppImage "$ROOT/dist/"

echo "== 4/4 instalação limpa: o gerenciador de pacotes traz git, nc e ps"
CHECK='command -v git && command -v nc && command -v ps && ls /opt/*/gerenciador-de-terminal && echo INSTALACAO-OK'
docker run --rm --platform linux/amd64 -v "$WORK/dist":/pkg debian:bookworm sh -c \
  "apt-get update -qq && apt-get install -y -qq /pkg/*.deb >/dev/null && $CHECK"
docker run --rm --platform linux/amd64 -v "$WORK/dist":/pkg fedora:41 sh -c \
  "cp /pkg/*.rpm /tmp/ && dnf install -y -q /tmp/*.rpm >/dev/null && $CHECK"  # o dnf não lê direto do volume montado
echo "Pacotes em:"; ls "$ROOT"/dist/*.deb "$ROOT"/dist/*.rpm "$ROOT"/dist/*.AppImage
