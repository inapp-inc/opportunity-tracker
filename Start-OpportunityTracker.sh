#!/usr/bin/env bash
#
# Opportunity Tracker — macOS launcher
#
# - Ensures Homebrew (instructions only if missing), Node 18+, Python 3.9+ (for native npm builds)
# - npm install in server/ and web/, verifies React deps
# - Opens two Terminal.app windows (API + Vite) and Chrome to http://localhost:5173/
#
# Usage:
#   chmod +x Start-OpportunityTracker.sh
#   ./Start-OpportunityTracker.sh
#
# Or double-click: Start-OpportunityTracker.command
#
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_DIR="$ROOT/server"
WEB_DIR="$ROOT/web"
API_PORT="${API_PORT:-3001}"
UI_PORT="${UI_PORT:-5173}"

RED=$'\033[0;31m'
GRN=$'\033[0;32m'
CYN=$'\033[0;36m'
DIM=$'\033[90m'
RST=$'\033[0m'

step() {
  printf '\n%s>>> %s%s\n' "$CYN" "$1" "$RST"
}

die() {
  printf '%s%s%s\n' "$RED" "$1" "$RST" >&2
  exit "${2:-1}"
}

# Homebrew ships to different prefixes on Intel vs Apple Silicon.
load_brew_env() {
  if [[ -x /opt/homebrew/bin/brew ]]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
    return 0
  fi
  if [[ -x /usr/local/bin/brew ]]; then
    eval "$(/usr/local/bin/brew shellenv)"
    return 0
  fi
  return 1
}

ensure_brew() {
  load_brew_env || true
  if command -v brew >/dev/null 2>&1; then
    return 0
  fi
  die "${RED}Homebrew is not installed.

Install it from ${DIM}https://brew.sh${RED} using the site's one-liner, then run this script again.
(On Apple Silicon, after install often add: eval \"\\\$(/opt/homebrew/bin/brew shellenv)\".)

${RST}" 2
}

major_node_version() {
  node -v 2>/dev/null | sed -E 's/^v([0-9]+).*/\1/'
}

ensure_node() {
  load_brew_env || true
  if command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
    local mv
    mv="$(major_node_version || echo 0)"
    if [[ "$mv" =~ ^[0-9]+$ ]] && [[ "$mv" -ge 18 ]]; then
      printf '%sFound Node %s, npm %s%s\n' "$GRN" "$(node -v)" "$(npm -v)" "$RST"
      return 0
    fi
  fi
  step "Installing Node.js via Homebrew (LTS/current formula includes npm)…"
  brew install node
  hash -r || true
  load_brew_env || true
  command -v node >/dev/null 2>&1 || die "Node still not on PATH after brew install." 3
}

ensure_python() {
  printf '%sChecking Python 3…%s\n' "$DIM" "$RST"
  load_brew_env || true
  if python3 -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 9) else 1)' 2>/dev/null; then
    printf '%sPython 3 is available (%s).%s\n' "$GRN" "$(python3 -V)" "$RST"
    return 0
  fi
  step "Python 3.9+ not found. Installing Python 3.12 via Homebrew…"
  brew install python@3.12 || brew install python
  hash -r || true
  load_brew_env || true
  if ! python3 -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 9) else 1)' 2>/dev/null; then
    printf '%sWarning: Python 3 still not usable. Native modules (e.g. better-sqlite3) may need Xcode Command Line Tools:
  xcode-select --install%s\n' "$RED" "$RST"
  fi
}

npm_install_dir() {
  local d="$1"
  [[ -f "$d/package.json" ]] || die "Missing package.json in $d" 4
  ( cd "$d" && npm install --no-fund --no-audit --loglevel error ) || die "npm install failed in $d" 5
}

ensure_react_web() {
  printf '%sChecking React (web/node_modules)…%s\n' "$DIM" "$RST"
  local react_pkg="$WEB_DIR/node_modules/react/package.json"
  local rdom_pkg="$WEB_DIR/node_modules/react-dom/package.json"
  if [[ -f "$react_pkg" ]] && [[ -f "$rdom_pkg" ]]; then
    printf '%sReact packages present.%s\n' "$GRN" "$RST"
    return 0
  fi
  step "Installing react and react-dom from web/package.json…"
  (
    cd "$WEB_DIR"
    react_ver="$(node -p "require('./package.json').dependencies.react" 2>/dev/null || echo "")"
    rdom_ver="$(node -p "require('./package.json').dependencies['react-dom']" 2>/dev/null || echo "")"
    if [[ -n "$react_ver" ]] && [[ -n "$rdom_ver" ]]; then
      npm install --no-fund --no-audit --loglevel error "react@${react_ver}" "react-dom@${rdom_ver}" || npm install --no-fund --no-audit --loglevel error
    else
      npm install --no-fund --no-audit --loglevel error
    fi
  ) || die "Failed to restore React deps in web/" 6
}

port_in_use_hint() {
  local p="$1"
  if nc -z 127.0.0.1 "$p" 2>/dev/null; then
    printf '%sWarning: port %s is already in use; stop conflicts if startup fails.%s\n' "$RED" "$p" "$RST"
  fi
}

wait_port() {
  local port="$1"
  local desc="$2"
  local secs="${3:-120}"
  local deadline=$(( $(date +%s) + secs ))
  printf '%sWaiting for %s on port %s…%s\n' "$DIM" "$desc" "$port" "$RST"
  while [[ $(date +%s) -lt $deadline ]]; do
    if nc -z 127.0.0.1 "$port" 2>/dev/null; then
      printf '%s  %s is reachable.%s\n' "$GRN" "$desc" "$RST"
      return 0
    fi
    sleep 0.5
  done
  printf '%s  %s did not become ready in %ss.%s\n' "$RED" "$desc" "$secs" "$RST"
  return 1
}

# Opens a new Terminal.app window (always runs via /bin/bash so zsh-login users are safe).
open_terminal_command() {
  local workdir="$1"
  local inner_cmd="$2"
  local script_line
  printf -v script_line 'cd %q && %s' "$workdir" "$inner_cmd"
  local invocation
  printf -v invocation '/bin/bash --login -o pipefail -c %q' "$script_line"
  osascript \
    -e 'on run argv' \
    -e '  tell application "Terminal"' \
    -e '    activate' \
    -e '    set cmdLine to item 1 of argv' \
    -e '    do script cmdLine' \
    -e '  end tell' \
    -e 'end run' \
    -- "$invocation"
}

ensure_chrome() {
  if [[ -d "/Applications/Google Chrome.app" ]]; then
    printf '%sGoogle Chrome found.%s\n' "$GRN" "$RST"
    return 0
  fi
  step "Google Chrome not in /Applications. Installing via Homebrew Cask…"
  brew install --cask google-chrome || printf '%sCould not install Chrome cask; will use default browser.%s\n' "$RED" "$RST"
}

open_ui_browser() {
  local url="http://localhost:${UI_PORT}/"
  if [[ -d "/Applications/Google Chrome.app" ]]; then
    open -na "Google Chrome" --args --new-window "$url"
    printf '%sOpened Chrome at %s%s\n' "$GRN" "$url" "$RST"
  elif [[ -d "/Applications/Chromium.app" ]]; then
    open -na "Chromium" --args --new-window "$url"
    printf '%sOpened Chromium at %s%s\n' "$GRN" "$url" "$RST"
  else
    open "$url"
    printf '%sOpened default browser at %s%s\n' "$CYN" "$url" "$RST"
  fi
}

# --- Main ---
ensure_brew
step "Prerequisites — Node.js and npm"
ensure_node
step "Prerequisites — Python (native npm builds)"
ensure_python

[[ -d "$SERVER_DIR" ]] && [[ -d "$WEB_DIR" ]] || die "Expected server/ or web/ missing under $ROOT" 7

step "Installing server dependencies…"
npm_install_dir "$SERVER_DIR"

step "Installing web dependencies (React/Vite via package.json)…"
npm_install_dir "$WEB_DIR"
ensure_react_web

port_in_use_hint "$API_PORT"
port_in_use_hint "$UI_PORT"

step "Starting API server (new Terminal window)…"
API_SHELL=$'npm run start; echo ""; read -rp "Press Enter to close (API stops)"'
open_terminal_command "$SERVER_DIR" "$API_SHELL"

wait_port "$API_PORT" "API" 90 || printf '%sAPI port check inconclusive — see API terminal.%s\n' "$RED" "$RST"

step "Starting Vite dev server (new Terminal window)…"
WEB_SHELL=$'npm run dev; echo ""; read -rp "Press Enter to close (web stops)"'
open_terminal_command "$WEB_DIR" "$WEB_SHELL"

wait_port "$UI_PORT" "Vite frontend" 120 || die "Frontend did not listen on $UI_PORT — check Web terminal window." 8

ensure_chrome
open_ui_browser

echo ""
printf '%sApp run started. Quit the servers from their Terminal windows (Ctrl+C) or press Enter in each after they exit.%s\n' "$GRN" "$RST"
