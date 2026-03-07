#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

LOG_DIR="$ROOT_DIR/logs"
mkdir -p "$LOG_DIR"

SUPERVISOR_PID_FILE="$LOG_DIR/infra-supervisor.pid"
SUPERVISOR_LOG_FILE="$LOG_DIR/infra-supervisor.log"

if [ -f "$SUPERVISOR_PID_FILE" ]; then
  existing_pid="$(tr -d '[:space:]' < "$SUPERVISOR_PID_FILE")"
  if [ -n "$existing_pid" ] && kill -0 "$existing_pid" 2>/dev/null; then
    echo "[infra-autostart] supervisor already running pid=$existing_pid"
    exit 0
  fi
fi

nohup bash "$ROOT_DIR/scripts/infra-supervisor.sh" >> "$SUPERVISOR_LOG_FILE" 2>&1 &
new_pid=$!

echo "$new_pid" > "$SUPERVISOR_PID_FILE"
echo "[infra-autostart] supervisor started pid=$new_pid"
