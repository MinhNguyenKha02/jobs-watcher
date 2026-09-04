#!/bin/bash

################################################################################
# Tmux Setup Script for Ops TUI - 5-Pane PA-PE/PB-PE/PC-PD GH-Dark
#
# Layout:
#   ┌──────────────────┬──────────────────┐
#   │ PA stdout h28    │ PE stderr h36    │  top PE=PA+PB
#   │                  │                  │  w 60% | 40%
#   ├──────────────────┤                  │
#   │ PB stdin 2-line  │                  │
#   ├──────────────────┴──────────────────┤
#   │ PC rmq 60% h12   │ PD observe 40%   │  bottom 4-line compact
#   └──────────────────┴──────────────────┘
#   PA 60% h75% PB 25% PC 60% | PD 40%
#
# Usage:
#   ./scripts/tmux-tui-setup.sh
################################################################################

set -e

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SESSION_NAME="jobs"
LOG_FILE_RENDER="${PROJECT_ROOT}/tui-logs-render.jsonl"
LOG_FILE_ACTION="${PROJECT_ROOT}/tui-logs-action.jsonl"

# Set tmux socket directory to avoid /tmp permission issues
export TMUX_TMPDIR="${XDG_RUNTIME_DIR}/tmux"
mkdir -p "$TMUX_TMPDIR"
chmod 700 "$TMUX_TMPDIR"

# Export environment for child processes
export INTERNAL_AUTH_TOKEN="${INTERNAL_AUTH_TOKEN:-temp-dev-token}"
export UDS_SOCKET_PATH="${UDS_SOCKET_PATH:-/run/jobs-watcher/ingest.sock}"
export TUI_SHARED_STATE_PATH="/run/user/$(id -u)/jobs-watcher-tui-state.json"

echo "Validating prerequisites..."
echo ""

if ! command -v node &> /dev/null; then echo "ERROR: Node.js not found"; exit 1; fi
echo "Node.js found: $(node --version)"

if ! command -v npm &> /dev/null; then echo "ERROR: npm not found"; exit 1; fi
echo "npm found"

if ! command -v tmux &> /dev/null; then echo "ERROR: tmux not found"; exit 1; fi
echo "tmux found: $(tmux -V)"

if [ ! -d "$PROJECT_ROOT/dist" ]; then
    echo "Building project..."
    cd "$PROJECT_ROOT" && npm run build > /dev/null 2>&1
fi
echo "Project build found"

if ! grep -q '"render-server"' "$PROJECT_ROOT/package.json"; then
    echo "ERROR: render-server script not found"; exit 1
fi
if ! grep -q '"action-controller"' "$PROJECT_ROOT/package.json"; then
    echo "ERROR: action-controller script not found"; exit 1
fi
echo "npm scripts found"

echo ""
echo "All prerequisites validated"
echo ""

# Kill existing session
if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
    tmux kill-session -t "$SESSION_NAME" 2>/dev/null || true
    sleep 1
fi

cd "$PROJECT_ROOT"

echo "Creating 5-pane TUI session: $SESSION_NAME"
echo ""

# ANSI truecolor guards (GitHub Dark 38;2)
tmux set -g default-terminal "tmux-256color" 2>/dev/null || tmux set -g default-terminal "screen-256color" 2>/dev/null || true
tmux set -ga terminal-overrides ",xterm-256color:Tc,*-256color:Tc,alacritty:Tc" 2>/dev/null || true
tmux set -g xterm-keys on 2>/dev/null || true
tmux set -g focus-events on 2>/dev/null || true
tmux set -gs escape-time 0 2>/dev/null || true
tmux set -g allow-passthrough on 2>/dev/null || true
tmux set -g set-clipboard on 2>/dev/null || true

# 5-pane PA-PE / PB-PE / PC-PD 60/40, PA tall PB 2-line PE=PA+PB span, PC 60% | PD 40% bottom 4-line
tmux new-session -d -s "$SESSION_NAME" -x 160 -y 48
tmux split-window -h -t "$SESSION_NAME:0.0" -p 40
tmux split-window -v -t "$SESSION_NAME:0.0" -p 22
tmux split-window -v -t "$SESSION_NAME:0.1" -p 30
tmux split-window -h -t "$SESSION_NAME:0.3" -p 50

# PA: stdout (render) top-left tall
tmux send-keys -t "$SESSION_NAME:0.0" "npm run render-server 2>'$LOG_FILE_RENDER'" C-m
# PE: stderr (logs) right span PA+PB
tmux send-keys -t "$SESSION_NAME:0.1" "cd '$PROJECT_ROOT' && tail -f -n +1 '$LOG_FILE_RENDER' '$LOG_FILE_ACTION' 2>/dev/null | pino-pretty 2>/dev/null || cat" C-m
# PB: stdin (action) bottom-left 2-line
tmux send-keys -t "$SESSION_NAME:0.2" "UDS_SOCKET_PATH=\"$UDS_SOCKET_PATH\" npm run action-controller 2>'$LOG_FILE_ACTION'" C-m
# PC: rmq consumer 60% bottom-left compact local-only 1s poll
tmux send-keys -t "$SESSION_NAME:0.3" "npx tsx scripts/poll-rmq-pane.ts --width 96" C-m
# PD: observe compact 40% bottom-right 4-line
tmux send-keys -t "$SESSION_NAME:0.4" "cd '$PROJECT_ROOT' && npx tsx src/infrastructure/inbound/cli/observability.ts --compact" C-m

tmux set-window-option -t "$SESSION_NAME:0" mode-keys vi
tmux select-pane -t "$SESSION_NAME:0.2"

echo ""
echo "Validating pane startup (waiting 3 seconds)..."
sleep 3

PANE_0_ACTIVE=$(tmux capture-pane -t "$SESSION_NAME:0.0" -p -e | strings | wc -l)
PANE_1_ACTIVE=$(tmux capture-pane -t "$SESSION_NAME:0.2" -p -e | strings | wc -l)
if tmux capture-pane -t "$SESSION_NAME:0.0" -p -e | grep -q $'\x1b\['; then echo "PA ANSI ok"; else echo "WARNING: ANSI stripped in PA"; fi

if [ "$PANE_0_ACTIVE" -lt 2 ]; then echo "WARNING: Pane 0 may not have started"; fi
if [ "$PANE_1_ACTIVE" -lt 2 ]; then echo "WARNING: Pane 2 may not have started"; fi

echo "Panes validated"
echo ""
echo "5-Pane TUI session created: $SESSION_NAME"
echo ""
echo "Layout:"
echo "  ┌──────────────────┬──────────────────┐"
echo "  │ PA stdout h28    │ PE stderr h36    │"
echo "  ├──────────────────┤                  │"
echo "  │ PB stdin 2-line  │                  │"
echo "  ├──────────────────┴──────────────────┤"
echo "  │ PC rmq 60% h12   │ PD observe 40%   │"
echo "  └──────────────────┴──────────────────┘"
echo ""
echo "Keyboard (in P2 - Action):"
echo "  c=clipboard-parse  j=queue  d=discard"
echo "  i=ingest-clipboard e=edit   p=preview  o=open-url"
echo ""
echo "Attaching in 2s..."
sleep 2

tmux attach-session -t "$SESSION_NAME"
