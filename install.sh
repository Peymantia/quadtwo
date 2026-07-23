#!/usr/bin/env bash
# Quadtwo one-line installer (Telegram VPN shop + 3x-ui)
# Usage:
#   bash <(curl -Ls https://raw.githubusercontent.com/Peymantia/quadtwo/main/install.sh)
set -euo pipefail

REPO_URL="${QUADTWO_REPO:-https://github.com/Peymantia/quadtwo.git}"
REPO_BRANCH="${QUADTWO_BRANCH:-main}"
INSTALL_DIR="${QUADTWO_DIR:-/opt/quadtwo}"
SERVICE_NAME="quadtwo"
NODE_MAJOR=22

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() { echo -e "${GREEN}[quadtwo]${NC} $*"; }
warn() { echo -e "${YELLOW}[quadtwo]${NC} $*"; }
err() { echo -e "${RED}[quadtwo]${NC} $*" >&2; }

need_root() {
  if [[ "${EUID}" -ne 0 ]]; then
    err "Please run this script as root (sudo)."
    exit 1
  fi
}

detect_os() {
  if [[ -f /etc/os-release ]]; then
    # shellcheck disable=SC1091
    . /etc/os-release
    OS_ID="${ID:-linux}"
  else
    OS_ID="linux"
  fi
}

install_node() {
  if command -v node >/dev/null 2>&1; then
    local major
    major="$(node -v | sed 's/v//' | cut -d. -f1)"
    if [[ "${major}" -ge "${NODE_MAJOR}" ]]; then
      log "Node.js $(node -v) found."
      return
    fi
    warn "Node.js $(node -v) is too old — installing ${NODE_MAJOR}+."
  fi

  log "Installing Node.js ${NODE_MAJOR}..."
  case "${OS_ID}" in
    ubuntu|debian|raspbian)
      apt-get update -y
      apt-get install -y ca-certificates curl gnupg git
      mkdir -p /etc/apt/keyrings
      curl -fsSL "https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key" \
        | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
      echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" \
        > /etc/apt/sources.list.d/nodesource.list
      apt-get update -y
      apt-get install -y nodejs
      ;;
    centos|rhel|rocky|almalinux|fedora|amzn)
      curl -fsSL "https://rpm.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
      if command -v dnf >/dev/null 2>&1; then
        dnf install -y nodejs git
      else
        yum install -y nodejs git
      fi
      ;;
    *)
      err "Unsupported distro: ${OS_ID}. Install Node ${NODE_MAJOR}+ and git manually."
      exit 1
      ;;
  esac
}

prompt() {
  local var="$1" label="$2" def="${3:-}"
  local value
  if [[ -n "${def}" ]]; then
    read -r -p "${label} [${def}]: " value || true
    value="${value:-$def}"
  else
    while true; do
      read -r -p "${label}: " value || true
      [[ -n "${value}" ]] && break
      warn "This field is required."
    done
  fi
  printf -v "${var}" '%s' "${value}"
}

write_env() {
  local env_file="${INSTALL_DIR}/.env"
  cat > "${env_file}" <<EOF
NODE_ENV=production
PORT=${PORT}
DATABASE_URL=file:${INSTALL_DIR}/data/quadtwo.db

BOT_TOKEN=${BOT_TOKEN}
BOT_MODE=polling
TELEGRAM_WEBHOOK_PATH=/telegram/webhook
ADMIN_TELEGRAM_IDS=${ADMIN_TELEGRAM_IDS}

XUI_BASE_URL=${XUI_BASE_URL}
XUI_API_TOKEN=${XUI_API_TOKEN}
XUI_INBOUND_ID=${XUI_INBOUND_ID}
XUI_SUB_BASE=${XUI_SUB_BASE}

PUBLIC_DOMAIN=${PUBLIC_DOMAIN}
DASH_DOMAIN=${DASH_DOMAIN}
NEXT_PUBLIC_API_URL=https://${DASH_DOMAIN}
NEXT_PUBLIC_APP_URL=https://${DASH_DOMAIN}
CORS_ORIGINS=https://${DASH_DOMAIN},https://${PUBLIC_DOMAIN}
EOF
  chmod 600 "${env_file}"
  log "Config written: ${env_file}"
}

clone_or_update() {
  if [[ -d "${INSTALL_DIR}/.git" ]]; then
    log "Updating repo in ${INSTALL_DIR}..."
    git -C "${INSTALL_DIR}" fetch --depth 1 origin "${REPO_BRANCH}"
    git -C "${INSTALL_DIR}" reset --hard "origin/${REPO_BRANCH}"
  else
    log "Cloning repo into ${INSTALL_DIR}..."
    rm -rf "${INSTALL_DIR}"
    git clone --depth 1 --branch "${REPO_BRANCH}" "${REPO_URL}" "${INSTALL_DIR}"
  fi
  mkdir -p "${INSTALL_DIR}/data"
}

build_app() {
  cd "${INSTALL_DIR}"
  log "Installing npm dependencies..."
  npm install

  # Load domains from .env when updating (prompts already set vars on fresh install)
  if [[ -f "${INSTALL_DIR}/.env" ]]; then
    # shellcheck disable=SC1091
    set -a
    # shellcheck source=/dev/null
    source "${INSTALL_DIR}/.env"
    set +a
  fi

  log "Building packages..."
  npm run build -w @quadtwo/shared
  npm run db:generate -w @quadtwo/server
  DATABASE_URL="file:${INSTALL_DIR}/data/quadtwo.db" npm run db:push -w @quadtwo/server
  npm run build -w @quadtwo/server
  log "Building web dashboard..."
  NEXT_PUBLIC_API_URL="https://${DASH_DOMAIN:-dash.anthropics.ir}" npm run build -w @quadtwo/web
}

write_systemd() {
  cat > "/etc/systemd/system/${SERVICE_NAME}.service" <<EOF
[Unit]
Description=Quadtwo Telegram VPN shop
After=network.target

[Service]
Type=simple
WorkingDirectory=${INSTALL_DIR}
EnvironmentFile=${INSTALL_DIR}/.env
ExecStart=/usr/bin/node ${INSTALL_DIR}/apps/server/dist/index.js
Restart=always
RestartSec=5
User=root
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
EOF

  systemctl daemon-reload
  systemctl enable "${SERVICE_NAME}"
  systemctl restart "${SERVICE_NAME}"
  log "Service ${SERVICE_NAME} started."

  cat > "/etc/systemd/system/${SERVICE_NAME}-web.service" <<EOF
[Unit]
Description=Quadtwo Piing Web Dashboard
After=network.target ${SERVICE_NAME}.service

[Service]
Type=simple
WorkingDirectory=${INSTALL_DIR}/apps/web
EnvironmentFile=${INSTALL_DIR}/.env
Environment=PORT=3000
ExecStart=/usr/bin/npx next start -p 3000
Restart=always
RestartSec=5
User=root

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable "${SERVICE_NAME}-web"
  systemctl restart "${SERVICE_NAME}-web"
  log "Service ${SERVICE_NAME}-web started."
}

write_helper() {
  local src="${INSTALL_DIR}/scripts/q2"
  if [[ ! -f "${src}" ]]; then
    err "Missing ${src} — cannot install Q2 CLI."
    exit 1
  fi
  install -m 755 "${src}" /usr/local/bin/q2
  # Allow override of install dir without editing the script body
  if [[ "${INSTALL_DIR}" != "/opt/quadtwo" ]]; then
    sed -i "s|^DIR=\"\${QUADTWO_DIR:-/opt/quadtwo}\"|DIR=\"\${QUADTWO_DIR:-${INSTALL_DIR}}\"|" /usr/local/bin/q2
  fi
  ln -sfn /usr/local/bin/q2 /usr/local/bin/quadtwo
  log "CLI installed: q2  (alias: quadtwo) — run with no args for menu"
}

do_install() {
  need_root
  detect_os
  install_node

  echo
  log "Enter configuration (press Enter to keep the default)"
  prompt BOT_TOKEN "BOT_TOKEN (from BotFather)"
  prompt ADMIN_TELEGRAM_IDS "Admin Telegram numeric ID"
  prompt XUI_BASE_URL "3x-ui base URL (trailing slash required)" "http://127.0.0.1:2053/"
  prompt XUI_API_TOKEN "3x-ui API token"
  prompt XUI_INBOUND_ID "Inbound ID" "1"
  prompt XUI_SUB_BASE "Subscription base URL (optional)" ""
  prompt PUBLIC_DOMAIN "Public domain for Mini App / API" "app.anthropics.ir"
  prompt DASH_DOMAIN "Web dashboard domain" "dash.anthropics.ir"
  prompt PORT "API service port" "4000"

  clone_or_update
  write_env
  build_app
  write_systemd
  write_helper

  echo
  log "Install complete."
  echo "  Menu:     q2   or   quadtwo          # numbered CLI"
  echo "  Manage:   q2 status | q2 logs | q2 restart"
  echo "  Config:   q2 env"
  echo "  New bot:  q2 set-token   # after BotFather token change / rebrand"
  echo "  New admin: q2 set-admin  # replace ADMIN_TELEGRAM_IDS + demote old admins"
  echo "  Dashboard: https://${DASH_DOMAIN:-dash.anthropics.ir}"
  echo "  Nginx sample: deploy/nginx-dash.anthropics.ir.conf"
  echo "  In bot:  /setcard CARD_NUMBER|CARD_HOLDER_NAME"
  echo "  Then open Telegram and send /start to the bot."
  systemctl --no-pager --full status "${SERVICE_NAME}" || true
}

do_update() {
  need_root
  detect_os
  [[ -d "${INSTALL_DIR}/.git" ]] || { err "No existing install found at ${INSTALL_DIR}."; exit 1; }
  install_node
  clone_or_update
  build_app
  write_systemd
  write_helper
  log "Update complete."
}

do_uninstall() {
  need_root
  systemctl stop "${SERVICE_NAME}" 2>/dev/null || true
  systemctl stop "${SERVICE_NAME}-web" 2>/dev/null || true
  systemctl disable "${SERVICE_NAME}" 2>/dev/null || true
  systemctl disable "${SERVICE_NAME}-web" 2>/dev/null || true
  rm -f "/etc/systemd/system/${SERVICE_NAME}.service"
  rm -f "/etc/systemd/system/${SERVICE_NAME}-web.service"
  systemctl daemon-reload
  rm -f /usr/local/bin/q2 /usr/local/bin/quadtwo
  read -r -p "Also delete ${INSTALL_DIR}? [y/N]: " ans || true
  if [[ "${ans:-}" =~ ^[Yy]$ ]]; then
    rm -rf "${INSTALL_DIR}"
  fi
  log "Uninstall complete."
}

case "${1:-}" in
  --update|-u) do_update ;;
  --uninstall) do_uninstall ;;
  --help|-h)
    echo "Usage: install.sh [--update|--uninstall]"
    ;;
  *) do_install ;;
esac
