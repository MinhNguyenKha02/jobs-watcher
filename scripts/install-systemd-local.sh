#!/usr/bin/env bash
set -euo pipefail

LOG_DIR="e2e-output"
LOG_FILE="$LOG_DIR/systemd-install.log"
mkdir -p "$LOG_DIR"
echo "=== jobs-watcher systemd install started $(date) ===" | tee -a "$LOG_FILE"

ENV_FILE_ARG="${1:-}" # optional first arg: path to env file
ENV_FILE="${ENV_FILE_ARG:-.env.production}"
if [ ! -f "$ENV_FILE" ]; then
  if [ -f .env ]; then
    ENV_FILE=".env"
    echo "Defaulting to .env" | tee -a "$LOG_FILE"
  else
    echo "Env file not found: tried $ENV_FILE and .env" | tee -a "$LOG_FILE"
    echo "Creating empty env at /tmp/jobs-watcher.env" | tee -a "$LOG_FILE"
    echo "# jobs-watcher empty env" > /tmp/jobs-watcher.env
    ENV_FILE="/tmp/jobs-watcher.env"
  fi
fi

SERVICE_SRC="scripts/systemd/jobs-watcher.service"
SERVICE_DST="/etc/systemd/system/jobs-watcher.service"
ENV_DST="/etc/jobs-watcher.env"

SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  SUDO="sudo"
fi

echo "Ensuring group 'jobs-watcher' exists (may require sudo)" | tee -a "$LOG_FILE"
${SUDO} sh -c 'groupadd -f jobs-watcher 2>/dev/null || true' || true

if [ ! -f "$SERVICE_SRC" ]; then
  echo "Service source not found: $SERVICE_SRC" | tee -a "$LOG_FILE"
  exit 1
fi

echo "Copying service file to $SERVICE_DST" | tee -a "$LOG_FILE"
${SUDO} cp -f "$SERVICE_SRC" "$SERVICE_DST"
${SUDO} chmod 0640 "$SERVICE_DST" || true

echo "Copying env file to $ENV_DST" | tee -a "$LOG_FILE"
TMPFILE=$(mktemp /tmp/jobs-watcher.env.XXXX)
cp "$ENV_FILE" "$TMPFILE"
${SUDO} mv "$TMPFILE" "$ENV_DST"

if ${SUDO} chown root:jobs-watcher "$ENV_DST" 2>/dev/null; then
  echo "Set owner root:jobs-watcher for $ENV_DST" | tee -a "$LOG_FILE"
else
  ${SUDO} chown root:root "$ENV_DST" || true
  echo "Set owner root:root for $ENV_DST" | tee -a "$LOG_FILE"
fi
${SUDO} chmod 0640 "$ENV_DST" || true

echo "Reloading systemd and enabling service" | tee -a "$LOG_FILE"
${SUDO} systemctl daemon-reload 2>&1 | tee -a "$LOG_FILE" || true
${SUDO} systemctl enable --now jobs-watcher.service 2>&1 | tee -a "$LOG_FILE" || true

echo "=== jobs-watcher systemd install finished $(date) ===" | tee -a "$LOG_FILE"
