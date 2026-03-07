#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

LOG_DIR="$ROOT_DIR/logs"
mkdir -p "$LOG_DIR"
STATE_LOG="$LOG_DIR/ll-scheduled-cycle.log"

stamp() {
  date -Iseconds
}

echo "[$(stamp)] [ll-cycle] start" | tee -a "$STATE_LOG"

SUPERVISOR_PID_FILE="$LOG_DIR/infra-supervisor.pid"
SERVICE_PID_FILE="$LOG_DIR/data-listening.pid"

is_running_pid_file() {
  local pid_file="$1"
  if [ ! -f "$pid_file" ]; then
    return 1
  fi
  local pid
  pid="$(tr -d '[:space:]' < "$pid_file")"
  if [ -z "$pid" ]; then
    return 1
  fi
  kill -0 "$pid" 2>/dev/null
}

if is_running_pid_file "$SUPERVISOR_PID_FILE"; then
  echo "[$(stamp)] [ll-cycle] supervisor=UP" | tee -a "$STATE_LOG"
else
  echo "[$(stamp)] [ll-cycle] supervisor=DOWN -> autostart" | tee -a "$STATE_LOG"
  npm run ll:infra:autostart >> "$STATE_LOG" 2>&1 || true
fi

if is_running_pid_file "$SERVICE_PID_FILE"; then
  echo "[$(stamp)] [ll-cycle] corepipeline=UP" | tee -a "$STATE_LOG"
else
  echo "[$(stamp)] [ll-cycle] corepipeline=DOWN (supervisor will recover)" | tee -a "$STATE_LOG"
fi

npm run ll:infra:monitor >> "$STATE_LOG" 2>&1 || true
npm run ll:daily:feedback:baseline >> "$STATE_LOG" 2>&1 || true
bash "$ROOT_DIR/scripts/ll-notify-latest-cases.sh" >> "$STATE_LOG" 2>&1 || true

echo "[$(stamp)] [ll-cycle] done" | tee -a "$STATE_LOG"
