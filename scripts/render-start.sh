#!/usr/bin/env bash
# Production entrypoint — only the API + static SPA (not root package.json "start"/concurrently).
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ -d server ]]; then
  cd server
elif [[ -d src/server ]]; then
  cd src/server
else
  echo "render-start: server dir not found (tried server/, src/server/)"
  exit 1
fi

export NODE_ENV=production
exec node src/index.js
