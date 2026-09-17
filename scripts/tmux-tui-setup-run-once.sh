#!/bin/bash

################################################################################
# Tmux Setup Script for Ops TUI - 5-Pane PA-PE/PB-PE/PC-PD GH-Dark
#
# Layout (Option A full-width bottom 17%):
#   ┌──────────────────┬──────────────────┐
#   │ PA stdout h32    │ PE stderr h40    │  top PE=PA+PB span
#   │   96x32 0,0      │  64x40 96,0      │  w 60% | 40%
#   ├──────────────────┤                  │
#   │ PB stdin h8      │                  │  96x8 0,32 2-line
#   ├──────────────────┴──────────────────┤
#   │ PC tui-poll 96x8 │ PD daemon-poll   │  bottom h8 full-width
#   │  60% 0,40        │  40% 64x8 96,40  │  4-line compact
#   └──────────────────┴──────────────────┘
#   160×48 Tc GH-Dark 38;2 peekIds 19ee…job-N 5× midTruncate 11
#
# Usage:
#   ./scripts/tmux-tui-setup-run-once.sh [--dev] [--purge] [--auto-kill]
################################################################################

set -euo pipefail
IS_DEV=false; PURGE=false; AUTO_KILL=false; for arg in "$@"; do case "$arg" in --dev) IS_DEV=true;; --purge) PURGE=true;; --auto-kill) AUTO_KILL=true;; esac; done
if [[ "$IS_DEV" != "true" && ! -d "/opt/jobs-watcher" ]]; then echo -e "\x1b[38;2;210;153;34m[TMUX] /opt/jobs-watcher not exists (need --dev or /opt)\x1b[0m"; exit 0; fi
if [[ "$IS_DEV" == "true" ]]; then PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"; ENV_SRC=".env"
else PROJECT_ROOT="/opt/jobs-watcher"; ENV_SRC=".env.production"; export NVM_DIR="/opt/jobs-watcher/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
fi
# source env file only — no inline UDS/IPC defaults
set -a; [ -f "$PROJECT_ROOT/$ENV_SRC" ] && . "$PROJECT_ROOT/$ENV_SRC" 2>/dev/null || [ -f "$ENV_SRC" ] && . "$ENV_SRC" 2>/dev/null || true; set +a
if [ -z "${UDS_SOCKET_PATH:-}" ] || [ -z "${TUI_SHARED_STATE_PATH:-}" ]; then echo -e "\x1b[38;2;248;81;73m[TMUX] missing UDS_SOCKET_PATH or TUI_SHARED_STATE_PATH in $ENV_SRC\x1b[0m"; exit 1; fi
LOG_FILE_RENDER="${PROJECT_ROOT}/tui-logs-render.jsonl"
LOG_FILE_ACTION="${PROJECT_ROOT}/tui-logs-action.jsonl"
export TMUX_TMPDIR="${XDG_RUNTIME_DIR:-/tmp}/tmux"
mkdir -p "$TMUX_TMPDIR"; chmod 700 "$TMUX_TMPDIR" 2>/dev/null || true
if [[ "$PURGE" == "true" ]]; then
  # --purge resets logs + IPC state (must run before session create at new-session/send-keys below).
  # PA (tui:stdout, first send-keys) recreates the IPC file via ensureSharedStateFile(),
  # so PB/PC observe clean defaults; non-purge reruns preserve the file (restore path).
  if [[ "$IS_DEV" == "true" ]]; then rm -f "$TUI_SHARED_STATE_PATH" "$TUI_SHARED_STATE_PATH.lock" "$TUI_SHARED_STATE_PATH.tmp" "$PROJECT_ROOT"/tui-logs-*.jsonl 2>/dev/null || true
  else sudo -u jobs-watcher rm -f "$TUI_SHARED_STATE_PATH" "$TUI_SHARED_STATE_PATH.lock" "$TUI_SHARED_STATE_PATH.tmp" "$PROJECT_ROOT"/tui-logs-*.jsonl 2>/dev/null || true
  fi
fi
if [[ "$IS_DEV" != "true" ]] && { [ "$(id -u)" -ne 997 ] || [ "$(id -gn)" != "jobs-watcher" ]; }; then echo -e "\x1b[38;2;210;153;34m[WARN] not 1004/997 → sudo -u jobs-watcher\x1b[0m"; sudo -v || exit 1; fi
if [[ "$IS_DEV" == "true" ]]; then RUN_AS=""; else RUN_AS="sudo -u jobs-watcher"; fi
export UDS_SOCKET_PATH
export TUI_SHARED_STATE_PATH
SESSION_NAME="jobs"
if ! command -v tmux >/dev/null 2>&1; then echo "tmux not found"; exit 1; fi
if ! command -v node >/dev/null 2>&1; then echo "node not found"; exit 1; fi
if [ ! -d "$PROJECT_ROOT/dist" ]; then echo -e "\x1b[38;2;210;153;34m[WARN] $PROJECT_ROOT/dist missing → building\x1b[0m"; if [[ -z "$RUN_AS" ]]; then bash -c "cd $PROJECT_ROOT && npm run build" >/dev/null 2>&1 || true; else $RUN_AS bash -c "cd $PROJECT_ROOT && npm run build" >/dev/null 2>&1 || true; fi; fi
# --- stuck-protection: cross-socket sweep (refuse+list, or --auto-kill) ---
# The classic stuck state: a live `jobs` session on another socket dir (or
# socketless orphan TUI procs) while this run builds a duplicate stack.
SOCKETS=()
[[ -n "${TMUX_TMPDIR:-}" ]] && SOCKETS+=("$TMUX_TMPDIR/default")
for d in /tmp/tmux-1000 /run/user/1000/tmux/tmux-1000; do
  [[ -e "$d/default" ]] && SOCKETS+=("$d/default")
done
LIVE_SESS=()
for s in ${SOCKETS[@]+"${SOCKETS[@]}"}; do
  if tmux -S "$s" has-session -t "$SESSION_NAME" 2>/dev/null; then LIVE_SESS+=("$s"); fi
done
if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
  already=0
  for s in ${LIVE_SESS[@]+"${LIVE_SESS[@]}"}; do [[ "$s" == "(default)" ]] && already=1; done
  [[ "$already" -eq 0 ]] && LIVE_SESS+=("(default)")
fi
ORPHANS="$(pgrep -af 'tui:tui-poll|tui:daemon-poll|tui:stdout|tui:stdin' 2>/dev/null || true)"
if [[ "${#LIVE_SESS[@]}" -gt 0 || -n "$ORPHANS" ]]; then
  echo -e "\x1b[38;2;210;153;34m[TMUX] live duplicates found:\x1b[0m"
  for s in ${LIVE_SESS[@]+"${LIVE_SESS[@]}"}; do echo -e "\x1b[38;2;210;153;34m[TMUX] session jobs on socket $s\x1b[0m"; done
  [[ -n "$ORPHANS" ]] && echo "$ORPHANS" | sed 's/^/\x1b[38;2;210;153;34m[TMUX] orphan proc: /' | sed 's/$/\x1b[0m/'
  if [[ "$AUTO_KILL" != "true" ]]; then
    echo -e "\x1b[38;2;248;81;73m[TMUX] refuse: rerun with --auto-kill to kill them first\x1b[0m"
    exit 1
  fi
  echo -e "\x1b[38;2;210;153;34m[TMUX] --auto-kill: killing duplicates (TERM, 5s grace, then KILL)...\x1b[0m"
  for s in ${LIVE_SESS[@]+"${LIVE_SESS[@]}"}; do
    if [[ "$s" == "(default)" ]]; then tmux kill-session -t "$SESSION_NAME" 2>/dev/null || true
    else tmux -S "$s" kill-session -t "$SESSION_NAME" 2>/dev/null || true; fi
    echo -e "\x1b[38;2;210;153;34m[TMUX] killed session jobs on $s\x1b[0m"
  done
  if [[ -n "$ORPHANS" ]]; then
    while IFS= read -r line; do
      pid="${line%% *}"
      owner="$(ps -o user= -p "$pid" 2>/dev/null | tr -d ' ' || true)"
      if [[ "$owner" == "root" && "$(id -u)" -ne 0 ]]; then
        echo -e "\x1b[38;2;248;81;73m[TMUX] skip root-owned pid $pid (needs sudo kill $pid)\x1b[0m"
        continue
      fi
      kill "$pid" 2>/dev/null || true
    done <<< "$ORPHANS"
    for i in 1 2 3 4 5; do
      REM="$(pgrep -f 'tui:tui-poll|tui:daemon-poll|tui:stdout|tui:stdin' 2>/dev/null || true)"
      [[ -z "$REM" ]] && break
      [[ "$i" -eq 5 ]] && echo "$REM" | while IFS= read -r line; do kill -9 "${line%% *}" 2>/dev/null || true; done
      sleep 1
    done
    echo -e "\x1b[38;2;210;153;34m[TMUX] orphan TUI procs cleared\x1b[0m"
  fi
  sleep 1
fi
# --- stuck-protection: port pre-checks ---
if ss -ltn 2>/dev/null | grep -q ':9091 '; then
  echo -e "\x1b[38;2;248;81;73m[TMUX] refuse: 9091 listening (stale tui:stdout?) — stop it or rerun with --auto-kill\x1b[0m"
  exit 1
fi
echo -e "\x1b[38;2;210;153;34m[TMUX] pre-check: 9091 free\x1b[0m"
if ! curl -s --connect-timeout 2 http://127.0.0.1:9090/health >/dev/null 2>&1; then
  echo -e "\x1b[38;2;210;153;34m[TMUX] WARN: daemon 9090 not up (PC will show ERR until daemon starts)\x1b[0m"
else
  echo -e "\x1b[38;2;210;153;34m[TMUX] pre-check: daemon 9090 up\x1b[0m"
fi
tmux set -g default-terminal "tmux-256color" 2>/dev/null || tmux set -g default-terminal "screen-256color" 2>/dev/null || true
tmux set -ga terminal-overrides ",xterm-256color:Tc,*-256color:Tc,alacritty:Tc" 2>/dev/null || true
tmux set -g xterm-keys on 2>/dev/null || true
tmux set -g focus-events on 2>/dev/null || true
tmux set -gs escape-time 0 2>/dev/null || true
tmux set -g allow-passthrough on 2>/dev/null || true
tmux set -g set-clipboard on 2>/dev/null || true
tmux set -g pane-base-index 0 2>/dev/null || true
tmux set -g base-index 0 2>/dev/null || true
# 5-pane Option A full-width bottom 17% — PA 60% h32 | PE 40% h40=PA+PB span / PB h8 2-line / PC 60% h8 | PD 40% h8
# bottom swap: PC left (daemon-poll 9090) | PD right (tui-poll 9091)
# pane_id stable: avoid pane_index renumber after -h split (was 0.1→PE, 0.2→bottom)
# split-window -P -F "#{pane_id}" prints pane_id %N; -Pf is -P -f + shell cmd (bug -> dead #{pane_id} pane)
tmux new-session -d -s "$SESSION_NAME" -x 160 -y 48
BOTTOM=$(tmux split-window -v -P -F "#{pane_id}" -t "$SESSION_NAME:0.0" -p 17)           # bottom h8 full-width
PE=$(tmux split-window -h -P -F "#{pane_id}" -t "$SESSION_NAME:0.0" -p 40)             # top PE 40% span
PB=$(tmux split-window -v -P -F "#{pane_id}" -t "$SESSION_NAME:0.0" -p 22)             # left PB h8 2-line
PD=$(tmux split-window -h -P -F "#{pane_id}" -t "$BOTTOM" -p 40)                       # bottom PD 40% (BOTTOM stays PC 60%)
# STD hygiene: PA stdout P0 tui:stdout 0.0, PB stdin raw P2 tui:stdin PB, PE stderr P1 tail inline PE, PC 3s P3 tui:daemon-poll 9090 BOTTOM, PD 1s P4 tui:tui-poll 9091 PD
tmux send-keys -t "$SESSION_NAME:0.0" "$RUN_AS bash -c \"cd $PROJECT_ROOT && npm run tui:stdout 2>$LOG_FILE_RENDER\"" C-m
tmux send-keys -t "$PE" "$RUN_AS bash -c \"tail -f -n +1 $LOG_FILE_RENDER $LOG_FILE_ACTION 2>/dev/null | npx pino-pretty 2>/dev/null || cat\"" C-m
tmux send-keys -t "$PB" "$RUN_AS bash -c \"cd $PROJECT_ROOT && npm run tui:stdin 2>$LOG_FILE_ACTION\"" C-m
tmux send-keys -t "$BOTTOM" "$RUN_AS bash -c \"cd $PROJECT_ROOT && npm run tui:daemon-poll\"" C-m
tmux send-keys -t "$PD" "$RUN_AS bash -c \"cd $PROJECT_ROOT && npm run tui:tui-poll\"" C-m
tmux set-window-option -t "$SESSION_NAME:0" mode-keys vi
tmux select-pane -t "$PB"
sleep 3
if tmux capture-pane -t "$SESSION_NAME:0.0" -p -e 2>/dev/null | grep -q $'\x1b\['; then :; else echo -e "\x1b[38;2;210;153;34m[WARN] ANSI stripped in PA\x1b[0m"; fi
if [[ "$IS_DEV" != "true" ]]; then PANE_OWNER=$(ps -o user= -p $(tmux list-panes -t "$PB" -F "#{pane_pid}" 2>/dev/null | head -1) 2>/dev/null | tr -d ' '); if [ "$PANE_OWNER" != "jobs-watcher" ]; then echo -e "\x1b[38;2;248;81;73m[TMUX] unexpected $PANE_OWNER expected jobs-watcher 997/1004\x1b[0m"; fi; fi
# --- stuck-protection: post-start verify (rollback on fail, never a half-built stack) ---
echo -e "\x1b[38;2;210;153;34m[TMUX] post-check: 5 panes alive + 9091 health (10s budget)...\x1b[0m"
OK=false
for i in $(seq 1 10); do
  DEAD="$(tmux list-panes -t "$SESSION_NAME" -F '#{pane_dead}' 2>/dev/null | grep -c '^1$' || true)"
  if [[ "$DEAD" == "0" ]] && curl -s --connect-timeout 2 http://127.0.0.1:9091/health >/dev/null 2>&1; then OK=true; break; fi
  sleep 1
done
if [[ "$OK" != "true" ]]; then
  echo -e "\x1b[38;2;248;81;73m[TMUX] FAIL: stack unhealthy — rolling back (kill session)\x1b[0m"
  tmux kill-session -t "$SESSION_NAME" 2>/dev/null || true
  exit 1
fi
echo -e "\x1b[38;2;210;153;34m[TMUX] post-check: 5 panes alive, 9091 ok — attaching\x1b[0m"
tmux attach-session -t "$SESSION_NAME"
