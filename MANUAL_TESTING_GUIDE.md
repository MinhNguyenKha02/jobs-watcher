# Manual Testing Guide - TUI Operator Actions

> **⚠️ STALE DOC NOTICE**: This guide was written for an older architecture (Signal 1→2→3 with separate `needs_enrichment`/`job_queue`/`job_trash` collections). Current architecture uses **Signal 1 (webhook)**, **Signal 2a (manual paste)**, **Signal 2b (clipboard)**, **Signal 2c (browser auto/extraction)** with a unified `job_lifecycle` collection (stage-based: PARTIAL_PARSED, FULL_PARSED, QUEUED, TRASHED, SKIPPED) and a separate `extraction_queue`. Indeed URLs from Signal 1 are **deferred to the extraction queue** (not immediately displayed). The hybrid job filter may reject jobs at ingest time. Key bindings `[b]`/`[i]` trigger Signal 2a/2b respectively. See [src/application/ingestor.ts](src/application/ingestor.ts) for current signal flow.

**Objective**: Validate all signal flows via manual operator actions in TUI.

**Prerequisites Checklist**:
- [ ] MongoDB is running: `mongosh --eval "db.version()"`  
- [ ] Daemon is active: `ps aux | grep 'node dist.*index.js' | grep -v grep`
- [ ] Systemd service running: `systemctl status jobs-watcher` or manually deployed
- [ ] Socket ready: `ls -la /run/jobs-watcher/ingest.sock` or `/run/user/$UID/jobs-watcher/ingest.sock`
- [ ] tmux is installed: `which tmux`
- [ ] .env configured with MONGODB_URI, GMAIL_CLIENT_ID, etc.
- [ ] Gmail test account ready (with Job-Alerts label)
- [ ] Port 3000 available: `netstat -tuln 2>/dev/null | grep:3000` (should be empty)
- [ ] /tmp writable: `touch /tmp/test.$$ && rm /tmp/test.$$`

---

## TEST SEQUENCING & DEPENDENCIES

**Tests 1-2: SEQUENTIAL (must run in order)**
- TEST 2 depends on job appearing from TEST 1
- Do NOT skip TEST 1 before TEST 2

**Tests 3-5: INDEPENDENT (can run in any order with fresh state)**
- Each requires clean MongoDB state
- Use `--clean` flag in eval-fetch-and-trigger.sh:
- Example: `bash scripts/eval-fetch-and-trigger.sh 1 --clean`
- Run cleanup between each test

**Tests 6-9: PARALLEL OK** (Core operator actions)
- Can run in parallel or independently
- Each generates its own test data

**Tests 10-11: MODAL PATTERN TESTS** (Requires implementation first)
- TEST 10 ([p] Preview Modal): Tests preview action enhancement
- TEST 11 ([f] Filter State Modal): Tests filter toggle with visual feedback
- Run AFTER modal components deployed

**Recommended Sequence**:
1. Run TEST 1 → 2 (sequential chain)
2. Run cleanup: `SKIP_CONFIRM=1 npm run db:truncate`
3. Run TEST 3 with: `bash scripts/eval-fetch-and-trigger.sh 1 --clean`
4. Run TEST 4 with: `bash scripts/eval-fetch-and-trigger.sh 1 --clean`
5. Run TEST 5-9 independently (current operator tests)
6. **After modal deployment**: Run TEST 10, 11 for enhanced actions

---

## SETUP: Start the 3-Pane TUI

```bash
cd /home/minh-nguyen/node_projects/jobs-watcher
bash scripts/tmux-tui-setup.sh
```

**Layout**:
- Pane 0 (top 40%): Render Server (SSE display, ANSI output)
- Pane 1 (middle 40%): Action Controller (keyboard input, IPC sender)
- Pane 2 (bottom 20%): Combined logs (tail -f render + action)

**Navigation** (inside tmux session):
- Ctrl+b o      : Cycle to next pane (0 → 1 → 2 → 0)
- Ctrl+b ;      : Toggle to previous pane  
- Ctrl+b [      : Enter scroll/copy mode (Page-Up/Down to scroll, q to exit)
- Ctrl+b {      : Swap pane up
- Ctrl+b }      : Swap pane down  
- Ctrl+b d      : Detach from session
- Ctrl+b x      : Kill current pane

---

## TEST 1: Signal 1 Webhook Flow → Extraction Queue or Display

**Goal**: Verify webhook email triggers Signal 1, jobs are extracted. Indeed URLs **defer to the extraction queue** (not immediately displayed); non-Indeed jobs display immediately in TUI. For multi-job emails (TopCV 10 jobs, Indeed 18 jobs), verify all jobs extracted.

**Multi-Job + Extraction Queue Behavior**:
- Daemon extracts ALL jobs from email envelope (via `JobExtractionService.extractAllJobs()`)
- Creates unique messageId per job: `${originalMessageId}-job-0`, `${originalMessageId}-job-1`, etc.
- For **Indeed URLs**: job is enqueued to `extraction_queue` with `PARTIAL_PARSED` stage in `job_lifecycle` — **no TUI display** until scheduler processes and Signal 2c completes
- For **non-Indeed URLs** (e.g. TopCV): job emits Signal 1 event, TUI displays immediately
- ExtractionScheduler (3 workers) dequeues jobs from `extraction_queue`, runs browser extraction, then calls Signal 2c (FULL_PARSED + BROWSER_AUTO)
- If extraction succeeds → job updated to FULL_PARSED, event emitted
- If extraction fails → fallback re-emits with existing PARTIAL_PARSED data (signal1BrowserAutoFallback)

**Steps**:

1. In Pane 1 (Action Controller), wait for idle state (TUI initialized)
2. Verify daemon is running in separate terminal:
   ```bash
   ps aux | grep "node dist" | grep -v grep
   ```
   Should show: `node /path/to/dist/index.js`
3. Run webhook trigger with multi-job email:
   ```bash
   bash scripts/eval-fetch-and-trigger.sh 1
   ```
   (Test email typically contains 10-18 jobs)
4. For **non-Indeed jobs**: Observe Pane 0 (Render Server) - job card appears:
   - "company: Company-A, position: Position-A, salary: $XXk, location: ..."
   - Prompt: "[b]rowser-parse [i]ngest-clipboard [p]review [o]pen-url [s]kip [d]iscard [j]ueue [e]dit [f]ilter"
5. For **Indeed jobs**: Check logs only — job is in extraction queue, no immediate TUI display
6. Check Pane 2 (Logs):
   - Should see: "Extracted N job(s) from email" (e.g., "Extracted 10 job(s)")
   - Should see: "Processing job 1/10 with messageId: {msgid}-job-0"
   - Should see: "Signal 1 emitted: job.generated"
   - Should see: SSE broadcasts
   - For Indeed jobs: "[webhook] Indeed URL detected — deferring to extraction queue"
7. For non-Indeed jobs: press [j] to queue → displays next job; press [b] for browser parse (Signal 2a)

**Expected**:
- ✅ Non-Indeed jobs appear in TUI within 2-3 seconds
- ✅ Indeed jobs go to extraction queue (no TUI display until scheduler processes)
- ✅ Signal 1 (job.generated) logged for each job
- ✅ Logs show extraction count: "Extracted N job(s) from email"
- ✅ ExtractionScheduler logs show worker activity

**Single-Job vs Multi-Job Behavior**:
| Scenario | Signal 1 Events | job_lifecycle Entries | TUI Display |
|----------|---|---|---|
| Single-job non-Indeed | 1 event | 1 entry (PARTIAL_PARSED) | Job displays once |
| Multi-job non-Indeed | N events | N entries | Jobs display sequentially |
| Indeed URL (any count) | 1 event | 1 entry + 1 extraction_queue | No display until Signal 2c |

**Failure Debug**:
- No job appears: Check daemon running: `ps aux | grep "node dist"` should show active process
- Pane 0 shows "No SSE connection": Check `/events` endpoint responding: `curl -v http://127.0.0.1:3000/events 2>&1 | head -5`
- Wrong data: Check EmailParser.parseMetadata() at src/services/email-parser.ts:30
- No multi-job extraction: Check logs for "Extracted N job(s)". If shows "Extracted 1 job(s)" for multi-job email, check JobExtractionService.extractAllJobs()
- Indeed job never appears: Check ExtractionScheduler logs. May be stuck on browser extraction. Restart daemon
- "Extracted 1 job(s)" but email has 10: Check if fallback to single-job parser triggered; verify HTML structure matches expected job-item patterns

---

## TEST 2: Operator [b] Browser Parse → Signal 2a Manual

**Goal**: Verify operator `[b]` key triggers Signal 2a (manual paste/browser parse), upgrades PARTIAL_PARSED to FULL_PARSED with merged fields + score. With multi-job emails, operator can parse each job independently.

> **Key difference from old [c] key**: `[b]` sends HTML payload for full parsing; `[i]` (Signal 2b) ingests clipboard as new job (no prior PARTIAL_PARSED). See ingestor.ts: `signal2aManual` vs `signal2bManual`.

**Multi-Job Signal 2a Behavior**:
- Each job from multi-job email has unique messageId: `${originalMessageId}-job-0`, `${originalMessageId}-job-1`, etc.
- Operator presses [b] to Signal 2a parse ANY job in the queue
- mergeFields logic: stage1 fields (company, url) take priority over stage2 parsed values (role, salary, location, skills)
- Different jobs can be at different stages simultaneously (Job 1 at FULL_PARSED, Job 2 at PARTIAL_PARSED)

**Prerequisites**: Completed TEST 1 (non-Indeed job showing in DISPLAY)

**Steps**:

1. Pane 0 shows Job 1 from multi-job email: "company: CompanyA, position: PositionA, salary: ..., messageId: msgid-job-0"
2. Move to Pane 1 (Ctrl+b o repeatedly or Page Down)
3. Press 'b' key for Signal 2a parse
   - TUI sends UDS POST /internal/ingest with htmlPayload
4. Wait ~2-3 seconds for parse
5. Observe Pane 0 (Render Server):
   - Job 1 card refreshes with additional fields: "Skills: ..., Experience: ..., Score: XX/100"
   - Prompt changes to routing actions: "[j]ueue [d]iscard [s]kip [e]dit [p]review"
6. Check Pane 2 (Logs):
   - Should see: "UDS /internal/ingest"
   - Should see: "[STAGE2] buildStage2Job inputs/outputs"
   - Should see: "HtmlJobParser.parseJobFromHtml() completed"
   - Should see: "ScoreMatcher.calculateJobScore() = XX/100"

**Multi-Job Test Extension** (Additional validation):

After Signal 2a:
1. Press [j] to queue Job 1 → TUI transitions to IDLE
2. Immediately displays Job 2 (still at PARTIAL_PARSED stage)
3. Verify MongoDB state:
   ```bash
   mongosh jobs_watcher --eval "
     db.job_lifecycle.find({ messageId: { \$regex: '^msgid-job' } }, 
       { messageId: 1, stage: 1, company: 1 }).pretty()
   "
   ```
   Expected: `msgid-job-0`: stage=FULL_PARSED, `msgid-job-1`: stage=PARTIAL_PARSED

**Expected**:
- ✅ Job card updates with full parsed fields + score for THAT specific job
- ✅ Prompt changes to routing actions
- ✅ Next job in queue displays at PARTIAL_PARSED stage (unaffected)

**Failure Debug**:
- 'b' key not recognized: Check Pane 1 is in focus (Ctrl+b o). Verify setClientMode() in action-controller.ts
- No display update after 3s: Check Pane 2 logs for "[STAGE2] buildStage2Job". If not present, check for errors in logs
- Score shows 0%: Verify profile.json exists at resources/profile.json
- UDS error: Verify socket exists: `ls -la /run/jobs-watcher/ingest.sock`. If missing, internal server not initialized

---

## TEST 3: Operator [j] Queue → IDLE

**Goal**: Verify 'j' routing action updates job_lifecycle stage to QUEUED, job disappears, TUI returns to IDLE.

**Prerequisites**: Completed TEST 2 (job showing full Stage 2 data)

**Steps**:

1. Job card showing with full fields and Score
2. In Pane 1, press 'j' for Queue
   - TUI sends UDS POST /internal/action { action: 'queue', messageId }
3. Wait ~1-2 seconds for routing
4. Observe Pane 0 (Render Server):
   - Job card disappears
   - Returns to IDLE (empty display, waiting for next job)
5. Check Pane 2 (Logs):
   - Should see: "UDS /internal/action action=queue"
   - Should see: "job_lifecycle updated to stage=QUEUED"

**Expected**:
- ✅ Job immediately removed from display
- ✅ TUI returns to IDLE state
- ✅ MongoDB job_lifecycle shows stage=QUEUED for that job

**Failure Debug**:
- 'j' key not recognized: Ensure Pane 1 active (Ctrl+b Page Down). Check handleQueue() in action-controller.ts
- Job visible 2+ seconds after 'j': Check ops-tui-app.ts clearCurrentJob(). May be waiting for async UDS response
- job_lifecycle not updated: Query MongoDB: `mongosh jobs_watcher --eval "db.job_lifecycle.findOne({ stage: 'QUEUED' })"`
- UDS error "Connection refused": Daemon may not have internal server listening

---

## TEST 4: Operator [d] Discard/Trash → Queue Removal

**Goal**: Verify 'd' routing action sets job_lifecycle stage to TRASHED, job disappears.

**Prerequisites**: Completed TEST 1 (fresh job in DISPLAY)

**Steps**:

1. Job card showing (Signal 1)
2. In Pane 1, press 'd' for Discard/Trash
   - TUI sends UDS POST /internal/action { action: 'trash', messageId }
3. Wait ~1-2 seconds
4. Observe Pane 0:
   - Job card disappears
   - IDLE state
5. Check Pane 2:
   - Should see: "UDS /internal/action action=trash"
   - Should see: "job_lifecycle updated to stage=TRASHED"

**Expected**:
- ✅ Job_lifecycle stage updated to TRASHED
- ✅ Job removed from display

**Failure Debug**:
- 'd' key not recognized: Ensure Pane 1 active (Ctrl+b Page Down). Check handleTrash() in action-controller.ts
- MongoDB not updated: Query: `mongosh jobs_watcher --eval "db.job_lifecycle.findOne({ stage: 'TRASHED' })"`

---

## TEST 5: Operator [s] Skip → Display Removal

**Goal**: Verify 's' routing action sets job_lifecycle stage to SKIPPED, job disappears.

**Prerequisites**: Completed TEST 1 (fresh job in DISPLAY)

**Steps**:

1. Job card showing
2. In Pane 1, press 's' for Skip
3. Wait ~1 second
4. Observe Pane 0:
   - Job card disappears
   - IDLE state
5. Check Pane 2:
   - Should see: "UDS /internal/action action=skip"
   - Should see: "job_lifecycle updated to stage=SKIPPED"

**Expected**:
- ✅ Job removed from display
- ✅ job_lifecycle stage updated to SKIPPED
- ✅ No QUEUED/TRASHED side effects

**Failure Debug**:
- 's' key not recognized: Ensure Pane 1 active (Ctrl+b Page Down). Check handleSkip() in action-controller.ts
- Stage not SKIPPED: Query: `mongosh jobs_watcher --eval "db.job_lifecycle.findOne({ stage: 'SKIPPED' })"`
- No log output: Check Pane 2 for UDS errors

---

## TEST 6: Operator [i] Ingest Clipboard → Signal 2b (Direct Clipboard Ingest)

**Goal**: Verify clipboard ingestion via `[i]` calls Signal 2b (signal2bManual), directly creating FULL_PARSED job with BROWSER_CLIPBOARD source. Skips PARTIAL_PARSED stage entirely.

**Prerequisites**: 
- TUI running in Pane 0
- Valid HTML job listing prepared (TopCV format or similar)

**Steps**:

1. TUI in IDLE state (no job displayed)
2. In Pane 1, press 'i' for Ingest Clipboard
   - Operator provides HTML (via paste or clipboard buffer)
3. Wait ~2-3 seconds for parse + filter + upsert
4. Check Pane 2:
   - Should see: "UDS /internal/ingest"
   - Should see: "[INGEST] signal2bManual"
   - Should see: "HtmlJobParser.parseJobFromHtml() completed"
   - Should see: "hybridJobFilter" evaluation
   - If hybrid filter rejects: job is SKIPPED, log shows reject reason
5. If job passes filter: Observe Pane 0:
   - Job card appears with FULL data (stage=FULL_PARSED, source=BROWSER_CLIPBOARD)
   - Score visible
   - **No PARTIAL_PARSED intermediate state**
   - Prompt: "[j]ueue [d]iscard [s]kip [e]dit [p]review"

**Expected**:
- ✅ Clipboard path skips PARTIAL_PARSED entirely
- ✅ Job appears with full parsed + scored data
- ✅ messageId generated as 'clip-...'
- ✅ hybridJobFilter evaluated; rejected jobs silently skipped
- ✅ E11000 duplicate role+company → silently skipped (not a failure)

**Failure Debug**:
- 'i' key not recognized: Ensure Pane 1 active (Ctrl+b Page Down). Check handleIngest() in action-controller.ts
- Job doesn't appear: Check Pane 2 logs for "hybridJobFilter rejected" or "Duplicate role+company"
- Score missing: Check ScoreMatcher runs. Verify profile.json exists
- Signal 1 appears in logs: Indicates source detection failed. Check parseSourceType() in ingestor.ts

---

## TEST 7: Operator [e] Edit + Routing

**Goal**: Verify 'e' key spawns external editor (nano), allows job editing, then routes.

**Status**: ⚠️ IN PROGRESS - Daemon integration incomplete + Modal pattern READY FOR IMPLEMENTATION

**UX Enhancement Status**: 🟡 MEDIUM Priority - Confirmation modal opportunity (see MODAL_PATTERN_ANALYSIS.md)

**Prerequisites**: Job displayed at Signal 2 (after completing TEST 2 with [c] parse) OR Signal 1 (fresh from TEST 1)

**Steps**:

1. Job card showing in Pane 0
2. In Pane 1, press 'e' for Edit
   - Should see: "Opening editor..." message
   - External editor (nano) spawns showing job JSON
3. Edit job fields (e.g., change company name, add skills, etc.)
4. Save and exit editor (Ctrl+X in nano)
5. TUI re-displays modified job with changes reflected
6. Prompt shown: "Confirm routing? [j]ueue [d]iscard [s]kip"
7. Press 'j' to queue with edits
   - TUI sends UDS POST /internal/action { action: 'queue', messageId, editedKVs: { company: 'NewName', ... } }
8. Wait ~1-2 seconds
9. Observe Pane 0:
   - Job card disappears
   - IDLE state
10. Check Pane 2:
    - Should see: "editedKVs extracted" with new values
    - Should see: "job_queue INSERT with merged: {...newValues...}"
    - Should see: "Signal 3 with edits applied"

**Expected**:
- ✅ External editor launches and displays job JSON
- ✅ Edits parsed and merged with original job
- ✅ Signal 3 includes edited KVs in audit trail
- ✅ MongoDB job_queue has merged fields

**UX Enhancement (Future Modal Pattern)**:
- 🟡 READY FOR IMPLEMENTATION: Confirmation modal after editor save
- Would show diff: `Old: {...} → New: {...}` before routing confirmation
- Improves operator confidence (verify changes before queue/trash/skip)
- See [MODAL_PATTERN_ANALYSIS.md](MODAL_PATTERN_ANALYSIS.md#1.2-operator-action-implementations) for implementation details

**Failure Debug**:
- 'e' key not recognized: Ensure Pane 1 active (Ctrl+b Page Down). Check handleEdit() in action-controller.ts:180
- Editor doesn't spawn: Verify nano/vim installed: `which nano`. Check EDITOR env var: `echo $EDITOR`
- Job not refreshed after save: Check if editor spawn is async-awaited. May need manual confirmation step
- Edited fields lost: Check mergeEditedFields() in shared-tui-state.ts. Query MongoDB for editedKVs: `mongosh jobs_watcher --eval "db.job_queue.findOne({}, { editedKVs: 1 })"`
- Signal 3 doesn't include edits: Check if editedKVs serialized. Grep logs: "editedKVs extracted"
- ⚠️ **KNOWN GAP**: editedKVs currently stored locally in TUI but NOT sent to daemon. To verify if edits routed: Check daemon logs for "editedKVs merged" message. If absent, UDS POST /internal/action with editedKVs payload not yet implemented. See [src/ui/action-controller.ts](src/ui/action-controller.ts#L500) for editor integration.

---

## TEST 8: 5+ Concurrent Webhook Jobs (Burst Test)

**Goal**: Verify daemon handles rapid webhook ingestion, TUI buffers properly, no job loss.

**Prerequisites**: 
- Daemon fully running
- TUI running in Pane 0
- Gmail test account has 5+ emails with job alerts

**Steps**:

1. In Pane 1, run:
   ```bash
   bash scripts/eval-fetch-and-trigger.sh 5
   ```
2. Observe Pane 0:
   - Should see 5 job cards appear sequentially or near-simultaneously
   - Each should display fully (company, position, etc.)
   - **No cards should be skipped or lost**
3. For each job, operator performs routing action ([j/d/s]) in Pane 1
4. After 5 routing actions, TUI returns to IDLE
5. Check Pane 2 (Logs):
   - Should see 5x Signal 1 emitted
   - Should see 5x action routing completed
   - No "lost job" messages
6. Verify MongoDB:
   ```bash
   mongosh --eval "db.getSiblingDB('jobs_watcher').job_lifecycle.countDocuments({ stage: 'QUEUED' })"
   ```
   - Should show queued count matching [j] actions

**Expected**:
- ✅ All jobs displayed (no loss)
- ✅ TUI responsive even under high load
- ✅ MongoDB reflects all routing decisions

**Failure Debug**:
- Fewer than 5 jobs appear: Check Pane 2 logs for "[SSE] job.generated" count. Should see 5 signals emitted
- TUI freezes: May be overloaded. Check memory: `free -h`. Restart daemon if needed
- MongoDB count wrong: Check if operator actions weren't routed: `mongosh jobs_watcher --eval "db.job_lifecycle.find({}, { stage: 1 }).pretty()"`
- Some events lost: Verify SSE event buffer size. Check src/services/sse-server.ts (LRUCache max: 100)

---

## TEST 9: Operator [f] Filter Toggle (IN PROGRESS)

**Goal**: Verify 'f' key toggles job filtering mode, sends UDS routing action, daemon processes filter state change.

**Status**: ⚠️ IN PROGRESS - State feedback incomplete + Modal pattern READY FOR IMPLEMENTATION

**UX Enhancement Status**: 🔴 HIGH Priority - Filter state modal opportunity (see MODAL_PATTERN_ANALYSIS.md)

**Prerequisites**:
- Daemon running with `filterEnabled = false` (default in src/index.ts line 32)
- TUI running with Pane 0 showing at least one job
- Pane 2 (Logs) visible for debug observation

**Steps**:

1. Job card displaying in Pane 0
2. In Pane 1, press 'f' for Filter Toggle
   - Should see: "Toggling filter mode..." message (or similar)
   - TUI attempts to toggle filter state (ON → OFF or OFF → ON)
3. Check Pane 2 (Logs) for routing message:
   - Should see: "Action sent via UDS" or similar confirmation
   - UDS sends POST /internal/action with { action: 'filter_toggle', messageId: '...', timestamp: ... }
4. Wait ~1 second for daemon to process
5. Check Pane 2 for daemon response:
   - Expected: "filterEnabled toggled to [true|false]"
   - Expected: Filter state broadcast back to TUI via SSE (if implemented)
6. Verify daemon logs (from Pane 2 or systemctl journal):
   ```bash
   journalctl -u jobs-watcher -n 50 | grep -i "filter"
   ```
   - Should show filter toggle event received and processed

**Expected**:
- ✅ UDS POST /internal/action received by daemon
- ✅ Daemon logs show "filter_toggle" action processed
- ✅ Global `filterEnabled` state updated in daemon (check `src/index.ts` line 32)
- ⚠️ TUI state feedback (previousState/newState) may show as null (known gap)

**UX Enhancement (Future Modal Pattern)**:
- 🔴 HIGH Priority: State feedback modal showing "Filter: OFF→ON ✓" confirmation
- Daemon should return new filter state in UDS 202 response
- Would eliminate null state feedback and provide operator confirmation
- Critical for TEST 9 validation and operator confidence
- See [MODAL_PATTERN_ANALYSIS.md](MODAL_PATTERN_ANALYSIS.md#executive-summary) for implementation roadmap

**Failure Debug**:
- 'f' key not recognized: Ensure Pane 1 active (Ctrl+b Page Down). Check handleFilterToggle() in [src/ui/action-controller.ts](src/ui/action-controller.ts#L750)
- UDS POST not sent: Check if UDS socket exists: `ls -la /run/jobs-watcher/ingest.sock`. Verify daemon listening: `lsof | grep ingest.sock`
- Daemon doesn't receive action: Check daemon logs: `journalctl -u jobs-watcher -n 100 | grep "filter_toggle"`. If empty, UDS connection failed
- No filter behavior change: Verify filter logic in src/services/sse-server.ts isSignalEvent() filter (lines 79-87). Filter state affects which events broadcast to TUI
- State feedback null: Known gap - TUI logs previousState/newState as null (no state object returned from daemon). See [src/ui/action-controller.ts](src/ui/action-controller.ts#L760) for details
- Cannot trace event: Add debug log in daemon: `console.log('[FILTER_TOGGLE]', { previousState: filterEnabled, newState: !filterEnabled })`

**Next Action** (Post-Verification):
- [ ] Implement state feedback: Daemon should return new filter state to TUI
- [ ] Add SSE broadcast of filter state change (optional, for real-time sync)
- [ ] Add confirmation UI in TUI showing new filter mode (ON/OFF)

---

## TEST 10: Operator [p] Preview Modal (NEW - Modal Pattern)

**Goal**: Verify 'p' key displays clipboard preview in modal viewer with pagination and dismiss controls.

**Status**: ✅ IMPLEMENTED


**Prerequisites**: Job displayed with full parsed data (Signal 2 or later)

**Steps**:

1. Job card showing in Pane 0 (full Stage 2 data with score)
2. In Pane 1, press 'p' for Preview
   - Should see: Clipboard preview modal appears
3. Modal displays clipboard page:
   ```
   [CLIPBOARD PREVIEW]
   ┌────────────────────────────┐
   │ raw/html clipboard content │
   │ rendered line-by-line      │
   │ ...                        │
   └────────────────────────────┘
   [Page 1/3] [↑↓] scroll | [q/esc] close
   ```
4. Press [↓] arrow key to scroll down
   - Should see: Page indicator updates to [Page 2/3]
5. Press [Esc] to close
   - Should see: Modal closes, job display resumes
6. Open modal again, then press [q] to close
   - Should see: Modal closes, job display resumes

**Expected**:
- ✅ Clipboard content shown in paginated modal view
- ✅ Pagination working: [Page X/Y] indicator accurate
- ✅ Arrow keys [↑/↓] scroll content
- ✅ [q] or [Esc] closes modal gracefully

**Failure Debug**:
- 'p' key not recognized: Check Pane 1 active. Verify handlePreview() in [src/ui/action-controller.ts](src/ui/action-controller.ts#L308)
- Modal doesn't appear: Check if modal rendering integrated in ops-tui-app.ts (should dispatch to PreviewViewerModal component)
- Content truncated: Verify clipboard content stored in modal state. Check src/ui/shared-tui-state.ts for PREVIEW_VIEWER payload
- Pagination broken: Check terminal height detection. Should use `process.stdout.rows` or `tput lines`
- Arrow keys don't scroll: Verify keyboard handler dispatches [↑/↓] to modal when active
- Colors not showing: Check TERM env var supports colors. Fallback to plain text if needed

**UX Enhancement Status**: ✅ IMPLEMENTED
- Modal closes on `q` and `Esc`
- Arrow keys drive page navigation in preview modal
- See [MODAL_IMPLEMENTATION_SPEC.md](MODAL_IMPLEMENTATION_SPEC.md#22-preview-viewer-modal-component) for implementation

---

## TEST 11: Operator [f] Filter State Modal (NEW - Modal Pattern)

**Goal**: Verify 'f' key displays filter state modal with confirmation showing new state.

**Status**: 🟡 READY FOR IMPLEMENTATION - Modal pattern spec complete (requires daemon UDS response enhancement)

**Prerequisites**:
- Daemon running with `filterEnabled = false` (default in src/index.ts line 32)
- TUI running with Pane 0 showing at least one job
- Pane 2 (Logs) visible for observation

**Implementation Requirement** (Daemon Side):
- UDS POST /internal/action endpoint should return 202 response with body:
  ```json
  {
    "status": "success",
    "filterEnabled": true,
    "message": "Filter toggled"
  }
  ```

**Steps**:

1. Job card displaying in Pane 0
2. In Pane 1, press 'f' for Filter Toggle
   - TUI sends UDS POST /internal/action { action: 'filter_toggle', messageId: '...', timestamp: ... }
3. **NEW**: Modal appears showing state transition:
   ```
   ┌─ Filter Status ───────────────┐
   │ OFF → ON ✓                    │
   └───────────────────────────────┘
   ```
4. Modal auto-dismisses in 1.5 seconds
5. Observe Pane 0:
   - Job card resumes normal display
   - No job removed (filtering affects broadcast, not routing)
6. Check Pane 2 (Logs):
   - Should see: "filterEnabled toggled to true"
   - Should see: "Modal auto-dismissed"

**Expected**:
- ✅ Modal appears immediately after [f] keystroke
- ✅ State transition shown (OFF→ON or ON→OFF) with ✓ checkmark
- ✅ Modal auto-dismisses after 1.5 seconds (no user action required)
- ✅ Job display resumes after modal closes
- ✅ No null state feedback (TUI parses daemon UDS response)

**Failure Debug**:
- 'f' key not recognized: Check Pane 1 active. Verify handleFilterToggle() in [src/ui/action-controller.ts](src/ui/action-controller.ts#L750)
- Modal doesn't appear: Check if modal rendering integrated in ops-tui-app.ts (should dispatch to FilterStateModal component)
- State shows null: Daemon UDS response not returning {filterEnabled: boolean}. Check /internal/action handler in src/index.ts
- Modal doesn't auto-dismiss: Check timer logic in checkModalExpiry() function in shared-tui-state.ts. May need to adjust expiry timeout
- Colors not showing: Check TERM env var. Verify ANSI codes for state transitions

**UX Enhancement Status**: 🟢 READY FOR IMPLEMENTATION (MEDIUM Priority)
- Eliminates null state feedback from TEST 9
- Provides visual confirmation of filter toggle
- Improves operator confidence in state management
- See [MODAL_IMPLEMENTATION_SPEC.md](MODAL_IMPLEMENTATION_SPEC.md#22-filter-state-modal-component) for implementation

---

## TEST 7 Enhanced: [e] Edit Confirmation Modal (UPDATED)

**Current Status**: Modal pattern implementation ready (see MODAL_IMPLEMENTATION_SPEC.md section 2.1)

**Modal Flow** (Replaces immediate routing):
1. User presses [e]
2. External editor (nano) spawns with job JSON
3. User edits fields and saves
4. **NEW**: Confirmation modal appears showing diff:
   ```
   ┌─ Diff Preview ────────────┐
   │ company:
   │   Original: "OldCo"
   │   New:      "NewCo" ✓
   └───────────────────────────┘
   [A]pply  [D]iscard
   ```
5. User presses [A]pply:
   - Modal closes
   - Job updates to show new values
   - Prompt stays at "[j]ueue [d]iscard [s]kip [e]dit"
6. User can now press [j] to queue with merged edits

**Expected After Modal Implementation**:
- ✅ Diff preview shows only changed fields (ANSI colors: original gray, new green)
- ✅ [A]pply button confirms edits and closes modal
- ✅ [D]iscard button reverts to original and closes modal
- ✅ Edit and routing are SEPARATED (user chooses routing action after confirming edits)
- ✅ Daemon receives editedKVs with [j] routing (not immediately after edit)

**Verification Checklist**:
- [ ] Modal renders with correct ANSI styling (see MODAL_QUICK_REFERENCE.md for color scheme)
- [ ] Diff algorithm correctly identifies changed fields only
- [ ] [A]pply/[D]iscard buttons respond to keypresses
- [ ] Job state updates in shared-tui-state.ts after [A]pply
- [ ] Routing prompt appears after modal closes (allows [j/d/s])

**Implementation Reference**: [MODAL_IMPLEMENTATION_SPEC.md](MODAL_IMPLEMENTATION_SPEC.md#21-edit-confirmation-modal)

---

## Deployment Setup (Before Starting Tests)

**Prerequisites Verification**:
```bash
# 1. Verify MongoDB is running
mongosh --eval "db.adminCommand('ping')"

# 2. Verify systemd service (if deployed)
sudo systemctl status jobs-watcher.service

# 3. Verify daemon is running (manual or systemd)
ps aux | grep "node dist/src/index.js" | grep -v grep

# 4. Verify socket is ready
ls -la /run/user/$(id -u)/jobs-watcher/ingest.sock || ls -la /run/jobs-watcher/ingest.sock

# 5. Start TUI session
bash scripts/tmux-tui-setup.sh

# 6. **OPTIONAL**: Clean MongoDB before tests
SKIP_CONFIRM=1 npm run db:truncate

# OR: Use --clean flag in deploy script
./scripts/deploy-with-manual-test.sh --clean
```

**Systemd Troubleshooting**:
If service fails to start:
```bash
# Check systemd errors
sudo journalctl -u jobs-watcher -n 50

# Verify socket path detection
echo $XDG_RUNTIME_DIR
ls -la /run/user/$(id -u)/

# Reset and restart
sudo systemctl daemon-reload
sudo systemctl restart jobs-watcher
```

---

## Manual Test Execution Log Template

```markdown
## Execution: [DATE] [TIME]

### Pre-Test
- [ ] Daemon running: ps aux | grep "node dist"
- [ ] MongoDB: mongosh --eval "db.health()"
- [ ] TUI session: tmux list-sessions | grep jobs
- [ ] Gmail test emails available

### TEST 1: Signal 1 Flow
- Duration: ___ seconds
- Result: [PASS / FAIL]
- Notes: ___

### TEST 2: Operator [b] Browser Parse (Signal 2a)
- Duration: ___ seconds
- Result: [PASS / FAIL]
- Notes: ___

### TEST 3: Operator [j] Queue
- Duration: ___ seconds
- Result: [PASS / FAIL]
- Notes: ___

### TEST 4: Operator [d] Trash
- Result: [PASS / FAIL]
- Notes: ___

### TEST 5: Operator [s] Skip
- Result: [PASS / FAIL]
- Notes: ___

### TEST 6: Operator [i] Ingest Clipboard
- Result: [PASS / FAIL]
- Notes: ___

### TEST 7: Operator [e] Edit
- Result: [PASS / FAIL]
- Notes: ___

### TEST 8: Burst Test (5 jobs)
- Duration: ___ seconds
- Jobs processed: 5/5
- Result: [PASS / FAIL]
- Notes: ___

### Post-Test Cleanup
- [ ] Kill TUI: tmux kill-session -t jobs
- [ ] Stop daemon: systemctl stop jobs-watcher (or kill PID)
- [ ] Verify no orphaned processes

### Summary
- [ ] All tests passed
- [ ] No job loss observed
- [ ] No UI glitches
- [ ] Logs clean (no errors)
```

---

## Troubleshooting Quick Reference

| Symptom | Check |
|---------|-------|
| TUI not starting | tmux installed? UDP socket exists ls -la /run/jobs-watcher/? |
| No SSE events | Daemon running? Change-stream connection? MongoDB auth? |
| Keyboard input ignored | Action controller pane active (Ctrl+b PgDn)? Stdin wired? |
| Job not routed | UDS /internal/action responding? Check logs for 422/500 errors |
| Editor not spawning | nano installed? EDITOR env var set? |
| Scores not calculated | Profile data exists? src/services/score-matcher.ts working? |

---

## TEST 7 & TEST 9: Modal Pattern Readiness

**Current Implementation**: Modal overlays implemented for edit, filter, and preview  
**Gap Analysis**: See [MODAL_PATTERN_ANALYSIS.md](MODAL_PATTERN_ANALYSIS.md) for comprehensive assessment

### Readiness Matrix

| Test | Action | Current Gap | Modal Enhancement | Priority | Implementation Status |
|------|--------|-------------|-------------------|----------|----------------------|
| TEST 7 | [e] Edit | Confirm field changes before apply/discard | Diff modal before routing | 🟡 MEDIUM | ✅ Implemented |
| TEST 9 | [f] Filter | Confirm toggle state update | State confirmation modal | 🔴 HIGH | ✅ Implemented |
| - | [p] Preview | Inspect clipboard payload with paging | Clipboard modal viewer | 🟡 MEDIUM | ✅ Implemented |

**Headless Compatibility**: ✅ YES - All modal patterns are TTY-independent (formatted stderr text)

### Implementation Checklist

**Modal Pattern Verification Checklist**:
- [x] Modal dispatch in shared-tui-state.ts
- [x] [e] edit confirmation modal wired in action-controller.ts
- [x] [f] filter state modal wired in action-controller.ts
- [x] [p] preview modal with pagination
- [ ] Update/add automated tests for modal keyboard flows

**Residual Risk**:
- Modal behavior depends on state-file sync timing between render and action processes.
- Manual regression on [q]/[Esc]/arrow behavior should be run after any keyboard mapping changes.

---

## Next Steps

After manual validation passes:
1. Create automated integration tests (Jest)
2. Load test with 100+ jobs
3. Production deployment
