#!/bin/sh
# Publica uma versão: testes, builds Mac (.zip assinado) e Linux (AppImage/.deb/.rpm), SHA256SUMS, tag e release no GitHub.
# uso: npm run release -- 0.2.0
set -eu
ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"
die() { echo "release: $*" >&2; exit 1; }

V="${1:-}"
echo "$V" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' || die "versão inválida: \"$V\" (use maior.menor.correção, ex.: 0.2.0)"
CUR=$(node -p "require('./package.json').version")
[ "$V" != "$CUR" ] && [ "$(printf '%s\n%s\n' "$CUR" "$V" | sort -t. -k1,1n -k2,2n -k3,3n | tail -n 1)" = "$V" ] \
  || die "a versão $V precisa ser maior que a atual ($CUR)"
[ "$(git rev-parse --abbrev-ref HEAD)" = main ] || die "rode na main"
[ -z "$(git status --porcelain)" ] || die "há mudanças não commitadas"
gh auth status >/dev/null 2>&1 || die "gh sem login (gh auth login)"
docker info >/dev/null 2>&1 || die "Docker não está rodando (o build Linux precisa dele)"

COMMITTED=0
restore() { [ "$COMMITTED" = 1 ] || git checkout -- package.json package-lock.json 2>/dev/null || true; }
trap restore EXIT

echo "== testes"
npm test
echo "== versão $CUR → $V"
npm version "$V" --no-git-tag-version >/dev/null

OUT="$ROOT/dist/release-$V"
rm -rf "$OUT"
mkdir -p "$OUT"
echo "== Mac"
npm run pack
ARCH=$(uname -m)
[ "$ARCH" = x86_64 ] && ARCH=x64
APP=$(ls -d "$ROOT"/dist/mac*/"Gerenciador de Terminal.app" | head -n 1)
ditto -c -k --keepParent "$APP" "$OUT/gerenciador-de-terminal-$V-mac-$ARCH.zip"
echo "== Linux"
sh scripts/build-linux.sh
cp "$ROOT"/dist/gerenciador-de-terminal-"$V"-* "$OUT"/
(cd "$OUT" && shasum -a 256 gerenciador-de-terminal-* >"$ROOT/dist/SHA256SUMS.tmp" && mv "$ROOT/dist/SHA256SUMS.tmp" SHA256SUMS)
ls "$OUT"

PREV=$(git describe --tags --abbrev=0 2>/dev/null || true)
NOTES=$(git log --format=%s ${PREV:+"$PREV"..}HEAD | node scripts/release-notes.mjs)

git commit -qam "chore(release): $V"
COMMITTED=1
git tag "v$V"
git push origin main "v$V"
gh release create "v$V" "$OUT"/* --title "$V" --notes "$NOTES"
echo "publicado: v$V"
