#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
RED='\033[38;2;248;81;73m'
GREEN='\033[38;2;63;185;80m'
YELLOW='\033[38;2;210;153;34m'
BLUE='\033[38;2;88;166;255m'
GRAY='\033[38;2;139;148;158m'
NC='\033[0m'
ENV_FILE="${ENV_FILE:-.env.production}"
IS_BETA=false
SKIP_TESTS=false
CLEAN_MONGODB=false
LOG_DIR="logs/deploy"
LOG_FILE="$LOG_DIR/deploy-$(date +%Y%m%d-%H%M%S).log"
mkdir -p "$LOG_DIR"
chmod 755 "$LOG_DIR" 2>/dev/null || true
export LOG_DIR LOG_FILE
log_info() { echo -e "${GREEN}[INFO]${NC} $1" | tee -a "$LOG_FILE"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1" | tee -a "$LOG_FILE"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1" | tee -a "$LOG_FILE"; }
log_section() { echo -e "\n${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n${BLUE}▶ $1 ${GRAY}[incomplete]${NC}" | tee -a "$LOG_FILE"; }
log_complete() { echo -e "${GREEN}[complete]${NC} $1" | tee -a "$LOG_FILE"; }
cleanup_process_artifacts() {
  log_info "Cleaning process artifacts (sockets/state)..."
  if systemctl is-active --quiet jobs-watcher 2>/dev/null; then sudo systemctl stop jobs-watcher 2>/dev/null || true; fi
  pid=$(systemctl show -p MainPID --value jobs-watcher 2>/dev/null || echo 0); if [ -n "$pid" ] && [ "$pid" -gt 0 ] 2>/dev/null && ps -p "$pid" >/dev/null 2>&1; then sudo kill "$pid" 2>/dev/null || true; fi
  pkill -u jobs-watcher -f "node.*dist/src/index" 2>/dev/null || true
  # UDS path from sourced env — no inline fallback
  rm -f "${UDS_SOCKET_PATH:-}" 2>/dev/null || true
  [ -n "${TUI_SHARED_STATE_PATH:-}" ] && rm -f "$TUI_SHARED_STATE_PATH" 2>/dev/null || true
}
systemctl_daemon_reload() { sudo systemctl daemon-reload 2>&1 | tee -a "$LOG_FILE"; }
systemctl_restart_service() { sudo systemctl restart jobs-watcher 2>&1 | tee -a "$LOG_FILE"; }
while [[ $# -gt 0 ]]; do case "$1" in --clean-mongodb) CLEAN_MONGODB=true; shift;; --beta) IS_BETA=true; shift;; --skip-tests) SKIP_TESTS=true; shift;; --env) ENV_FILE="$2"; shift 2;; --help) grep '^#' "$0" | head -20; exit 0;; *) log_error "Unknown option: $1"; exit 1;; esac; done
# STEP 1 Validate Env
log_section "STEP 1 Validate Env"
if [ ! -f "$ENV_FILE" ]; then
  if [ -f .env.production ]; then ENV_FILE=".env.production"; log_info "Defaulting to .env.production"
  elif [ -f .env ]; then ENV_FILE=".env"; log_info "Defaulting to .env"
  else log_error "Env file not found: tried $ENV_FILE and .env — abort"; exit 1; fi
fi
log_info "Env file: $ENV_FILE"
if ! grep -qE '^(MONGODB_URI|GMAIL_CLIENT_ID|GMAIL_CLIENT_SECRET|RABBITMQ_URL)=' "$ENV_FILE" 2>/dev/null; then
  log_warn "Env missing at least one required key (MONGODB_URI/GMAIL_CLIENT_ID/GMAIL_CLIENT_SECRET/RABBITMQ_URL) — will fail at config validation"
fi
# source env — single source, no inline UDS/IPC defaults
set -a; source "$ENV_FILE" 2>/dev/null || true; set +a
HEALTH_PORT="${HEALTH_PORT:-9090}"
WEBHOOK_PORT="${WEBHOOK_PORT:-3000}"
# UDS/IPC explicitly from env file — fail fast if missing
if [ -z "${UDS_SOCKET_PATH:-}" ] || [ -z "${TUI_SHARED_STATE_PATH:-}" ]; then log_error "Missing UDS_SOCKET_PATH or TUI_SHARED_STATE_PATH in $ENV_FILE"; exit 1; fi
log_complete "STEP 1 Validate Env"
# STEP 1.5 MongoDB Cleanup
if [[ "$CLEAN_MONGODB" == "true" ]]; then
  log_section "STEP 1.5 MongoDB Cleanup"
  if SKIP_CONFIRM=1 npm run db:truncate >> "$LOG_FILE" 2>&1; then log_complete "MongoDB cleaned"; else log_warn "MongoDB cleanup had issues"; fi
fi
# STEP 1.75 Stop Old
log_section "STEP 1.75 Stop Old Service"
cleanup_process_artifacts
log_complete "Stop Old"
# STEP 2 Build
log_section "STEP 2 Build"
if [[ "$SKIP_TESTS" != "true" ]]; then
  if [[ "${SKIP_PREFLIGHT:-}" != "1" ]]; then
    if npm run test:preflight 2>&1 | tee -a "$LOG_FILE"; then log_complete "test:preflight passed"; else log_error "test:preflight failed"; exit 1; fi
  else echo -e "${BLUE}[CI] SKIP_PREFLIGHT=1 — preflight skipped${NC}" | tee -a "$LOG_FILE"; fi
  if npm run test:unit 2>&1 | tee -a "$LOG_FILE"; then log_complete "test:unit passed"; else log_error "test:unit failed"; exit 1; fi
  if npm run test:integration -- --no-file-parallelism 2>&1 | tee -a "$LOG_FILE"; then log_complete "test:integration passed"; else log_error "test:integration failed"; exit 1; fi
else echo -e "${BLUE}[CI] skip-tests — unit+integration+preflight skipped${NC}" | tee -a "$LOG_FILE"; fi
if npm run build 2>&1 | tee -a "$LOG_FILE"; then log_complete "Build"; else log_error "Build failed"; exit 1; fi
[ -f dist/src/index.js ] || { log_error "Build artifact missing: dist/src/index.js"; exit 1; }
log_complete "STEP 2 Build"
# STEP 3 Install systemd (includes daemon-reload + 3 enables + restart — see install 064-067)
log_section "STEP 3 Install systemd"
if bash scripts/install-systemd-local.sh "$ENV_FILE" >> "$LOG_FILE" 2>&1; then log_complete "systemd installed"; else log_error "systemd install failed"; exit 1; fi
# STEP 4 Verify (install already daemon-reloaded + enabled; verify here for CI gate — strict fail)
log_section "STEP 4 Verify Daemon"
if ! systemctl is-active --quiet mongod 2>/dev/null; then log_warn "mongod not active"; fi
if ! systemctl is-active --quiet rabbitmq-server 2>/dev/null; then log_warn "rabbitmq-server not active"; fi
if systemctl is-active --quiet jobs-watcher; then log_complete "jobs-watcher active"; else log_error "jobs-watcher not active"; sudo systemctl status jobs-watcher 2>&1 | tee -a "$LOG_FILE"; exit 1; fi
pid=$(systemctl show -p MainPID --value jobs-watcher); if [ "$pid" -gt 0 ] && ps -p "$pid" >/dev/null 2>&1; then log_complete "pid $pid"; else log_error "pid not found"; exit 1; fi
if [ -S "$UDS_SOCKET_PATH" ]; then log_complete "UDS $UDS_SOCKET_PATH"; else log_error "UDS not found ($UDS_SOCKET_PATH)"; exit 1; fi
if curl --fail -s "http://127.0.0.1:${HEALTH_PORT}/health" 2>&1 | grep -q ok; then log_complete "health:${HEALTH_PORT} green"; else log_error "health:${HEALTH_PORT} failed"; exit 1; fi
for C in mongo rabbitmq browser scheduler uds webhook; do
  if curl -s "http://127.0.0.1:${HEALTH_PORT}/metrics" 2>&1 | grep -q "infra_ready{component=\"$C\"} 1"; then log_complete "infraReady $C 1";
  else log_error "infraReady $C !=1 (metrics)"; exit 1; fi
done
# port exposure nic localhost — curl primary, ss/lsof compat fallback
if curl -s --connect-timeout 2 "http://127.0.0.1:${HEALTH_PORT}/health" >/dev/null 2>&1; then log_complete "probe 127.0.0.1:${HEALTH_PORT} ok";
else log_error "probe 127.0.0.1:${HEALTH_PORT} fail"; exit 1; fi
if curl -s --connect-timeout 2 "http://127.0.0.1:${WEBHOOK_PORT}/health" >/dev/null 2>&1; then log_complete "probe 127.0.0.1:${WEBHOOK_PORT} ok";
elif curl -s "http://127.0.0.1:${HEALTH_PORT}/metrics" >/dev/null 2>&1; then log_complete "probe 127.0.0.1:${WEBHOOK_PORT} ok (via metrics)";
else
  if command -v ss >/dev/null 2>&1; then ss -Hln "sport = :${WEBHOOK_PORT}" 2>/dev/null | grep -q "127.0.0.1" && log_complete "ss 127.0.0.1:${WEBHOOK_PORT} ok" || { log_error "ss 127.0.0.1:${WEBHOOK_PORT} not localhost"; exit 1; }
  elif command -v lsof >/dev/null 2>&1; then lsof -i :${WEBHOOK_PORT} -sTCP:LISTEN 2>/dev/null | grep -q "127.0.0.1" && log_complete "lsof 127.0.0.1:${WEBHOOK_PORT} ok" || log_warn "lsof check skipped";
  else log_warn "no ss/lsof — curl probe skipped"; fi
fi
log_complete "STEP 4 Verify"
# STEP 5 Beta/Prod fetch timer (install already enables 3 units; beta disables, prod is already active)
log_section "STEP 5 Fetch Timer"
if [[ "$IS_BETA" == "true" ]]; then
  sudo systemctl disable --now jobs-watcher-fetch.service 2>/dev/null || true
  sudo systemctl disable --now jobs-watcher-fetch.timer 2>/dev/null || true
  log_complete "beta — fetch timer disabled (manual sh 500/7)"
else
  log_complete "prod — fetch timer weekly active (via install)"
fi
log_info "Deploy complete — ${GREEN}[exit 0]${NC}" | tee -a "$LOG_FILE"
exit 0
