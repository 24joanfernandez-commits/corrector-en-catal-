#!/bin/bash
cd "$(dirname "$0")"
if ! command -v node >/dev/null; then
  echo "No tienes Node.js instalado. Descargalo gratis de https://nodejs.org (version LTS)."
  read -p "Pulsa Enter para salir"; exit 1
fi
[ -d node_modules ] || npm install
node server.js
