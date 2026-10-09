#!/bin/sh
# Cria (uma vez) o certificado fixo de assinatura de código no Keychain de login.
# Com a mesma identidade em todos os builds, o macOS mantém as permissões de pastas entre versões.
set -eu
NAME="Gerenciador de Terminal Local"
KC="$HOME/Library/Keychains/login.keychain-db"
if security find-identity -v -p codesigning | grep -q "$NAME"; then
  echo "certificado \"$NAME\" já existe"
  exit 0
fi
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
cat >"$TMP/cert.cnf" <<EOF
[req]
distinguished_name = dn
x509_extensions = ext
prompt = no
[dn]
CN = $NAME
[ext]
basicConstraints = critical,CA:false
keyUsage = critical,digitalSignature
extendedKeyUsage = critical,codeSigning
EOF
/usr/bin/openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -config "$TMP/cert.cnf" -keyout "$TMP/key.pem" -out "$TMP/cert.pem"
/usr/bin/openssl pkcs12 -export -inkey "$TMP/key.pem" -in "$TMP/cert.pem" -out "$TMP/cert.p12" -passout pass:gt
security import "$TMP/cert.p12" -k "$KC" -P gt -T /usr/bin/codesign
# confiança só para assinatura de código (o macOS pede a senha)
security add-trusted-cert -r trustRoot -p codeSign -k "$KC" "$TMP/cert.pem"
security find-identity -v -p codesigning | grep "$NAME"
