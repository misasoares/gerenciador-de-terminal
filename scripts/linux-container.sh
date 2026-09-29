#!/bin/sh
# Roda DENTRO do container. Modos:
#   test    → Linux arm64 nativo: instala, compila node-pty e roda a suíte (valida /proc, nc, git, PTY no Linux)
#   package → Linux amd64 (emulado): compila só o node-pty x64 e empacota .deb e .rpm com o out/ já gerado.
#             Nada de esbuild aqui: o Go dele quebra sob emulação x64 em Apple Silicon.
set -eu
MODE="${1:-test}"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq git procps netcat-openbsd lsof python3 make g++ rpm >/dev/null
git config --global --add safe.directory '*'
git config --global user.email build@local
git config --global user.name build
cd /work
rm -rf node_modules
if [ "$MODE" = test ]; then
  npm ci --no-audit --no-fund
  npx vitest run
else
  npm ci --ignore-scripts --no-audit --no-fund
  npm rebuild node-pty
  test -d out || { echo "out/ ausente: gere o bundle antes (electron-vite build)"; exit 1; }
  npx electron-builder --linux --x64 --publish never -c.npmRebuild=false
fi
