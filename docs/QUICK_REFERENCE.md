# Quick Reference: Daemon & TUI Logging

**Status:** ✅ Fully Implemented  
**Date:** April 10, 2026

---

## 🎯 Quick Start (Recommended)

### Option 1: Tmux (Best for Development)

```bash
cd /home/minh-nguyen/node_projects/jobs-watcher
./scripts/tmux-tui-setup.sh
```

**Result:**
```
┌─────────────────────────────┐
│ TUI (clean ANSI only)       │
├─────────────────────────────┤
│ Logs (live tail, stderr)    │
└─────────────────────────────┘
```

### Option 2: Manual (Two Terminals)

**Terminal 1: TUI**
```bash
cd /home/minh-nguyen/node_projects/jobs-watcher
npm run tui 2>tui-logs.jsonl
```

**Terminal 2: Logs**
```bash
cd /home/minh-nguyen/node_projects/jobs-watcher
tail -f tui-logs.jsonl
```

### Option 3: Four Terminal Setup (Full Monitoring)

**Term 1: Daemon Logs**
```bash
sudo journalctl -u jobs-watcher -f
```

**Term 2: TUI**
```bash
npm run tui 2>tui-logs.jsonl
```

**Term 3: TUI Logs**
```bash
tail -f tui-logs.jsonl
```

**Term 4: Dispatch Webhooks**
```bash
./scripts/eval-fetch-and-trigger.sh 1
```

---

## 📊 What Goes Where?

| Stream | Source | Destination | View |
|--------|--------|-------------|------|
| **stdout** | AnsiTerminal.write() | Terminal screen | ANSI frames only |
| **stderr (TUI)** | logger.ts | File/terminal | `2>tui-logs.jsonl` |
| **stderr (Daemon)** | logger.ts | journalctl | `journalctl -u jobs-watcher` |

---

## 🔍 Daemon Monitoring (journalctl)

### Live Tail
```bash
sudo journalctl -u jobs-watcher -f
```

### Filter by Level
```bash
# Only errors
sudo journalctl -u jobs-watcher -p err

# Info and above
sudo journalctl -u jobs-watcher -p info
```

### Time Range
```bash
# Last 10 minutes
sudo journalctl -u jobs-watcher --since "10 minutes ago"

# Today
sudo journalctl -u jobs-watcher --since "today"

# Between timestamps
sudo journalctl -u jobs-watcher --since "2026-04-10 12:00:00" --until "2026-04-10 13:00:00"
```

### Export to File
```bash
sudo journalctl -u jobs-watcher > daemon_logs.txt
```

### Watch for Specific Events
```bash
# UDS ingest events
sudo journalctl -u jobs-watcher -f | grep "UDS\|ingest"

# Webhook events
sudo journalctl -u jobs-watcher -f | grep "webhook\|Gmail"

# Errors only
sudo journalctl -u jobs-watcher -f | grep "ERROR\|error"
```

---

## 🖥️ TUI Monitoring

### Live Logs File
```bash
tail -f tui-logs.jsonl
```

### Filter Logs
```bash
# Job buffered events
tail -f tui-logs.jsonl | grep "Job buffered\|📥"

# Actions dispatched
tail -f tui-logs.jsonl | grep "queue\|trash\|ingest"

# Errors
tail -f tui-logs.jsonl | grep "Error\|ERROR"
```

### Parse and Pretty-Print
```bash
# Print human-readable (extract message only)
tail -f tui-logs.jsonl | sed 's/.*] //'

# Count log types
grep -o "\[.\]" tui-logs.jsonl | uniq -c

# Most recent 20 logs
tail -20 tui-logs.jsonl
```

---

## 🎛️ Tmux Commands (Quick Reference)

| Command | Action |
|---------|--------|
| `Ctrl+b ↑` | Navigate to pane above |
| `Ctrl+b ↓` | Navigate to pane below |
| `Ctrl+b ←` | Navigate to pane left |
| `Ctrl+b →` | Navigate to pane right |
| `Ctrl+b %` | Split current pane vertically |
| `Ctrl+b "` | Split current pane horizontally |
| `Ctrl+b x` | Kill current pane |
| `Ctrl+b d` | Detach (session keeps running) |
| `Ctrl+b n` | Next window |
| `Ctrl+b p` | Previous window |
| `Ctrl+b c` | New window |

---

## 🧪 Testing Workflow

### Test 1: Daemon Connectivity

```bash
# Check systemd status
sudo systemctl status jobs-watcher

# View daemon logs
sudo journalctl -u jobs-watcher -n 20

# Verify socket exists
ls -la /run/jobs-watcher/ingest.sock
```

### Test 2: TUI Startup

```bash
# Terminal 1: Start TUI
npm run tui 2>tui-logs.jsonl

# Terminal 2: Check logs appear
sleep 1 && tail -f tui-logs.jsonl
```

**Expected in Terminal 2:**
```
2026-04-10T... [*] 🚀 Starting Ops TUI
2026-04-10T... [*] 🟢 SSE connected
2026-04-10T... [*] ✅ Keyboard attached
```

### Test 3: Action Dispatch

```bash
# Terminal 3: Trigger webhook
./scripts/eval-fetch-and-trigger.sh 1

# Terminal 1 (TUI): Should show job card
# Terminal 2 (TUI Logs): Should show "📥 Job buffered"
# Terminal 0 (Daemon): Should show "🟢 UDS ingest processed"

# Press 'q' in Terminal 1 (queue)
# Check Terminal 0 for: "job_queue updated"
# Check Terminal 2 for: "✓ Job queued"
```

### Test 4: Edit Job

```bash
# Terminal 1 (TUI): Press 'e'
# Expected: nano editor opens with job JSON

# Edit company field
# Save & exit: Ctrl+X → Y → Enter

# Terminal 1: Should show updated card with new company
# Terminal 2: Should show "Job edited and queued"
```

---

## 🔧 Troubleshooting

### TUI shows logs mixed with ANSI

```bash
# Problem: Logs appearing in TUI pane
# Solution: Ensure stderr is redirected

npm run tui 2>tui-logs.jsonl  # ✅ Correct
npm run tui                    # ❌ Wrong - logs on stdout
```

### Daemon logs not in journalctl

```bash
# Check service is running
sudo systemctl status jobs-watcher

# Restart if needed
sudo systemctl restart jobs-watcher

# View logs
sudo journalctl -u jobs-watcher -f
```

### Tmux session already exists

```bash
# Reattach to existing
tmux attach -t jobs

# Or kill and restart
tmux kill-session -t jobs
./scripts/tmux-tui-setup.sh
```

### Socket permission denied

```bash
# Check socket exists
ls -la /run/jobs-watcher/ingest.sock

# Check permissions (should be rw-rw----)
stat /run/jobs-watcher/ingest.sock

# Current user in group?
id -a | grep jobs-watcher

# Fix permissions
sudo chmod 0660 /run/jobs-watcher/ingest.sock
```

---

## 📈 Monitoring Multiple Instances

If running multiple services:

```bash
# Monitor all services
sudo journalctl -f

# Filter for jobs-watcher
sudo journalctl -f | grep jobs-watcher

# Exclude noise
sudo journalctl -f --grep="ERROR|WARN" -p warn
```

---

## 💡 Pro Tips

1. **Persistent TUI Session:**
   ```bash
   tmux new-session -d -s jobs "./scripts/tmux-tui-setup.sh"
   # Detach: Ctrl+b d
   # Later: tmux attach -t jobs
   ```

2. **Save Monitoring State:**
   ```bash
   # Capture session
   tmux capture-pane -t jobs -p > session_backup.txt
   ```

3. **Log Rotation:**
   ```bash
   # Archive TUI logs
   gzip tui-logs.jsonl && mv tui-logs.jsonl.gz logs/$(date +%Y%m%d_%H%M%S).jsonl.gz
   ```

4. **Alert on Errors:**
   ```bash
   # Watch for errors and alert
   tail -f tui-logs.jsonl | while read line; do
     if echo "$line" | grep -q "ERROR"; then
       echo "\a"  # Bell sound
     fi
   done
   ```

5. **Automated Testing:**
   ```bash
   # Start with tmux, run tests, capture results
   ./scripts/tmux-tui-setup.sh
   sleep 3
   ./scripts/eval-fetch-and-trigger.sh 3
   tmux capture-pane -t jobs -p -S -100 > test_results.txt
   ```

---

## 🎓 Architecture Summary

```
┌─────────────────────────────────────────────────────┐
│ Daemon (index.ts)                                   │
│                                                     │
│  ├─ logger.ts → console.error() → journalctl       │
│  ├─ SSE /events endpoint                           │
│  └─ UDS /internal/action endpoint                  │
└──────────────────────┬──────────────────────────────┘
                       │
                       │ SSE stream + UDS commands
                       │
┌──────────────────────▼──────────────────────────────┐
│ TUI (ops-tui-app.ts)                                │
│                                                     │
│  ├─ stdout: AnsiTerminal.write() → ANSI frames     │
│  ├─ stderr: logger.ts → tui-logs.jsonl             │
│  └─ keyboard: waitForAction()                      │
└─────────────────────────────────────────────────────┘
```

✅ **Result:** Clean separation, easy monitoring, production-ready!
