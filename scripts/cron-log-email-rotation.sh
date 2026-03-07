#!/usr/bin/env bash
# cron-log-email-rotation.sh
# Rotates logs and emails after Gmail API fetch. To be run after fetch-raw-emails.ts completes.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$ROOT_DIR/logs"
EMAIL_DIR="$ROOT_DIR/src/db/raw-ingest"

# Rotate logs older than 30 days
echo "[rotation] Cleaning logs older than 30 days..."
find "$LOG_DIR" -type f -name "*.log" -mtime +30 -delete

# Rotate emails older than 30 days
if [ -d "$EMAIL_DIR" ]; then
  echo "[rotation] Cleaning emails older than 30 days..."
  find "$EMAIL_DIR" -type f -mtime +30 -delete
fi

echo "[rotation] Log and email rotation complete."
