#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

LOG_DIR="$ROOT_DIR/logs"
SUPERVISOR_PID_FILE="$LOG_DIR/infra-supervisor.pid"
SERVICE_PID_FILE="$LOG_DIR/data-listening.pid"

stop_by_pid_file() {
  local label="$1"
  local file="$2"

  if [ ! -f "$file" ]; then
    echo "[$label] pid file missing"
    return
  fi

  local pid
  pid="$(tr -d '[:space:]' < "$file")"

  if [ -z "$pid" ]; then
    echo "[$label] empty pid"
    rm -f "$file"
    return
  fi

  if kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null || true
    sleep 1
    if kill -0 "$pid" 2>/dev/null; then
      kill -9 "$pid" 2>/dev/null || true
    fi
    echo "[$label] stopped pid=$pid"
  else
    echo "[$label] stale pid=$pid"
  fi

  rm -f "$file"
}

stop_by_pid_file "corepipeline" "$SERVICE_PID_FILE"
stop_by_pid_file "supervisor" "$SUPERVISOR_PID_FILE"
