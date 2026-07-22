# Logging Architecture: TUI vs Daemon

**Status:** ✅ Implemented  
**Date:** April 10, 2026

## Overview

The logging system now cleanly separates concerns:
- **TUI (ops-tui-app)**: ANSI rendering on stdout, all logs on stderr
- **Daemon (index.ts)**: All logs to stderr, captured by systemd/journalctl

---

## Logger Behavior

### `src/services/logger.ts` (Updated)

All loggers now send output to **stderr** via `console.error()`:

```typescript
// BEFORE: Mixed console.log/warn/error
if (level === 'error') {
  console.error(out);
} else {
  console.log(out);  // ❌ Logs went to stdout
}

// AFTER: All logs to stderr
console.error(out);  // ✅ Consistent stderr output
```

**Why stderr?**
- Separates logs from ANSI UI rendering (which uses stdout)
- Allows tmux/shell redirection: `npm run tui 2>logs.jsonl`
- Universal compatibility: both TUI and daemon benefit
- Unix convention: errors/logs → stderr, data → stdout

---

## For TUI (ops-tui-app.ts)

### Stdout: ANSI Rendering Only
```typescript
// In AnsiTerminal.ts
write(data: string): void {
  process.stdout.write(data);  // ✅ Only ANSI frames
}
```

**Result:**
```
╔ 🟢 SSE ↕ UDS [DISPLAY]                    ╗
╟─ Company: Acme Corp                       ║
║  Position: Senior Backend Engineer        ║
║  URL: https://...                         ║
╚════════════════════════════════════════════╝
```

### Stderr: All Logs
```bash
# TUI startup
2026-04-10T12:59:00.123Z [*] [OpsTuiApp.start] 🚀 Starting Ops TUI
2026-04-10T12:59:00.125Z [*] [SseJobReader.connect] 🟢 SSE connected
2026-04-10T12:59:00.126Z [*] [KeyboardHandler.attach] ✅ Keyboard attached

# Job event
2026-04-10T12:59:25.459Z [*] [SseJobReader.handleSseEvent] 📥 Job buffered

# Action dispatch
2026-04-10T12:59:30.100Z [*] [OpsTuiApp.handleQueue] ✓ Job queued
```

### Tmux Layout: Separated Streams

```
+────────────────────────────────────────+
│ Terminal 1: npm run tui (stdout only)  │
│                                        │
│ ╔ 🟢 SSE ↕ UDS [DISPLAY]           ╗ │
│ ╟─ Company: Acme Corp             ║ │
│ ║ Position: Senior Backend Eng.   ║ │
│ ╚════════════════════════════════════╝ │
+────────────────────────────────────────+
│ Terminal 2: tail -f logs.jsonl         │
│ (stderr stream)                        │
│ 2026-04-10T12:59:00.123Z [*] Starting  │
│ 2026-04-10T12:59:25.459Z [*] Job found │
│ 2026-04-10T12:59:30.100Z [*] Queued    │
+────────────────────────────────────────+
```

---

## For Daemon (index.ts + journalctl)

### Systemd Service Capture

By default, systemd captures **both stdout and stderr** from services:

```bash
# systemd unit file: /etc/systemd/system/jobs-watcher.service

[Service]
Type=simple
ExecStart=/home/minh-nguyen/.nvm/versions/node/v22.12.0/bin/node /home/minh-nguyen/node_projects/jobs-watcher/dist/src/index.js

# StandardOutput=journal (default)
# StandardError=journal (default)
# ↑ Captures both stdout and stderr into journalctl
```

### Result: Journalctl Has All Logs

```bash
$ sudo journalctl -u jobs-watcher -f

Thg 4 10 12:59:32 minh-nguyen node[1785151]: 2026-04-10T05:59:32.794Z [*] [logWithAudit] ✅ MongoDB storage connected
Thg 4 10 12:59:32 minh-nguyen node[1785151]: 2026-04-10T05:59:32.799Z [*] [logWithAudit] 🔎 Health endpoints listening
Thg 4 10 12:59:32 minh-nguyen node[1785151]: 2026-04-10T05:59:32.809Z [*] [logWithAudit] SSE: MongoDB change stream established
Thg 4 10 12:59:32 minh-nguyen node[1785151]: 2026-04-10T05:59:32.815Z [*] [logWithAudit] ✅ Jobs Watcher is running
```

✅ **All logs appear in journalctl** even though they're sent to stderr

---

## Verification

### 1. Daemon Logging (systemd/journalctl)

```bash
# Monitor daemon logs in real-time
sudo journalctl -u jobs-watcher -f

# Filter logs by time
sudo journalctl -u jobs-watcher --since "10 minutes ago"

# Check for errors
sudo journalctl -u jobs-watcher -p err

# Export to file
sudo journalctl -u jobs-watcher > daemon_logs.txt
```

**Expected:** All logs from index.ts appear (connection, ingestion, actions)

### 2. TUI Logging (tmux separated streams)

**Setup tmux:**
```bash
tmux new-session -d -s jobs

# Pane 0: TUI (stdout only → ANSI rendering)
tmux send-keys -t 0 "npm run tui" C-m

# Pane 1: Logs (stderr stream)
tmux send-keys -t 1 "sleep 1 && tail -f ~/.local/ops-tui.log" C-m
```

**Expected:**
- Pane 0: Clean ANSI frames only (no log noise)
- Pane 1: All logs flowing (SSE, keyboard, actions)

### 3. TUI Redirection to File

```bash
# Redirect stderr to log file
npm run tui 2>tui-logs.jsonl

# Monitor in another terminal
tail -f tui-logs.jsonl

# Or use tmux (recommended)
tmux split-window -v
tmux send-keys -t 1 "tail -f tui-logs.jsonl" C-m
```

---

## Architecture Benefits

| Component | Stdout | Stderr | Benefit |
|-----------|---------|---------|---------|
| **TUI ANSI** | ✅ Frames only | — | Clean rendering, no log spam |
| **TUI Logs** | — | ✅ All logs | Easy to tail in separate pane |
| **Daemon Logs** | — | ✅ Via logger.ts | Captured by systemd/journalctl |
| **Tmux Split** | Pane 0 | Pane 1 | Independent streams, no interference |

---

## Example: Action Flow with Logging

### User presses 'q' (queue job)

**Stdout (Pane 0 - TUI):**
```
╔ 🟢 SSE ↕ UDS [ACTION_DISPATCH]        ╗
╟─ Company: Acme Corp                   ║
║ Action: queue → Routing to job_queue  ║
║ Status: ✓ Queued                      ║
╚════════════════════════════════════════╝
```

**Stderr (Pane 1 - Logs):**
```
2026-04-10T12:59:30.100Z [*] [OpsTuiApp.dispatchAction] Dispatching action: queue
2026-04-10T12:59:30.105Z [*] [OpsTuiApp.handleQueue] Sending UDS request to /internal/action
2026-04-10T12:59:30.112Z [*] [UdsActionWriter.queue] Queue request accepted (messageId: 19d71bc66c5b44e7)
2026-04-10T12:59:30.115Z [*] [OpsTuiApp] ✓ Job queued
```

**Daemon Logs (via journalctl):**
```
2026-04-10T12:59:30.110Z [*] [UDS action processing] /internal/action received
2026-04-10T12:59:30.112Z [*] [Action router] Routing to job_queue (messageId: 19d71bc66c5b44e7)
2026-04-10T12:59:30.115Z [*] [MongoDB upsert] job_queue updated successfully
```

---

## Troubleshooting

### Daemon logs not appearing in journalctl

```bash
# Check service status
sudo systemctl status jobs-watcher

# View recent logs
sudo journalctl -u jobs-watcher -n 50

# Follow live
sudo journalctl -u jobs-watcher -f
```

### TUI logs mixed with ANSI rendering

```bash
# WRONG: No stderr redirection
npm run tui  # Logs appear inline with ANSI

# CORRECT: Separate stderr
npm run tui 2>logs.jsonl  # Clean ANSI on stdout

# BEST: Use tmux split (recommended)
tmux split-window -v
tmux send-keys -t 1 "tail -f logs.jsonl" C-m
```

### "Cannot open /run/jobs-watcher/ingest.sock"

```bash
# Check socket exists
ls -la /run/jobs-watcher/ingest.sock

# Verify permissions
stat /run/jobs-watcher/ingest.sock

# Check daemon is running
sudo systemctl status jobs-watcher

# View daemon logs for socket errors
sudo journalctl -u jobs-watcher | grep "ingest\|socket"
```

---

## Quick Commands

### Monitor Everything (3 Terminals)

**Terminal 1: Daemon**
```bash
sudo journalctl -u jobs-watcher -f
```

**Terminal 2: TUI Logs**
```bash
cd /home/minh-nguyen/node_projects/jobs-watcher
npm run tui 2>logs.jsonl &
tail -f logs.jsonl
```

**Terminal 3: Trigger Jobs**
```bash
cd /home/minh-nguyen/node_projects/jobs-watcher
./scripts/eval-fetch-and-trigger.sh 1
```

### Monitor with Tmux (1 Session)

```bash
tmux new-session -s jobs

# Split horizontally
Ctrl+b "

# Top pane: TUI
npm run tui 2>logs.jsonl

# Bottom pane: Logs (after TUI starts)
tail -f logs.jsonl

# Navigate
Ctrl+b ↑ / Ctrl+b ↓
```

---

## Implementation Details

### Files Modified

1. **src/services/logger.ts**
   - Changed all `console.log()` → `console.error()`
   - Centralized logging to stderr
   - ConsoleLogger now outputs to stderr instead of stdout

2. **src/ui/sse-client.ts**
   - SSE init logging now uses `console.error()`
   - Prevents confusing output in ANSI rendering

3. **src/ui/components/AnsiTerminal.ts**
   - Error messages still use `console.error()`
   - Keeps critical errors visible

### Result

- **TUI stdout:** Pure ANSI frames (no log spam)
- **TUI stderr:** All diagnostic logs (tail-able)
- **Daemon stdout:** System output (MySQL, etc.)
- **Daemon stderr:** All diagnostic logs (journalctl-captured)
- **No changes needed** to systemd unit (journalctl already captures both)

---

## Summary

✅ **Logging is correctly separated:**
- logger.ts sends everything to stderr (Unix best practice)
- TUI renders on stdout (ANSI frames)
- Daemon logs go to journalctl (captures stderr)
- tmux can split streams: pane 0 (TUI), pane 1 (logs)

✅ **No breaking changes:**
- Daemon logging works without modification
- TUI works with optional redirection
- All existing scripts remain compatible
