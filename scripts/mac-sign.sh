#!/bin/sh
# Assina o .app do dist com o certificado fixo (criado uma vez por scripts/mac-cert.sh).
set -eu
NAME="Gerenciador de Terminal Local"
ROOT=$(cd "$(dirname "$0")/.." && pwd)
APP=$(ls -d "$ROOT"/dist/mac*/"Gerenciador de Terminal.app" 2>/dev/null | head -n 1)
[ -n "$APP" ] || { echo "app não encontrado em dist/mac*"; exit 1; }
security find-identity -v -p codesigning | grep -q "$NAME" || { echo "certificado \"$NAME\" ausente: rode uma vez  sh scripts/mac-cert.sh"; exit 1; }
codesign --force --deep --sign "$NAME" "$APP"
codesign --verify --deep --strict "$APP"
echo "assinado: $APP"
