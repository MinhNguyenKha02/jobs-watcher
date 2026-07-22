# Test Dependency Chain & Execution Guide

This document explains the dependencies between manual tests and provides clear sequencing for execution.

---

## Quick Reference

| Test | Type | Depends On | Requires Clean DB | Duration |
|------|------|-----------|---|---|
| TEST 1 | Sequential | None | No | 2-3s |
| TEST 2 | Sequential | TEST 1 | No | 2-3s |
| TEST 3 | Independent | None | Yes | 1-2s |
| TEST 4 | Independent | None | Yes | 1-2s |
| TEST 5 | Independent | None | Yes | 1-2s |
| TEST 6 | Independent | None | No | 2-3s |
| TEST 7 | Independent | None | No | 3-5s |
| TEST 8 | Independent | None | Yes | 5-10s |

---

## Dependencies Explained

### Sequential Block: Tests 1-2

```
TEST 1: Signal 1 (job.generated)
        ↓
        Webhook → MongoDB → SSE → TUI Display (PARTIAL data)
        ↓
TEST 2: Signal 2 (job.parse.completed)  ← DEPENDS ON TEST 1 JOB
        ↓
        Operator presses 'c' → Parse → Score → Display (FULL data)
        ↓
TEST 3: Signal 3 (job.routed decision)  ← Can run next OR independent
```

**Constraint**: TEST 2 **must** have a job from TEST 1 visible in Pane 0 before executing

**No MongoDB reset needed**: TEST 2 uses same messageId as TEST 1

### Independent Block: Tests 3-5

```
Clean DB
  ↓
TEST 3: Signal 3 with decision=queue ✅
  ↓
Clean DB
  ↓
TEST 4: Signal 3 with decision=trash ✅
  ↓
Clean DB
  ↓
TEST 5: Signal 3 with decision=skip ✅
```

**Constraint**: Each test **must** start with clean MongoDB

**Why clean?**: Previous test leaves job_queue/job_trash records which would pollute independent test

**Usage**: 
```bash
bash scripts/eval-fetch-and-trigger.sh 1 --clean  # Cleans before fetch/trigger
```

### Parallel Block: Tests 6-8

```
TEST 6: Clipboard ingest (source=clipboard)
TEST 7: Edit + routing  
TEST 8: Burst test (100+ concurrent messages)
```

**Constraint**: None between tests (can run in parallel)

**Why**: Tests 6-8 don't interact with webhook-driven job_queue workflow

---

## Execution Scenarios

### Scenario A: Manual Testing (One-at-a-time)

```bash
# 1. Build and start daemon in background
npm run build
npm run start &

# 2. Start TUI session
bash scripts/tmux-tui-setup.sh

# 3. Sequential chain (TEST 1 → 2 → 3)
# Terminal 2:
bash scripts/eval-fetch-and-trigger.sh 1      # TEST 1
# Watch Pane 0 for job
# Go to Pane 1, press 'c'                      # TEST 2
# Go to Pane 1, press 'j'                      # TEST 3

# 4. Independent tests (with cleanup between)
SKIP_CONFIRM=1 npm run db:truncate            # Clean
bash scripts/eval-fetch-and-trigger.sh 1      # TEST 4 (press 'd' not 'j')

SKIP_CONFIRM=1 npm run db:truncate            # Clean
bash scripts/eval-fetch-and-trigger.sh 1      # TEST 5 (press 's' not 'j')

# 5. Clipboard tests (no cleanup needed)
# In Pane 1, press 'i'                         # TEST 6
# Paste HTML, Ctrl+D                      

# In Pane 1, press 'e'                         # TEST 7
# Modify job in editor, save
# Press 'j' to queue with edits

# 6. Burst test (optional, more resources needed)
# bash scripts/eval-fetch-and-trigger.sh 100   # TEST 8
```

### Scenario B: Automated Testing with Scripts

Create `scripts/run-manual-tests.sh`:

```bash
#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

run_cleanup() {
  echo "[test] 🧹 Cleaning MongoDB..."
  SKIP_CONFIRM=1 npm run db:truncate > /dev/null 2>&1 || {
    echo "[test] ⚠️  Cleanup failed, continuing..."
  }
  sleep 1
}

run_test_1() {
  echo "[TEST 1] 📨 Signal 1: Webhook → Display"
  bash scripts/eval-fetch-and-trigger.sh 1
  echo "[TEST 1] ✓ Job fetched and POSTed to webhook"
  sleep 2
}

run_test_2() {
  echo "[TEST 2] 🔍 Signal 2: Parse + Score"
  echo "[TEST 2] ⚠️  MANUAL STEP: Press 'c' in Pane 1 to trigger parse"
  echo "[TEST 2] Waiting 10s for manual action..."
  sleep 10
  echo "[TEST 2] ✓ Parse step should be complete"
}

run_test_3() {
  echo "[TEST 3] ✨ Signal 3: Queue decision"
  run_cleanup
  bash scripts/eval-fetch-and-trigger.sh 1
  echo "[TEST 3] ⚠️  MANUAL STEP: Press 'j' in Pane 1 to queue"
  sleep 3
  # Verify job_queue incremented
  COUNT=$(mongosh jobs_watcher --quiet --eval "db.job_queue.countDocuments()")
  if [ "$COUNT" -gt 0 ]; then
    echo "[TEST 3] ✓ Job queued (job_queue count: $COUNT)"
  else
    echo "[TEST 3] ✗ FAILED: Job not queued"
    exit 1
  fi
}

run_test_4() {
  echo "[TEST 4] 🗑️  Signal 3: Trash decision"
  run_cleanup
  bash scripts/eval-fetch-and-trigger.sh 1
  echo "[TEST 4] ⚠️  MANUAL STEP: Press 'd' in Pane 1 to discard"
  sleep 3
  # Verify job_trash incremented
  COUNT=$(mongosh jobs_watcher --quiet --eval "db.job_trash.countDocuments()")
  if [ "$COUNT" -gt 0 ]; then
    echo "[TEST 4] ✓ Job trashed (job_trash count: $COUNT)"
  else
    echo "[TEST 4] ✗ FAILED: Job not trashed"
    exit 1
  fi
}

run_test_5() {
  echo "[TEST 5] ⏭️  Signal 3: Skip decision"
  run_cleanup
  bash scripts/eval-fetch-and-trigger.sh 1
  echo "[TEST 5] ⚠️  MANUAL STEP: Press 's' in Pane 1 to skip"
  sleep 3
  # Verify job_queue and job_trash empty (skip doesn't write)
  QUEUE=$(mongosh jobs_watcher --quiet --eval "db.job_queue.countDocuments()")
  TRASH=$(mongosh jobs_watcher --quiet --eval "db.job_trash.countDocuments()")
  if [ "$QUEUE" -eq 0 ] && [ "$TRASH" -eq 0 ]; then
    echo "[TEST 5] ✓ Job skipped (no queue/trash records)"
  else
    echo "[TEST 5] ✗ FAILED: Skip didn't work (queue: $QUEUE, trash: $TRASH)"
    exit 1
  fi
}

# Main execution
echo "🧪 Running manual test suite..."
echo ""
echo "⚠️  IMPORTANT: This script requires tmux-tui-setup.sh running in another terminal"
echo ""

run_test_1
echo ""
run_test_2
echo ""
run_test_3
echo ""
run_test_4
echo ""
run_test_5
echo ""

echo "✅ All automated tests passed!"
```

Run with:
```bash
# Terminal 1: Start TUI
bash scripts/tmux-tui-setup.sh

# Terminal 2: Run test suite
bash scripts/run-manual-tests.sh
```

### Scenario C: CI/CD Pipeline (Fully Automated)

For headless testing without tmux, use automated test scripts:

```bash
npm run test:tui
```

This runs programmatically without manual interaction.

---

## Pre-Test Validation

Run before starting any test sequence:

```bash
#!/bin/bash
echo "🔍 Pre-test validation..."

# 1. MongoDB
echo -n "  MongoDB: "
mongosh --eval "db.version()" > /dev/null 2>&1 && echo "✅" || echo "❌"

# 2. Daemon process
echo -n "  Daemon: "
ps aux | grep -E "node dist.*index.js" | grep -v grep > /dev/null && echo "✅" || echo "❌"

# 3. Port 3000
echo -n "  Port 3000: "
netstat -tuln 2>/dev/null | grep -q ":3000 " && echo "✅" || echo "❌"

# 4. Collections exist
echo -n "  Collections: "
mongosh jobs_watcher --eval "
  const collections = ['job_queue', 'job_trash', 'action_snapshots', 'needs_enrichment'];
  const missing = collections.filter(c => !db.getCollectionNames().includes(c));
  print(missing.length === 0 ? '✅' : '❌ Missing: ' + missing.join(', '));
"

# 5. tmux
echo -n "  tmux: "
which tmux > /dev/null && echo "✅" || echo "❌"

echo ""
```

---

## Troubleshooting Dependencies

### Problem: TEST 2 fails with "no job in Pane 0"

**Cause**: TEST 1 didn't complete successfully

**Solution**:
```bash
# Verify TEST 1 output
ps aux | grep daemon        # Check daemon running
mongosh --eval "
  db.getSiblingDB('jobs_watcher').action_snapshots
    .findOne({ action: 'email.generated' }, { messageId: 1 })
"
# If empty, webhook didn't fire. Check daemon logs:
journalctl -u jobs-watcher -f --no-pager | grep -i "webhook\|signal"
```

### Problem: TEST 4/5 show wrong MongoDB state

**Cause**: MongoDB not cleaned properly between tests

**Solution**:
```bash
# Manual cleanup
mongosh jobs_watcher --eval "
  db.action_snapshots.deleteMany({});
  db.job_queue.deleteMany({});
  db.job_trash.deleteMany({});
  db.needs_enrichment.deleteMany({});
  print('✅ Cleaned all collections');
"
# Then retry test:
bash scripts/eval-fetch-and-trigger.sh 1 --clean
```

### Problem: Pane 1 keys not responding

**Cause**: Pane 0 is focused (not Pane 1)

**Solution**:
```bash
# In tmux session
Ctrl+b o    # Cycle panes until you see active border on Pane 1
# Then try keyboard action (c, j, d, s, etc.)
```

---

## Summary

| Need | Command |
|------|---------|
| Clean DBschema | `SKIP_CONFIRM=1 npm run db:truncate` |
| Fetch + trigger | `bash scripts/eval-fetch-and-trigger.sh 1` |
| Fetch + clean + trigger | `bash scripts/eval-fetch-and-trigger.sh 1 --clean` |
| Check daemon | `ps aux \| grep "node dist.*index"` |
| Check MongoDB | `mongosh --eval "db.version()"` |
| View job_queue | `mongosh jobs_watcher --eval "db.job_queue.countDocuments()"` |
| View action log | `journalctl -u jobs-watcher -f --no-pager \| grep -i signal` |
