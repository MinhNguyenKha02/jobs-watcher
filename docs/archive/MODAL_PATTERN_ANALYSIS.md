# Modal Pattern Implementation Analysis - jobs-watcher TUI

**Date**: 2026-04-16  
**Scope**: UX polish opportunities for operator actions via modal patterns  
**Status**: Analysis Complete

---

## EXECUTIVE SUMMARY

Current implementation uses **pure stderr logging** (no modal overlays). Modal patterns represent significant **UX polish opportunity** for three operator actions:

| Action | Current | Gap | UX Improvement |
|--------|---------|-----|-----------------|
| `[e] Edit` | Editor opens, logs changes | ❌ No confirmation after save | **Confirmation modal**: show diff before routing |
| `[f] Filter` | Sends UDS, logs toggle | ❌ No state feedback | **State modal**: "Filter: OFF→ON" with confirmation |
| `[p] Preview` | Logs to stderr | ❌ No modal display | **Modal viewer**: centered card with pagination |

**Current Modal Support**: **0/3 (NO)** - Pure logger implementation  
**Headless Mode Compatibility**: **✅ YES** - All modal patterns can be stderr-friendly (text-based with no TTY requirement)  
**Implementation Complexity**: Medium (requires shared-tui-state.ts extensions + action-controller.ts modal dispatch)

---

## 1. CURRENT IMPLEMENTATION STATUS

### 1.1 Headless Mode Assessment

**Finding**: Truly headless (pure stderr-only)

```typescript
// src/ui/action-controller.ts:650
mode: 'HEADLESS' // Logged when TTY unavailable
```

- **No UI overlays** in headless mode
- **All output** to logger (stderr) with action tags: `[EDIT]`, `[FILTER]`, `[PREVIEW]`, etc.
- **No TTY-dependent components** in main action loop
- **Headless Compatibility**: Modal patterns would **NOT break** headless compatibility if implemented as formatted stderr text

---

### 1.2 Operator Action Implementations

#### **[e] Edit Action** (`src/ui/action-controller.ts:480-550`)

```typescript
private async handleEdit(): Promise<void> {
  // 1. Spawn editor (nano/vim/nvim)
  const editor = spawn(editorPath, [tempFile], { stdio: 'inherit', detached: false });
  
  // 2. Wait for editor to close
  await new Promise<void>((resolve) => {
    editor.on('exit', () => resolve());
  });
  
  // 3. Read edited file + compute diff
  const editedKVs = this.computeDiff(originalRecord, editedJob);
  
  // 4. LOG to stderr only
  logger.info('[EDIT] Job modified in editor', {
    fieldsChanged: changedFields,
    fieldsCount: changedFields.length,
  });
  
  // 5. Store locally in shared-tui-state
  setEditedFields(editedKVs);
  // ❌ NO CONFIRMATION MODAL SHOWN
}
```

**Gap**: After editor closes and diff computed, NO confirmation modal displayed. User sees only stderr log.  
**UX Issue**: User doesn't know if edits will be applied or skipped until routing action ([j/d/s]) pressed.

---

#### **[f] Filter Toggle** (`src/ui/action-controller.ts:665-681`)

```typescript
private async handleFilterToggle(): Promise<void> {
  try {
    await this.udsWriter.filterToggle(); // Sends UDS POST /internal/action
    
    logger.info('[FILTER] Toggle requested', {
      messageId: null,
      previousState: null, // ❌ ALWAYS NULL
      newState: null,      // ❌ ALWAYS NULL
      udsTookMs: udsTook,
    });
  } catch (err) {
    logger.error('[FILTER] Toggle failed', { error: message });
  }
}
```

**Gap**: `previousState` and `newState` logged as `null` (known limitation in MANUAL_TESTING_GUIDE.md line 460).  
**Root Cause**: Daemon toggles filter state in-process, but doesn't return new state to TUI.  
**UX Issue**: User receives no visual confirmation of filter state change (ON→OFF or OFF→ON).

---

#### **[p] Preview Action** (`src/ui/action-controller.ts:308-351`)

```typescript
private async handlePreview(): Promise<void> {
  const current = getCurrentJob();
  
  // 1. Log job metadata
  logger.info('[PREVIEW] Current job loaded', {
    messageId: current.messageId,
    company: jobData.company,
    position: jobData.position,
    salary: jobData.salary,
    location: jobData.location,
  });
  
  // 2. Log clipboard content snippet
  logger.info('[PREVIEW] Clipboard content available', {
    byteLength: clipboardHtml.length,
    plainTextPreview: plainText.substring(0, 100),
  });
  // ❌ NO MODAL VIEWER, JUST LOGS
}
```

**Gap**: Preview displays only first 100 chars of clipboard; full content not visible.  
**UX Issue**: Operator can't see full job+clipboard context before routing decision.

---

### 1.3 State Management (`src/ui/shared-tui-state.ts`)

**Current State Interface**:
```typescript
export interface CurrentJobState {
  version: number;
  messageId: string | null;
  job: Job | null;
  stage: CurrentJobStage;
  editedFields: Record<string, unknown> | null;
  updatedAt: string | null;
}
```

**Gap**: No modal state tracking

```typescript
// ❌ MISSING:
// - modalActive: boolean (is modal showing?)
// - modalType: 'EDIT_CONFIRMATION' | 'FILTER_TOGGLE' | 'PREVIEW' | null
// - modalData: Record<string, unknown> (modal-specific context)
```

---

### 1.4 SSE Signal Filtering (`src/services/sse-server.ts:85-87`)

```typescript
function isSignalEvent(action: string | undefined | null): boolean {
  const actionLower = String(action || '').toLowerCase();
  return actionLower.includes('job.generated') ||
         actionLower.includes('job.parse.completed') ||
         actionLower.includes('job.routed');
}
```

**Finding**: Only broadcasts 3 signal events to TUI. Operator actions ([e], [f], [p]) are **NOT** broadcast as SSE events.

**Impact on Modal Patterns**: Modal feedback must come from:
1. **Local TUI action response** (via shared-tui-state)
2. **Daemon UDS response** (if implemented)
3. **NOT from SSE events** (action signals filtered out)

---

## 2. MODAL PATTERN OPPORTUNITIES

### 2.1 [e] Edit + Confirmation Modal (Priority: **HIGH**)

**Current Flow**:
```
User presses [e]
  ↓
External editor spawns (nano)
  ↓
Editor closes
  ↓
Diff computed & logged to stderr
  ↓
Job re-rendered (if [j] queued)
```

**Proposed Modal Flow**:
```
User presses [e]
  ↓
External editor spawns (nano)
  ↓
Editor closes
  ↓
MODAL SHOWN: "Edit Confirmation"
├─ Diff preview (changed fields)
├─ Original vs. New side-by-side (first 5 fields)
├─ Action buttons: [A]pply [D]iscard
  ↓
User presses [A] or [D]
  ↓
Route with/without edits
```

**Implementation**:
- Add `modalType: 'EDIT_CONFIRMATION'` to shared-tui-state.ts
- Update action-controller.ts handleEdit() to call `setModalState()` after diff computed
- Modify JobCardRenderer to detect modal state and render confirmation card (stdout)
- Capture [a]/[d] in keyboard handler with modal-aware dispatch

**Headless Compatibility**: ✅ YES
- Modal renders as formatted stderr text with field names + values
- Works with `stdio: 'inherit'` and can be captured/tested

**UX Benefit**: User sees exact changes before routing decision; prevents accidental field modifications.

---

### 2.2 [f] Filter State Modal (Priority: **MEDIUM**)

**Current Flow**:
```
User presses [f]
  ↓
UDS POST /internal/action { action: 'filter_toggle' }
  ↓
Daemon toggles filterEnabled in-process
  ↓
Logged to stderr: "[FILTER] Toggle requested" (previousState: null, newState: null)
```

**Proposed Modal Flow**:
```
User presses [f]
  ↓
UDS POST /internal/action { action: 'filter_toggle' }
  ↓
IMMEDIATE MODAL (optimistic): "Filter Toggling..."
  ├─ Shows current state
  ├─ Spinner animation
  ↓
Daemon ACKs toggle + broadcasts state via SSE (if implemented)
  ↓
MODAL UPDATED: "Filter: OFF → ON ✓"
  ├─ Shows new state
  ├─ Auto-dismiss in 1.5s
```

**Implementation**:
- Daemon: Return filter state in UDS 202 response body
  ```typescript
  // src/index.ts:750
  res.end(JSON.stringify({ 
    accepted: true, 
    filterEnabled: !filterEnabled  // NEW
  }));
  ```
- TUI: Parse UDS response and update shared-tui-state
  ```typescript
  // src/ui/components/UdsActionWriter.ts:230
  setModalState({
    type: 'FILTER_TOGGLE',
    previousState: filterEnabledBefore,
    newState: filterEnabledAfter,
    expiresAt: Date.now() + 1500, // Auto-dismiss
  });
  ```
- Renderer: Show filter state change in top banner

**Headless Compatibility**: ✅ YES
- State change rendered as stderr banner: `[FILTER_MODAL] OFF → ON`
- No TTY required for text rendering

**UX Benefit**: User gets immediate feedback that filter state changed; eliminates confusion about which filtering mode is active.

---

### 2.3 [p] Preview Modal (Priority: **MEDIUM**)

**Current Flow**:
```
User presses [p]
  ↓
Log job metadata to stderr (20 chars of each field)
  ↓
Log clipboard preview to stderr (100 chars)
  ↓
No modal shown; user must check logs
```

**Proposed Modal Flow**:
```
User presses [p]
  ↓
MODAL SHOWN: "Preview Job + Clipboard"
├─ Tab 1: Job Details
│  ├─ messageId: 12345...
│  ├─ company: TechCorp
│  ├─ position: Full-Stack Engineer
│  ├─ salary: $120-150k
│  ├─ location: San Francisco, CA
│  ├─ url: https://...
│  ├─ matchScore: 87%
│  └─ [↓ scroll ↑]
├─ Tab 2: Clipboard Preview
│  ├─ <full HTML rendered as plain text>
│  ├─ <paginated to terminal height>
│  └─ [↓ scroll ↑]
├─ Tab 3: Diff (if edits exist)
│  ├─ Changed fields (company, position, etc.)
│  └─ [↓ scroll ↑]
└─ [q]uit Modal
```

**Implementation**:
- Extend shared-tui-state.ts with modal content buffer
- Add pagination state: `currentPage: 0`, `maxPages: computed`
- Keyboard handler: [↑]/[↓] to paginate within modal
- Renderer: Detect modal type and render centered card with borders
- UDS integration: Store full clipboard + full job in modal state

**Headless Compatibility**: ✅ YES
- Modal rendered to stdout as ANSI-formatted text box
- Pagination handled via stderr status line

**UX Benefit**: Operator sees complete job+clipboard context in single view before routing decision; eliminates need to check logs.

---

## 3. GAP ANALYSIS: TEST Cases vs. Implementation

### Gap 1: Signal 1 Job Generation → TUI Render Sync

**TEST 1 Expected** (MANUAL_TESTING_GUIDE.md:64):
> Job appears in TUI within 2-3 seconds after webhook trigger

**Implementation Location**: [src/index.ts](src/index.ts#L250-266)
```typescript
async emitJobGenerated(job: any, context: { stage: string; source: string }): Promise<void> {
  const snapshot = {
    action: 'job.generated',
    messageId,
    company: job?.company,
    position: job?.position,
    // ...
  };
  await this.storage.insertActionSnapshot(snapshot);
  logger.info('[SSE] job.generated snapshot recorded (Signal 1)');
}
```

**Render Server** [src/ui/ops-tui-app.ts](src/ui/ops-tui-app.ts#L75-100):
```typescript
this.sseReader.addEventListener('job.generated', (event: any) => {
  const job = { messageId, company, position, ... };
  setCurrentJob(messageId, job, 'PARTIAL');
});
```

**✅ ALIGNED**: Signal 1 flow correctly emits → renders

---

### Gap 2: setCurrentJob Propagation Timing

**TEST 1 → TEST 7 Dependency**: Job displayed in Pane 0 before [e] can be pressed

**Implementation**:
```typescript
// src/ui/shared-tui-state.ts:130
export function setCurrentJob(messageId: string, job: Job, stage: CurrentJobStage): void {
  persist({
    version: STATE_VERSION,
    messageId,
    job,
    stage,
    editedFields: null,
    updatedAt: new Date().toISOString(),
  });
}

// src/ui/ops-tui-app.ts:310
const unwatch = watchStateFile((state) => {
  logger.info('[RENDER] State changed', { messageId: state.messageId });
  // Re-render triggered
});
```

**Gap Identified**: `watchStateFile()` debounced to 100ms. In high-frequency scenarios, state transitions may batch.

**Severity**: LOW (100ms debounce acceptable for UI)  
**Fix Priority**: LOW

---

### Gap 3: [e] Edit → UDS Action Response Handling

**TEST 7 Expected** (MANUAL_TESTING_GUIDE.md:286-310):
> After pressing [e], editor saves, TUI should show confirmation

**Current Implementation** [src/ui/action-controller.ts](src/ui/action-controller.ts#L500-520):
```typescript
// 5. Read edited file
const editedJson = readFileSync(tempFile, 'utf8');
const editedJob = JSON.parse(editedJson);

// 6. Compute diff
const editedKVs = this.computeDiff(originalRecord, editedJob);

logger.info('[EDIT] Job modified in editor', {
  fieldsChanged: changedFields,
});

setEditedFields(editedKVs); // ✓ Stored locally
```

**Gap**: No modal shown after `setEditedFields()` call.

```typescript
// ❌ MISSING:
// setModalState({
//   type: 'EDIT_CONFIRMATION',
//   editedKVs: editedKVs,
//   originalJob: originalRecord,
// });
```

**Daemon Perspective** [src/index.ts](src/index.ts#L700-770):
```typescript
} else if (action === 'queue') {
  // Merge editedKVs into job_queue
  const merged = enrichedJob ? { ...enrichedJob, ...editedKVs } : { messageId, ...editedKVs };
  // Insert to job_queue ✓
  logger.info('✓ Job queued with merged editedKVs');
}
```

**Severity**: HIGH (affects TEST 7 feedback)  
**Fix Priority**: HIGH - Implement edit confirmation modal

---

### Gap 4: [f] Filter Toggle State Feedback

**TEST 9 Expected** (MANUAL_TESTING_GUIDE.md:370-430):
> TUI logs show "Filter: OFF→ON" with confirmation

**Current Implementation** [src/ui/action-controller.ts](src/ui/action-controller.ts#L673-675):
```typescript
logger.info('[FILTER] Toggle requested', {
  messageId: null,
  previousState: null, // ❌ Always null
  newState: null,      // ❌ Always null
  udsTookMs: udsTook,
});
```

**Root Cause**: Daemon response not parsed by TUI

```typescript
// src/ui/components/UdsActionWriter.ts:230
private async sendAction(payload: ActionPayload): Promise<void> {
  try {
    const res = await postJsonOverUds(this.udsOpts, payload);
    // ❌ IGNORES RESPONSE BODY
    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw new Error(`Action failed: ${res.statusCode}`);
    }
    logger.debug(`✓ Action sent: ${payload.action}`);
    // ❌ NOT: const body = JSON.parse(res.body);
    //         setModalState({ previousState, newState: body.filterEnabled });
  }
}
```

**Daemon** [src/index.ts](src/index.ts#L740-751):
```typescript
} else if (action === 'filter_toggle') {
  filterEnabled = !filterEnabled;
  logger.info(`🔄 Filter toggled`, { filterEnabled });
  // ❌ Response body doesn't include new state:
  //    res.end(JSON.stringify({ accepted: true }));
}
```

**Severity**: HIGH (TEST 9 validation incomplete)  
**Fix Priority**: HIGH
- Daemon: Return `{ accepted: true, filterEnabled: newValue }`
- TUI: Parse response and update shared-tui-state with modal

---

### Gap 5: [p] Preview Action → Full Content Context

**TEST 1-6 Prerequisites**: Operator needs to see full job+clipboard before routing

**Current Implementation** [src/ui/action-controller.ts](src/ui/action-controller.ts#L320-345):
```typescript
logger.info('[PREVIEW] Current job loaded', {
  messageId: current.messageId,
  stage: current.stage,
  company: jobData.company,
  position: jobData.position,
  // ❌ Omits: url, description, full salary, full location
});

logger.info('[PREVIEW] Clipboard content available', {
  byteLength: clipboardHtml.length,
  plainTextPreview: plainText.substring(0, 100), // ❌ Truncated to 100 chars
});
```

**Gap**: Full job metadata and clipboard content not accessible from preview.

**Severity**: MEDIUM (affects operator decision-making quality)  
**Fix Priority**: MEDIUM - Implement full-content preview modal

---

## 4. HEADLESS MODE COMPATIBILITY ASSESSMENT

### 4.1 Current Headless Mode

**Definition**: HEADLESS=1 env var disables TTY-dependent components

**Current Behavior**:
- No interactive keyboard handler
- No ANSI terminal raw mode
- All output to stderr as structured logs
- **No UI components at all** (pure daemon operation)

---

### 4.2 Modal Patterns in Headless Mode

**Concern**: Do modal patterns require TTY/interactive input?

**Answer**: NO - Proposed modal patterns are **TTY-independent**

**Reasoning**:
1. **Modals rendered as formatted stderr text** (not ANSI escape codes)
2. **State stored in shared-tui-state.json** (queryable by external tools)
3. **No keyboard input required** (modals auto-dismiss after confirmation)
4. **Headless mode can skip modal rendering** entirely

**Implementation Strategy**:
```typescript
// src/ui/action-controller.ts:500
if (modeContext.isHeadless) {
  // Headless: Just log to stderr, no modal state
  logger.info('[EDIT_HEADLESS] Edits recorded', { editedKVs });
} else {
  // Interactive: Show modal
  setModalState({
    type: 'EDIT_CONFIRMATION',
    editedKVs,
  });
}
```

---

### 4.3 Headless + Modal Compatibility: ✅ YES

Modal patterns **enhance** (not break) headless mode by:
- Adding queryable state (modal type, content)
- Enabling CI/CD to validate TUI flow without TTY
- Allowing external modal injection via shared-tui-state.json

---

## 5. IMPLEMENTATION PRIORITY RANKING

| Issue | Priority | Effort | Impact | Notes |
|-------|----------|--------|--------|-------|
| **[e] Edit Confirmation Modal** | 🔴 HIGH | 2-3h | HIGH | Affects TEST 7; prevents accidental edits |
| **[f] Filter State Feedback** | 🔴 HIGH | 1-2h | HIGH | Affects TEST 9; daemon UDS response parsing missing |
| **[p] Preview Full Modal** | 🟡 MEDIUM | 2h | MEDIUM | UX polish; aids operator decision-making |
| **setCurrentJob sync timing** | 🟢 LOW | <30m | LOW | 100ms debounce acceptable; only impacts stress scenarios |
| **Modal state infrastructure** | 🟡 MEDIUM | 1h | FOUNDATIONAL | Prerequisite for all 3 modal patterns |

---

## 6. RECOMMENDED CHANGES

### 6.1 shared-tui-state.ts - Add Modal State

```typescript
export type ModalType = 'EDIT_CONFIRMATION' | 'FILTER_TOGGLE' | 'PREVIEW' | null;

export interface CurrentJobState {
  // ... existing
  
  // NEW: Modal state for confirmation/feedback
  modalActive: boolean;
  modalType: ModalType;
  modalData: {
    editedKVs?: Record<string, unknown>;
    originalJob?: Record<string, unknown>;
    filterPreviousState?: boolean;
    filterNewState?: boolean;
    previewClipboard?: string;
    expiresAt?: number; // Auto-dismiss timestamp
  } | null;
}

export function setModalState(type: ModalType, data: any): void {
  const nextState = {
    ...readSharedStateFromDisk(),
    modalActive: type !== null,
    modalType: type,
    modalData: data || null,
    updatedAt: new Date().toISOString(),
  };
  persist(nextState);
  logger.info('[MODAL] State updated', { type, expiresAt: data?.expiresAt });
}
```

### 6.2 action-controller.ts - Dispatch Modals

```typescript
// [e] Edit - show confirmation modal after diff computed
private async handleEdit(): Promise<void> {
  // ... existing diff computation
  setModalState('EDIT_CONFIRMATION', {
    editedKVs,
    originalJob: current.job,
  });
}

// [f] Filter - await daemon response and show state modal
private async handleFilterToggle(): Promise<void> {
  try {
    const filterNewState = await this.udsWriter.filterToggle(); // Parse response
    setModalState('FILTER_TOGGLE', {
      filterPreviousState: !filterNewState, // Inferred from toggle
      filterNewState: filterNewState,
      expiresAt: Date.now() + 1500,
    });
  } catch (err) {
    logger.error('[FILTER] Toggle failed', { error: String(err) });
  }
}

// [p] Preview - show full modal with job + clipboard
private async handlePreview(): Promise<void> {
  const current = getCurrentJob();
  setModalState('PREVIEW', {
    previewClipboard: await clipboardGetter(), // Full content, not truncated
  });
}
```

### 6.3 JobCardRenderer.ts - Render Modals

```typescript
renderCard(job: Job | null, status: CardStatus, modalState?: any): string {
  // ... existing rendering
  
  if (modalState?.modalActive) {
    return this.renderModal(modalState.modalType, modalState.modalData);
  }
  
  return this.renderJobCard(job, status);
}

private renderModal(type: ModalType, data: any): string {
  if (type === 'EDIT_CONFIRMATION') {
    return this.renderEditConfirmationModal(data);
  } else if (type === 'FILTER_TOGGLE') {
    return this.renderFilterToggleModal(data);
  } else if (type === 'PREVIEW') {
    return this.renderPreviewModal(data);
  }
  return '';
}
```

### 6.4 Daemon - Return Filter State in UDS Response

```typescript
// src/index.ts:750
} else if (action === 'filter_toggle') {
  filterEnabled = !filterEnabled;
  logger.info(`🔄 Filter toggled`, { filterEnabled });
  
  // NOW: Return new state in response
  const responseBody = JSON.stringify({ 
    accepted: true,
    filterEnabled: filterEnabled  // NEW
  });
  res.writeHead(202, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(responseBody),
  });
  res.end(responseBody);
}
```

### 6.5 UdsActionWriter.ts - Parse Response

```typescript
async filterToggle(): Promise<boolean> {
  const payload: ActionPayload = {
    messageId: '',
    action: 'filter_toggle',
    source: 'ops-tui',
  };
  
  try {
    const res = await postJsonOverUds(this.udsOpts, payload);
    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw new Error(`Action failed: ${res.statusCode}`);
    }
    
    // NEW: Parse response and return new state
    const body = JSON.parse(res.body || '{}');
    return body.filterEnabled ?? false;
  } catch (err) {
    logger.error('[FILTER] Toggle failed', { error: String(err) });
    throw err;
  }
}
```

---

## 7. TESTING STRATEGY

### Test Cases Updated for Modal Patterns

**TEST 7 (Edit Modal)**:
```bash
# Step 1: Press [e], editor opens
# Step 2: Modify company name from "TechCorp" to "TechCorp Inc"
# Step 3: Save & exit editor
# EXPECTED: Modal shows "Edit Confirmation" with diff:
#   company: TechCorp → TechCorp Inc
# Step 4: Press [a] to apply
# Step 5: Queue action completes with edited field
```

**TEST 9 (Filter Modal)**:
```bash
# Step 1: Press [f]
# EXPECTED: Modal shows "Filter Toggling..."
# Step 2: Daemon processes, returns new state
# EXPECTED: Modal updates to "Filter: OFF → ON ✓"
# Step 3: Modal auto-dismisses after 1.5s
```

**TEST X (Preview Modal)**:
```bash
# Step 1: Press [p]
# EXPECTED: Modal shows job details + clipboard preview (full)
# Step 2: Press [↓] to scroll through content
# Step 3: Press [q] to close modal
# EXPECTED: Returns to job card
```

---

## 8. CONCLUSION

| Metric | Finding |
|--------|---------|
| **Current Modal Support** | ❌ NO (pure stderr logging) |
| **Headless Compatibility** | ✅ YES (modal patterns TTY-independent) |
| **High-Priority Gaps** | 2/5 ([e] edit confirmation, [f] filter feedback) |
| **Total Implementation Effort** | ~6-8 hours (spread across 3 modals + infrastructure) |
| **UX Improvement Impact** | **HIGH** (all 3 modals reduce operator confusion) |
| **Test Coverage Impact** | **HIGH** (enables TEST 7 & TEST 9 completion) |

**Recommendation**: Implement in priority order:
1. **Modal infrastructure** (shared-tui-state.ts) — 1h
2. **[f] Filter modal** (fastest win, TEST 9 enabler) — 1.5h
3. **[e] Edit confirmation modal** (highest impact) — 2h
4. **[p] Preview modal** (polish) — 2h

Total: ~6.5 hours for full UX polish suite.
