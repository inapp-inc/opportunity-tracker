#!/usr/bin/env bash
set -euo pipefail

ARCHIVE_PATH="${1:-presales-tracker-docker.zip}"
APP_NAME="${APP_NAME:-presales-tracker}"
CONTAINER_NAME="${CONTAINER_NAME:-$APP_NAME}"
IMAGE_TAG="${IMAGE_TAG:-$APP_NAME:latest}"
BASE_PATH="${BASE_PATH:-/ps}"
PUBLIC_ORIGIN="${PUBLIC_ORIGIN:-https://foundry.inapp.com}"
DEPLOY_ROOT="${DEPLOY_ROOT:-/var/www/ps}"
POSTGRES_DB="${POSTGRES_DB:-appdb}"
DATABASE_URL_DEFAULT="postgresql://foundry:foundry@127.0.0.1:5432/${POSTGRES_DB}"

command -v docker >/dev/null 2>&1 || {
  echo "docker is required on the destination host." >&2
  exit 1
}
command -v unzip >/dev/null 2>&1 || {
  echo "unzip is required on the destination host." >&2
  exit 1
}

normalize_base_path() {
  local value="${1:-}"
  value="${value#/}"
  value="${value%/}"
  if [[ -z "$value" ]]; then
    echo ""
  else
    echo "/$value"
  fi
}

env_value() {
  local file="$1"
  local key="$2"
  [[ -f "$file" ]] || return 0
  awk -F= -v key="$key" '
    $0 !~ /^[[:space:]]*#/ && $1 == key {
      sub(/^[^=]*=/, "", $0)
      gsub(/^["'\'']|["'\'']$/, "", $0)
      print $0
      exit
    }
  ' "$file"
}

ensure_env_value() {
  local file="$1"
  local key="$2"
  local value="$3"
  if [[ -z "$(env_value "$file" "$key" || true)" ]]; then
    printf '%s=%s\n' "$key" "$value" >> "$file"
  fi
}

set_env_value() {
  local file="$1"
  local key="$2"
  local value="$3"
  local tmp="${file}.tmp"
  if [[ -f "$file" ]] && grep -qE "^${key}=" "$file"; then
    awk -v key="$key" -v value="$value" '
      BEGIN { replaced = 0 }
      $0 ~ "^" key "=" {
        print key "=" value
        replaced = 1
        next
      }
      { print }
      END {
        if (!replaced) print key "=" value
      }
    ' "$file" > "$tmp"
    mv "$tmp" "$file"
  else
    printf '%s=%s\n' "$key" "$value" >> "$file"
  fi
}

is_port_free() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    ! lsof -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
  elif command -v ss >/dev/null 2>&1; then
    ! ss -ltn "( sport = :$port )" | grep -q ":$port"
  elif command -v netstat >/dev/null 2>&1; then
    ! netstat -ltn | grep -q ":$port "
  else
    ! (echo >/dev/tcp/127.0.0.1/"$port") >/dev/null 2>&1
  fi
}

choose_port() {
  local preferred="${1:-}"
  if [[ "$preferred" =~ ^400[0-9]$|^4010$ ]] && is_port_free "$preferred"; then
    echo "$preferred"
    return 0
  fi
  for port in {4000..4010}; do
    if is_port_free "$port"; then
      echo "$port"
      return 0
    fi
  done
  echo "No free port found in 4000-4010." >&2
  return 1
}

if [[ ! -f "$ARCHIVE_PATH" ]]; then
  echo "Archive not found: $ARCHIVE_PATH" >&2
  exit 1
fi
ARCHIVE_PATH="$(cd "$(dirname "$ARCHIVE_PATH")" && pwd)/$(basename "$ARCHIVE_PATH")"

mkdir -p "$DEPLOY_ROOT"
unzip -oq "$ARCHIVE_PATH" -d "$DEPLOY_ROOT"

DEST_ENV_FILE="${ENV_FILE:-}"
if [[ -z "$DEST_ENV_FILE" ]]; then
  for candidate in \
    "$DEPLOY_ROOT/.env" \
    "/etc/${APP_NAME}.env" \
    "/etc/presales-tracker.env"; do
    if [[ -f "$candidate" ]]; then
      DEST_ENV_FILE="$candidate"
      break
    fi
  done
fi

if [[ -z "$DEST_ENV_FILE" ]]; then
  DEST_ENV_FILE="$DEPLOY_ROOT/.env"
  JWT_SECRET_VALUE="$(openssl rand -hex 32 2>/dev/null || date +%s%N)"
  cat > "$DEST_ENV_FILE" <<EOF
NODE_ENV=production
JWT_SECRET=$JWT_SECRET_VALUE
STATIC_AUTH_EMAIL=demo@example.com
STATIC_AUTH_PASSWORD=password
CORS_ORIGINS=$PUBLIC_ORIGIN
DATABASE_URL=$DATABASE_URL_DEFAULT
APP_BASE_PATH=$BASE_PATH
PUBLIC_BASE_PATH=$BASE_PATH
SERVE_STATIC=1
EOF
  echo "Created destination env file at $DEST_ENV_FILE"
else
  echo "Using destination env file: $DEST_ENV_FILE"
fi

set_env_value "$DEST_ENV_FILE" "DATABASE_URL" "$DATABASE_URL_DEFAULT"
ensure_env_value "$DEST_ENV_FILE" "CORS_ORIGINS" "$PUBLIC_ORIGIN"
ensure_env_value "$DEST_ENV_FILE" "APP_BASE_PATH" "$BASE_PATH"
ensure_env_value "$DEST_ENV_FILE" "PUBLIC_BASE_PATH" "$BASE_PATH"
ensure_env_value "$DEST_ENV_FILE" "SERVE_STATIC" "1"

ENV_BASE_PATH="$(env_value "$DEST_ENV_FILE" APP_BASE_PATH || true)"
BASE_PATH="$(normalize_base_path "${ENV_BASE_PATH:-$BASE_PATH}")"
if [[ -z "$BASE_PATH" ]]; then
  BASE_PATH="/ps"
fi
PREFERRED_PORT="$(env_value "$DEST_ENV_FILE" PORT || true)"
PORT="$(choose_port "$PREFERRED_PORT")"

cd "$DEPLOY_ROOT"
docker build \
  --build-arg "VITE_BASE_PATH=${BASE_PATH}/" \
  -t "$IMAGE_TAG" .

docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
docker run -d \
  --name "$CONTAINER_NAME" \
  --restart unless-stopped \
  --env-file "$DEST_ENV_FILE" \
  --network host \
  -e "NODE_ENV=production" \
  -e "SERVE_STATIC=1" \
  -e "APP_BASE_PATH=$BASE_PATH" \
  -e "PUBLIC_BASE_PATH=$BASE_PATH" \
  -e "PORT=$PORT" \
  "$IMAGE_TAG" >/dev/null

cat <<EOF
Deployed $CONTAINER_NAME
Image: $IMAGE_TAG
Container URL: http://127.0.0.1:$PORT$BASE_PATH
Health URL: http://127.0.0.1:$PORT$BASE_PATH/health

Suggested nginx location:

location = $BASE_PATH {
  return 301 $BASE_PATH/;
}

location $BASE_PATH/ {
  proxy_pass http://127.0.0.1:$PORT;
  proxy_set_header Host \$host;
  proxy_set_header X-Real-IP \$remote_addr;
  proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto \$scheme;
}
EOF
