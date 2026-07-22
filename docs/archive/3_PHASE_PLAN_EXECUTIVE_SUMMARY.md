# 3-PHASE IMPLEMENTATION PLAN - EXECUTIVE SUMMARY
## jobs-watcher Systemd Deployment & Modal Integration

**Total Estimated Time**: 11-16 hours  
**Status**: Ready for implementation  
**File Location**: COMPREHENSIVE_3_PHASE_IMPLEMENTATION_PLAN.md (detailed 1000+ line plan)

---

## QUICK REFERENCE

### PHASE 1: Systemd Deployment Fix (2-3 hours)

**Problem**: Service fails to start with "SyntaxError: Unexpected token '.'" due to Node v12

**Root Cause**:
- ExecStart points to `/usr/bin/node` (v12.22.9) which doesn't support modern JS
- lru-cache module uses optional chaining `?.` syntax not supported in v12
- Socket directory `/run/jobs-watcher` owned by non-existent `jobswatcher` user in dev

**Solution**:
1. Create `scripts/systemd/jobs-watcher.dev.service` 
   - Use `~/.nvm/versions/node/v22.12.0/bin/node`
   - Use current `$USER` instead of `jobswatcher` system user
   - Runtime dir: `/run/user/$UID/jobs-watcher` (XDG_RUNTIME_DIR)

2. Create `src/utils/socket-path.ts`
   - Detect runtime directory in order: XDG_RUNTIME_DIR → /run → $HOME/.cache
   - Return appropriate socket path for dev/prod

3. Update `src/index.ts`
   - Replace hardcoded `/run/jobs-watcher` with getSocketPath()

4. Create `scripts/.env.development.example`
   - Template for `~/.jobs-watcher.env`

**Deliverables**:
- ✅ Development service file (dev.service)
- ✅ Socket path helper function
- ✅ Updated index.ts
- ✅ Development environment template

**Validation**:
```bash
systemctl status jobs-watcher-dev.service              # Should show: active (running)
ls -lh /run/user/$(id -u)/jobs-watcher/ingest.sock    # Should exist
journalctl -u jobs-watcher-dev -n 10                   # Should show: socket initialized
```

---

### PHASE 2: Modal Specification Refinements (5-7 hours)

**Objective**: Implement 3 modal patterns to enhance operator UX

**Current State**: Modals NOT implemented (pure stderr logging)  
**Target State**: 3 working modals with proper state management

#### Modal #1: Edit Confirmation [e]
- Shows diff of edited fields before routing
- Uses fs.watch + temp file serialization (no Signal duplication)
- Pattern: Editor → Diff computed → Confirmation modal
- Dismissal: User presses [a]ccept or [d]iscard

#### Modal #2: Preview Viewer [p]  
- Clipboard-only design (single tab)
- Paginated display (20 lines/page)
- Pattern: Clipboard read → Split by lines → Show pages
- Navigation: [↑] prev [↓] next [q] close
- Auto-dismiss: No (requires manual close)

#### Modal #3: Filter State [f]
- Shows filter toggle confirmation
- UDS response includes `{filterEnabled: boolean}`
- Pattern: Send UDS → Parse response → Show state
- Auto-dismiss: Yes (1500ms timeout)

**Implementation**:
1. Update `src/ui/shared-tui-state.ts`
   - Add ModalState union type (EditConfirmationModal, PreviewViewerModal, FilterStateModal)
   - Add modal functions: setEditConfirmationModal(), setPreviewViewerModal(), setFilterStateModal()
   - Add modal management: updatePreviewPage(), clearModal(), checkModalExpiry()

2. Update `src/ui/action-controller.ts`
   - handleEdit() → calls setEditConfirmationModal() after diff computed
   - handlePreview() → calls setPreviewViewerModal()
   - handleFilterToggle() → calls setFilterStateModal()
   - Keyboard handler for preview pagination (↑/↓/q)

3. Update `src/ui/components/UdsActionWriter.ts`
   - filterToggle() → parse response body, extract filterEnabled

4. Update `src/index.ts` (daemon)
   - /internal/action handler → return {filterEnabled: boolean}

5. Update render server
   - Add renderEditConfirmationModal(), renderPreviewViewerModal(), renderFilterStateModal()
   - Integrate into main render loop before job card

6. Remove headless mode branching
   - All modals use stderr-friendly text format (no TTY requirement)

**Deliverables**:
- ✅ Modal state management layer
- ✅ 3 modal implementations
- ✅ Modal rendering functions
- ✅ Keyboard/UDS integration
- ✅ Single code path (no headless branching)

**Validation**:
```bash
# Press 'e' on job → Edit modal appears with diff
# Press 'p' on job → Preview modal appears with pagination
# Press 'f' on job → Filter modal appears then auto-dismisses
jq '.modal' ~/.cache/jobs-watcher-tui-state.json  # Should show modal state
```

---

### PHASE 3: Testing Guide & CI Integration (2-4 hours)

**Objective**: Update documentation and deploy scripts for modal testing

**Updates**:

1. **MANUAL_TESTING_GUIDE.md**
   - Add TEST 10: Modal [p]review - Preview Viewer
   - Add TEST 11: Modal [f]ilter - Filter State Feedback  
   - Add Modal Testing Workflow (integrated sequence)
   - Add MongoDB cleanup prerequisites

2. **scripts/deploy-with-manual-test.sh**
   - Fix hardcoded `/srv/jobs-watcher` paths
   - Add `detect_runtime_dir()` function (XDG_RUNTIME_DIR support)
   - Add `--clean` flag for MongoDB cleanup
   - Enhance systemd verification with all 3 socket path checks
   - Add `-n` to mongosh eval for quiet output

3. **docs/SYSTEMD_VERIFICATION_CHECKLIST.md** (NEW)
   - Pre-deployment checks (syntax, Node.js version, permissions)
   - Deployment steps (enable, start, verify socket)
   - Post-deployment checks (logs, health, socket connectivity)
   - Troubleshooting guide (common errors + fixes)

4. **QUICK_START.md** (Updated)
   - Add systemd section
   - Reference verification checklist

**Deliverables**:
- ✅ Updated MANUAL_TESTING_GUIDE.md with TEST 10-11
- ✅ Updated deploy script (portable paths + MongoDB cleanup)
- ✅ New systemd verification checklist
- ✅ Updated quick start guide

**Validation**:
```bash
# Test deploy script
./scripts/deploy-with-manual-test.sh --verify-only

# Verify docs
grep "TEST 10\|TEST 11" MANUAL_TESTING_GUIDE.md
test -f docs/SYSTEMD_VERIFICATION_CHECKLIST.md

# Test MongoDB cleanup
./scripts/deploy-with-manual-test.sh --clean
mongosh jobs_watcher --eval "db.action_snapshots.countDocuments()"  # Should be 0
```

---

## IMPLEMENTATION SEQUENCE

### Week 1: Phase 1 (2-3 hours)
```
Day 1: Morning
  1. Create scripts/systemd/jobs-watcher.dev.service
  2. Create src/utils/socket-path.ts
  3. Update src/index.ts to use getSocketPath()
  4. Create scripts/.env.development.example

Day 1: Afternoon  
  1. Update scripts/install-systemd-local.sh for dev support
  2. Test: sudo systemctl start jobs-watcher-dev.service
  3. Validate: Socket creation + service status
  4. Checkpoint 1.1-1.5 validation
```

### Week 1: Phase 2 (5-7 hours)
```
Day 2-3: Full days
  1. Update src/ui/shared-tui-state.ts (modal types + functions)
  2. Update src/ui/action-controller.ts (modal dispatching)
  3. Update UdsActionWriter.ts (filter response parsing)
  4. Update daemon index.ts (filter response enhancement)
  5. Update render server (modal rendering)
  6. Add keyboard navigation for preview pagination
  7. Test each modal individually
  8. Test integrated workflow
  9. Checkpoint 2.1-2.5 validation
```

### Week 2: Phase 3 (2-4 hours)
```
Day 4: Morning
  1. Update MANUAL_TESTING_GUIDE.md (TEST 10-11 + workflow)
  2. Update scripts/deploy-with-manual-test.sh (paths + cleanup)
  3. Create docs/SYSTEMD_VERIFICATION_CHECKLIST.md
  4. Update QUICK_START.md

Day 4: Afternoon
  1. Test deploy script with --clean flag
  2. Run modal integration tests (TEST 10-11)
  3. Verify all documentation paths
  4. Checkpoint 3.1-3.4 validation
```

---

## FILE CHANGE SUMMARY

### New Files (5)
- `scripts/systemd/jobs-watcher.dev.service`
- `src/utils/socket-path.ts`
- `scripts/.env.development.example`
- `docs/SYSTEMD_VERIFICATION_CHECKLIST.md`
- `COMPREHENSIVE_3_PHASE_IMPLEMENTATION_PLAN.md` (this plan)

### Modified Files (6)
- `src/index.ts` (socket path detection)
- `src/ui/shared-tui-state.ts` (modal state layer)
- `src/ui/action-controller.ts` (modal dispatching + keyboard)
- `src/ui/components/UdsActionWriter.ts` (filter response parsing)
- `scripts/deploy-with-manual-test.sh` (portable paths + cleanup)
- `MANUAL_TESTING_GUIDE.md` (TEST 10-11 + workflow)

### Optional Updates (2)
- `QUICK_START.md` (add systemd references)
- Render server file (modal rendering integration)

---

## RISK ASSESSMENT & MITIGATION

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Node v12 still used in production | CRITICAL | Use NVM path in dev.service, document for prod |
| Socket directory permissions wrong | HIGH | Runtime directory detection + XDG_RUNTIME_DIR |
| Modal state not persisted correctly | MEDIUM | Test atomic file writes + retry logic |
| Headless mode breaks with modals | MEDIUM | Use stderr-only text rendering (no TTY) |
| Deploy script fails with new paths | MEDIUM | Extensive path testing before production |
| Modal rendering timing issues | LOW | Add debounce + expiry checks in main loop |

---

## SUCCESS CRITERIA

✅ **Phase 1 Success**: Service starts, socket created, no syntax errors  
✅ **Phase 2 Success**: All 3 modals appear, pagination works, state persists  
✅ **Phase 3 Success**: Tests run, MongoDB cleanup works, docs complete

---

## NEXT ACTIONS

1. **Review** this executive summary + detailed plan
2. **Approve** implementation approach
3. **Schedule** 4-5 development days
4. **Create** Phase 1 branch from main
5. **Implement** Phase 1 → Validate → Merge
6. **Implement** Phase 2 → Validate → Merge  
7. **Implement** Phase 3 → Validate → Merge
8. **Integration testing** with full workflow
9. **Production deployment** following Phase 1 production instructions

---

## QUESTIONS FOR CLARIFICATION

Before starting implementation, confirm:
- [ ] Should Phase 1 also create production service file (jobs-watcher.service)?
- [ ] Should modal rendering be added to existing render-server.ts or new component?
- [ ] Should TEST 10-11 be added to E2E test suite or remain manual-only?
- [ ] Should SONATA REFINEMENT PHASE 2 (agent-core) wait for modal completion?

---

For detailed implementation steps, file paths, line numbers, and code samples, see:  
**COMPREHENSIVE_3_PHASE_IMPLEMENTATION_PLAN.md** (1000+ lines, all sections)
