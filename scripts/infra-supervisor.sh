#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

LOG_DIR="$ROOT_DIR/logs"
mkdir -p "$LOG_DIR"

SUPERVISOR_PID_FILE="$LOG_DIR/infra-supervisor.pid"
RESTART_LOG_FILE="$LOG_DIR/infra-restarts.log"
SUPERVISOR_LOG_FILE="$LOG_DIR/infra-supervisor.log"

MAX_RESTARTS_WINDOW="${MAX_RESTARTS_WINDOW:-3}"
RESTART_WINDOW_SEC="${RESTART_WINDOW_SEC:-900}"
DEGRADE_SLEEP_SEC="${DEGRADE_SLEEP_SEC:-300}"

printf '%s\n' "$$" > "$SUPERVISOR_PID_FILE"

echo "[infra-supervisor] started pid=$$ at $(date -Iseconds)" | tee -a "$SUPERVISOR_LOG_FILE"

while true; do
  echo "[infra-supervisor] booting core pipeline via npm run serve:hybrid at $(date -Iseconds)" | tee -a "$SUPERVISOR_LOG_FILE"
  set +e
  npm run serve:hybrid >> "$SUPERVISOR_LOG_FILE" 2>&1
  exit_code=$?
  set -e
  now_epoch="$(date +%s)"
  echo "$now_epoch $exit_code" >> "$RESTART_LOG_FILE"

  recent_restarts="$(awk -v since="$((now_epoch - RESTART_WINDOW_SEC))" '$1 >= since {count++} END {print count+0}' "$RESTART_LOG_FILE")"

  if [ "$recent_restarts" -gt "$MAX_RESTARTS_WINDOW" ]; then
    echo "[infra-supervisor] CASE_INFRA_DEGRADE_HOLD restarts=$recent_restarts window=${RESTART_WINDOW_SEC}s sleep=${DEGRADE_SLEEP_SEC}s" | tee -a "$SUPERVISOR_LOG_FILE"
    npm run ll:daily:closeout >> "$SUPERVISOR_LOG_FILE" 2>&1 || true
    P1_QUEUE_LAG_MAX_MS="${P1_QUEUE_LAG_MAX_MS:-300000}" npm run ll:gate:hard >> "$SUPERVISOR_LOG_FILE" 2>&1 || true
    sleep "$DEGRADE_SLEEP_SEC"
  else
    echo "[infra-supervisor] crash-restart backoff=10s" | tee -a "$SUPERVISOR_LOG_FILE"
    sleep 10
  fi
done
