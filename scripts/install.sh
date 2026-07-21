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
  cat > /usr/local/bin/quadtwo <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
SERVICE=quadtwo
DIR=/opt/quadtwo

env_file() { echo "$DIR/.env"; }

env_get() {
  local key="$1" file
  file="$(env_file)"
  [[ -f "$file" ]] || return 1
  grep -E "^${key}=" "$file" | tail -n1 | cut -d= -f2- | tr -d '\r'
}

set_env_key() {
  local key="$1" value="$2" file tmp
  file="$(env_file)"
  [[ -f "$file" ]] || { echo "No .env at $file"; exit 1; }
  tmp="$(mktemp)"
  grep -v -E "^${key}=" "$file" > "$tmp" || true
  printf '%s=%s\n' "$key" "$value" >> "$tmp"
  mv "$tmp" "$file"
  chmod 600 "$file"
}

telegram_get_me() {
  local token="$1" proxy args=(-fsS --max-time 15)
  proxy="$(env_get TELEGRAM_PROXY 2>/dev/null || true)"
  [[ -n "$proxy" ]] && args+=(-x "$proxy")
  curl "${args[@]}" "https://api.telegram.org/bot${token}/getMe"
}

case "${1:-}" in
  start) systemctl start "$SERVICE" ;;
  stop) systemctl stop "$SERVICE" ;;
  restart) systemctl restart "$SERVICE" ;;
  status) systemctl status "$SERVICE" --no-pager ;;
  logs) journalctl -u "$SERVICE" -f -n 100 ;;
  update)
    bash <(curl -Ls https://raw.githubusercontent.com/Peymantia/quadtwo/main/install.sh) --update
    ;;
  set-token|settoken)
    ENV_FILE="$(env_file)"
    [[ -f "$ENV_FILE" ]] || { echo "No .env at $ENV_FILE"; exit 1; }
    TOKEN="${2:-}"
    if [[ -z "$TOKEN" ]]; then
      read -r -p "New BOT_TOKEN from BotFather: " TOKEN
    fi
    TOKEN="$(echo "$TOKEN" | tr -d '[:space:]')"
    [[ -n "$TOKEN" ]] || { echo "BOT_TOKEN is required."; exit 1; }
    if [[ ! "$TOKEN" =~ ^[0-9]+:[A-Za-z0-9_-]+$ ]]; then
      echo "Token format looks invalid (expected 123456789:ABC...)."
      exit 1
    fi
    echo "Validating token with Telegram..."
    ME_JSON="$(telegram_get_me "$TOKEN")" || {
      echo "Telegram rejected this token (network or invalid token)."
      exit 1
    }
    BOT_USER="$(echo "$ME_JSON" | grep -o '"username":"[^"]*"' | head -1 | cut -d'"' -f4 || true)"
    BOT_NAME="$(echo "$ME_JSON" | grep -o '"first_name":"[^"]*"' | head -1 | cut -d'"' -f4 || true)"
    set_env_key BOT_TOKEN "$TOKEN"
    echo "BOT_TOKEN updated in $ENV_FILE"
    if [[ "$(env_get BOT_MODE)" == "webhook" ]]; then
      DOMAIN="$(env_get PUBLIC_DOMAIN)"
      PATH_HOOK="$(env_get TELEGRAM_WEBHOOK_PATH)"
      PATH_HOOK="${PATH_HOOK:-/telegram/webhook}"
      if [[ -n "$DOMAIN" ]]; then
        WEBHOOK_URL="https://${DOMAIN}${PATH_HOOK}"
        echo "Setting webhook: $WEBHOOK_URL"
        curl -fsS --max-time 15 \
          "https://api.telegram.org/bot${TOKEN}/setWebhook" \
          -d "url=${WEBHOOK_URL}" >/dev/null \
          || echo "Warning: setWebhook failed — check PUBLIC_DOMAIN and HTTPS."
      else
        echo "Warning: BOT_MODE=webhook but PUBLIC_DOMAIN is empty."
      fi
    fi
    echo "Restarting $SERVICE..."
    systemctl restart "$SERVICE"
    sleep 1
    if [[ -n "$BOT_USER" ]]; then
      echo "Done. New bot: @${BOT_USER}${BOT_NAME:+ ($BOT_NAME)}"
    else
      echo "Done. Service restarted."
    fi
    echo "Users must open the new bot and send /start."
    ;;
  set-admin|setadmin)
    ENV_FILE="$(env_file)"
    [[ -f "$ENV_FILE" ]] || { echo "No .env at $ENV_FILE"; exit 1; }
    IDS="${2:-}"
    if [[ -z "$IDS" ]]; then
      echo "Current ADMIN_TELEGRAM_IDS: $(env_get ADMIN_TELEGRAM_IDS || echo '(empty)')"
      read -r -p "New admin Telegram numeric ID(s), comma-separated: " IDS
    fi
    IDS="$(echo "$IDS" | tr -d '[:space:]' | tr -d '@')"
    [[ -n "$IDS" ]] || { echo "Admin Telegram ID is required."; exit 1; }
    if [[ ! "$IDS" =~ ^[0-9]+(,[0-9]+)*$ ]]; then
      echo "Invalid ID list (expected numeric IDs like 123456789 or 111,222)."
      exit 1
    fi
    OLD_IDS="$(env_get ADMIN_TELEGRAM_IDS || true)"
    set_env_key ADMIN_TELEGRAM_IDS "$IDS"
    echo "ADMIN_TELEGRAM_IDS: ${OLD_IDS:-'(empty)'} → $IDS"
    echo "Syncing database roles..."
    (
      cd "$DIR"
      set -a
      # shellcheck disable=SC1091
      source "$ENV_FILE"
      set +a
      if [[ -x "$DIR/node_modules/.bin/tsx" ]]; then
        "$DIR/node_modules/.bin/tsx" apps/server/scripts/set-admin.ts "$IDS"
      elif command -v npx >/dev/null 2>&1; then
        npx --yes tsx apps/server/scripts/set-admin.ts "$IDS"
      else
        echo "Warning: tsx not found — .env updated but DB roles were not synced."
        echo "Run manually: cd $DIR && npx tsx apps/server/scripts/set-admin.ts $IDS"
      fi
    ) || {
      echo "Warning: DB sync failed — .env was still updated."
      echo "Fix DB with: cd $DIR && npx tsx apps/server/scripts/set-admin.ts $IDS"
    }
    echo "Restarting $SERVICE..."
    systemctl restart "$SERVICE"
    sleep 1
    echo "Done. New admin(s): $IDS"
    echo "Open the bot from the new Telegram account and send /start."
    echo "Old Telegram accounts are no longer control admins."
    ;;
  env) ${EDITOR:-nano} "$(env_file)" ;;
  *)
    echo "Usage: quadtwo {start|stop|restart|status|logs|update|env|set-token [TOKEN]|set-admin [ID,...]}"
    exit 1
    ;;
esac
EOF
  sed -i "s|^DIR=.*|DIR=${INSTALL_DIR}|" /usr/local/bin/quadtwo
  chmod +x /usr/local/bin/quadtwo
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
  echo "  Manage:  quadtwo status | quadtwo logs | quadtwo restart"
  echo "  Config:  quadtwo env"
  echo "  New bot:   quadtwo set-token   # after BotFather token change / rebrand"
  echo "  New admin: quadtwo set-admin   # replace ADMIN_TELEGRAM_IDS + demote old admins"
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
  rm -f /usr/local/bin/quadtwo
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
