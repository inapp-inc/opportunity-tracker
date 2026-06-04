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
JWT_SECRET_OVERRIDE="${JWT_SECRET:-}"

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
      gsub(/^["'\''']|["'\''']$/, "", $0)
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
