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
    err "این اسکریپت را با root اجرا کنید (sudo)."
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
      log "Node.js $(node -v) موجود است."
      return
    fi
    warn "Node.js قدیمی است ($(node -v)) — نسخه ${NODE_MAJOR}+ نصب می‌شود."
  fi

  log "نصب Node.js ${NODE_MAJOR}..."
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
      err "توزیع پشتیبانی‌نشده: ${OS_ID}. Node ${NODE_MAJOR}+ و git را دستی نصب کنید."
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
      warn "این مقدار الزامی است."
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
NEXT_PUBLIC_API_URL=https://${PUBLIC_DOMAIN}
NEXT_PUBLIC_APP_URL=https://${PUBLIC_DOMAIN}
EOF
  chmod 600 "${env_file}"
  log "فایل تنظیمات: ${env_file}"
}

clone_or_update() {
  if [[ -d "${INSTALL_DIR}/.git" ]]; then
    log "به‌روزرسانی مخزن در ${INSTALL_DIR}..."
    git -C "${INSTALL_DIR}" fetch --depth 1 origin "${REPO_BRANCH}"
    git -C "${INSTALL_DIR}" reset --hard "origin/${REPO_BRANCH}"
  else
    log "کلون مخزن در ${INSTALL_DIR}..."
    rm -rf "${INSTALL_DIR}"
    git clone --depth 1 --branch "${REPO_BRANCH}" "${REPO_URL}" "${INSTALL_DIR}"
  fi
  mkdir -p "${INSTALL_DIR}/data"
}

build_app() {
  cd "${INSTALL_DIR}"
  log "نصب وابستگی‌ها..."
  npm install

  log "ساخت پکیج‌ها..."
  npm run build -w @quadtwo/shared
  npm run db:generate -w @quadtwo/server
  DATABASE_URL="file:${INSTALL_DIR}/data/quadtwo.db" npm run db:push -w @quadtwo/server
  npm run build -w @quadtwo/server
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
  log "سرویس ${SERVICE_NAME} راه‌اندازی شد."
}

write_helper() {
  cat > /usr/local/bin/quadtwo <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
SERVICE=quadtwo
DIR=/opt/quadtwo
case "${1:-}" in
  start) systemctl start "$SERVICE" ;;
  stop) systemctl stop "$SERVICE" ;;
  restart) systemctl restart "$SERVICE" ;;
  status) systemctl status "$SERVICE" --no-pager ;;
  logs) journalctl -u "$SERVICE" -f -n 100 ;;
  update)
    bash <(curl -Ls https://raw.githubusercontent.com/Peymantia/quadtwo/main/install.sh) --update
    ;;
  env) ${EDITOR:-nano} "$DIR/.env" ;;
  *)
    echo "Usage: quadtwo {start|stop|restart|status|logs|update|env}"
    exit 1
    ;;
esac
EOF
  # keep DIR in sync if custom install path was used
  sed -i "s|^DIR=.*|DIR=${INSTALL_DIR}|" /usr/local/bin/quadtwo
  chmod +x /usr/local/bin/quadtwo
}

do_install() {
  need_root
  detect_os
  install_node

  echo
  log "تنظیمات را وارد کنید (Enter = مقدار پیش‌فرض)"
  prompt BOT_TOKEN "BOT_TOKEN (از BotFather)"
  prompt ADMIN_TELEGRAM_IDS "Telegram ID ادمین"
  prompt XUI_BASE_URL "آدرس پنل 3x-ui (با / انتهایی)" "http://127.0.0.1:2053/"
  prompt XUI_API_TOKEN "API Token پنل 3x-ui"
  prompt XUI_INBOUND_ID "Inbound ID" "1"
  prompt XUI_SUB_BASE "آدرس پایه ساب (اختیاری)" ""
  prompt PUBLIC_DOMAIN "دامنه Mini App" "app.piing.ir"
  prompt PORT "پورت سرویس" "4000"

  clone_or_update
  write_env
  build_app
  write_systemd
  write_helper

  echo
  log "نصب تمام شد."
  echo "  مدیریت:  quadtwo status | quadtwo logs | quadtwo restart"
  echo "  تنظیمات: quadtwo env"
  echo "  کارت بانکی در بات: /setcard شماره|نام"
  echo "  ربات را در تلگرام /start بزنید."
  systemctl --no-pager --full status "${SERVICE_NAME}" || true
}

do_update() {
  need_root
  detect_os
  [[ -d "${INSTALL_DIR}/.git" ]] || { err "نصب قبلی در ${INSTALL_DIR} پیدا نشد."; exit 1; }
  install_node
  clone_or_update
  # keep existing .env
  build_app
  write_systemd
  write_helper
  log "به‌روزرسانی انجام شد."
}

do_uninstall() {
  need_root
  systemctl stop "${SERVICE_NAME}" 2>/dev/null || true
  systemctl disable "${SERVICE_NAME}" 2>/dev/null || true
  rm -f "/etc/systemd/system/${SERVICE_NAME}.service"
  systemctl daemon-reload
  rm -f /usr/local/bin/quadtwo
  read -r -p "پوشه ${INSTALL_DIR} هم حذف شود؟ [y/N]: " ans || true
  if [[ "${ans:-}" =~ ^[Yy]$ ]]; then
    rm -rf "${INSTALL_DIR}"
  fi
  log "حذف انجام شد."
}

case "${1:-}" in
  --update|-u) do_update ;;
  --uninstall) do_uninstall ;;
  --help|-h)
    echo "Usage: install.sh [--update|--uninstall]"
    ;;
  *) do_install ;;
esac
