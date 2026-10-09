#!/bin/sh
# Troca a versão do Gerenciador de Terminal depois que o app fecha. Roda fora do bundle (o app copia
# este arquivo para a pasta de atualizações: no AppImage a montagem some quando o app sai).
# uso: update-helper.sh <mac-zip|appimage> <pid do app> <bundle ou AppImage atual> <arquivo baixado> <pasta updates> <versão nova> <versão atual>
set -u
KIND=$1
PID=$2
TARGET=$3
ART=$4
UPD=$5
TO=$6
FROM=$7
WAIT_EXIT=${GT_HELPER_WAIT_EXIT:-30}
WAIT_OK=${GT_HELPER_WAIT_OK:-60}
LOG="$UPD/helper.log"

log() { echo "$(date '+%Y-%m-%dT%H:%M:%S') $*" >>"$LOG"; }

fail() {
  log "falhou: $*"
  printf '{"from":"%s","to":"%s","at":"%s"}\n' "$FROM" "$TO" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" >"$UPD/failed.json"
}

launch() {
  if [ -n "${GT_HELPER_LAUNCH:-}" ]; then
    sh -c "$GT_HELPER_LAUNCH" launch "$1"
  elif [ "$KIND" = mac-zip ]; then
    # -n: instância nova mesmo se o LaunchServices ainda lembrar da anterior; --env leva o GT_HOME isolado dos testes
    set -- "$1"
    [ -n "${GT_HOME:-}" ] && set -- --env "GT_HOME=$GT_HOME" "$@"
    [ -n "${GT_UPDATE_URL:-}" ] && set -- --env "GT_UPDATE_URL=$GT_UPDATE_URL" "$@"
    open -n "$@"
  else
    nohup "$1" >/dev/null 2>&1 &
  fi
}

log "início: $KIND $FROM → $TO ($TARGET)"

i=0
while kill -0 "$PID" 2>/dev/null; do
  i=$((i + 1))
  if [ "$i" -gt $((WAIT_EXIT * 2)) ]; then
    fail "o app não fechou em ${WAIT_EXIT}s; nada foi trocado"
    exit 1
  fi
  sleep 0.5
done

case "$KIND" in
mac-zip)
  OLD="${TARGET%.app}.anterior.app"
  STAGE="$(dirname "$TARGET")/.gt-update-$TO"
  rm -rf "$STAGE"
  if ! mkdir -p "$STAGE" || ! ditto -x -k "$ART" "$STAGE" 2>>"$LOG"; then
    fail "não consegui extrair $ART"
    rm -rf "$STAGE"
    launch "$TARGET"
    exit 1
  fi
  NEW=$(find "$STAGE" -maxdepth 1 -name '*.app' | head -n 1)
  if [ -z "$NEW" ]; then
    fail "o zip não tem um .app"
    rm -rf "$STAGE"
    launch "$TARGET"
    exit 1
  fi
  rm -rf "$OLD"
  if ! mv "$TARGET" "$OLD" || ! mv "$NEW" "$TARGET"; then
    fail "não consegui trocar o bundle"
    [ -d "$TARGET" ] || mv "$OLD" "$TARGET"
    rm -rf "$STAGE"
    launch "$TARGET"
    exit 1
  fi
  rm -rf "$STAGE"
  ;;
appimage)
  OLD="$TARGET.anterior"
  if ! cp "$ART" "$TARGET.novo" || ! chmod +x "$TARGET.novo" || ! cp -p "$TARGET" "$OLD" || ! mv "$TARGET.novo" "$TARGET"; then
    fail "não consegui trocar o AppImage"
    rm -f "$TARGET.novo"
    launch "$TARGET"
    exit 1
  fi
  ;;
*)
  fail "tipo desconhecido: $KIND"
  exit 1
  ;;
esac

log "trocado; abrindo $TO"
rm -f "$UPD/ok-$TO"
launch "$TARGET"

i=0
while [ ! -f "$UPD/ok-$TO" ]; do
  i=$((i + 1))
  if [ "$i" -gt $((WAIT_OK * 2)) ]; then
    fail "a versão $TO não confirmou em ${WAIT_OK}s; voltando para $FROM"
    # Mac: a nova pode estar aberta e travada (e com um daemon dela); fecha antes de reabrir a anterior
    [ "$KIND" = mac-zip ] && pkill -f "$TARGET/Contents/MacOS/" 2>/dev/null
    sleep 1
    rm -rf "$TARGET"
    mv "$OLD" "$TARGET"
    launch "$TARGET"
    exit 1
  fi
  sleep 0.5
done

rm -rf "$OLD"
rm -f "$UPD/ok-$TO"
log "ok: $TO"
exit 0
