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

# Strip scheme / trailing slash / whitespace from a hostname
normalize_host() {
  local h="$1"
  h="$(echo "${h}" | sed -e 's|^[Hh][Tt][Tt][Pp][Ss]\?://||' -e 's|/$||' -e 's|^[[:space:]]*||' -e 's|[[:space:]]*$||')"
  printf '%s' "${h}"
}

setup_nginx() {
  local domain
  domain="$(normalize_host "${DASH_DOMAIN:-}")"
  if [[ -z "${domain}" ]]; then
    warn "DASH_DOMAIN empty — skip nginx setup. Set it in .env and re-run install or: q2 env"
    return 0
  fi

  if ! command -v nginx >/dev/null 2>&1; then
    log "Installing nginx…"
    if command -v apt-get >/dev/null 2>&1; then
      DEBIAN_FRONTEND=noninteractive apt-get install -y nginx
    elif command -v dnf >/dev/null 2>&1; then
      dnf install -y nginx
    else
      warn "Could not auto-install nginx — install it manually and copy deploy/nginx-dash.conf"
      return 0
    fi
  fi

  local site_avail="/etc/nginx/sites-available/quadtwo-dash"
  local site_en="/etc/nginx/sites-enabled/quadtwo-dash"
  local tpl="${INSTALL_DIR}/deploy/nginx-dash.conf"
  if [[ ! -f "${tpl}" ]]; then
    warn "Missing ${tpl} — skip nginx write"
    return 0
  fi

  sed "s/__DASH_DOMAIN__/${domain}/g" "${tpl}" > "${site_avail}"
  mkdir -p /etc/nginx/sites-enabled
  ln -sfn "${site_avail}" "${site_en}"
  # Drop stock default so Host / Cloudflare don't hit empty 404
  rm -f /etc/nginx/sites-enabled/default

  # Older installs put named upstreams in conf.d — remove to avoid duplicate upstream
  if [[ -d /etc/nginx/conf.d ]]; then
    for f in /etc/nginx/conf.d/quadtwo*.conf /etc/nginx/conf.d/*quadtwo*.conf; do
      [[ -f "$f" ]] || continue
      if grep -qE 'upstream[[:space:]]+quadtwo_(api|web)' "$f" 2>/dev/null; then
        warn "Removing duplicate nginx upstream file: $f"
        rm -f "$f"
      fi
    done
  fi

  # If nginx -t fails on duplicate default_server, strip default_server from our site and retry
  if ! nginx -t 2>/dev/null; then
    if grep -q 'default_server' "${site_avail}" 2>/dev/null; then
      warn "Stripping default_server from ${site_avail} (another site already owns :80)"
      sed -i 's/ default_server//g' "${site_avail}"
    fi
  fi

  if nginx -t; then
    systemctl enable nginx >/dev/null 2>&1 || true
    systemctl restart nginx
    log "Nginx ready for https://${domain} (origin HTTP :80 — Cloudflare SSL: Flexible)"
  else
    err "nginx -t failed — fix ${site_avail} then: systemctl restart nginx"
    return 1
  fi
}

write_env() {
  local env_file="${INSTALL_DIR}/.env"
  # Allow "1,2,3" in the inbound prompt — store list + primary id
  local inbound_ids="${XUI_INBOUND_ID}"
  local inbound_primary
  inbound_primary="$(echo "${inbound_ids}" | tr ',' ' ' | awk '{print $1}')"
  [[ -z "${inbound_primary}" ]] && inbound_primary="1"
  cat > "${env_file}" <<EOF
NODE_ENV=production
PORT=${PORT}
DATABASE_URL=file:${INSTALL_DIR}/data/quadtwo.db
DEMO_MODE=false

BOT_TOKEN=${BOT_TOKEN}
BOT_MODE=polling
TELEGRAM_WEBHOOK_PATH=/telegram/webhook
ADMIN_TELEGRAM_IDS=${ADMIN_TELEGRAM_IDS}

XUI_BASE_URL=${XUI_BASE_URL}
XUI_API_TOKEN=${XUI_API_TOKEN}
XUI_INBOUND_ID=${inbound_primary}
XUI_INBOUND_IDS=${inbound_ids}
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
  QUADTWO_PREV_SHA=""
  if [[ -d "${INSTALL_DIR}/.git" ]]; then
    QUADTWO_PREV_SHA="$(git -C "${INSTALL_DIR}" rev-parse HEAD 2>/dev/null || true)"
    log "Updating repo in ${INSTALL_DIR}..."
    # Deeper fetch so we can diff previous → new for smart builds
    git -C "${INSTALL_DIR}" fetch --depth 30 origin "${REPO_BRANCH}"
    git -C "${INSTALL_DIR}" reset --hard "origin/${REPO_BRANCH}"
  else
    log "Cloning repo into ${INSTALL_DIR}..."
    rm -rf "${INSTALL_DIR}"
    git clone --depth 1 --branch "${REPO_BRANCH}" "${REPO_URL}" "${INSTALL_DIR}"
  fi
  mkdir -p "${INSTALL_DIR}/data"
  QUADTWO_NEW_SHA="$(git -C "${INSTALL_DIR}" rev-parse HEAD 2>/dev/null || true)"
}

load_dotenv() {
  if [[ -f "${INSTALL_DIR}/.env" ]]; then
    # shellcheck disable=SC1091
    set -a
    # shellcheck source=/dev/null
    source "${INSTALL_DIR}/.env"
    set +a
  fi
}

build_app_full() {
  cd "${INSTALL_DIR}"
  load_dotenv
  mark_build_start
  log "Full build: npm install + all packages + clean Next.js build"
  # NODE_ENV=production is in .env for runtime; force-install build/dev deps for tsc.
  npm install --include=dev
  log "Building packages..."
  npm run build -w @quadtwo/shared
  npm run db:generate -w @quadtwo/server
  DATABASE_URL="file:${INSTALL_DIR}/data/quadtwo.db" npm run db:push -w @quadtwo/server
  if [[ -f "${INSTALL_DIR}/data/demo.db" ]]; then
    log "Updating demo database schema (data/demo.db)..."
    DATABASE_URL="file:${INSTALL_DIR}/data/demo.db" npm run db:push -w @quadtwo/server \
      || warn "demo db:push failed — check prisma"
  fi
  npm run build -w @quadtwo/server
  log "Building web dashboard..."
  rm -rf "${INSTALL_DIR}/apps/web/.next"
  if [[ -z "${DASH_DOMAIN:-}" ]]; then
    err "DASH_DOMAIN is empty — set it in ${INSTALL_DIR}/.env before building the web app"
    exit 1
  fi
  NEXT_PUBLIC_API_URL="https://${DASH_DOMAIN}" NEXT_PUBLIC_APP_URL="https://${DASH_DOMAIN}" \
    npm run build -w @quadtwo/web
  mark_build_done
}

# Fresh install always uses full build
build_app() {
  build_app_full
}

BUILD_LOCK="${INSTALL_DIR}/data/.build-incomplete"

mark_build_start() {
  mkdir -p "${INSTALL_DIR}/data"
  touch "${BUILD_LOCK}"
}

mark_build_done() {
  rm -f "${BUILD_LOCK}"
}

artifacts_ok() {
  [[ -f "${INSTALL_DIR}/apps/server/dist/index.js" ]] \
    && [[ -f "${INSTALL_DIR}/apps/web/.next/BUILD_ID" || -d "${INSTALL_DIR}/apps/web/.next/server" ]]
}

# After restart: confirm API (:PORT) and web (:3000) answer locally.
verify_local_services() {
  load_dotenv
  local api_port="${PORT:-4000}"
  local ok=1
  local i web_code
  for i in 1 2 3 4 5 6 7 8 9 10; do
    web_code="$(curl -sS --max-time 2 -o /dev/null -w "%{http_code}" "http://127.0.0.1:3000/" 2>/dev/null || echo 000)"
    if systemctl is-active --quiet "${SERVICE_NAME}" \
      && systemctl is-active --quiet "${SERVICE_NAME}-web" \
      && curl -fsS --max-time 2 "http://127.0.0.1:${api_port}/health" >/dev/null 2>&1 \
      && [[ "${web_code}" =~ ^(200|301|302|307|308)$ ]]; then
      ok=0
      break
    fi
    sleep 1
  done
  if [[ "${ok}" -ne 0 ]]; then
    warn "Local health check failed (API :${api_port} / web :3000) — often means interrupted build → 502"
    systemctl --no-pager -l status "${SERVICE_NAME}" 2>/dev/null | tail -n 20 || true
    systemctl --no-pager -l status "${SERVICE_NAME}-web" 2>/dev/null | tail -n 20 || true
    journalctl -u "${SERVICE_NAME}" -u "${SERVICE_NAME}-web" -n 40 --no-pager 2>/dev/null || true
    return 1
  fi
  log "Local health OK (API :${api_port} + web :3000)"
  return 0
}

changed_match() {
  local pattern="$1"
  echo "${CHANGED_FILES}" | grep -E "${pattern}" >/dev/null 2>&1
}

build_app_smart() {
  cd "${INSTALL_DIR}"
  load_dotenv

  # Interrupted previous update leaves corrupt dist/.next while git SHA is current.
  if [[ -f "${BUILD_LOCK}" ]]; then
    warn "Previous build was interrupted — forcing full rebuild."
    build_app_full
    return
  fi

  if ! artifacts_ok; then
    warn "Build artifacts missing/incomplete — forcing full rebuild."
    build_app_full
    return
  fi

  local old="${QUADTWO_PREV_SHA:-}"
  local new="${QUADTWO_NEW_SHA:-}"
  CHANGED_FILES=""

  if [[ -z "${old}" || -z "${new}" ]]; then
    warn "No previous commit — running full build."
    build_app_full
    return
  fi

  if [[ "${old}" == "${new}" ]]; then
    log "Already up to date (${new:0:7})."
    log "Skipping rebuild (use: q2 update --full to force)."
    return
  fi

  if ! git -C "${INSTALL_DIR}" cat-file -e "${old}^{commit}" 2>/dev/null; then
    warn "Previous commit not in local history — running full build."
    build_app_full
    return
  fi

  CHANGED_FILES="$(git -C "${INSTALL_DIR}" diff --name-only "${old}" "${new}" 2>/dev/null || true)"
  if [[ -z "${CHANGED_FILES}" ]]; then
    warn "Empty diff — running full build to be safe."
    build_app_full
    return
  fi

  mark_build_start

  log "Smart update ${old:0:7} → ${new:0:7}"
  local count
  count="$(echo "${CHANGED_FILES}" | grep -c . || true)"
  log "Changed paths: ${count}"
  echo "${CHANGED_FILES}" | head -n 25
  if [[ "${count}" -gt 25 ]]; then
    log "… and $((count - 25)) more"
  fi

  local need_npm=0 need_prisma=0 need_shared=0 need_server=0 need_web=0

  if changed_match '^(package-lock\.json|package\.json|npm-shrinkwrap\.json|apps/[^/]+/package\.json|packages/[^/]+/package\.json)$'; then
    need_npm=1
  fi
  if changed_match '^apps/server/prisma/'; then
    need_prisma=1
  fi
  if changed_match '^packages/shared/'; then
    need_shared=1
  fi
  if changed_match '^apps/server/'; then
    need_server=1
  fi
  if changed_match '^apps/web/'; then
    need_web=1
  fi

  # Cascades
  if [[ "${need_npm}" -eq 1 ]]; then
    need_shared=1
    need_server=1
    need_web=1
    need_prisma=1
  fi
  if [[ "${need_shared}" -eq 1 ]]; then
    need_server=1
    need_web=1
  fi
  if [[ "${need_prisma}" -eq 1 ]]; then
    need_server=1
  fi

  if [[ "${need_npm}" -eq 0 && "${need_prisma}" -eq 0 && "${need_shared}" -eq 0 && "${need_server}" -eq 0 && "${need_web}" -eq 0 ]]; then
    log "No app code/deps changed — skip compile (CLI/docs only)."
    mark_build_done
    return
  fi

  if [[ "${need_npm}" -eq 1 ]]; then
    log "Installing npm dependencies…"
    # See build_app_full — keep @types/node & typescript available under NODE_ENV=production.
    npm install --include=dev
  else
    log "Skip npm install (lockfile unchanged)."
    # Re-include pruned devDeps if a prior production install removed them.
    if [[ "${need_server}" -eq 1 || "${need_web}" -eq 1 ]]; then
      npm install --include=dev --no-audit --no-fund >/dev/null
    fi
  fi

  if [[ "${need_shared}" -eq 1 ]]; then
    log "Building @quadtwo/shared…"
    npm run build -w @quadtwo/shared
  fi

  if [[ "${need_prisma}" -eq 1 ]]; then
    log "Prisma generate + db push…"
    npm run db:generate -w @quadtwo/server
    DATABASE_URL="file:${INSTALL_DIR}/data/quadtwo.db" npm run db:push -w @quadtwo/server
    if [[ -f "${INSTALL_DIR}/data/demo.db" ]]; then
      DATABASE_URL="file:${INSTALL_DIR}/data/demo.db" npm run db:push -w @quadtwo/server \
        || warn "demo db:push failed"
    fi
  elif [[ "${need_server}" -eq 1 ]]; then
    # Keep client in sync when server rebuilds
    npm run db:generate -w @quadtwo/server
  fi

  if [[ "${need_server}" -eq 1 ]]; then
    log "Building @quadtwo/server…"
    npm run build -w @quadtwo/server
  fi

  if [[ "${need_web}" -eq 1 ]]; then
    log "Building web dashboard (incremental Next.js)…"
    # Keep .next cache for speed; use --full to wipe if chunks go stale
    NEXT_PUBLIC_API_URL="https://${DASH_DOMAIN}" NEXT_PUBLIC_APP_URL="https://${DASH_DOMAIN}" \
      npm run build -w @quadtwo/web
  fi

  mark_build_done
  log "Smart build done."
}

do_update() {
  need_root
  detect_os
  [[ -d "${INSTALL_DIR}/.git" ]] || { err "No existing install found at ${INSTALL_DIR}."; exit 1; }
  install_node
  clone_or_update
  if [[ "${UPDATE_FULL:-0}" -eq 1 ]]; then
    log "Mode: full rebuild"
    build_app_full
  else
    log "Mode: smart update (pass --full to force clean rebuild)"
    build_app_smart
  fi
  write_systemd
  write_helper
  if systemctl list-unit-files quadtwo-demo.service &>/dev/null; then
    systemctl restart quadtwo-demo quadtwo-demo-web 2>/dev/null || true
    log "Restarted demo showcase services (quadtwo-demo)."
  fi
  load_dotenv
  setup_nginx || true

  if ! verify_local_services; then
    warn "Services unhealthy after update — running one automatic full rebuild…"
    build_app_full
    write_systemd
    if verify_local_services; then
      log "Recovered after full rebuild."
    else
      err "Still unhealthy. Run: journalctl -u quadtwo -u quadtwo-web -n 80 --no-pager"
      err "Or: q2 update --full"
    fi
  fi

  log "Update complete."
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
Environment=NODE_ENV=production
ExecStart=${INSTALL_DIR}/node_modules/.bin/next start -p 3000
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
  log "Enter configuration (required fields cannot be empty)"
  prompt BOT_TOKEN "BOT_TOKEN (from BotFather)"
  prompt ADMIN_TELEGRAM_IDS "Admin Telegram numeric ID"
  prompt XUI_BASE_URL "3x-ui base URL (trailing slash required)" "http://127.0.0.1:2053/"
  prompt XUI_API_TOKEN "3x-ui API token"
  prompt XUI_INBOUND_ID "Inbound ID(s), comma-separated" "1"
  prompt XUI_SUB_BASE "Subscription base URL (optional)" ""
  prompt DASH_DOMAIN "Web dashboard domain (e.g. dash.example.com)"
  DASH_DOMAIN="$(normalize_host "${DASH_DOMAIN}")"
  prompt PUBLIC_DOMAIN "Public / Mini App domain (often same as dashboard)" "${DASH_DOMAIN}"
  PUBLIC_DOMAIN="$(normalize_host "${PUBLIC_DOMAIN}")"
  prompt PORT "API service port" "4000"

  if [[ -z "${DASH_DOMAIN}" ]]; then
    err "DASH_DOMAIN is required"
    exit 1
  fi

  clone_or_update
  write_env
  build_app
  write_systemd
  write_helper
  setup_nginx

  echo
  log "Install complete."
  echo "  Menu:     q2   or   quadtwo          # numbered CLI"
  echo "  Manage:   q2 status | q2 logs | q2 restart"
  echo "  Config:   q2 env"
  echo "  New bot:  q2 set-token   # after BotFather token change / rebrand"
  echo "  New admin: q2 set-admin  # replace ADMIN_TELEGRAM_IDS + demote old admins"
  echo "  Demo:     q2 demo        # DEMO_MODE on/off / status (showcase bot)"
  echo "  License:  q2 activate | q2 license"
  echo "  Update:   q2 update      # smart |  q2 update --full"
  echo "  Dashboard: https://${DASH_DOMAIN}"
  echo "  Cloudflare: orange proxy + SSL mode Flexible (HTTP origin :80)"
  echo "  In bot:  /setcard CARD_NUMBER|CARD_HOLDER_NAME"
  echo "  Then open Telegram and send /start to the bot."
  systemctl --no-pager --full status "${SERVICE_NAME}" || true
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

UPDATE_FULL=0
case "${1:-}" in
  --update|-u)
    shift || true
    for arg in "$@"; do
      case "${arg}" in
        --full|-f|full) UPDATE_FULL=1 ;;
      esac
    done
    do_update
    ;;
  --uninstall) do_uninstall ;;
  --help|-h)
    echo "Usage: install.sh [--update [--full]|--uninstall]"
    echo "  --update         Smart rebuild (only changed parts)"
    echo "  --update --full  Clean full rebuild (like fresh install build)"
    ;;
  *) do_install ;;
esac
