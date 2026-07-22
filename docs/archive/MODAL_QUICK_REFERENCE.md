---
# Modal Implementation: Quick Reference & Architecture Guide

**Date**: 2026-04-17  
**Scope**: Visual reference for implementing modals [e], [p], [f]  
**Target Audience**: Backend/TUI developers implementing the spec

---

## STATE MACHINE DIAGRAMS

### [e] Edit Modal Flow

```
JOB_DISPLAY
    │ User presses [e]
    ▼
EDITOR_OPEN ◄──── Spawn nano/vim with job.json
    │
    │ User edits & saves
    │
EDITOR_CLOSED ◄── Process exits
    │
    ├─► Compute diff
    ├─► Call setEditConfirmationModal(original, edited, diff)
    │
    ▼
MODAL_SHOWING (modal.type = 'EDIT_CONFIRMATION')
    │
    ├─ [A] Pressed ──┐
    │                └──► clearModal() (keep editedFields)
    │                      ▼
    │                   JOB_DISPLAY (with new values)
    │
    └─ [D] Pressed ──┐
                     └──► clearModal() + setEditedFields(null)
                          ▼
                       JOB_DISPLAY (original values)
```

### [p] Preview Modal Flow

```
JOB_DISPLAY
    │ User presses [p]
    ▼
READ_CLIPBOARD ◄── Get full HTML content via clipboard-getter
    │              Direct call to getClipboardContent()
    │              Returns: {hash, content, language, size}
    │
    ├─ setPreviewViewerModal(clipboard)
    │
    ▼
MODAL_SHOWING (modal.type = 'PREVIEW_VIEWER', clipboard-only)
    │ Single tab: CLIPBOARD content only
    │ (NO tab switching, NO JOB_DETAILS or DIFF tabs)
    │ Paginated: 20 lines/page by default
    │
    ├─ [↓] ──┐
    │        └──► updatePreviewPage('down')  ──► Page += 1
    │
    ├─ [↑] ──┐
    │        └──► updatePreviewPage('up')    ──► Page -= 1
    │
    └─ [Q]/[ESC] ─┐
                  └──► clearModal()
                       ▼
                    JOB_DISPLAY
```

**Refinement: Clipboard-Only Design**
- ✅ Single content tab (no tab switching logic)
- ✅ Direct clipboard integration (no temp files, no tab state)
- ✅ Simpler rendering (reduced implementation complexity)
- ✅ Estimated effort: -30 to -60 minutes vs. multi-tab design

### [f] Filter Modal Flow

```
JOB_DISPLAY
    │ User presses [f]
    ▼
UDS_POST_FILTER_TOGGLE ◄── POST /internal/action {action: 'filter_toggle'}
    │
    │ Parse UDS Response
    │ Extract: res.body.filterEnabled = new_state
    │
    ├─► setFilterStateModal(old_state, new_state)
    │
    ▼
MODAL_SHOWING (modal.type = 'FILTER_STATE')
    │ Display: "OFF → ON ✓"
    │
    │ Wait for timeout OR keypress
    │
    ├─ 1500ms elapsed ──┐
    │                   └──► checkModalExpiry()
    │                        ▼
    │                    clearModal()
    │
    └─ Any keypress ─┬──────────────────────────────┐
                     └──► clearModal()               ▼
                                               JOB_DISPLAY
```

---

## COMPONENT ARCHITECTURE

```
┌─ shared-tui-state.ts ─────────────────────────────┐
│ ┌─ CurrentJobState ──────────────────────────────┐│
│ │ job: Job                                       ││
│ │ editedFields: Record<k,v> | null              ││
│ │ modal: ModalState | null ◄─── NEW FIELD       ││
│ │   ├─ EditConfirmationModal                    ││
│ │   ├─ PreviewViewerModal                       ││
│ │   └─ FilterStateModal                         ││
│ └────────────────────────────────────────────────┘│
│                                                   │
│ Exports:                                         │
│   setCurrentJob()                                │
│   getCurrentJob()                                │
│   setEditedFields()                              │
│   clearModal()           ◄─── NEW               │
│   setEditConfirmationModal()  ◄─── NEW          │
│   setPreviewViewerModal()     ◄─── NEW          │
│   setFilterStateModal()       ◄─── NEW          │
│   updatePreviewPage()         ◄─── NEW          │
│   switchPreviewTab()          ◄─── NEW          │
└─────────────────────────────────────────────────┘
           ▲
           │ reads/writes
           │
┌─────────────────────────────────────────────────┐
│ action-controller.ts                             │
│ ┌─ dispatchAction(action) ───────────────────┐ │
│ │ if (modal active)                          │ │
│ │   handleModalInput() ◄─── NEW              │ │
│ │ else                                       │ │
│ │   handleEdit() ─────────┐                  │ │
│ │   handlePreview() ───┐  │                  │ │
│ │   handleFilterToggle()│  │                  │ │
│ │                      │  │                  │ │
│ │                      ▼  ▼                  │ │
│ │   setEditConfirmationModal()  ◄─── NEW    │ │
│ │   setPreviewViewerModal()     ◄─── NEW    │ │
│ │   setFilterStateModal()       ◄─── NEW    │ │
│ └──────────────────────────────────────────┘ │
│                                              │
│ Exports:                                     │
│   handleEditApply()      ◄─── NEW            │
│   handleEditDiscard()    ◄─── NEW            │
│   handlePreviewScrollUp() ◄─── NEW            │
│   handlePreviewScrollDown() ◄─── NEW            │
│   handlePreviewClose()   ◄─── NEW            │
│   handleFilterDismiss()  ◄─── NEW            │
└─────────────────────────────────────────────┘
           ▲
           │ dispatches to
           │
┌─────────────────────────────────────────────────┐
│ KeyboardHandler.ts                               │
│ Captures: [a], [d], [↑], [↓], [q], [ESC], [TAB] │
│ Routes modal inputs to action-controller        │
└─────────────────────────────────────────────────┘
           ▲
           │ monitors
           │
┌─────────────────────────────────────────────────┐
│ ops-tui-app.ts (Render Server)                   │
│ ┌─ renderJobCard(state) ─────────────────────┐ │
│ │ if (state.modal)                           │ │
│ │   renderModal(state.modal) ◄─── NEW        │ │
│ │ else                                       │ │
│ │   renderJobDisplay(state.job)              │ │
│ │                                            │ │
│ │   Dispatches to:                           │ │
│ │   renderEditConfirmationModal()  ◄─── NEW  │ │
│ │   renderPreviewViewerModal()     ◄─── NEW  │ │
│ │   renderFilterStateModal()       ◄─── NEW  │ │
│ └────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────┘
```

---

## MODAL TYPE DEFINITIONS

### EditConfirmationModal
```typescript
{
  type: 'EDIT_CONFIRMATION';
  originalJob: { company: 'OldCorp', position: 'Engineer', ... };
  editedJob: { company: 'NewCorp', position: 'Engineer', ... };
  editedKVs: { company: 'NewCorp' };  // Only diffs
  diffFields: {
    company: { original: 'OldCorp', edited: 'NewCorp' }
  };
  createdAt: '2026-04-17T15:30:00Z';
}
```

**Rendering**:
```
┌─ Diff Preview ─────────────────┐
│ company:
│   Original: "OldCorp"
│   New:      "NewCorp" ✓
│
└────────────────────────────────┘
[A]pply  [D]iscard
```

### PreviewViewerModal
```typescript
{
  type: 'PREVIEW_VIEWER';
  clipboardContent: string[];  // Pre-split lines from clipboard HTML
  currentPage: 0;              // 0-indexed page number
  maxPages: 3;                 // Total pages
  maxLinePerPage: 20;          // Lines per page
  createdAt: '2026-04-17T15:30:00Z';
}
```

**Rendering** (Page 0/3, Clipboard-only):
```
  CLIPBOARD PREVIEW
┌────────────────────────────────────┐
│ <html>                             │
│   <body>                           │
│     <div class="job-posting">      │
│       ...                          │
│     </div>                         │
│   </body>                          │
│ </html>                            │
│ ...                                │
│                                    │
└────────────────────────────────────┘
[Page 1/3] [↑↓] scroll | [q] close
```

### FilterStateModal
```typescript
{
  type: 'FILTER_STATE';
  previousState: false;
  newState: true;
  message: 'Filter: OFF → ON ✓';
  createdAt: '2026-04-17T15:30:00Z';
  expiresAt: '2026-04-17T15:30:01.5Z';  // Auto-dismiss after 1.5s
}
```

**Rendering**:
```
┌─ Filter Status ───────────────────┐
│ OFF → ON ✓                        │
└───────────────────────────────────┘
```

---

## ANSI COLOR REFERENCE

### Edit Modal Theme
```
Field Name:        BOLD CYAN    (company:)
Original Label:    DIM WHITE    (Original:)
Original Value:    DIM WHITE    ("OldCorp")
New Label:         BOLD GREEN   (New:)
New Value:         BOLD GREEN   ("NewCorp")
Checkmark:         GREEN        (✓)
Buttons:           BOLD YELLOW  ([A]pply [D]iscard)
Border:            CYAN         (┌─┐ │ └─┘)
```

### Preview Modal Theme
```
JSON Object Keys:  CYAN         ("company")
JSON Strings:      GREEN        ("TechCorp")
JSON Numbers:      YELLOW       (123)
JSON Booleans:     MAGENTA      (true/false)
JSON Null:         DIM WHITE    (null)
Tab Active:        BOLD CYAN    ([JOB_DETAILS])
Tab Inactive:      DIM WHITE    ([CLIPBOARD])
Pagination:        DIM WHITE    ([Page 1/3])
Border:            CYAN         (┌─┐ │ └─┘)
```

### Filter Modal Theme
```
State Before:      DIM WHITE    (OFF)
Arrow:             YELLOW       (→)
State After:       BOLD GREEN   (ON)
Checkmark:         GREEN        (✓)
Border:            YELLOW       (┌─┐ │ └─┘)
```

### ANSI Codes (for reference)
```
\x1b[0m            RESET
\x1b[1m            BOLD
\x1b[2m            DIM
\x1b[4m            UNDERLINE
\x1b[30-37m        Foreground (Black, Red, Green, Yellow, Blue, Magenta, Cyan, White)
\x1b[90-97m        Bright Foreground (same order)
\x1b[40-47m        Background
```

---

## INTEGRATION CHECKLIST (Quick Version)

### Step 1: Extend State (shared-tui-state.ts)
- [ ] Add ModalType type def
- [ ] Add EditConfirmationModal, PreviewViewerModal, FilterStateModal interfaces
- [ ] Add modal field to CurrentJobState
- [ ] Add 8 new exported functions
- [ ] Update persist() to handle modal field

### Step 2: Create Modal Components (NEW FILES)
- [ ] AnsiStyles.ts → ANSI codes + themes
- [ ] EditConfirmationModal.ts → render + input parser
- [ ] PreviewViewerModal.ts → render + input parser
- [ ] FilterStateModal.ts → render + expiry check
- [ ] HeadlessDetector.ts → environment detection

### Step 3: Update Action Controller (action-controller.ts)
- [ ] Modify dispatchAction() to check for modal
- [ ] Add handleModalInput() method
- [ ] Update handleEdit() to call setEditConfirmationModal()
- [ ] Update handlePreview() to call setPreviewViewerModal()
- [ ] Update handleFilterToggle() to call setFilterStateModal()
- [ ] Add 6 new handler methods (handleEditApply, etc.)

### Step 4: Update Render Server (ops-tui-app.ts)
- [ ] Modify renderJobCard() to check for modal
- [ ] Add renderModal() dispatcher function
- [ ] Import + call appropriate modal renderer

### Step 5: Update Keyboard Handler (KeyboardHandler.ts)
- [ ] Add handleModalInput() async method
- [ ] Wire modal input to action dispatcher
- [ ] Handle [a], [d], [↑], [↓], [tab], [q], [esc]

### Step 6: Update Daemon (src/index.ts)
- [ ] Modify /internal/action response for filter_toggle
- [ ] Return { accepted: true, filterEnabled: new_state }

### Step 7: Testing
- [ ] TEST 7: [e] Edit modal
- [ ] TEST 8: [e] Edit headless
- [ ] TEST 10: [p] Preview modal
- [ ] TEST 11: [f] Filter modal

---

## KEYBOARD INPUT PRIORITY

**When Modal Active**:
```
[a] or [A]     → handleEditApply()      (Edit modal only)
[d] or [D]     → handleEditDiscard()    (Edit modal only)
[↑] or [w]     → handlePreviewScrollUp() (Preview modal only)
[↓] or [s]     → handlePreviewScrollDown() (Preview modal only)
[TAB]          → switchPreviewTab()     (Preview modal only)
[q], [Q], [ESC] → handlePreviewClose() OR handleFilterDismiss()
```

**When No Modal**:
```
[e]             → handleEdit()
[p]             → handlePreview()
[f]             → handleFilterToggle()
[j], [d], [s]   → handleQueue(), handleTrash(), handleSkip()
[o]             → handleOpenUrl()
[h]             → handleHelp()
```

---

## HEADLESS MODE BEHAVIOR

### Detection
```javascript
isHeadless = !process.stdout.isTTY || 
             process.env.HEADLESS === '1' ||
             process.env.TERM === 'dumb'
```

### Modal Behavior
| Modal | Headless Behavior |
|-------|------------------|
| **Edit** | Auto-apply edits (skip modal) |
| **Preview** | Log to stderr (skip modal) |
| **Filter** | Render as plain text |

### Output Example (TERM=dumb)
```
[EDIT] Job modified in editor
fieldsChanged: ["company"]

[FILTER] Filter state changed
previousState: false
newState: true
```

---

## TESTING STRATEGY

### Manual Tests (MANUAL_TESTING_GUIDE.md updates)

**TEST 7**: [e] Edit Confirmation Modal
1. Press [e] → editor opens
2. Edit field (company: "OldCo" → "NewCo")
3. Save & exit editor
4. ✅ Modal appears showing diff
5. Press [a] → modal closes, new state visible
6. Press [j] → job queued with edits

**TEST 8**: [e] Edit in Headless
1. `HEADLESS=1 TERM=dumb` → start app
2. Press [e] → editor opens
3. Edit & save
4. ✅ No modal shown, edits auto-applied
5. Press [j] → job queued

**TEST 10**: [p] Preview Modal
1. Press [p] → modal appears
2. ✅ Shows job details in tab
3. Press [↓] → page increments
4. Press [tab] → switches to CLIPBOARD tab
5. Press [q] → closes modal

**TEST 11**: [f] Filter State Modal
1. Press [f] → modal appears showing state change
2. Wait 1.5 seconds
3. ✅ Modal auto-dismisses
4. ✅ Normal display resumes

### E2E Tests
- Modal state persists to disk
- Modal keyboard input doesn't block other processes
- ANSI codes render correctly in TTY
- Plain text renders in headless

---

## PERFORMANCE TARGETS

| Metric | Target | Notes |
|--------|--------|-------|
| Modal render time | <50ms | ANSI string concatenation |
| State persist latency | <10ms | Atomic file write |
| Keyboard response | <100ms | Modal input → state update |
| Preview pagination | <20ms | Line splitting + rendering |

---

## TROUBLESHOOTING

| Issue | Diagnosis | Fix |
|-------|-----------|-----|
| Modal doesn't appear | `state.modal` is null | Check setEditConfirmationModal() call in handleEdit() |
| Keyboard not responding | Modal active but input not captured | Verify KeyboardHandler.handleModalInput() wired correctly |
| ANSI codes visible as `^[` | TTY not detected | Check process.stdout.isTTY, may need ` 2>&1` in shell |
| Preview pagination wrong | Line count mismatch | Verify `maxLinePerPage` calculated from terminal height |
| Edit changes lost after [a] | editedFields cleared too early | Check clearModal() doesn't clear editedFields for edit modal |

---

## FILE SIZES (ESTIMATE)

```
AnsiStyles.ts                  ~200 lines
EditConfirmationModal.ts       ~300 lines
PreviewViewerModal.ts          ~400 lines
FilterStateModal.ts            ~100 lines
HeadlessDetector.ts            ~80 lines
─────────────────────────────────────────
Total NEW code:                ~1080 lines

Modifications to existing:
  shared-tui-state.ts          +300 lines
  action-controller.ts         +200 lines
  ops-tui-app.ts               +100 lines
  KeyboardHandler.ts           +50 lines
  index.ts                     +10 lines
─────────────────────────────────────────
Total MODIFIED:               ~660 lines

TOTAL CHANGES:                ~1740 lines
```

---

## DEPLOYMENT STEPS

1. **Code Review**: Submit PR with spec + implementation
2. **Unit Tests**: Test each modal component in isolation
3. **Integration Tests**: Run TEST 7, 8, 10, 11 manually
4. **E2E Tests**: Test with full daemon + TUI
5. **Headless Tests**: `HEADLESS=1 TERM=dumb` verification
6. **Merge**: Fast-forward to main branch
7. **Deploy**: Update systemd service, restart daemon

---

**End of Quick Reference**

For detailed implementation, refer to: `MODAL_IMPLEMENTATION_SPEC.md`
