#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ARCHIVE_PATH="${1:-"$ROOT_DIR/presales-tracker-docker.zip"}"

command -v zip >/dev/null 2>&1 || {
  echo "zip is required to create the deployment archive." >&2
  exit 1
}

cat > "$ROOT_DIR/Dockerfile" <<'DOCKERFILE'
# syntax=docker/dockerfile:1

FROM node:20-bookworm-slim AS server-deps
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY server/package*.json ./server/
RUN npm ci --prefix server --omit=dev --no-audit --no-fund

FROM node:20-bookworm-slim AS web-build
WORKDIR /app
ARG VITE_BASE_PATH=/ps/
ENV VITE_BASE_PATH=${VITE_BASE_PATH}
COPY web/package*.json ./web/
RUN npm ci --prefix web --no-audit --no-fund
COPY web ./web
RUN npm --prefix web run build

FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
  SERVE_STATIC=1 \
  APP_BASE_PATH=/ps \
  PUBLIC_BASE_PATH=/ps \
  PORT=4000
COPY --from=server-deps /app/server/node_modules ./server/node_modules
COPY server ./server
COPY --from=web-build /app/web/dist ./web/dist
EXPOSE 4000
CMD ["npm", "--prefix", "server", "start"]
DOCKERFILE

cat > "$ROOT_DIR/.dockerignore" <<'DOCKERIGNORE'
.git
.env
*.env
**/.env
**/*.env
.DS_Store
**/.DS_Store
node_modules
**/node_modules
web/dist
server/data
server/.tmp-*
*.log
*.zip
Dockerfile
.dockerignore
DOCKERIGNORE

rm -f "$ARCHIVE_PATH"
(
  cd "$ROOT_DIR"
  zip -r "$ARCHIVE_PATH" . \
    -x ".git/*" \
    -x ".env" \
    -x "*.env" \
    -x "*/.env" \
    -x "*/*.env" \
    -x "*/*/.env" \
    -x "*/*/*.env" \
    -x ".DS_Store" \
    -x "*/.DS_Store" \
    -x "node_modules/*" \
    -x "*/node_modules/*" \
    -x "web/dist/*" \
    -x "server/data/*" \
    -x "server/.tmp-*/*" \
    -x "*.zip" \
    -x "agent-transcripts/*"
)

echo "Created $ARCHIVE_PATH"
echo "Dockerfile and .dockerignore were generated at the project root and included in the archive."
