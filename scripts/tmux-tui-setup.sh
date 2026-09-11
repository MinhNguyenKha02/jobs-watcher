#!/bin/bash

################################################################################
# Tmux Setup Script for Ops TUI - 5-Pane PA-PE/PB-PE/PC-PD GH-Dark
#
# Layout (Option A full-width bottom 25%):
#   ┌──────────────────┬──────────────────┐
#   │ PA stdout h28    │ PE stderr h36    │  top PE=PA+PB span
#   │   96x28 0,0      │  64x36 96,0      │  w 60% | 40%
#   ├──────────────────┤                  │
#   │ PB stdin h8      │                  │  96x8 0,28 2-line
#   ├──────────────────┴──────────────────┤
#   │ PC tui-poll 96x12│ PD daemon-poll   │  bottom h12 full-width
#   │  60% 0,36        │  40% 64x12 96,36 │  4-line compact
#   └──────────────────┴──────────────────┘
#   160×48 Tc GH-Dark 38;2 peekIds 19ee…job-N 5× midTruncate 11
#
# Usage:
#   ./scripts/tmux-tui-setup.sh [--dev] [--purge]
################################################################################

set -euo pipefail
IS_DEV=false; PURGE=false; for arg in "$@"; do case "$arg" in --dev) IS_DEV=true;; --purge) PURGE=true;; esac; done
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
if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then tmux kill-session -t "$SESSION_NAME" 2>/dev/null || true; sleep 1; fi
tmux set -g default-terminal "tmux-256color" 2>/dev/null || tmux set -g default-terminal "screen-256color" 2>/dev/null || true
tmux set -ga terminal-overrides ",xterm-256color:Tc,*-256color:Tc,alacritty:Tc" 2>/dev/null || true
tmux set -g xterm-keys on 2>/dev/null || true
tmux set -g focus-events on 2>/dev/null || true
tmux set -gs escape-time 0 2>/dev/null || true
tmux set -g allow-passthrough on 2>/dev/null || true
tmux set -g set-clipboard on 2>/dev/null || true
tmux set -g pane-base-index 0 2>/dev/null || true
tmux set -g base-index 0 2>/dev/null || true
# 5-pane Option A full-width bottom 25% — PA 60% h28 | PE 40% h36=PA+PB span / PB h8 2-line / PC 60% h12 | PD 40% h12
# pane_id stable: avoid pane_index renumber after -h split (was 0.1→PE, 0.2→bottom)
# split-window -P -F "#{pane_id}" prints pane_id %N; -Pf is -P -f + shell cmd (bug -> dead #{pane_id} pane)
tmux new-session -d -s "$SESSION_NAME" -x 160 -y 48
BOTTOM=$(tmux split-window -v -P -F "#{pane_id}" -t "$SESSION_NAME:0.0" -p 25)           # bottom h12 full-width
PE=$(tmux split-window -h -P -F "#{pane_id}" -t "$SESSION_NAME:0.0" -p 40)             # top PE 40% span
PB=$(tmux split-window -v -P -F "#{pane_id}" -t "$SESSION_NAME:0.0" -p 22)             # left PB h8 2-line
PD=$(tmux split-window -h -P -F "#{pane_id}" -t "$BOTTOM" -p 40)                       # bottom PD 40% (BOTTOM stays PC 60%)
# STD hygiene: PA stdout P0 tui:stdout 0.0, PB stdin raw P2 tui:stdin PB, PE stderr P1 tail inline PE, PC 1s P3 tui:tui-poll 9091 BOTTOM, PD 5s P4 tui:daemon-poll 9090 PD
tmux send-keys -t "$SESSION_NAME:0.0" "$RUN_AS bash -c \"cd $PROJECT_ROOT && npm run tui:stdout 2>$LOG_FILE_RENDER\"" C-m
tmux send-keys -t "$PE" "$RUN_AS bash -c \"tail -f -n +1 $LOG_FILE_RENDER $LOG_FILE_ACTION 2>/dev/null | npx pino-pretty 2>/dev/null || cat\"" C-m
tmux send-keys -t "$PB" "$RUN_AS bash -c \"cd $PROJECT_ROOT && npm run tui:stdin 2>$LOG_FILE_ACTION\"" C-m
tmux send-keys -t "$BOTTOM" "$RUN_AS bash -c \"cd $PROJECT_ROOT && npm run tui:tui-poll\"" C-m
tmux send-keys -t "$PD" "$RUN_AS bash -c \"cd $PROJECT_ROOT && npm run tui:daemon-poll\"" C-m
tmux set-window-option -t "$SESSION_NAME:0" mode-keys vi
tmux select-pane -t "$PB"
sleep 3
if tmux capture-pane -t "$SESSION_NAME:0.0" -p -e 2>/dev/null | grep -q $'\x1b\['; then :; else echo -e "\x1b[38;2;210;153;34m[WARN] ANSI stripped in PA\x1b[0m"; fi
if [[ "$IS_DEV" != "true" ]]; then PANE_OWNER=$(ps -o user= -p $(tmux list-panes -t "$PB" -F "#{pane_pid}" 2>/dev/null | head -1) 2>/dev/null | tr -d ' '); if [ "$PANE_OWNER" != "jobs-watcher" ]; then echo -e "\x1b[38;2;248;81;73m[TMUX] unexpected $PANE_OWNER expected jobs-watcher 997/1004\x1b[0m"; fi; fi
tmux attach-session -t "$SESSION_NAME"
