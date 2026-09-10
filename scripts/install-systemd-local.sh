#!/usr/bin/env bash
set -euo pipefail
RED='\033[38;2;248;81;73m'
GREEN='\033[38;2;63;185;80m'
YELLOW='\033[38;2;210;153;34m'
BLUE='\033[38;2;88;166;255m'
GRAY='\033[38;2;139;148;158m'
NC='\033[0m'
LOG_DIR="${LOG_DIR:-logs/deploy}"
LOG_FILE="${LOG_FILE:-logs/deploy/systemd-install.log}"
mkdir -p "$LOG_DIR"
chmod 755 "$LOG_DIR" 2>/dev/null || true
echo -e "${BLUE}▶ install started ${GRAY}[incomplete]${NC}" | tee -a "$LOG_FILE"
echo "=== jobs-watcher systemd install started $(date) ===" | tee -a "$LOG_FILE"
ENV_FILE_ARG="${1:-}"
ENV_FILE="${ENV_FILE_ARG:-.env.production}"
if [ ! -f "$ENV_FILE" ]; then
  if [ -f .env ]; then ENV_FILE=".env"; echo -e "${YELLOW}[WARN] Defaulting to .env${NC}" | tee -a "$LOG_FILE"
  else echo -e "${RED}[ERROR] Env file not found: tried $ENV_FILE and .env — abort${NC}" | tee -a "$LOG_FILE"; exit 1; fi
fi
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OPT_DST="/opt/jobs-watcher"
SRV_ASSET="/srv/jobs-watcher/asset"
SERVICE_SRC="scripts/systemd/jobs-watcher.service"
FETCH_SERVICE_SRC="scripts/systemd/jobs-watcher-fetch.service"
FETCH_TIMER_SRC="scripts/systemd/jobs-watcher-fetch.timer"
SERVICE_DST="/etc/systemd/system/jobs-watcher.service"
FETCH_SERVICE_DST="/etc/systemd/system/jobs-watcher-fetch.service"
FETCH_TIMER_DST="/etc/systemd/system/jobs-watcher-fetch.timer"
ENV_DST="/etc/jobs-watcher.env"
SUDO=""; if [ "$(id -u)" -ne 0 ]; then SUDO="sudo"; fi
echo -e "${BLUE}▶ ensure group ${GRAY}[incomplete]${NC}" | tee -a "$LOG_FILE"
${SUDO} sh -c 'groupadd -f jobs-watcher 2>/dev/null || true' || true
if ! id -u jobs-watcher >/dev/null 2>&1; then ${SUDO} useradd --system --no-create-home --shell /usr/sbin/nologin --uid 997 --gid jobs-watcher jobs-watcher 2>/dev/null || ${SUDO} useradd --system --no-create-home --shell /usr/sbin/nologin jobs-watcher 2>/dev/null || true; fi
echo -e "${GREEN}[complete]${NC} group jobs-watcher" | tee -a "$LOG_FILE"
echo -e "${BLUE}▶ ensure /opt/srv ${GRAY}[incomplete]${NC}" | tee -a "$LOG_FILE"
${SUDO} mkdir -p "$OPT_DST" "$SRV_ASSET"
${SUDO} chown jobs-watcher:jobs-watcher "$OPT_DST" "$SRV_ASSET" || true
${SUDO} chmod 0750 "$OPT_DST"; ${SUDO} chmod 0755 "$SRV_ASSET" || true
echo -e "${GREEN}[complete]${NC} /opt /srv isolated" | tee -a "$LOG_FILE"
echo -e "${BLUE}▶ git archive HEAD → $OPT_DST ${GRAY}[incomplete]${NC}" | tee -a "$LOG_FILE"
${SUDO} rm -rf "${OPT_DST:?}"/* 2>/dev/null || true; ${SUDO} mkdir -p "$OPT_DST"
${SUDO} -u jobs-watcher bash -c "git -C $ROOT_DIR archive --format=tar HEAD | tar -x -C $OPT_DST" 2>&1 | tee -a "$LOG_FILE" || true
echo -e "${BLUE}▶ nvm 22.12 @ $OPT_DST/.nvm ${GRAY}[incomplete]${NC}" | tee -a "$LOG_FILE"
if [ ! -x "$OPT_DST/.nvm/versions/node/v22.12.0/bin/node" ]; then
  ${SUDO} -u jobs-watcher bash -c "export NVM_DIR=$OPT_DST/.nvm; curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash" 2>&1 | tee -a "$LOG_FILE" || true
  ${SUDO} -u jobs-watcher bash -c "export NVM_DIR=$OPT_DST/.nvm; [ -s \$NVM_DIR/nvm.sh ] && . \$NVM_DIR/nvm.sh; nvm install 22.12.0" 2>&1 | tee -a "$LOG_FILE" || true
fi
echo -e "${GREEN}[complete]${NC} nvm 22.12" | tee -a "$LOG_FILE"
echo -e "${BLUE}▶ npm ci + build @ $OPT_DST ${GRAY}[incomplete]${NC}" | tee -a "$LOG_FILE"
${SUDO} -u jobs-watcher bash -c "cd $OPT_DST && export NVM_DIR=$OPT_DST/.nvm; [ -s \$NVM_DIR/nvm.sh ] && . \$NVM_DIR/nvm.sh; npm ci --omit=dev" 2>&1 | tee -a "$LOG_FILE" || true
${SUDO} -u jobs-watcher bash -c "cd $OPT_DST && export NVM_DIR=$OPT_DST/.nvm; [ -s \$NVM_DIR/nvm.sh ] && . \$NVM_DIR/nvm.sh; npm run build" 2>&1 | tee -a "$LOG_FILE" || true
${SUDO} chmod 0750 "$OPT_DST" || true
${SUDO} chown -R jobs-watcher:jobs-watcher "$OPT_DST/dist" "$OPT_DST/node_modules" 2>/dev/null || true
echo -e "${GREEN}[complete]${NC} npm ci + build" | tee -a "$LOG_FILE"
if [ ! -f "$SERVICE_SRC" ]; then echo -e "${RED}[exit 1]${NC} Service source not found: $SERVICE_SRC" | tee -a "$LOG_FILE"; exit 1; fi
echo -e "${BLUE}▶ copy service files ${GRAY}[incomplete]${NC}" | tee -a "$LOG_FILE"
${SUDO} cp -f "$SERVICE_SRC" "$SERVICE_DST"; ${SUDO} chmod 0640 "$SERVICE_DST" || true; ${SUDO} chown root:root "$SERVICE_DST" || true
if [ -f "$FETCH_SERVICE_SRC" ]; then ${SUDO} cp -f "$FETCH_SERVICE_SRC" "$FETCH_SERVICE_DST"; ${SUDO} chmod 0640 "$FETCH_SERVICE_DST" || true; fi
if [ -f "$FETCH_TIMER_SRC" ]; then ${SUDO} cp -f "$FETCH_TIMER_SRC" "$FETCH_TIMER_DST"; ${SUDO} chmod 0640 "$FETCH_TIMER_DST" || true; fi
echo -e "${GREEN}[complete]${NC} service files" | tee -a "$LOG_FILE"
echo -e "${BLUE}▶ copy env → $ENV_DST ${GRAY}[incomplete]${NC}" | tee -a "$LOG_FILE"
TMPFILE=$(mktemp /tmp/jobs-watcher.env.XXXX); cp "$ENV_FILE" "$TMPFILE"; ${SUDO} mv "$TMPFILE" "$ENV_DST"
if ${SUDO} chown root:jobs-watcher "$ENV_DST" 2>/dev/null; then echo -e "${GREEN}[complete]${NC} env $ENV_DST root:jobs-watcher" | tee -a "$LOG_FILE"; else ${SUDO} chown root:root "$ENV_DST" || true; fi
${SUDO} chmod 0640 "$ENV_DST" || true
echo -e "${BLUE}▶ daemon-reload + enable ${GRAY}[incomplete]${NC}" | tee -a "$LOG_FILE"
${SUDO} systemctl daemon-reload 2>&1 | tee -a "$LOG_FILE" || true
${SUDO} systemctl enable --now jobs-watcher.service 2>&1 | tee -a "$LOG_FILE" || true
${SUDO} systemctl enable --now jobs-watcher-fetch.service 2>&1 | tee -a "$LOG_FILE" || true
${SUDO} systemctl enable --now jobs-watcher-fetch.timer 2>&1 | tee -a "$LOG_FILE" || true
${SUDO} systemctl restart jobs-watcher.service 2>&1 | tee -a "$LOG_FILE" || true
echo -e "${GREEN}[complete]${NC} install ${GREEN}[exit 0]${NC} $(date)" | tee -a "$LOG_FILE"
