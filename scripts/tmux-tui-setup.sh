#!/bin/bash

################################################################################
# Tmux Setup Script for Ops TUI - 4-Pane 2x2 Grid
#
# Layout:
#   ┌──────────────────────┬──────────────────┐
#   │ Pane 0: stdout       │ Pane 1: observe  │  top 80%
#   │         (render)     │         (cli)     │
#   ├──────────────────────┼──────────────────┤
#   │ Pane 2: stdin        │ Pane 3: stderr   │  bottom 20%
#   │         (action)     │         (logs)   │
#   └──────────────────────┴──────────────────┘
#          w=60%                w=40%
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

echo "Creating 4-pane TUI session: $SESSION_NAME"
echo ""

# Create session with 2-column layout:
# Left column (w=60%): P0 stdout (h=80%) top, P2 stdin (h=20%) bottom
# Right column (w=40%): P1 observe (h=40%) top, P3 stderr (h=60%) bottom
tmux new-session -d -s "$SESSION_NAME" -x 160 -y 50

# Split vertical: left 60%, right 40%
tmux split-window -h -t "$SESSION_NAME:0.0" -p 40

# Left column: split horizontal top 80% (P0), bottom 20% (P2)
tmux split-window -v -t "$SESSION_NAME:0.0" -p 20

# Right column: split horizontal top 40% (P1), bottom 60% (P3)
tmux split-window -v -t "$SESSION_NAME:0.1" -p 60

# P0: stdout (render server) — top-left
tmux send-keys -t "$SESSION_NAME:0.0" "npm run render-server 2>'$LOG_FILE_RENDER'" C-m
# P1: observe (observability CLI) — top-right
tmux send-keys -t "$SESSION_NAME:0.1" "cd '$PROJECT_ROOT' && npx tsx src/infrastructure/inbound/cli/observability.ts" C-m
# P2: stdin (action controller) — bottom-left
tmux send-keys -t "$SESSION_NAME:0.2" "UDS_SOCKET_PATH=\"$UDS_SOCKET_PATH\" npm run action-controller 2>'$LOG_FILE_ACTION'" C-m
# P3: stderr (logs) — bottom-right
tmux send-keys -t "$SESSION_NAME:0.3" "cd '$PROJECT_ROOT' && tail -f -n +1 '$LOG_FILE_RENDER' '$LOG_FILE_ACTION' 2>/dev/null" C-m

tmux set-window-option -t "$SESSION_NAME:0" mode-keys vi
tmux select-pane -t "$SESSION_NAME:0.0"

echo ""
echo "Validating pane startup (waiting 3 seconds)..."
sleep 3

PANE_0_ACTIVE=$(tmux capture-pane -t "$SESSION_NAME:0.0" -p | wc -l)
PANE_1_ACTIVE=$(tmux capture-pane -t "$SESSION_NAME:0.2" -p | wc -l)

if [ "$PANE_0_ACTIVE" -lt 2 ]; then echo "WARNING: Pane 0 may not have started"; fi
if [ "$PANE_1_ACTIVE" -lt 2 ]; then echo "WARNING: Pane 2 may not have started"; fi

echo "Panes validated"
echo ""
echo "4-Pane TUI session created: $SESSION_NAME"
echo ""
echo "Layout:"
echo "  ┌──────────────────────┬──────────────────┐"
echo "  │ P0: stdout (render)  │ P1: observe (cli)│"
echo "  ├──────────────────────┼──────────────────┤"
echo "  │ P2: stdin (action)   │ P3: stderr (logs)│"
echo "  └──────────────────────┴──────────────────┘"
echo ""
echo "Keyboard (in P2 - Action):"
echo "  c=clipboard-parse  j=queue  d=discard"
echo "  i=ingest-clipboard e=edit   p=preview  o=open-url"
echo ""
echo "Attaching in 2s..."
sleep 2

tmux attach-session -t "$SESSION_NAME"
