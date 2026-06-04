#!/usr/bin/env bash
#
# Unified runner: installs dependencies if needed, then starts API + Vite in one terminal.
#
# Usage:
#   chmod +x run.sh && ./run.sh
#
# Environment:
#   API_PORT   (default 3001) — read by server/src/index.js
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

export API_PORT="${API_PORT:-3001}"

need_install_root() {
  [[ ! -d "$ROOT/node_modules/concurrently" ]]
}

need_install_server() {
  [[ ! -d "$ROOT/server/node_modules/express" ]]
}

need_install_web() {
  [[ ! -d "$ROOT/web/node_modules/vite" ]]
}

if need_install_root || need_install_server || need_install_web; then
  echo ">>> Installing dependencies..."
  npm install --no-fund --no-audit
  npm run install:all
fi

echo ">>> API: http://localhost:${API_PORT}   Web: http://localhost:5173"
echo "    Press Ctrl+C to stop both."
exec npm run dev
