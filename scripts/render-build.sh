#!/usr/bin/env bash
# Render / CI: install web + server on Linux, build SPA, rebuild native better-sqlite3.
set -euo pipefail
cd "$(dirname "$0")/.."

WEB="web"
SRV="server"
if [[ ! -d "$WEB" && -d "src/web" ]]; then
  WEB="src/web"
  SRV="src/server"
fi

if [[ ! -d "$SRV" ]]; then
  echo "render-build: server dir not found (tried server/, src/server/)"
  exit 1
fi

npm ci --prefix "$WEB"
npm run build --prefix "$WEB"
npm ci --prefix "$SRV"
npm rebuild better-sqlite3 --prefix "$SRV"
