#!/bin/bash
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
tmux new-session -d -s "$SESSION_NAME" -x 160 -y 48
tmux split-window -v -t "$SESSION_NAME:0" -p 25
tmux split-window -h -t "$SESSION_NAME:0.0" -p 40
tmux split-window -v -t "$SESSION_NAME:0.0" -p 22
tmux split-window -h -t "$SESSION_NAME:0.1" -p 40
tmux send-keys -t "$SESSION_NAME:0.0" "$RUN_AS bash -c 'cd $PROJECT_ROOT && npm run render-server 2>$LOG_FILE_RENDER'" C-m
tmux send-keys -t "$SESSION_NAME:0.2" "$RUN_AS bash -c 'tail -f -n +1 $LOG_FILE_RENDER $LOG_FILE_ACTION 2>/dev/null | pino-pretty 2>/dev/null || cat'" C-m
tmux send-keys -t "$SESSION_NAME:0.3" "$RUN_AS bash -c 'cd $PROJECT_ROOT && npm run action-controller 2>$LOG_FILE_ACTION'" C-m
tmux send-keys -t "$SESSION_NAME:0.1" "$RUN_AS bash -c 'cd $PROJECT_ROOT && npx tsx src/infrastructure/inbound/cli/poll-rmq-pane.ts --width 96'" C-m
tmux send-keys -t "$SESSION_NAME:0.4" "$RUN_AS bash -c 'cd $PROJECT_ROOT && npx tsx src/infrastructure/inbound/cli/observability.ts --compact'" C-m
tmux set-window-option -t "$SESSION_NAME:0" mode-keys vi
tmux select-pane -t "$SESSION_NAME:0.3"
sleep 3
if [[ "$IS_DEV" != "true" ]]; then PANE_OWNER=$(ps -o user= -p $(tmux list-panes -t "$SESSION_NAME:0.3" -F "#{pane_pid}" 2>/dev/null | head -1) 2>/dev/null | tr -d ' '); if [ "$PANE_OWNER" != "jobs-watcher" ]; then echo -e "\x1b[38;2;248;81;73m[TMUX] unexpected $PANE_OWNER expected jobs-watcher 997/1004\x1b[0m"; fi; fi
tmux attach-session -t "$SESSION_NAME"
