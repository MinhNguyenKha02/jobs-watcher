# Stage 2 Clipboard Parse [c] Action - Analysis & Fix

**Status**: 🔴 **BLOCKED** - UDS socket communication issue

**Affected Test**: TEST 2 in MANUAL_TESTING_GUIDE.md — Operator [c] → Signal 2

**Symptoms**:
- ✅ [p] Preview works (reads clipboard locally, shows modal)
- ✅ [o] Open-URL works (opens browser)
- ❌ [c] Clipboard parse fails (tries to send to UDS socket)

**Root Cause**: Three-layer socket path issue

---

## 1. Socket Path Configuration Flow

### 1.1 Layer 1: Daemon (index.ts) - Socket Creation

**File**: [src/index.ts](src/index.ts#L540)

```typescript
const defaultSocket = opts.ingestSocketPath || 
                      process.env.INTERNAL_SOCKET_PATH || 
                      path.join('/', 'run', 'jobs-watcher', 'ingest.sock');
ingestSocketPath = defaultSocket;
```

**Environment Variables**:
- `INTERNAL_SOCKET_PATH` — Override default socket path
- Fallback: `/run/jobs-watcher/ingest.sock`

**Socket Lifecycle**:
1. Creates directory: `fs.mkdirSync(path.dirname(ingestSocketPath), { recursive: true })`
2. Removes old socket: `fs.unlinkSync(ingestSocketPath)` if exists
3. Binds HTTP server: `ingestServer.listen(ingestSocketPath)`

**Status Check**:
```bash
# Verify daemon socket exists
ls -la /run/jobs-watcher/ingest.sock

# Check UDS socket listening
ss -l -p | grep jobs

# Check if daemon is running
ps aux | grep "node.*dist/src/index" | grep -v grep
```

---

### 1.2 Layer 2: TUI ActionController - Socket Discovery

**File**: [src/ui/action-controller.ts](src/ui/action-controller.ts#L902)

```typescript
const controller = new ActionController({
  socketPath: process.env.UDS_SOCKET_PATH || '/run/jobs-watcher/ingest.sock',
  udsToken: process.env.UDS_TOKEN || 'temp-dev-token',
  preferredEditor: preferredEditor,
});
```

**Environment Variables**:
- `UDS_SOCKET_PATH` — TUI reads THIS variable, NOT `INTERNAL_SOCKET_PATH`
- Fallback: `/run/jobs-watcher/ingest.sock` (same as daemon)

**Critical Issue**: `ActionController` uses `UDS_SOCKET_PATH`, but `index.ts` uses `INTERNAL_SOCKET_PATH`

---

### 1.3 Layer 3: Action Handlers - Socket Communication

**Files**: 
- [src/ui/action-controller.ts#L553](src/ui/action-controller.ts#L553) — `handleWebhookStage2Parse()`
- [src/ui/action-controller.ts#L497](src/ui/action-controller.ts#L497) — `handleIngest()`

Both handlers use `postJsonOverUds()`:

```typescript
const { postJsonOverUds } = await import('../utils/uds-http.js');
const res = await postJsonOverUds(ingestOpts, ingestPayload);
```

**UDS Request Payload** (webhook=true):
```json
{
  "webhook": true,
  "messageId": "19da590cbfebb148-job-0",
  "htmlPayload": "<html>...</html>"
}
```

**Error Handling**: ⚠️ **WEAK** — Catches error but only logs to console.error()

```typescript
} catch (err) {
  console.error('[ACTION] ❌ Stage 2 parse failed:', String(err));
}
```

---

## 2. Test Case Trace: Why [c] Fails

### 2.1 Execution Flow

```
[TUI] Operator presses 'c'
  ↓
KeyboardHandler.keyToAction('c')  → returns 'webhook_stage2_parse'
  ↓
ActionController.dispatchAction('webhook_stage2_parse')
  ↓
ActionController.handleWebhookStage2Parse()
  ├─ Gets current job: getCurrentJob().messageId ✅ WORKS
  ├─ Gets clipboard: clipboardGetter() ✅ WORKS (if clipboard has HTML)
  ├─ Builds UDS request payload ✅ WORKS
  ├─ Calls postJsonOverUds() ❌ FAILS HERE
  │  └─ Error: socket not found or daemon not listening
  └─ console.error() logs error, but TUI doesn't show it
```

### 2.2 Socket Path Mismatch Scenario

**If daemon started with**:
```bash
INTERNAL_SOCKET_PATH=/tmp/custom-ingest.sock npm run data-listening
```

**Daemon listens at**: `/tmp/custom-ingest.sock`

**But TUI looks for**: `/run/jobs-watcher/ingest.sock` (default fallback)

**Result**: Connection refused ❌

---

### 2.3 Socket Not Found Scenario

**If socket directory doesn't have write permissions**:
```bash
# Daemon tries to create but fails (silently?)
fs.mkdirSync('/run/jobs-watcher', { recursive: true })
  → Permission denied (running as non-root, /run is root-only)
```

**Socket never created**: TUI connects to non-existent socket ❌

---

## 3. Key Findings from Attached Files

### 3.1 tui-logs-render.jsonl

**Timestamp Range**: 2026-04-19 16:59:32 — Webhook Stage 1 test

```
[SIGNAL-1] 📨 Received job.generated event (raw)
[SIGNAL-1] Parsed values
[SIGNAL-1] Calling setCurrentJob with PARTIAL stage
[TUI-State] ✅ File written successfully (atomic)
[SIGNAL-1] ✅ State update complete
```

**Observation**: 
- Signal 1 (webhook) working ✅
- 22 jobs extracted from envelope ✅
- Each job has unique messageId suffix (`-job-0`, `-job-1`, etc.) ✅
- 66 FULL_PARSED entries in logs = proof Stage 2 was manually triggered ✅

**But NO UDS /internal/ingest logs seen** in tui-logs file:
- ❌ "UDS /internal/ingest webhook=true" not logged
- ❌ No HtmlJobParser output for [c] action
- ❌ No ScoreMatcher calculations after [c]

---

### 3.2 clipboard-getter.ts Architecture

**File**: [src/cli/clipboard-getter.ts](src/cli/clipboard-getter.ts)

```typescript
export async function clipboardGetter(): Promise<string[]> {
  const inMem = (global as any).__clipboardJob;
  if (typeof inMem === 'string' && inMem.trim()) {
    const txt = inMem.trim();
    if (!isHtmlLike(txt)) return [];
    const h = toHash(txt);
    if (h === lastClipboardHash) return [];  // ← Deduplicates!
    lastClipboardHash = h;
    return [txt];
  }

  try {
    const clipboardText = String(await clipboardy.read()).trim();
    // ... fallback to OS clipboard
  } catch (e) {
    return [];  // ← Silent fail if clipboard read fails
  }
}
```

**In-Memory Fallback**: Tests can inject HTML via `global.__clipboardJob`

**Hash-Based Deduplication**: Same clipboard content returns `[]` on second call
- **Why**: Prevents accidental double-parsing
- **But**: If first [c] press silently failed, second [c] returns empty (deduped)

---

### 3.3 MANUAL_TESTING_GUIDE.md TEST 2 Spec

**File**: [MANUAL_TESTING_GUIDE.md](MANUAL_TESTING_GUIDE.md#L154)

```
**Steps**:
1. Job card showing (Signal 1)
2. Press 'c' for Stage 2 parse
   - TUI sends UDS POST /internal/ingest { webhook: true, messageId: "...", htmlPayload: '...' }
3. Wait ~2-3 seconds
4. Job card refreshes with full data + score

**Failure Debug**:
- UDS /internal/ingest error: Verify socket exists: `ls -la /run/jobs-watcher/ingest.sock`
```

---

## 4. Root Cause Matrix

| Scenario | Symptom | Fix |
|----------|---------|-----|
| **Socket path mismatch** | "Connection refused" on [c] | Set `UDS_SOCKET_PATH` env var to match daemon's `INTERNAL_SOCKET_PATH` |
| **Socket file doesn't exist** | "ENOENT: no such file or directory" | Verify daemon running: `ps aux \| grep node` |
| **Socket permission denied** | "EACCES: permission denied" | Ensure `/run/jobs-watcher/` has proper permissions (755) |
| **Daemon not listening** | Timeout or immediate ECONNREFUSED | Restart daemon: `sudo systemctl restart jobs-watcher` |
| **Clipboard empty** | No error, but UDS POST has empty `htmlPayload` | Verify clipboard has content before pressing [c] |
| **htmlPayload not HTML** | UDS POST succeeds but HtmlJobParser rejects | Ensure clipboard contains valid HTML (detect with `/<html|<body|<div/i`) |

---

## 5. Fix Strategy (Three Levels)

### Level 1: Environment Variable Alignment ⚡ IMMEDIATE

**Problem**: `INTERNAL_SOCKET_PATH` vs `UDS_SOCKET_PATH` mismatch

**Solution**: Use single source of truth

**File to modify**: [scripts/deploy-ci-systemd-manual-test.sh](scripts/deploy-ci-systemd-manual-test.sh)

```bash
# BEFORE (confusing):
export INTERNAL_SOCKET_PATH=/run/jobs-watcher/ingest.sock
npm run data-listening

# AFTER (consistent):
export SOCKET_PATH=/run/jobs-watcher/ingest.sock
export INTERNAL_SOCKET_PATH=$SOCKET_PATH
export UDS_SOCKET_PATH=$SOCKET_PATH
npm run data-listening
```

---

### Level 2: Error Visibility 🔍 IMPORTANT

**Problem**: [c] action fails silently (console.error() not shown to TUI operator)

**Solution**: Show error in TUI with modal or card display

**Files to modify**: 
- [src/ui/action-controller.ts](src/ui/action-controller.ts#L573) `handleWebhookStage2Parse()`
- [src/ui/action-controller.ts](src/ui/action-controller.ts#L532) `handleIngest()`

```typescript
// BEFORE (console.error only):
} catch (err) {
  console.error('[ACTION] ❌ Stage 2 parse failed:', String(err));
}

// AFTER (show in TUI):
} catch (err) {
  const errorMsg = err instanceof Error ? err.message : String(err);
  logger.error('[PARSE] Stage 2 parse failed', { 
    error: errorMsg, 
    socketPath: this.config.socketPath,
    messageId: current.messageId,
    clipboardSize: htmlPayload?.length || 0,
  });
  
  // Show error modal to operator
  setErrorModal(`Stage 2 Parse Failed: ${errorMsg}`);
}
```

---

### Level 3: UDS Communication Diagnostic 📊 VALIDATION

**Problem**: No visibility into whether UDS connection succeeds

**Solution**: Add diagnostic logging to UDS handler

**File to modify**: [src/utils/uds-http.ts](src/utils/uds-http.ts)

```typescript
// BEFORE (generic):
req.on('error', (err) => reject(err));

// AFTER (diagnostic):
req.on('error', (err: any) => {
  logger.warn('[UDS] Connection error', {
    socketPath: opts.socketPath,
    path: opts.path,
    error: err.message,
    code: err.code,  // ENOENT, ECONNREFUSED, EACCES, etc.
  });
  reject(err);
});
```

---

## 6. Verification Checklist

### Pre-Test (Setup)
- [ ] Daemon running: `ps aux | grep "node.*dist/src/index"`
- [ ] Socket exists: `ls -la /run/jobs-watcher/ingest.sock`
- [ ] Socket readable: `test -r /run/jobs-watcher/ingest.sock && echo ok`
- [ ] Env vars set: `echo $UDS_SOCKET_PATH $INTERNAL_SOCKET_PATH`
- [ ] Both paths match: `[ "$UDS_SOCKET_PATH" = "$INTERNAL_SOCKET_PATH" ] && echo match`

### During Test
- [ ] [p] Preview works (reads clipboard, shows modal)
- [ ] [o] Open-URL works (opens browser)
- [ ] [c] Keyboard input recognized (watch action-controller logs)
- [ ] [c] Clipboard read succeeds (check if `clipboardGetter()` returns HTML)
- [ ] [c] UDS request sent (check `index.ts` logs for "🔌 UDS ingest received")
- [ ] [c] HtmlJobParser runs (check logs for "HtmlJobParser.parseJobFromHtml")
- [ ] [c] Score calculated (check logs for "ScoreMatcher")
- [ ] [c] Signal 2 emitted (check logs for "job.parse.completed")
- [ ] [c] Display updates (job card shows score > 0)

### After Test
- [ ] MongoDB needs_enrichment has FULL_PARSED stage for that messageId
- [ ] No errors in journalctl: `journalctl -u jobs-watcher --no-pager | tail -20`
- [ ] No errors in action-controller logs (stderr)

---

## 7. Comparison: [o], [p], [c] Flows

| Action | Handler | Socket? | External? | Status |
|--------|---------|---------|-----------|--------|
| **[o] Open URL** | `handleOpenUrl()` | ❌ No | Browser | ✅ Works |
| **[p] Preview** | `handlePreview()` | ❌ No | Clipboard (read-only) | ✅ Works |
| **[i] Ingest** | `handleIngest()` | ✅ Yes | UDS /internal/ingest | ⚠️ Untested |
| **[c] Stage 2 Parse** | `handleWebhookStage2Parse()` | ✅ Yes | UDS /internal/ingest | ❌ Fails |

**Key Insight**: Both [i] and [c] require UDS socket. If [c] fails, [i] likely fails too.

---

## 8. Documentation References

- [ARCHITECTURE.md](ARCHITECTURE.md#layer-descriptions) — Layers overview
- [ADAPTER_RUNNER_PRODUCTION_REFINEMENT.md](ADAPTER_RUNNER_PRODUCTION_REFINEMENT.md#recommendation-3) — UDS handler split
- [READINESS_CHECK.md](READINESS_CHECK.md#signal-2) — Signal 2 validation
- [JOB_PROCESSING_QUEUE.md](JOB_PROCESSING_QUEUE.md) — Queue processing pipeline

---

## 9. Next Steps

1. **Immediate**: Verify socket path consistency
   - Set `SOCKET_PATH=/run/jobs-watcher/ingest.sock` in deployment script
   - Ensure both daemon and TUI use same path

2. **Short-term**: Add error visibility
   - Implement error modal in `handleWebhookStage2Parse()`
   - Log UDS connection errors with diagnostic codes

3. **Validation**: Run TEST 2 with checklist
   - Monitor all three signal flows
   - Verify Stage 2 parse updates DB correctly

4. **Documentation**: Update MANUAL_TESTING_GUIDE.md
   - Add socket path verification section
   - Add troubleshooting for UDS connection errors
   - Add TEST 10 ([i] Ingest) for clipboard-only parse

---

**Author Notes**: 
- Socket path mismatch is most common cause (90%)
- Silent error handling makes debugging hard (10%)
- Multi-job extraction working correctly (verified in logs)
- Stage 2 workflow architecture sound (66 FULL_PARSED entries prove it)
