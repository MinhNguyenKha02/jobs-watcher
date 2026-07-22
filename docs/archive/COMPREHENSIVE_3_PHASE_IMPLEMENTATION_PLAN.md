# Comprehensive 3-Phase Implementation Plan
## jobs-watcher Systemd Deployment & Modal Integration

**Date**: 2026-04-17  
**Status**: Ready for Implementation  
**Total Estimated Dev Time**: 11-15 hours (Phase 1: 2-3h | Phase 2: 5-7h | Phase 3: 2-4h)  
**Reduced from**: 6-8 hours (Phase 2 modal refinements optimize implementation)

---

## EXECUTIVE SUMMARY

This plan addresses critical infrastructure gaps and modal UX improvements:

| Phase | Focus | Issues | Est. Time |
|-------|-------|--------|-----------|
| **Phase 1** | Systemd deployment fix | Node.js v12 path, socket permissions, user/group setup | 2-3 hours |
| **Phase 2** | Modal specifications | Edit/Preview/Filter modals with refined patterns | 5-7 hours |
| **Phase 3** | Testing & CI integration | MANUAL_TESTING_GUIDE updates, deploy script fixes | 2-4 hours |

**Key Deliverables**:
- ✅ Development systemd service file (using NVM Node v22.12.0)
- ✅ Modal state management layer with 3 modal types
- ✅ Updated testing guide with modal validation checkpoints
- ✅ Corrected deploy script with MongoDB cleanup + systemd verification

---

# PHASE 1: SYSTEMD DEPLOYMENT FIX

## 1.1 Problem Analysis

### Current Issues
1. **Node.js Version Mismatch** (`/etc/systemd/system/jobs-watcher.service`)
   - ExecStart: `/usr/bin/node` (points to v12.22.9)
   - Problem: v12 doesn't support modern JS syntax (optional chaining `?.`, nullish coalescing `??`)
   - lru-cache module fails with `SyntaxError: Unexpected token '.'`
   - **Solution**: Point to NVM v22.12.0 which supports ES2020+ syntax

2. **Socket Directory Ownership** (`/run/jobs-watcher`)
   - Current: Created by systemd tmpfiles but may have wrong owner
   - tmpfiles.d config references: `scripts/tmpfiles.d/jobs-watcher.conf` (line 12)
   - Current setting: `jobs-watcher:jobs-watcher` (non-existent user in dev)
   - **Solution**: Use current user in dev environment, keep system user in production

3. **User/Group Setup** (Development vs Production)
   - Production: Requires `jobswatcher` system user + group
   - Development: Should use current user (avoid sudo requirements)
   - **Gap**: No dev-specific systemd service file

4. **Socket Directory Permissions**
   - Current: 0755 (rwxr-xr-x) - TUI action controller needs write access
   - Files created inside: Check UDS writer creates socket with correct mode
   - Source: `src/ui/components/UdsActionWriter.ts` (need to verify socket creation)

### Environment Context
```bash
# Verify current setup
$ which node                          # /home/minh-nguyen/.nvm/versions/node/v22.12.0/bin/node
$ /usr/bin/node --version             # v12.22.9 (PROBLEM - too old)
$ /home/minh-nguyen/.nvm/versions/node/v22.12.0/bin/node --version # v22.12.0 (TARGET)
```

---

## 1.2 Configuration Issues (Detailed Breakdown)

### Issue #1: Node.js Executable Path
**File**: `scripts/systemd/jobs-watcher.service`  
**Lines**: 15  
**Current**: 
```
ExecStart=/usr/bin/node /srv/jobs-watcher/dist/src/index.js
```
**Problem**: `/usr/bin/node` → v12.22.9 → syntax errors for ES2020+ features  
**Impact**: Service fails to start with `SyntaxError: Unexpected token '.'`

### Issue #2: User/Group Mismatch (Dev)
**File**: `scripts/systemd/jobs-watcher.service`  
**Lines**: 9-10  
**Current**:
```
User=jobswatcher
Group=jobswatcher
```
**Problem**: In dev environment, `jobswatcher` system user doesn't exist  
**Impact**: systemctl fails with `User jobswatcher not found`  
**Dev Solution**: Conditionally use `$USER` for development deployments

### Issue #3: Socket Directory Path (Workspace-Relative)
**File**: Multiple references  
- `scripts/deploy-with-manual-test.sh` (line 32): `SOCKET_PATH="/run/jobs-watcher/ingest.sock"`
- `src/index.ts` (hardcoded): checks for `/run/jobs-watcher/`
**Problem**: Non-portable, assumes /run/jobs-watcher exists with correct permissions  
**Dev Solution**: Support `$XDG_RUNTIME_DIR` or `$HOME/.cache` for dev environments

### Issue #4: EnvironmentFile Ownership (Production)
**File**: `/etc/jobs-watcher.env` created by `install-systemd-local.sh`  
**Lines**: 47-51  
**Current Logic**:
```bash
if ${SUDO} chown root:jobswatcher "$ENV_DST" 2>/dev/null; then
  echo "Set owner root:jobswatcher for $ENV_DST"
else
  ${SUDO} chown root:root "$ENV_DST" || true
  echo "Set owner root:root for $ENV_DST"
fi
${SUDO} chmod 0640 "$ENV_DST"
```
**Problem**: Dev environment may not have `jobswatcher` group → silently falls back to `root:root`  
**Impact**: TUI action controller cannot read env vars if restricted to jobswatcher group  
**Dev Solution**: Skip chown/chmod restrictions in dev mode

---

## 1.3 Corrected Systemd Service File (Development)

**Action**: Create new file with dev-friendly configuration

**File Path**: `scripts/systemd/jobs-watcher.dev.service`

```ini
[Unit]
Description=Jobs Watcher webhook + worker (Development)
After=network.target mongod.service
StartLimitIntervalSec=0

[Service]
Type=simple
# Development: Use current user (avoid jobswatcher system user requirement)
# In production, replace with: User=jobswatcher
User=%USER%
Group=%USER%

# Environment: Load secrets from dev env file
EnvironmentFile=%h/.jobs-watcher.env
Environment="NODE_ENV=development"

# WorkingDirectory: Adjust to deployment path
# For dev: Use workspace directory
# For prod: Use /srv/jobs-watcher (or your deploy path)
WorkingDirectory=%h/node_projects/jobs-watcher

# ExecStart: CRITICAL - Point to NVM Node v22.12.0 (not /usr/bin/node v12)
ExecStart=%h/.nvm/versions/node/v22.12.0/bin/node %h/node_projects/jobs-watcher/dist/src/index.js

# Restart behavior
Restart=on-failure
RestartSec=5

# Permissions: Allow read from user home directory
UMask=0077

# Runtime directory: Use user-specific XDG_RUNTIME_DIR
# This creates /run/user/{uid}/jobs-watcher with correct ownership
RuntimeDirectory=jobs-watcher
RuntimeDirectoryMode=0755

[Install]
WantedBy=multi-user.target

# ============================================================================
# DEPLOYMENT NOTES
# ============================================================================
#
# DEVELOPMENT SETUP:
#   1. Copy this file to /etc/systemd/system/jobs-watcher-dev.service
#   2. Create ~/.jobs-watcher.env with secrets (not committed to git):
#      INTERNAL_AUTH_TOKEN=dev-token-123
#      MONGODB_URI=mongodb://localhost:27017/jobs_watcher
#      GMAIL_CLIENT_ID=your-dev-client-id
#      etc...
#   3. Enable and start:
#      sudo systemctl enable --now jobs-watcher-dev.service
#   4. Check logs:
#      journalctl -u jobs-watcher-dev -f
#
# PRODUCTION SETUP:
#   1. Create jobs-watcher system user:
#      sudo useradd -r -s /usr/sbin/nologin -m -d /var/lib/jobs-watcher jobswatcher
#   2. Create group:
#      sudo groupadd -f jobswatcher
#   3. Set up production service file (scripts/systemd/jobs-watcher.service)
#   4. Update paths: /srv/jobs-watcher, /etc/jobs-watcher.env
#
# SOCKET PATH RESOLUTION:
#   - Development (XDG_RUNTIME_DIR): /run/user/{uid}/jobs-watcher/ingest.sock
#   - Production (system): /run/jobs-watcher/ingest.sock
#   - Fallback (no /run): {HOME}/.cache/jobs-watcher/ingest.sock
#
# ENV VAR SUBSTITUTION:
#   %USER% → Current user (e.g., minh-nguyen)
#   %h → User home directory (e.g., /home/minh-nguyen)
#   %U → User UID
#   %G → User GID
```

---

## 1.4 Socket Directory Setup & Permissions

### Current Structure
**Tmpfiles Config**: `scripts/tmpfiles.d/jobs-watcher.conf`
```
d /run/jobs-watcher 0755 jobs-watcher jobs-watcher
f /run/jobs-watcher/.gitkeep 0644 jobs-watcher jobs-watcher
```

**Problem**: Hardcoded path `/run/jobs-watcher` with system user owner

### Solution: Runtime Directory Hierarchy

**Development Path Resolution** (in order of preference):
1. `$XDG_RUNTIME_DIR/jobs-watcher` (if $XDG_RUNTIME_DIR set)
   - Typically `/run/user/{uid}/jobs-watcher` on Linux
   - Automatically created by systemd with user ownership
   - **Benefits**: No sudo needed, auto-cleaned on logout

2. `$HOME/.cache/jobs-watcher` (if /run not accessible)
   - Home-based fallback for constrained environments
   - **Benefits**: Portable, user-owned

3. `/run/jobs-watcher` (production-only)
   - Requires system user and tmpfiles.d configuration
   - **Benefits**: Follows FHS standard

### Implementation: Update Socket Path Detection
**File**: `src/index.ts`  
**Current**: Hardcoded `/run/jobs-watcher`  
**Action**: Use helper function to detect runtime directory

**Code Change** (pseudo):
```typescript
// Add to src/utils/socket-path.ts (NEW FILE)
export function getSocketDir(): string {
  // 1. Try XDG_RUNTIME_DIR (preferred in dev)
  const xdgRuntime = process.env.XDG_RUNTIME_DIR;
  if (xdgRuntime) {
    const dir = path.join(xdgRuntime, 'jobs-watcher');
    try {
      fs.mkdirSync(dir, { recursive: true, mode: 0o755 });
      return dir;
    } catch (err) {
      logger.warn('Failed to use XDG_RUNTIME_DIR', { error: String(err) });
    }
  }

  // 2. Try /run/jobs-watcher (production)
  const runDir = '/run/jobs-watcher';
  try {
    fs.accessSync(runDir, fs.constants.W_OK);
    return runDir;
  } catch {
    // Fallback
  }

  // 3. Use $HOME/.cache (last resort)
  const cacheDir = path.join(homedir(), '.cache', 'jobs-watcher');
  fs.mkdirSync(cacheDir, { recursive: true, mode: 0o755 });
  return cacheDir;
}

export function getSocketPath(): string {
  return path.join(getSocketDir(), 'ingest.sock');
}
```

---

## 1.5 User & Group Setup Checklist (Development vs Production)

### Development Setup (Local Machine)
```bash
# No special user/group needed in dev
# Current user: $(whoami) -> minh-nguyen

# Environment file location
~/.jobs-watcher.env

# Socket directory
/run/user/$(id -u)/jobs-watcher
OR
~/.cache/jobs-watcher

# Service file to use
/etc/systemd/system/jobs-watcher-dev.service

# Setup steps
1. Create ~/.jobs-watcher.env with secrets
2. sudo systemctl enable --now jobs-watcher-dev.service
3. Verify: systemctl status jobs-watcher-dev
```

### Production Setup (Staging/Production Server)
```bash
# Create system user (one-time)
sudo useradd -r -s /usr/sbin/nologin -m -d /var/lib/jobs-watcher jobswatcher
sudo groupadd -f jobswatcher

# Environment file ownership
sudo touch /etc/jobs-watcher.env
sudo chown root:jobswatcher /etc/jobs-watcher.env
sudo chmod 0640 /etc/jobs-watcher.env

# Socket directory (tmpfiles.d)
sudo systemctl enable systemd-tmpfiles-setup.service
sudo systemd-tmpfiles --create /etc/tmpfiles.d/jobs-watcher.conf

# Service file to use
/etc/systemd/system/jobs-watcher.service (production)

# Setup steps
1. Create /etc/jobs-watcher.env with production secrets
2. Deploy code to /srv/jobs-watcher
3. sudo systemctl enable --now jobs-watcher.service
4. Verify: systemctl status jobs-watcher
```

---

## 1.6 Phase 1 Implementation Steps

### Step 1.1: Create Development Service File
```bash
# File: scripts/systemd/jobs-watcher.dev.service
# See section 1.3 above for full content
```

### Step 1.2: Update Development Environment File Template
**File**: `.env.production` → Add template to docs  
**Location**: Create `scripts/.env.development.example`
```bash
NODE_ENV=development
INTERNAL_AUTH_TOKEN=dev-token-123
MONGODB_URI=mongodb://localhost:27017/jobs_watcher
GMAIL_CLIENT_ID=<your-dev-id>
GMAIL_CLIENT_SECRET=<your-dev-secret>
GMAIL_REFRESH_TOKEN=<your-dev-token>
WEBHOOK_PORT=3000
```

### Step 1.3: Update Socket Path Helper
**File**: Create `src/utils/socket-path.ts`  
**Action**: Implement runtime directory detection (see section 1.4)

### Step 1.4: Update index.ts to Use Socket Path Helper
**File**: `src/index.ts`  
**Lines**: Where socket path is defined  
**Change**: Replace hardcoded `/run/jobs-watcher` with call to `getSocketPath()`

### Step 1.5: Update install-systemd-local.sh for Dev Support
**File**: `scripts/install-systemd-local.sh`  
**Lines**: Add conditional logic for development vs production setup

### Step 1.6: Update Tmpfiles Configuration
**File**: `scripts/tmpfiles.d/jobs-watcher.conf`  
**Action**: Keep production config, add dev note in comments

---

## 1.7 Phase 1 Validation Checkpoints

### Checkpoint 1.1: Service File Correctness
```bash
# Verify dev service file syntax
systemd-analyze verify /etc/systemd/system/jobs-watcher-dev.service
# Expected: No errors, all paths resolve correctly

# Check systemd env var substitution
grep "^ExecStart=" /etc/systemd/system/jobs-watcher-dev.service
# Expected: Points to ~/.nvm/versions/node/v22.12.0/bin/node
```

### Checkpoint 1.2: Node.js Executable Resolution
```bash
# Verify Node v22.12.0 is available
~/.nvm/versions/node/v22.12.0/bin/node --version
# Expected: v22.12.0

# Verify lru-cache doesn't error with modern syntax
~/.nvm/versions/node/v22.12.0/bin/node -e "import('lru-cache').then(() => console.log('OK'))"
# Expected: OK (no syntax errors)
```

### Checkpoint 1.3: Socket Directory Setup
```bash
# After systemd start, verify socket directory exists
ls -lh /run/user/$(id -u)/jobs-watcher
# Expected: drwxr-xr-x 2 {user} {user}

# Verify socket file created
ls -lh /run/user/$(id -u)/jobs-watcher/ingest.sock
# Expected: srwxr-xr-x 1 {user} {user}
```

### Checkpoint 1.4: Service Status
```bash
# Check service is active
systemctl status jobs-watcher-dev.service
# Expected: ● jobs-watcher-dev.service - Jobs Watcher... (running)

# Check logs for startup success
journalctl -u jobs-watcher-dev -n 20
# Expected: No error messages, socket initialized, ready for connections
```

### Checkpoint 1.5: Socket Connectivity
```bash
# Test socket is accepting connections
echo "GET /health HTTP/1.1" | nc -U /run/user/$(id -u)/jobs-watcher/ingest.sock
# Expected: HTTP response (even if not full response)

# Or use timeout wrapper
timeout 1 bash -c 'exec 3<>/run/user/'$(id -u)'/jobs-watcher/ingest.sock && echo "OK"'
# Expected: OK
```

---

# PHASE 2: MODAL SPECIFICATION REFINEMENTS

## 2.1 Current State vs Target State

### Current Implementation
- **Modals Present**: NO (0/3 implemented)
- **Modal Support**: Planned but not implemented
- **Output Method**: Pure stderr logging (headless-compatible)
- **State Layer**: CurrentJobState (no modal field)

### Target Implementation  
- **Modals Present**: YES (3/3 implemented)
- **Edit Modal**: fs.watch + temp file serialization, no Signal duplication
- **Preview Modal**: Clipboard-only design (single tab, paginated)
- **Filter Modal**: UDS response returns {filterEnabled: boolean}
- **Code Path**: Single path (no headless branching)
- **State Layer**: ModalState interface added to CurrentJobState

---

## 2.2 State Management Extensions

### 2.2.1 New Types (shared-tui-state.ts)

**File**: `src/ui/shared-tui-state.ts`  
**Lines**: Add after line 6 (after CurrentJobStage type definition)

```typescript
/**
 * Modal type discriminator union
 */
export type ModalType = 'EDIT_CONFIRMATION' | 'PREVIEW_VIEWER' | 'FILTER_STATE' | null;

/**
 * Edit confirmation modal after editor closes
 */
export interface EditConfirmationModal {
  type: 'EDIT_CONFIRMATION';
  originalJob: Record<string, unknown>;      // Snapshot before edit
  editedJob: Record<string, unknown>;        // Snapshot after edit
  editedKVs: Record<string, unknown>;        // Diff only (for queuing)
  diffFields: {
    [key: string]: { original: unknown; edited: unknown };
  };
  createdAt: string;
  expiresAt?: string;                        // Auto-dismiss timeout (5000ms)
}

/**
 * Preview viewer modal with pagination
 */
export interface PreviewViewerModal {
  type: 'PREVIEW_VIEWER';
  clipboardContent: string[];                // Pre-split into lines
  currentPage: number;                       // Page index (0-indexed)
  maxPages: number;                          // Total pages
  linesPerPage: number;                      // Lines per page (default 20)
  createdAt: string;
}

/**
 * Filter state feedback modal
 */
export interface FilterStateModal {
  type: 'FILTER_STATE';
  previousState: boolean;                    // OLD state
  newState: boolean;                         // NEW state
  message: string;                           // Display: "Filter: OFF→ON ✓"
  createdAt: string;
  expiresAt: string;                         // Auto-dismiss (1500ms)
}

/**
 * Union of all modal types
 */
export type ModalState = EditConfirmationModal | PreviewViewerModal | FilterStateModal;

/**
 * Current job state WITH modal layer
 */
export interface CurrentJobState {
  version: number;
  messageId: string | null;
  job: Job | null;
  stage: CurrentJobStage;
  editedFields: Record<string, unknown> | null;
  modal: ModalState | null;                  // NEW FIELD
  updatedAt: string | null;
}
```

### 2.2.2 Update createDefaultState()

**File**: `src/ui/shared-tui-state.ts`  
**Lines**: Update createDefaultState() function (around line 40)

```typescript
function createDefaultState(): CurrentJobState {
  return {
    version: STATE_VERSION,
    messageId: null,
    job: null,
    stage: null,
    editedFields: null,
    modal: null,                // NEW FIELD
    updatedAt: null,
  };
}
```

### 2.2.3 Update readSharedStateFromDisk()

**File**: `src/ui/shared-tui-state.ts`  
**Lines**: Update validation logic in readSharedStateFromDisk() (around line 60)

Add modal field validation:
```typescript
export function readSharedStateFromDisk(): CurrentJobState {
  try {
    const raw = readFileSync(sharedStatePath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<CurrentJobState>;

    // ... existing validation code ...

    // Validate modal field (NEW)
    let modal: ModalState | null = null;
    if (parsed.modal && typeof parsed.modal === 'object') {
      const modalObj = parsed.modal as any;
      if (modalObj.type === 'EDIT_CONFIRMATION' && modalObj.diffFields) {
        modal = modalObj as EditConfirmationModal;
      } else if (modalObj.type === 'PREVIEW_VIEWER' && modalObj.clipboardContent) {
        modal = modalObj as PreviewViewerModal;
      } else if (modalObj.type === 'FILTER_STATE' && modalObj.newState !== undefined) {
        modal = modalObj as FilterStateModal;
      }
    }

    return {
      version: typeof parsed.version === 'number' ? parsed.version : STATE_VERSION,
      messageId: typeof parsed.messageId === 'string' ? parsed.messageId : null,
      job: parsed.job && typeof parsed.job === 'object' ? (parsed.job as Job) : null,
      stage: /* existing logic */,
      editedFields: /* existing logic */,
      modal,                    // NEW FIELD
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : null,
    };
  } catch {
    return sharedState;
  }
}
```

### 2.2.4 Add Modal Management Functions

**File**: `src/ui/shared-tui-state.ts`  
**Lines**: Add after existing functions (after clearCurrentJob, around line 150)

```typescript
/**
 * Set edit confirmation modal after editor closes
 * Shows diff of changes before user confirms routing
 */
export function setEditConfirmationModal(
  originalJob: Record<string, unknown>,
  editedJob: Record<string, unknown>,
  editedKVs: Record<string, unknown>
): void {
  const diffFields: Record<string, { original: unknown; edited: unknown }> = {};
  
  for (const [key, newValue] of Object.entries(editedKVs)) {
    diffFields[key] = {
      original: originalJob[key],
      edited: newValue,
    };
  }

  const nextState: CurrentJobState = {
    ...readSharedStateFromDisk(),
    modal: {
      type: 'EDIT_CONFIRMATION',
      originalJob,
      editedJob,
      editedKVs,
      diffFields,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 5000).toISOString(),
    },
    updatedAt: new Date().toISOString(),
  };

  persist(nextState);
  logger.info('[MODAL] Edit confirmation shown', {
    changedFields: Object.keys(editedKVs).length,
  });
}

/**
 * Set preview viewer modal (clipboard-only, paginated)
 */
export function setPreviewViewerModal(
  clipboard: string,
  linesPerPage: number = 20
): void {
  const lines = clipboard.split('\n');
  const maxPages = Math.ceil(lines.length / linesPerPage) || 1;

  const nextState: CurrentJobState = {
    ...readSharedStateFromDisk(),
    modal: {
      type: 'PREVIEW_VIEWER',
      clipboardContent: lines,
      currentPage: 0,
      maxPages,
      linesPerPage,
      createdAt: new Date().toISOString(),
    },
    updatedAt: new Date().toISOString(),
  };

  persist(nextState);
  logger.info('[MODAL] Preview viewer shown', {
    totalLines: lines.length,
    maxPages,
  });
}

/**
 * Update preview page (up/down navigation)
 */
export function updatePreviewPage(direction: 'up' | 'down'): void {
  const state = readSharedStateFromDisk();
  if (state.modal?.type !== 'PREVIEW_VIEWER') return;

  const modal = state.modal as PreviewViewerModal;
  const newPage =
    direction === 'down'
      ? Math.min(modal.currentPage + 1, modal.maxPages - 1)
      : Math.max(modal.currentPage - 1, 0);

  const nextState: CurrentJobState = {
    ...state,
    modal: {
      ...modal,
      currentPage: newPage,
    },
    updatedAt: new Date().toISOString(),
  };

  persist(nextState);
  logger.debug('[MODAL] Preview page updated', {
    page: newPage,
    maxPages: modal.maxPages,
  });
}

/**
 * Set filter state feedback modal
 */
export function setFilterStateModal(
  previousState: boolean,
  newState: boolean
): void {
  const stateStr = `${previousState ? 'ON' : 'OFF'}→${newState ? 'ON' : 'OFF'}`;
  const icon = newState === previousState ? '○' : '✓';

  const nextState: CurrentJobState = {
    ...readSharedStateFromDisk(),
    modal: {
      type: 'FILTER_STATE',
      previousState,
      newState,
      message: `Filter: ${stateStr} ${icon}`,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 1500).toISOString(),
    },
    updatedAt: new Date().toISOString(),
  };

  persist(nextState);
  logger.info('[MODAL] Filter state changed', {
    from: previousState ? 'ON' : 'OFF',
    to: newState ? 'ON' : 'OFF',
  });
}

/**
 * Clear current modal
 */
export function clearModal(): void {
  const nextState = {
    ...readSharedStateFromDisk(),
    modal: null,
    updatedAt: new Date().toISOString(),
  };

  persist(nextState);
  logger.debug('[MODAL] Modal cleared');
}

/**
 * Check if modal has expired
 */
export function checkModalExpiry(): void {
  const state = readSharedStateFromDisk();
  if (!state.modal?.expiresAt) return;

  const expiresAt = new Date(state.modal.expiresAt);
  if (Date.now() >= expiresAt.getTime()) {
    clearModal();
    logger.debug('[MODAL] Modal auto-dismissed (expired)');
  }
}
```

---

## 2.3 Edit Modal Implementation

### 2.3.1 Edit Action Handler Updates

**File**: `src/ui/action-controller.ts`  
**Lines**: handleEdit() method (around line 480)

**Current Implementation**: Editor spawns, temp file read, diff computed, editedFields stored  
**Target Enhancement**: Add setEditConfirmationModal() call after diff computation

```typescript
/**
 * Handle [e]dit action: Spawn editor, compute diff, show confirmation modal
 */
private async handleEdit(): Promise<void> {
  try {
    const currentState = getCurrentJob();
    if (!currentState.job) {
      logger.warn('[action-controller] [edit] No job to edit');
      return;
    }

    const originalJob = currentState.job;
    const tempFile = `/tmp/job-${currentState.messageId}.json`;

    logger.info('[action-controller] [edit] Spawning editor', {
      editor: this.editor.getPreferredEditor(),
      tempFile,
    });

    // 1. Write original job to temp file
    writeFileSync(tempFile, JSON.stringify(originalJob, null, 2), 'utf8');

    // 2. Spawn editor (nano/vim/nvim) - inherited stdio to user terminal
    const editorProcess = spawn(
      this.editor.getPreferredEditor(),
      [tempFile],
      {
        stdio: 'inherit',
        detached: false,
      }
    );

    // 3. Wait for editor to close
    await new Promise<void>((resolve, reject) => {
      editorProcess.on('exit', (code) => {
        if (code === 0 || code === null) {
          resolve();
        } else {
          reject(new Error(`Editor exited with code ${code}`));
        }
      });
      editorProcess.on('error', reject);
    });

    // 4. Read edited file
    const editedContent = readFileSync(tempFile, 'utf8');
    const editedJob = JSON.parse(editedContent) as Record<string, unknown>;

    // 5. Compute diff (only changed fields)
    const editedKVs: Record<string, unknown> = {};
    for (const [key, newValue] of Object.entries(editedJob)) {
      if (JSON.stringify(originalJob[key]) !== JSON.stringify(newValue)) {
        editedKVs[key] = newValue;
      }
    }

    if (Object.keys(editedKVs).length === 0) {
      logger.info('[action-controller] [edit] No changes made');
      return;
    }

    // 6. NEW: Show confirmation modal with diff
    setEditConfirmationModal(
      originalJob as Record<string, unknown>,
      editedJob,
      editedKVs
    );

    // 7. Store edited fields for routing action
    setEditedFields(editedKVs);

    logger.info('[action-controller] [edit] ✓ Edits saved, modal shown', {
      changedFields: Object.keys(editedKVs),
    });

    // 8. Cleanup temp file
    fs.unlinkSync(tempFile);
  } catch (err) {
    logger.error('[action-controller] [edit] Failed', {
      error: String(err),
    });
  }
}
```

**Key Points**:
- ✅ No Signal 1 or Signal 2 duplication (editor is local-only operation)
- ✅ fs.watch pattern NOT needed (one-time temp file read/write)
- ✅ Modal shown immediately after diff computation
- ✅ Temp file cleaned up after use
- ✅ Supports nano/vim/nvim with inherited stdio

### 2.3.2 Edit Modal Rendering (Render Server)

**File**: `src/services/render-server.ts` or `src/ui/components/RenderEngine.ts`  
**Action**: Add renderEditConfirmationModal() function

```typescript
/**
 * Render edit confirmation modal to stdout
 * Shows diff before user confirms routing
 */
function renderEditConfirmationModal(modal: EditConfirmationModal): void {
  const { diffFields, createdAt } = modal;

  // Header
  process.stdout.write('\n');
  process.stdout.write('┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓\n');
  process.stdout.write('┃ 📋 CONFIRM EDITS                                  ┃\n');
  process.stdout.write('┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┫\n');

  // Diff fields
  for (const [field, change] of Object.entries(diffFields)) {
    process.stdout.write(`┃ ${field.padEnd(20)} │ ${String(change.original).substring(0, 20)} → ${String(change.edited).substring(0, 20)}\n`);
  }

  // Footer
  process.stdout.write('┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┫\n');
  process.stdout.write('┃ [a]ccept [d]iscard [c]ancel                       ┃\n');
  process.stdout.write('┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛\n');
  process.stdout.write('\n');
}
```

---

## 2.4 Preview Modal Implementation

### 2.4.1 Preview Action Handler Updates

**File**: `src/ui/action-controller.ts`  
**Lines**: handlePreview() method (around line 420)

**Current**: Logs clipboard content to stderr  
**Target**: Read clipboard, set preview modal, support pagination

```typescript
/**
 * Handle [p]review action: Show clipboard content with pagination
 */
private async handlePreview(): Promise<void> {
  try {
    const currentState = getCurrentJob();
    if (!currentState.job) {
      logger.warn('[action-controller] [preview] No job to preview');
      return;
    }

    logger.info('[action-controller] [preview] Reading clipboard...');

    // 1. Get clipboard content
    const clipboard = await clipboardGetter();
    if (!clipboard || clipboard.length === 0) {
      logger.warn('[action-controller] [preview] Clipboard is empty');
      return;
    }

    // 2. Set preview modal (page 0)
    setPreviewViewerModal(clipboard, 20); // 20 lines per page

    logger.info('[action-controller] [preview] ✓ Preview shown', {
      contentLength: clipboard.length,
    });
  } catch (err) {
    logger.error('[action-controller] [preview] Failed', {
      error: String(err),
    });
  }
}
```

### 2.4.2 Preview Modal Page Navigation (Keyboard)

**File**: `src/ui/components/KeyboardHandler.ts`  
**Action**: Add page navigation in waitForAction() loop

When modal is active (modal.type === 'PREVIEW_VIEWER'):
- Arrow Down / Page Down / 'j' → updatePreviewPage('down')
- Arrow Up / Page Up / 'k' → updatePreviewPage('up')
- 'q' / ESC → clearModal()

### 2.4.3 Preview Modal Rendering (Render Server)

```typescript
/**
 * Render preview viewer modal
 * Shows clipboard content paginated
 */
function renderPreviewViewerModal(modal: PreviewViewerModal): void {
  const { clipboardContent, currentPage, maxPages, linesPerPage } = modal;

  const startLine = currentPage * linesPerPage;
  const endLine = Math.min(startLine + linesPerPage, clipboardContent.length);
  const pageContent = clipboardContent.slice(startLine, endLine);

  // Header
  process.stdout.write('\n');
  process.stdout.write('┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓\n');
  process.stdout.write(`┃ 👁️  PREVIEW (Page ${currentPage + 1}/${maxPages})                           ┃\n`);
  process.stdout.write('┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┫\n');

  // Content (line-wrapped)
  for (const line of pageContent) {
    const wrapped = line.substring(0, 50); // Truncate to terminal width
    process.stdout.write(`┃ ${wrapped.padEnd(50)} ┃\n`);
  }

  // Padding if page not full
  for (let i = pageContent.length; i < linesPerPage; i++) {
    process.stdout.write(`┃ ${''.padEnd(50)} ┃\n`);
  }

  // Footer
  process.stdout.write('┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┫\n');
  process.stdout.write('┃ [↑] prev [↓] next [q] close                        ┃\n');
  process.stdout.write('┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛\n');
  process.stdout.write('\n');
}
```

---

## 2.5 Filter Modal Implementation

### 2.5.1 UDS Response Enhancement

**File**: `src/ui/components/UdsActionWriter.ts`  
**Lines**: filterToggle() method (around line 665)

**Current**: Sends POST /internal/action {action: 'filter_toggle'}  
**Response Expected**: Daemon should return `{ filterEnabled: boolean }`

**Daemon Side** (src/index.ts or services):
```typescript
// In daemon ingest server POST /internal/action handler
if (action === 'filter_toggle') {
  filterEnabled = !filterEnabled;
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ 
    filterEnabled,
    timestamp: new Date().toISOString(),
  }));
}
```

**Client Side** (UdsActionWriter.ts):
```typescript
async filterToggle(): Promise<{ filterEnabled: boolean }> {
  try {
    const previousState = this.lastKnownFilterState ?? false;

    const response = await this.sendUdsRequest({
      action: 'filter_toggle',
    });

    // Parse response body
    const body = JSON.parse(response.body ?? '{}');
    const newState = body.filterEnabled ?? !previousState;

    // Store for next toggle
    this.lastKnownFilterState = newState;

    logger.info('[UDS] Filter toggle response received', {
      previousState,
      newState,
      udsTookMs: response.tookMs,
    });

    return { filterEnabled: newState };
  } catch (err) {
    logger.error('[UDS] Filter toggle failed', { error: String(err) });
    throw err;
  }
}
```

### 2.5.2 Filter Action Handler Updates

**File**: `src/ui/action-controller.ts`  
**Lines**: handleFilterToggle() method (around line 665)

```typescript
/**
 * Handle [f]ilter action: Toggle filter, show state modal
 */
private async handleFilterToggle(): Promise<void> {
  try {
    const startTime = Date.now();
    
    // 1. Get previous state (from shared state or default to false)
    const currentState = getCurrentJob();
    const previousState = currentState.modal?.type === 'FILTER_STATE'
      ? currentState.modal.previousState
      : false; // Assume OFF if unknown

    logger.info('[action-controller] [filter] Sending toggle request...');

    // 2. Send UDS request
    const result = await this.udsWriter.filterToggle();
    const udsTookMs = Date.now() - startTime;

    // 3. Show filter state modal with new state
    setFilterStateModal(previousState, result.filterEnabled);

    logger.info('[action-controller] [filter] ✓ Filter toggled', {
      previousState,
      newState: result.filterEnabled,
      udsTookMs,
    });
  } catch (err) {
    logger.error('[action-controller] [filter] Failed', {
      error: String(err),
    });
  }
}
```

### 2.5.3 Filter Modal Rendering

```typescript
/**
 * Render filter state modal (auto-dismisses)
 */
function renderFilterStateModal(modal: FilterStateModal): void {
  process.stdout.write('\n');
  process.stdout.write('╭─────────────────────────────────────────────────────╮\n');
  process.stdout.write(`│ ${modal.message.padEnd(49)} │\n`);
  process.stdout.write('╰─────────────────────────────────────────────────────╯\n');
  process.stdout.write('\n');
}
```

---

## 2.6 Modal Rendering Integration (Render Server)

### 2.6.1 Main Render Loop Integration

**File**: `src/services/render-server.ts` or wherever SSE rendering happens

Add modal rendering check BEFORE job display rendering:

```typescript
// In main render loop (before job card rendering)
const state = getCurrentJob();

if (state.modal) {
  // Check expiry
  checkModalExpiry();

  // Re-read state after expiry check
  const updatedState = getCurrentJob();
  if (updatedState.modal) {
    // Render appropriate modal
    switch (updatedState.modal.type) {
      case 'EDIT_CONFIRMATION':
        renderEditConfirmationModal(updatedState.modal);
        break;
      case 'PREVIEW_VIEWER':
        renderPreviewViewerModal(updatedState.modal);
        break;
      case 'FILTER_STATE':
        renderFilterStateModal(updatedState.modal);
        break;
    }
  }
} else if (state.job) {
  // Normal job card rendering
  renderJobCard(state.job, state.stage);
}
```

---

## 2.7 Phase 2 Implementation Steps

### Step 2.1: Update shared-tui-state.ts
- Add ModalState types (section 2.2.1)
- Update createDefaultState() (section 2.2.2)
- Update readSharedStateFromDisk() (section 2.2.3)
- Add modal management functions (section 2.2.4)

### Step 2.2: Update action-controller.ts
- Import modal functions from shared-tui-state
- Update handleEdit() (section 2.3.1)
- Update handlePreview() (section 2.4.1)
- Update handleFilterToggle() (section 2.5.2)
- Update keyboard handler for preview pagination (section 2.4.2)

### Step 2.3: Update UdsActionWriter.ts
- Enhance filterToggle() to parse response body (section 2.5.1)
- Add lastKnownFilterState tracking

### Step 2.4: Update Daemon (index.ts)
- Update /internal/action handler to return filterEnabled (section 2.5.1)

### Step 2.5: Update Render Server
- Add modal rendering functions (sections 2.3.2, 2.4.3, 2.5.3)
- Integrate modal rendering into main loop (section 2.6.1)
- Ensure checkModalExpiry() is called regularly

### Step 2.6: Remove Headless Mode Branching
- Search for `mode === 'HEADLESS'` or `headless` checks
- Ensure all modal rendering uses stderr-friendly format
- Verify no TTY-specific dependencies

---

## 2.8 Phase 2 Validation Checkpoints

### Checkpoint 2.1: State Management
```bash
# Verify state file includes modal field
jq '.modal' ~/.cache/jobs-watcher-tui-state.json

# Expected after edit: {"type":"EDIT_CONFIRMATION",...}
# Expected after preview: {"type":"PREVIEW_VIEWER",...}
# Expected after filter: {"type":"FILTER_STATE",...}
```

### Checkpoint 2.2: Edit Modal
```bash
# Press 'e' on job card, make edits in editor, save
# Expected in logs:
# - "[MODAL] Edit confirmation shown, changedFields: 3"
# - Job card shows updated values
# - Prompt remains "[j]ueue [d]iscard [s]kip [e]dit [p]review"
```

### Checkpoint 2.3: Preview Modal
```bash
# Press 'p' on job card
# Expected in render:
# - Modal box appears with clipboard content
# - Page indicator "Page 1/N"
# - Navigation prompts "[↑] prev [↓] next [q] close"
```

### Checkpoint 2.4: Filter Modal
```bash
# Press 'f' to toggle filter
# Expected in render:
# - Modal box appears: "Filter: ON→OFF ✓" (or OFF→ON)
# - Modal auto-dismisses after 1500ms
# - No user input required
```

### Checkpoint 2.5: Modal Expiry
```bash
# Watch state file for modal field
watch -n 0.1 'jq ".modal.type" ~/.cache/jobs-watcher-tui-state.json'

# Expected:
# - FILTER_STATE modal disappears after ~1500ms
# - EDIT_CONFIRMATION modal stays until routing action
# - PREVIEW_VIEWER modal stays until 'q' or ESC
```

---

# PHASE 3: TESTING GUIDE & CI INTEGRATION

## 3.1 Current State vs Target

### Current Issues
1. **MANUAL_TESTING_GUIDE.md** missing modal test cases (TEST 10, TEST 11)
2. **deploy-with-manual-test.sh** has hardcoded `/srv/jobs-watcher` paths (non-dev)
3. **No MongoDB cleanup step** in deploy script
4. **Systemd verification** steps missing from guide
5. **Modal rendering tests** not documented

### Target State
1. ✅ MANUAL_TESTING_GUIDE updated with TEST 10-11 modal validation
2. ✅ deploy-with-manual-test.sh uses local dev environment paths
3. ✅ Deploy script includes MongoDB pre-cleanup
4. ✅ Systemd service verification steps documented
5. ✅ Modal rendering validation checkpoints added

---

## 3.2 MANUAL_TESTING_GUIDE.md Updates

### Section 3.2.1: Add MongoDB Cleanup Prerequisites

**File**: `MANUAL_TESTING_GUIDE.md`  
**Lines**: Update prerequisites section (around line 15)

Add:
```markdown
**MongoDB Collections Cleanup**:
- Clean state between tests: `SKIP_CONFIRM=1 npm run db:truncate`
- Or manually: `mongosh jobs_watcher --eval "db.action_snapshots.deleteMany({})"`
- Or with Docker: `docker exec jobs-watcher-mongo mongosh jobs_watcher --eval "..."`

**Check current counts before testing**:
```bash
mongosh jobs_watcher --eval "
  console.log('action_snapshots:', db.action_snapshots.countDocuments());
  console.log('needs_enrichment:', db.needs_enrichment.countDocuments());
  console.log('job_queue:', db.job_queue.countDocuments());
  console.log('job_trash:', db.job_trash.countDocuments());
"
```
```

### Section 3.2.2: Add TEST 10 (Preview Modal)

**File**: `MANUAL_TESTING_GUIDE.md`  
**Location**: After TEST 9 section

```markdown
---

## TEST 10: Modal [p]review - Preview Viewer

**Status**: 🟢 READY - Modal implementation complete  
**Goal**: Verify [p] opens preview modal with paginated clipboard content.

**Prerequisites**:
- [ ] Job displayed (after TEST 1-2)
- [ ] Modal layer implemented (src/ui/shared-tui-state.ts has ModalState)
- [ ] Render server updated (supports renderPreviewViewerModal)

**Setup**:
1. TUI running with job displayed (Signal 2)
2. Prepare clipboard with multi-page content:
   ```bash
   # Copy 50+ lines of text to clipboard (e.g., job description HTML)
   ```

**Steps**:
1. Job card showing in Pane 0
2. Press 'p' in Pane 1
3. Observe Pane 0:
   - Modal box appears with centered content
   - Header: "👁️ PREVIEW (Page 1/N)"
   - Content: First 20 lines of clipboard
   - Footer: "[↑] prev [↓] next [q] close"
4. Test pagination:
   - Press ↓ or Page Down
   - Page increments: "Page 2/N"
   - Content shifts to next 20 lines
5. Press 'q' to close modal
   - Modal disappears
   - Job card returns to display

**Expected**:
- ✅ Modal appears with pagination
- ✅ Page navigation works (↑/↓)
- ✅ Can't page beyond max pages
- ✅ 'q' closes modal cleanly
- ✅ Job state unchanged after modal close

**Logs Expected** (Pane 2):
```
[MODAL] Preview viewer shown, totalLines: 52, maxPages: 3
[action-controller] [preview] ✓ Preview shown, contentLength: 1234
```

**Failure Debug**:
- 'p' key not recognized: Check Pane 1 focus
- No modal appears: Check renderPreviewViewerModal() exists in render-server.ts
- Pagination not working: Verify updatePreviewPage() called on ↑/↓
- Modal won't close: Check keyboard handler passes 'q' to clearModal()
- Page shows "Page 0/0": Verify maxPages calculation in setPreviewViewerModal()

**Test Artifact**: Screenshot of modal with pagination indicator
```

### Section 3.2.3: Add TEST 11 (Filter Modal)

**File**: `MANUAL_TESTING_GUIDE.md`  
**Location**: After TEST 10 section

```markdown
---

## TEST 11: Modal [f]ilter - Filter State Feedback

**Status**: 🟢 READY - Modal implementation complete  
**Goal**: Verify [f] toggles filter with visual state confirmation.

**Prerequisites**:
- [ ] Job displayed (after TEST 1-2)
- [ ] Modal layer implemented (FilterStateModal type)
- [ ] UDS response includes filterEnabled field
- [ ] Daemon /internal/action updated to return filterEnabled

**Setup**:
1. TUI running with job displayed
2. Verify daemon is running and responsive

**Steps**:
1. Job card showing in Pane 0, no modal visible
2. Press 'f' in Pane 1 to toggle filter
3. Observe Pane 0:
   - Modal box appears: "Filter: OFF→ON ✓"
   - Modal centered on screen
4. Wait 1-2 seconds:
   - Modal auto-dismisses (1500ms timeout)
   - Job card returns to display
5. Press 'f' again to toggle back:
   - Modal appears: "Filter: ON→OFF ✓"
   - Auto-dismisses again

**Expected**:
- ✅ Modal shows with correct state transition
- ✅ Modal auto-dismisses after ~1500ms
- ✅ No manual keypress required to dismiss
- ✅ Job state unchanged after toggle
- ✅ Repeated toggles work consistently

**Logs Expected** (Pane 2):
```
[action-controller] [filter] ✓ Filter toggled, previousState: false, newState: true, udsTookMs: 45
[MODAL] Filter state changed, from: OFF, to: ON
[MODAL] Modal auto-dismissed (expired)
```

**Failure Debug**:
- 'f' key not recognized: Check Pane 1 focus, verify keyboard handler routes 'f' to handleFilterToggle()
- Modal doesn't appear: Verify renderFilterStateModal() in render-server.ts
- Modal doesn't auto-dismiss: Check checkModalExpiry() called regularly in render loop
- State shows null: Verify daemon returns { filterEnabled: true/false } in /internal/action response
- Repeated toggles fail: Check this.lastKnownFilterState tracking in UdsActionWriter

**Test Artifact**: Screenshots of ON→OFF and OFF→ON state transitions
```

### Section 3.2.4: Add Modal Testing Workflow

**File**: `MANUAL_TESTING_GUIDE.md`  
**Location**: Add new section after TEST 11

```markdown
---

## MODAL TESTING WORKFLOW (Integrated)

**Complete Flow**: Chain all 3 modals in sequence

**Prerequisites**:
- [ ] MongoDB cleaned: `SKIP_CONFIRM=1 npm run db:truncate`
- [ ] TUI running (all 3 panes)
- [ ] Fresh job ready (TEST 1 webhook)

**Sequence**:

### Phase 1: Generate Job (Signal 1)
```
$ bash scripts/eval-fetch-and-trigger.sh 1
# Expected: Job appears in Pane 0
```

### Phase 2: Parse Job (Signal 2)
```
# In Pane 1: Press 'c' to clipboard parse
# Expected: Modal doesn't appear (Signal 2 is non-interactive)
```

### Phase 3: Test Edit Modal
```
# In Pane 1: Press 'e' to edit
# Expected: Editor opens (nano/vim)
# Action: Change position field, save, exit
# Expected: Edit confirmation modal appears with diff
# In Pane 1: Press 'a' to accept edits
# Expected: Modal clears, job displays with new values
```

### Phase 4: Test Preview Modal
```
# In Pane 1: Press 'p' to preview
# Expected: Preview modal appears (Page 1/N)
# Action: Press ↓ to navigate pages
# Expected: Page increments, content shifts
# Action: Press 'q' to close
# Expected: Modal clears
```

### Phase 5: Test Filter Modal
```
# In Pane 1: Press 'f' to toggle filter
# Expected: Filter state modal appears "Filter: OFF→ON ✓"
# Action: Wait 1-2 seconds
# Expected: Modal auto-dismisses
# Result: Job still displayed, filter toggled
```

### Phase 6: Route Job
```
# In Pane 1: Press 'j' to queue
# Expected: Signal 3 (job.routed decision=queue)
# Job disappears, TUI returns to IDLE
```

**Expected Outcomes**:
- ✅ All 3 modals appear with correct timing
- ✅ Each modal behaves as specified (dismiss vs auto-dismiss)
- ✅ Job state transitions correctly through all stages
- ✅ Logs show all signal emissions
- ✅ MongoDB collections updated correctly (job_queue, action_snapshots)

**Test Report**: Document each phase success/failure, collect logs:
```bash
$ journalctl -u jobs-watcher -n 100 > test-10-11-logs.txt
$ tail -50 logs/*.log >> test-10-11-logs.txt
```
```

---

## 3.3 deploy-with-manual-test.sh Updates

### Section 3.3.1: Fix Hardcoded Paths

**File**: `scripts/deploy-with-manual-test.sh`  
**Lines**: 32 (SOCKET_PATH)  
**Current**:
```bash
SOCKET_PATH="/run/jobs-watcher/ingest.sock"
```

**Target**: Support local development + production paths

```bash
# Detect runtime directory (before line 32)
detect_runtime_dir() {
  # 1. Try XDG_RUNTIME_DIR (dev)
  if [ -n "${XDG_RUNTIME_DIR:-}" ]; then
    echo "$XDG_RUNTIME_DIR/jobs-watcher"
    return
  fi
  
  # 2. Try /run/jobs-watcher (production)
  if [ -d /run/jobs-watcher ] && [ -w /run/jobs-watcher ]; then
    echo "/run/jobs-watcher"
    return
  fi
  
  # 3. Fallback to home cache (dev)
  echo "$HOME/.cache/jobs-watcher"
}

RUNTIME_DIR="$(detect_runtime_dir)"
SOCKET_PATH="$RUNTIME_DIR/ingest.sock"
```

### Section 3.3.2: Add MongoDB Cleanup Step

**File**: `scripts/deploy-with-manual-test.sh`  
**Location**: Add new section before STEP 1

```bash
# ============================================================================
# STEP 0: MongoDB Cleanup (Optional, --clean flag)
# ============================================================================

if [[ "${CLEAN_DB:-false}" == "true" ]]; then
  log_section "STEP 0: MongoDB Cleanup"
  
  if command -v mongosh &> /dev/null; then
    log_info "Cleaning MongoDB collections..."
    
    if mongosh jobs_watcher --quiet --eval "
      db.action_snapshots.deleteMany({});
      db.needs_enrichment.deleteMany({});
      db.job_queue.deleteMany({});
      db.job_trash.deleteMany({});
      db.raw_ingest.deleteMany({});
    " >> "$LOG_FILE" 2>&1; then
      log_info "✅ MongoDB collections cleaned"
    else
      log_warn "⚠️  MongoDB cleanup had issues (continuing anyway)"
    fi
  else
    log_warn "mongosh not found - skipping database cleanup"
  fi
fi
```

Add flag parsing at top:
```bash
CLEAN_DB=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --clean)
      CLEAN_DB=true
      shift
      ;;
    # ... existing cases ...
  esac
done
```

### Section 3.3.3: Update Usage Documentation

**File**: `scripts/deploy-with-manual-test.sh`  
**Lines**: Header comments (around line 10)

Add:
```bash
# Usage:
#   ./scripts/deploy-with-manual-test.sh [options]
#
# Options:
#   --build-only          Only build, don't deploy or verify
#   --verify-only         Only verify deployment, don't build
#   --env FILE            Use alternate .env file (default: .env.production)
#   --skip-tests          Skip running tests before build
#   --clean               Clean MongoDB before deployment
#   --help                Show this message
#
# Examples (Development):
#   # Build and deploy to dev environment with MongoDB cleanup
#   ./scripts/deploy-with-manual-test.sh --clean
#
#   # Build only
#   ./scripts/deploy-with-manual-test.sh --build-only
#
#   # Verify existing deployment
#   ./scripts/deploy-with-manual-test.sh --verify-only
```

### Section 3.3.4: Enhance Systemd Verification

**File**: `scripts/deploy-with-manual-test.sh`  
**Lines**: verify_daemon function (around line 200)

Enhance socket verification:
```bash
verify_daemon() {
  log_info "Checking systemd service status..."
  
  if systemctl is-active --quiet jobs-watcher-dev; then
    log_info "✅ Service is active"
  else
    log_warn "Service is not active, attempting to start..."
    if sudo systemctl start jobs-watcher-dev >> "$LOG_FILE" 2>&1; then
      log_info "✅ Service started"
      sleep 2
    else
      log_error "Failed to start service"
      sudo journalctl -u jobs-watcher-dev -n 30 2>&1 | tee -a "$LOG_FILE"
      return 1
    fi
  fi

  # Enhanced socket checking
  log_info "Checking for UDS socket file..."
  
  # Try XDG_RUNTIME_DIR first
  if [ -n "${XDG_RUNTIME_DIR:-}" ]; then
    SOCKET_PATH="$XDG_RUNTIME_DIR/jobs-watcher/ingest.sock"
    if [ -S "$SOCKET_PATH" ]; then
      log_info "✅ Socket file exists: $SOCKET_PATH"
      ls -lh "$SOCKET_PATH" 2>/dev/null | tee -a "$LOG_FILE"
      return 0
    fi
  fi
  
  # Try /run/jobs-watcher
  if [ -S "/run/jobs-watcher/ingest.sock" ]; then
    log_info "✅ Socket file exists: /run/jobs-watcher/ingest.sock"
    ls -lh /run/jobs-watcher/ingest.sock 2>/dev/null | tee -a "$LOG_FILE"
    return 0
  fi
  
  # Try $HOME/.cache
  if [ -S "$HOME/.cache/jobs-watcher/ingest.sock" ]; then
    log_info "✅ Socket file exists: $HOME/.cache/jobs-watcher/ingest.sock"
    ls -lh "$HOME/.cache/jobs-watcher/ingest.sock" 2>/dev/null | tee -a "$LOG_FILE"
    return 0
  fi
  
  log_error "❌ Socket file not found at any expected location"
  log_info "Checking service logs for errors..."
  sudo journalctl -u jobs-watcher-dev -n 50 2>&1 | tee -a "$LOG_FILE"
  return 1
}
```

---

## 3.4 Systemd Service Verification Steps

### Section 3.4.1: Service File Validation

**File**: Create `docs/SYSTEMD_VERIFICATION_CHECKLIST.md`

```markdown
# Systemd Service Verification Checklist

## Pre-Deployment

### 1. Service File Syntax
```bash
sudo systemd-analyze verify /etc/systemd/system/jobs-watcher-dev.service
# Expected: No errors, all paths resolve
```

### 2. Environment File Readable
```bash
ls -lh ~/.jobs-watcher.env
# Expected: -rw-r--r-- 1 {user} {user}

# Test reading env vars
source ~/.jobs-watcher.env && echo "NODE_ENV=$NODE_ENV"
# Expected: NODE_ENV=development
```

### 3. Node.js Binary Executable
```bash
# Check Node is at expected location
~/.nvm/versions/node/v22.12.0/bin/node --version
# Expected: v22.12.0

# Test can import modern syntax (lru-cache)
~/.nvm/versions/node/v22.12.0/bin/node -e "
  import('lru-cache').then(m => console.log('✓ lru-cache imported OK'))
"
# Expected: ✓ lru-cache imported OK
```

## Deployment

### 4. Service Enable
```bash
sudo systemctl daemon-reload
sudo systemctl enable jobs-watcher-dev.service
# Expected: No errors, service linked
```

### 5. Service Start
```bash
sudo systemctl start jobs-watcher-dev.service
sleep 2

# Check status
systemctl status jobs-watcher-dev.service
# Expected: ● jobs-watcher-dev.service - Jobs Watcher webhook + worker (active, running)
```

## Post-Deployment

### 6. Process Running
```bash
pgrep -f "node.*dist/src/index.js" | head -1
# Expected: [PID number]

# Or detailed:
ps aux | grep "node.*dist/src/index.js" | grep -v grep
```

### 7. Socket File Created
```bash
ls -lh /run/user/$(id -u)/jobs-watcher/ingest.sock
# Expected: srwxr-xr-x

# Test connectivity
timeout 1 bash -c "exec 3<>/run/user/$(id -u)/jobs-watcher/ingest.sock && echo OK" || echo "Socket responsive"
```

### 8. Logs Accessible
```bash
journalctl -u jobs-watcher-dev -n 20
# Expected: Service startup messages, no errors

# Follow live logs
journalctl -u jobs-watcher-dev -f
# (Ctrl+C to exit)
```

### 9. Health Check
```bash
# If daemon exposes /health endpoint
curl -s http://127.0.0.1:3000/health
# Expected: {"status":"ok"} or similar
```

## Troubleshooting

### Service Won't Start
```bash
# Check detailed error
journalctl -u jobs-watcher-dev -n 50
# Look for: SyntaxError, Module not found, ENOENT, EACCES

# Common fixes:
# 1. Node version mismatch: Verify ~/.nvm/versions/node/v22.12.0 exists
# 2. Working directory: Verify ~/node_projects/jobs-watcher exists
# 3. Permissions: Verify user can read ~/node_projects/jobs-watcher
```

### Socket Not Created
```bash
# Check service logs
journalctl -u jobs-watcher-dev -n 30

# Check directory permissions
ls -lhd /run/user/$(id -u)
# Expected: drwx------ (user owns it)

# Check if service is trying to create socket
sudo systemctl stop jobs-watcher-dev.service
rm -f /run/user/$(id -u)/jobs-watcher/ingest.sock
sudo systemctl start jobs-watcher-dev.service
sleep 1
ls -lh /run/user/$(id -u)/jobs-watcher/ingest.sock
```

### Permission Denied
```bash
# If you see "Permission denied" errors:
# 1. Check file ownership
ls -lh ~/.jobs-watcher.env
# Should be readable by current user

# 2. Check directory ownership
ls -lhd ~/.cache/jobs-watcher
# Should be writable by current user

# 3. Fix if needed
chmod 644 ~/.jobs-watcher.env
chmod 755 ~/.cache/jobs-watcher
```

## Success Indicators
- ✅ systemctl status shows "active (running)"
- ✅ journalctl shows no ERROR or CRITICAL messages
- ✅ Socket file exists and is readable
- ✅ Process visible in ps output
- ✅ /health endpoint responds (if applicable)
```

---

## 3.5 Phase 3 Implementation Steps

### Step 3.1: Update MANUAL_TESTING_GUIDE.md
- Add MongoDB cleanup prerequisites (section 3.2.1)
- Add TEST 10: Preview Modal (section 3.2.2)
- Add TEST 11: Filter Modal (section 3.2.3)
- Add Modal Testing Workflow (section 3.2.4)

### Step 3.2: Update deploy-with-manual-test.sh
- Fix hardcoded paths with runtime directory detection (section 3.3.1)
- Add MongoDB cleanup step with --clean flag (section 3.3.2)
- Update usage documentation (section 3.3.3)
- Enhance systemd verification (section 3.3.4)

### Step 3.3: Create Systemd Verification Guide
- Create `docs/SYSTEMD_VERIFICATION_CHECKLIST.md` (section 3.4.1)
- Document all pre/post/troubleshooting steps

### Step 3.4: Update Quick Start Guide
- Add systemd deployment section pointing to verification checklist
- Add modal testing quick links

---

## 3.6 Phase 3 Validation Checkpoints

### Checkpoint 3.1: Documentation Completeness
```bash
# Verify all guide sections updated
grep -n "TEST 10\|TEST 11\|MODAL" MANUAL_TESTING_GUIDE.md | head -10
# Expected: Multiple references to modal tests

# Verify systemd guide exists
test -f docs/SYSTEMD_VERIFICATION_CHECKLIST.md && echo "✅" || echo "❌"
```

### Checkpoint 3.2: Deploy Script Functionality
```bash
# Test with --clean flag (dry run)
bash scripts/deploy-with-manual-test.sh --build-only --clean --dry-run 2>&1 | grep -i "mongodb\|clean"
# Expected: Cleanup step listed

# Test socket path detection
bash scripts/deploy-with-manual-test.sh --verify-only 2>&1 | grep -i "socket"
# Expected: Socket path detected correctly
```

### Checkpoint 3.3: MongoDB Cleanup
```bash
# Before running deploy with --clean
mongosh jobs_watcher --eval "db.action_snapshots.countDocuments()"
# Expected: Some count

# Run deploy with --clean
bash scripts/deploy-with-manual-test.sh --clean

# After deployment
mongosh jobs_watcher --eval "db.action_snapshots.countDocuments()"
# Expected: 0 (or lower count)
```

### Checkpoint 3.4: Systemd Verification
```bash
# Run verification checklist items
systemd-analyze verify /etc/systemd/system/jobs-watcher-dev.service
# Expected: No errors

systemctl status jobs-watcher-dev.service
# Expected: active (running)

journalctl -u jobs-watcher-dev -n 5
# Expected: No CRITICAL/ERROR messages
```

---

# SUMMARY & DELIVERABLES

## Deliverables by Phase

### Phase 1 (2-3 hours)
- ✅ `scripts/systemd/jobs-watcher.dev.service` - Dev-friendly service file
- ✅ `src/utils/socket-path.ts` - Runtime directory detection
- ✅ Updated `src/index.ts` - Uses socket path helper
- ✅ Updated `scripts/install-systemd-local.sh` - Dev environment support
- ✅ `scripts/.env.development.example` - Dev environment template

### Phase 2 (5-7 hours)
- ✅ Extended `src/ui/shared-tui-state.ts` - Modal state layer
- ✅ Updated `src/ui/action-controller.ts` - Modal dispatching
- ✅ Updated `src/ui/components/UdsActionWriter.ts` - Filter response parsing
- ✅ Updated `src/index.ts` - Daemon filter response enhancement
- ✅ Updated render server - Modal rendering functions
- ✅ Removed headless mode branching - Unified code path

### Phase 3 (2-4 hours)
- ✅ Updated `MANUAL_TESTING_GUIDE.md` - TEST 10-11 modal tests
- ✅ Updated `scripts/deploy-with-manual-test.sh` - Path fixes + MongoDB cleanup
- ✅ New `docs/SYSTEMD_VERIFICATION_CHECKLIST.md` - Verification guide
- ✅ Updated `QUICK_START.md` - Systemd references
- ✅ Test artifacts collected and documented

## Total Estimated Timeline
- **Phase 1**: 2-3 hours (systemd fixes)
- **Phase 2**: 5-7 hours (modal implementation)
- **Phase 3**: 2-4 hours (testing & CI)
- **Buffer**: 1-2 hours (testing, debugging)
- **Total**: 11-16 hours (reduced from original 6-8 + 5-7 = 11-15 through refinements)

## Key Achievements
1. ✅ Systemd deployment works in dev environment
2. ✅ No more Node v12 syntax errors
3. ✅ Socket directory correctly resolved (dev/prod)
4. ✅ Three modals fully implemented with proper state management
5. ✅ Modal rendering integrated into main TUI loop
6. ✅ Testing guide comprehensive with validation checkpoints
7. ✅ Deploy script portable and CI-friendly

---

## Next Steps After Implementation

1. **Execute Phase 1**: Deploy dev systemd service, verify socket creation
2. **Execute Phase 2**: Implement modals, run manual modal tests (TEST 10-11)
3. **Execute Phase 3**: Update docs, run full manual testing workflow
4. **Integration**: Add modal tests to E2E test suite
5. **Production**: Adapt Phase 1 for production deployment path
6. **CI/CD**: Add systemd verification to deployment pipeline
