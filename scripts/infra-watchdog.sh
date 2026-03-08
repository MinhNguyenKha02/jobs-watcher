#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

LOG_DIR="$ROOT_DIR/logs"
mkdir -p "$LOG_DIR"

WATCHDOG_PID_FILE="$LOG_DIR/infra-watchdog.pid"
WATCHDOG_LOG_FILE="$LOG_DIR/infra-watchdog.log"
SERVICE_PID_FILE="$LOG_DIR/data-listening.pid"
SUPERVISOR_PID_FILE="$LOG_DIR/infra-supervisor.pid"

WATCHDOG_INTERVAL_SEC="${WATCHDOG_INTERVAL_SEC:-20}"
WATCHDOG_WARN_CONSECUTIVE="${WATCHDOG_WARN_CONSECUTIVE:-2}"
WATCHDOG_CRIT_CONSECUTIVE="${WATCHDOG_CRIT_CONSECUTIVE:-4}"
WATCHDOG_SOFT_COOLDOWN_SEC="${WATCHDOG_SOFT_COOLDOWN_SEC:-180}"
WATCHDOG_KILL_GRACE_SEC="${WATCHDOG_KILL_GRACE_SEC:-8}"
WATCHDOG_CPU_WARN_PERCENT="${WATCHDOG_CPU_WARN_PERCENT:-90}"
WATCHDOG_CPU_CRIT_PERCENT="${WATCHDOG_CPU_CRIT_PERCENT:-95}"
MAX_SWAP_USED_MB="${MAX_SWAP_USED_MB:-4608}"
MAX_DISK_PERCENT="${MAX_DISK_PERCENT:-90}"
MAX_SERVICE_PROCS="${MAX_SERVICE_PROCS:-1}"

warn_hits=0
crit_hits=0
last_state="ok"
last_remediation_at=0

log() {
  echo "[infra-watchdog] $(date -Iseconds) $*" >> "$WATCHDOG_LOG_FILE"
}



notify_state() {
  # GUI notification disabled; all alerts are TTY/log-only
  true
}

read_pid_file() {
  local pid_file="$1"
  if [ ! -f "$pid_file" ]; then
    echo ""
    return
  fi
  tr -d '[:space:]' < "$pid_file"
}

is_pid_alive() {
  local pid="$1"
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null
}

ensure_supervisor_running() {
  local pid
  pid="$(read_pid_file "$SUPERVISOR_PID_FILE")"
  if is_pid_alive "$pid"; then
    return
  fi
  log "supervisor is down -> autostart"
  npm run ll:infra:autostart >> "$WATCHDOG_LOG_FILE" 2>&1 || true
}

throttle_corepipeline() {
  local pid="$1"
  if ! is_pid_alive "$pid"; then
    return
  fi

  renice +10 -p "$pid" >/dev/null 2>&1 || true
  if command -v ionice >/dev/null 2>&1; then
    ionice -c3 -p "$pid" >/dev/null 2>&1 || true
  fi
}

graceful_restart_corepipeline() {
  local service_pid="$1"

  if is_pid_alive "$service_pid"; then
    log "remediation=soft-stop pid=$service_pid"
    kill -TERM "$service_pid" >/dev/null 2>&1 || true
    sleep "$WATCHDOG_KILL_GRACE_SEC"
  fi

  if is_pid_alive "$service_pid"; then
    log "remediation=force-kill pid=$service_pid"
    kill -9 "$service_pid" >/dev/null 2>&1 || true
  fi

  pkill -f "data-listening.ts --adapter=hybrid" >/dev/null 2>&1 || true
}

printf '%s\n' "$$" > "$WATCHDOG_PID_FILE"
log "started pid=$$ interval=${WATCHDOG_INTERVAL_SEC}s warn=${WATCHDOG_WARN_CONSECUTIVE} crit=${WATCHDOG_CRIT_CONSECUTIVE}"
notify_state "normal" "watchdog started (24/7 guard active)"

while true; do
  ensure_supervisor_running

  service_pid="$(read_pid_file "$SERVICE_PID_FILE")"
  service_running=0
  if is_pid_alive "$service_pid"; then
    service_running=1
  fi

  cpu_percent="$(top -bn1 | grep 'Cpu(s)' | sed 's/.*, *\([0-9.]*\)%* id.*/\1/' | awk '{print 100 - $1}' || echo 0)"
  cpu_int="$(printf '%.0f' "$cpu_percent" 2>/dev/null || echo 0)"
  swap_used="$(free -m | awk 'NR==3{print $3+0}' || echo 0)"
  disk_percent="$(df -h "$ROOT_DIR" | awk 'NR==2 {gsub(/%/, "", $5); print $5+0}' || echo 0)"
  process_count="$( (pgrep -f 'data-listening.ts --adapter=hybrid' 2>/dev/null || true) | xargs -r ps -o pgid= -p | awk '{print $1}' | sort -u | wc -l | tr -d '[:space:]')"
  if [ -z "$process_count" ]; then
    process_count=0
  fi

  warn_now=0
  crit_now=0
  reasons=()

  if [ "$service_running" -ne 1 ]; then
    crit_now=1
    reasons+=("service_down")
  fi

  if [ "$process_count" -gt "$MAX_SERVICE_PROCS" ]; then
    crit_now=1
    reasons+=("duplicate_procs=$process_count")
  fi

  if [ "$swap_used" -gt "$MAX_SWAP_USED_MB" ]; then
    warn_now=1
    reasons+=("swap=${swap_used}MB")
  fi

  if [ "$disk_percent" -gt "$MAX_DISK_PERCENT" ]; then
    crit_now=1
    reasons+=("disk=${disk_percent}%")
  fi

  if [ "$cpu_int" -ge "$WATCHDOG_CPU_CRIT_PERCENT" ]; then
    crit_now=1
    reasons+=("cpu=${cpu_int}%")
  elif [ "$cpu_int" -ge "$WATCHDOG_CPU_WARN_PERCENT" ]; then
    warn_now=1
    reasons+=("cpu=${cpu_int}%")
  fi

  if [ "$crit_now" -eq 1 ]; then
    crit_hits=$((crit_hits + 1))
    warn_hits=0
  elif [ "$warn_now" -eq 1 ]; then
    warn_hits=$((warn_hits + 1))
    crit_hits=0
  else
    warn_hits=0
    crit_hits=0
  fi

  now_epoch="$(date +%s)"

  if [ "$crit_hits" -ge "$WATCHDOG_CRIT_CONSECUTIVE" ]; then
    state="critical"
  elif [ "$warn_hits" -ge "$WATCHDOG_WARN_CONSECUTIVE" ]; then
    state="warning"
  else
    state="ok"
  fi

  if [ "$state" != "$last_state" ]; then
    case "$state" in
      ok)
        log "state=ok cpu=${cpu_int}% swap=${swap_used}MB disk=${disk_percent}% procs=${process_count}"
        notify_state "normal" "state=OK cpu=${cpu_int}% swap=${swap_used}MB disk=${disk_percent}%"
        ;;
      warning)
        log "state=warning reasons=${reasons[*]}"
        notify_state "normal" "state=WARNING reasons=${reasons[*]}"
        ;;
      critical)
        log "state=critical reasons=${reasons[*]}"
        notify_state "critical" "state=CRITICAL reasons=${reasons[*]}"
        ;;
    esac
    last_state="$state"
  fi

  if [ "$state" = "warning" ] && [ "$service_running" -eq 1 ]; then
    throttle_corepipeline "$service_pid"
  fi

  if [ "$state" = "critical" ] && [ $((now_epoch - last_remediation_at)) -ge "$WATCHDOG_SOFT_COOLDOWN_SEC" ]; then
    last_remediation_at="$now_epoch"
    log "remediation=start cooldown=${WATCHDOG_SOFT_COOLDOWN_SEC}s reasons=${reasons[*]}"
    graceful_restart_corepipeline "$service_pid"
    log "remediation=sleep ${WATCHDOG_SOFT_COOLDOWN_SEC}s"
    sleep "$WATCHDOG_SOFT_COOLDOWN_SEC"
    ensure_supervisor_running
  fi

  sleep "$WATCHDOG_INTERVAL_SEC"
done
