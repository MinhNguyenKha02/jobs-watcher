#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

LOG_DIR="$ROOT_DIR/logs"
REPORT_DIR="$LOG_DIR/feedback-reports"
SUPERVISOR_PID_FILE="$LOG_DIR/infra-supervisor.pid"
SERVICE_PID_FILE="$LOG_DIR/data-listening.pid"
LATEST_CASES_FILE="$REPORT_DIR/daily-cases-latest.json"

status_for_pid_file() {
  local label="$1"
  local pid_file="$2"

  if [ ! -f "$pid_file" ]; then
    echo "$label: DOWN (missing pid file)"
    return
  fi

  local pid
  pid="$(tr -d '[:space:]' < "$pid_file")"

  if [ -z "$pid" ]; then
    echo "$label: DOWN (empty pid)"
    return
  fi

  if kill -0 "$pid" 2>/dev/null; then
    local started
    started="$(ps -p "$pid" -o lstart= 2>/dev/null || true)"
    echo "$label: UP pid=$pid started=${started:-unknown}"
  else
    echo "$label: DOWN (stale pid=$pid)"
  fi
}

echo "=== Infra Monitor $(date -Iseconds) ==="
status_for_pid_file "supervisor" "$SUPERVISOR_PID_FILE"
status_for_pid_file "corepipeline" "$SERVICE_PID_FILE"

echo "memory_mb=$(free -m | awk 'NR==2{print $3}')"
echo "swap_used_mb=$(free -m | awk 'NR==3{print $3}')"
cpu_percent="$(top -bn1 | grep 'Cpu(s)' | sed 's/.*, *\([0-9.]*\)%* id.*/\1/' | awk '{print 100 - $1}')"
echo "cpu_percent=$cpu_percent"

process_count="$(pgrep -f 'data-listening.ts --adapter=hybrid' \
  | xargs -r ps -o pgid= -p \
  | awk '{print $1}' \
  | sort -u \
  | wc -l \
  | tr -d '[:space:]')"
echo "process_count=$process_count"

if [ -f "$LATEST_CASES_FILE" ]; then
  echo "cases_latest=$LATEST_CASES_FILE"
  node -e "
const fs = require('fs');
const data = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
console.log('verdict=' + (data.verdict || 'unknown'));
const count = Array.isArray(data.cases) ? data.cases.length : 0;
console.log('cases=' + count);
if (count > 0) {
  const top = data.cases.slice(0, 5).map((c) => c.case + ':' + c.severity).join(', ');
  console.log('top=' + top);
}
" "$LATEST_CASES_FILE"
else
  echo "cases_latest=missing"
fi
