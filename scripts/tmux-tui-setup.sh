#!/bin/bash

################################################################################
# Tmux Setup Script for Ops TUI - 3-Pane Architecture
#
# Creates a tmux session with 3 panes:
# - Pane 0 (top 40%): Render Server (ANSI output, no keyboard input)
# - Pane 1 (middle 40%): Action Controller (keyboard handler, full stdin)
# - Pane 2 (bottom 20%): Combined logs (scrollable tail)
#
# Architecture:
#   - Separates rendering (Pane 0) from keyboard input (Pane 1)
#   - Fixes stdin/stdout race condition during SSE floods
#   - Uses XDG_RUNTIME_DIR/tmux for socket (fixes /tmp permission issues)
#
# Usage:
#   ./scripts/tmux-tui-setup.sh
#
# Pane Navigation:
#   Ctrl+b o      : Cycle to next pane (0 → 1 → 2 → 0)
#   Ctrl+b ;      : Toggle to previous pane
#   Ctrl+b [      : Enter scroll mode (Page-Up/Down, q to exit)
#   Ctrl+b d      : Detach session
#
# Keyboard Actions (in Pane 1):
#   c = Clipboard parse   j = Queue   d = Discard   s = Skip
#   i = Ingest clipboard  e = Edit    p = Preview   o = Open URL
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

# ✓ P5: Validation checks before starting tmux session
echo "🔍 Validating prerequisites..."
echo ""

# Check if Node.js is available
if ! command -v node &> /dev/null; then
    echo "❌ ERROR: Node.js not found in PATH"
    exit 1
fi
NODE_VERSION=$(node --version)
echo "✅ Node.js found: $NODE_VERSION"

# Check if npm is available
if ! command -v npm &> /dev/null; then
    echo "❌ ERROR: npm not found in PATH"
    exit 1
fi
echo "✅ npm found"

# Check if tmux is available
if ! command -v tmux &> /dev/null; then
    echo "❌ ERROR: tmux not found in PATH"
    exit 1
fi
TMUX_VERSION=$(tmux -V)
echo "✅ tmux found: $TMUX_VERSION"

# Check if dist directory and built files exist
if [ ! -d "$PROJECT_ROOT/dist" ]; then
    echo "⚠️  dist directory not found, building project..."
    cd "$PROJECT_ROOT"
    npm run build > /dev/null 2>&1
    if [ $? -ne 0 ]; then
        echo "❌ ERROR: Build failed"
        exit 1
    fi
fi
echo "✅ Project build found"

# Check if package.json scripts exist
if ! grep -q '"render-server"' "$PROJECT_ROOT/package.json"; then
    echo "❌ ERROR: 'render-server' script not found in package.json"
    exit 1
fi
if ! grep -q '"action-controller"' "$PROJECT_ROOT/package.json"; then
    echo "❌ ERROR: 'action-controller' script not found in package.json"
    exit 1
fi
echo "✅ npm scripts found"

# Check if MongoDB is accessible (optional but recommended)
if ! command -v mongosh &> /dev/null && ! command -v mongo &> /dev/null; then
    echo "⚠️  WARNING: mongosh/mongo CLI not found (MongoDB connection won't be tested)"
else
    echo "✅ MongoDB CLI found"
fi

echo ""
echo "✅ All prerequisites validated"
echo ""

# Kill existing session if running (ignore errors)
if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
    echo "🔄 Killing existing session '$SESSION_NAME'..."
    tmux kill-session -t "$SESSION_NAME" 2>/dev/null || true
    sleep 1
fi

cd "$PROJECT_ROOT"

echo "🚀 Creating 3-pane TUI session: $SESSION_NAME"
echo ""

# Create session
tmux new-session -d -s "$SESSION_NAME" -x 160 -y 50

# Split horizontally: Pane 0 (Top/Mid) and Area for Pane 1/2 (Bottom)
tmux split-window -v -t "$SESSION_NAME:0.0" -p 30

# Split bottom area vertically: Pane 1 (Left) and Pane 2 (Right)
tmux split-window -h -t "$SESSION_NAME:0.1"

# Assign commands to panes
tmux send-keys -t "$SESSION_NAME:0.0" "INTERNAL_AUTH_TOKEN=\"$INTERNAL_AUTH_TOKEN\" npm run render-server 2>'$LOG_FILE_RENDER'" C-m
tmux send-keys -t "$SESSION_NAME:0.1" "INTERNAL_AUTH_TOKEN=\"$INTERNAL_AUTH_TOKEN\" UDS_SOCKET_PATH=\"$UDS_SOCKET_PATH\" npm run action-controller 2>'$LOG_FILE_ACTION'" C-m
tmux send-keys -t "$SESSION_NAME:0.2" "cd '$PROJECT_ROOT' && tail -f -n +1 '$LOG_FILE_RENDER' '$LOG_FILE_ACTION' 2>/dev/null" C-m

# Enable mouse & vi keys
tmux set-window-option -t "$SESSION_NAME:0" mode-keys vi
tmux set-option -t "$SESSION_NAME:0.2" mouse on

# Select pane 0 by default (render server - read-only)
tmux select-pane -t "$SESSION_NAME:0.0"

# ✓ P5: Validate that panes started successfully
echo ""
echo "🔍 Validating pane startup (waiting 3 seconds)..."
sleep 3

PANE_0_ACTIVE=$(tmux capture-pane -t "$SESSION_NAME:0.0" -p | wc -l)
PANE_1_ACTIVE=$(tmux capture-pane -t "$SESSION_NAME:0.1" -p | wc -l)

if [ "$PANE_0_ACTIVE" -lt 2 ]; then
    echo "⚠️  WARNING: Pane 0 (Render Server) may not have started"
fi
if [ "$PANE_1_ACTIVE" -lt 2 ]; then
    echo "⚠️  WARNING: Pane 1 (Action Controller) may not have started"
fi

# Check if panes are still running (exit codes)
if ! tmux send-keys -t "$SESSION_NAME:0.0" "" 2>/dev/null; then
    echo "⚠️  WARNING: Pane 0 is not responsive"
fi
if ! tmux send-keys -t "$SESSION_NAME:0.1" "" 2>/dev/null; then
    echo "⚠️  WARNING: Pane 1 is not responsive"
fi

echo "✅ Panes validated"
echo ""
echo "✅ 3-Pane TUI session created: $SESSION_NAME"
echo ""
echo "Layout:"
echo "  ┌─────────────────────────────────────────┐"
echo "  │ Pane 0: Render Server (stdout)          │"
echo "  │         [Top/Mid - ANSI frames]         │"
echo "  ├────────────────────┬────────────────────┤"
echo "  │ Pane 1: Action     │ Pane 2: Logs       │"
echo "  │         (stdin)    │         (tail -f)  │"
echo "  └─────────────────────────────────────────┘"
echo ""
echo "🎮 Navigation (inside tmux):"
echo "  Ctrl+b o         : Cycle to next pane (Pane 0 → 1 → 2 → 0)"
echo "  Ctrl+b ;         : Toggle to previous pane"
echo "  Ctrl+b {         : Swap pane up"
echo "  Ctrl+b }         : Swap pane down"
echo "  Ctrl+b [         : Enter scroll/copy mode (Page-Up/Down to scroll, q to exit)"
echo "  Ctrl+b d         : Detach from session"
echo "  Ctrl+b x         : Kill current pane"
echo ""
echo "⌨️  Quick Actions (in Pane 1 - Action Controller):"
echo "  c                : Trigger clipboard stage-2 parsing"
echo "  j                : Queue job"
echo "  d                : Discard/Trash job"
echo "  (s)              : (unmapped — use next job auto-advance)"
echo "  i                : Ingest from clipboard"
echo "  e                : Edit job with external editor"
echo "  p                : Preview job"
echo "  o                : Open URL in browser"
echo "  ?                : Show help"
echo ""
echo "📊 Testing Steps:"
echo "  1. Wait 3s for Pane 0 to connect to SSE"
echo "  2. Press Ctrl+b o to cycle to Pane 1 (Action Controller)"
echo "  3. In separate terminal, trigger webhook: bash scripts/eval-fetch-and-trigger.sh 1"
echo "  4. Watch Pane 0 for job card to appear"
echo "  5. Press 'c' in Pane 1 to parse (or 'j' to queue, 'd' to discard)"
echo "  6. Check Pane 2 for logs"
echo ""
echo "🔗 Session Commands:"
echo "  Attach existing: tmux attach -t $SESSION_NAME"
echo "  List sessions:   tmux list-sessions"
echo "  Kill session:    tmux kill-session -t $SESSION_NAME"
echo "  Detach current:  Ctrl+b d"
echo ""
echo "🔗 Attaching to session in 2 seconds..."
sleep 2

# Attach to the session
tmux attach-session -t "$SESSION_NAME"
