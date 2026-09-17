#!/bin/bash
# daemon-run-once.sh — single-instance daemon starter (flock) + stuck-protection.
# Refuses a second start (prints holder pid); --auto-kill kills the holder and starts.
# Same runtime body as `npm run daemon` (env, node dist, verify probes, wait).
# Scope isolation: never touches tmux sessions or TUI procs.
# Usage: bash scripts/daemon-run-once.sh [--auto-kill]  (redirect logs at call site:
#   bash scripts/daemon-run-once.sh --auto-kill > daemon_dev_log.text 2>&1 &)

set -euo pipefail
AUTO_KILL=false
for arg in "$@"; do
  case "$arg" in
    --auto-kill) AUTO_KILL=true ;;
    --help|-h) echo "usage: bash scripts/daemon-run-once.sh [--auto-kill]"; exit 0 ;;
    *) echo "[DAEMON] unknown arg: $arg" >&2; exit 2 ;;
  esac
done
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"
LOCK_FILE="${XDG_RUNTIME_DIR:-/tmp}/jobs-watcher-daemon.lock"

kill_pid() {
  local pid="$1" why="$2"
  local owner
  owner="$(ps -o user= -p "$pid" 2>/dev/null | tr -d ' ' || true)"
  [[ -z "$owner" ]] && return 0
  if [[ "$owner" == "root" && "$(id -u)" -ne 0 ]]; then
    echo "[DAEMON] skip root-owned pid $pid ($why) — needs sudo kill $pid"
    return 1
  fi
  echo "[DAEMON] --auto-kill: TERM $pid ($why, owner $owner)..."
  kill "$pid" 2>/dev/null || return 0
  local i
  for i in 1 2 3 4 5; do
    ps -p "$pid" >/dev/null 2>&1 || { echo "[DAEMON] pid $pid stopped"; return 0; }
    sleep 1
  done
  echo "[DAEMON] --auto-kill: KILL $pid (grace expired)..."
  kill -9 "$pid" 2>/dev/null || true
  sleep 1
  ps -p "$pid" >/dev/null 2>&1 && { echo "[DAEMON] FAIL: pid $pid unstoppable" >&2; return 1; }
  echo "[DAEMON] pid $pid stopped"
  return 0
}

exec {LOCK_FD}>"$LOCK_FILE"
if ! flock -n "$LOCK_FD"; then
  HOLDER="$(fuser "$LOCK_FILE" 2>/dev/null || true)"
  echo "[DAEMON] live holder: ${HOLDER:-unknown} (lock $LOCK_FILE)"
  if [[ "$AUTO_KILL" != "true" ]]; then
    echo "[DAEMON] refuse: daemon already running — rerun with --auto-kill to replace it"
    exit 1
  fi
  [[ -z "$HOLDER" ]] && { echo "[DAEMON] FAIL: lock held by unknown holder" >&2; exit 1; }
  for pid in $HOLDER; do
    # fuser may list own shell — never suicide
    [[ "$pid" == "$$" ]] && continue
    kill_pid "$pid" "lock holder" || exit 1
  done
  flock -n "$LOCK_FD" || { echo "[DAEMON] FAIL: lock still held after kill" >&2; exit 1; }
fi
echo "[DAEMON] lock acquired ($LOCK_FILE)"

# source env file only — no inline UDS defaults (same as npm run daemon)
set -a; [ -f .env ] && . ./.env 2>/dev/null || true; set +a
UDS="${UDS_SOCKET_PATH:-}"
HP="${HEALTH_PORT:-9090}"
WP="${WEBHOOK_PORT:-3000}"

# stuck-protection: port/socket pre-checks (a live daemon outside the lock, or leftovers)
if ss -ltn 2>/dev/null | grep -q ":$HP "; then
  echo "[DAEMON] port $HP listening without lock holder"
  if [[ "$AUTO_KILL" != "true" ]]; then
    echo "[DAEMON] refuse: port $HP busy — rerun with --auto-kill to clear it"
    exit 1
  fi
  LEFTOVER="$(pgrep -f 'dist/src/index\.js' 2>/dev/null || true)"
  if [[ -z "$LEFTOVER" ]]; then
    echo "[DAEMON] FAIL: port $HP busy but no daemon proc found" >&2
    exit 1
  fi
  for pid in $LEFTOVER; do kill_pid "$pid" "port $HP holder" || exit 1; done
fi
if [[ -n "$UDS" && -S "$UDS" ]]; then
  echo "[DAEMON] WARN: stale UDS socket present ($UDS) — daemon recreates on start"
fi
echo "[DAEMON] pre-check: port $HP free, lock held — starting"

NODE_BIN="/home/minh-nguyen/.nvm/versions/node/v22.12.0/bin/node"
[ -x "$NODE_BIN" ] || NODE_BIN="node"
"$NODE_BIN" "$PROJECT_ROOT/dist/src/index.js" & DAEMON_PID=$!
sleep 3
echo "[DAEMON] pid $DAEMON_PID ($UDS)"
[ -S "$UDS" ] && echo "[verify] UDS ok ($UDS)" || echo "[verify] UDS pending ($UDS)"
curl -s "http://127.0.0.1:$HP/health" 2>&1 | grep -q ok && echo "[verify] health ok ($HP)" || echo "[verify] health pending ($HP)"
for C in mongo rabbitmq browser scheduler uds webhook; do curl -s "http://127.0.0.1:$HP/metrics" 2>&1 | grep -q "infra_ready{component=\"$C\"} 1" && echo "[verify] infraReady $C 1" || echo "[verify] infraReady $C pending"; done
if curl -s --connect-timeout 2 --fail "http://127.0.0.1:$HP/health" >/dev/null 2>&1; then echo "[verify] probe 127.0.0.1:$HP ok"; else echo "[verify] probe $HP fail"; fi
if curl -s --connect-timeout 2 --fail "http://127.0.0.1:$WP/health" >/dev/null 2>&1; then echo "[verify] probe 127.0.0.1:$WP ok"; elif curl -s "http://127.0.0.1:$HP/metrics" >/dev/null 2>&1; then echo "[verify] probe 127.0.0.1:$WP ok (via metrics)"; else echo "[verify] probe $WP fail"; fi
wait $DAEMON_PID
