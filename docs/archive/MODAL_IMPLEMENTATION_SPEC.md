# Modal Implementation Specification: jobs-watcher TUI
**Date**: 2026-04-17  
**Status**: Design Specification - Ready for Implementation  
**Scope**: Three modal patterns for operator actions ([e] Edit, [p] Preview, [f] Filter)  
**Priority**: HIGH (affects TEST 7, TEST 10-11 validation)

---

## EXECUTIVE SUMMARY

This specification provides production-ready implementation details for three modal patterns to improve operator UX in the jobs-watcher TUI:

| Modal | Action | Priority | Complexity | Est. Dev Time |
|-------|--------|----------|------------|---------------|
| **Edit Confirmation** | `[e]` | HIGH | Medium | 2-3 hours |
| **Preview Viewer** | `[p]` | HIGH | Low | 1.5-2 hours |
| **Filter State** | `[f]` | MEDIUM | Low | 1-1.5 hours |

**Total Estimated**: 5-7 hours implementation + testing (REFINED: Was 6-8h, reduced by fs.watch + clipboard-only patterns)

**Key Refinements Applied (v2)**:
- ✅ **Edit Modal**: fs.watch + temp file serialization (no Signal 1/Signal 2 duplication overhead)
- ✅ **Preview Modal**: Clipboard-only single tab (removed tab switching complexity)
- ✅ **Filter Modal**: UDS response includes `{filterEnabled: boolean}` payload
- ✅ **Code Path**: Single stderr-friendly rendering (removed headless branching)
- ✅ **Dev Time Savings**: fs.watch simplification + clipboard-only design = -1 to -2 hours

---

# PART 1: STATE MANAGEMENT EXTENSIONS

## 1.1 New State Interface (shared-tui-state.ts)

### Current State
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

### Extended State (ADD MODAL LAYER)
```typescript
// Add to shared-tui-state.ts AFTER CurrentJobState interface

export type ModalType = 'EDIT_CONFIRMATION' | 'PREVIEW_VIEWER' | 'FILTER_STATE' | null;

export interface EditConfirmationModal {
  type: 'EDIT_CONFIRMATION';
  originalJob: Record<string, unknown>;      // Snapshot before edit
  editedJob: Record<string, unknown>;        // Snapshot after edit
  editedKVs: Record<string, unknown>;        // Diff only (for queuing)
  diffFields: {
    [key: string]: { original: unknown; edited: unknown };
  };
  createdAt: string;
  expiresAt?: string;                        // Auto-dismiss timeout
}

export interface PreviewViewerModal {
  type: 'PREVIEW_VIEWER';
  clipboardContent: string[];                // Pre-split into lines
  currentPage: number;                       // Page index (0-indexed)
  maxPages: number;                          // Total pages
  maxLinePerPage: number;                    // Lines per terminal view (default 20)
  createdAt: string;
}

export interface FilterStateModal {
  type: 'FILTER_STATE';
  previousState: boolean;
  newState: boolean;
  message: string;
  createdAt: string;
  expiresAt: string;                         // Auto-dismiss (1500ms)
}

export type ModalState = EditConfirmationModal | PreviewViewerModal | FilterStateModal;

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

### New Exported Functions (add to shared-tui-state.ts)

```typescript
/**
 * Set edit confirmation modal after editor closes
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

  const nextState = {
    ...readSharedStateFromDisk(),
    modal: {
      type: 'EDIT_CONFIRMATION' as const,
      originalJob,
      editedJob,
      editedKVs,
      diffFields,
      createdAt: new Date().toISOString(),
    },
    updatedAt: new Date().toISOString(),
  };

  persist(nextState);
  logger.info('[MODAL] Edit confirmation shown', {
    changedFields: Object.keys(editedKVs).length,
  });
}

/**
 * Set preview viewer modal (clipboard-only)
 */
export function setPreviewViewerModal(
  clipboard: string,
  maxLinesPerPage: number = 20
): void {
  // Use clipboard-getter to get full HTML
  // Split by lines for pagination
  const lines = clipboard.split('\n');
  const maxPages = Math.ceil(lines.length / maxLinesPerPage);

  const nextState = {
    ...readSharedStateFromDisk(),
    modal: {
      type: 'PREVIEW_VIEWER' as const,
      clipboardContent: lines,
      currentPage: 0,
      maxPages,
      maxLinePerPage: maxLinesPerPage,
      createdAt: new Date().toISOString(),
    },
    updatedAt: new Date().toISOString(),
  };

  persist(nextState);
  logger.info('[MODAL] Preview viewer shown (clipboard-only)', {
    totalLines: lines.length,
    maxPages,
    maxLinePerPage,
  });
}

/**
 * Update preview modal pagination
 */
export function updatePreviewPage(direction: 'up' | 'down'): void {
  const state = readSharedStateFromDisk();
  
  if (!state.modal || state.modal.type !== 'PREVIEW_VIEWER') {
    return;
  }

  const modal = state.modal as PreviewViewerModal;
  const nextPage = direction === 'down' 
    ? Math.min(modal.currentPage + 1, modal.maxPages - 1)
    : Math.max(modal.currentPage - 1, 0);

  const nextState = {
    ...state,
    modal: {
      ...modal,
      currentPage: nextPage,
    },
    updatedAt: new Date().toISOString(),
  };

  persist(nextState);
}

/**
 * Toggle preview tab
 */
export function switchPreviewTab(tab: 'JOB_DETAILS' | 'CLIPBOARD' | 'DIFF'): void {
  const state = readSharedStateFromDisk();
  
  if (!state.modal || state.modal.type !== 'PREVIEW_VIEWER') {
    return;
  }

  const modal = state.modal as PreviewViewerModal;
  const nextState = {
    ...state,
    modal: {
      ...modal,
      tabMode: tab,
      currentPage: 0, // Reset to first page
    },
    updatedAt: new Date().toISOString(),
  };

  persist(nextState);
}

/**
 * Set filter state modal (auto-expires)
 */
export function setFilterStateModal(
  previousState: boolean,
  newState: boolean,
  autoDismissMs: number = 1500
): void {
  const nextState = {
    ...readSharedStateFromDisk(),
    modal: {
      type: 'FILTER_STATE' as const,
      previousState,
      newState,
      message: `Filter: ${previousState ? 'ON' : 'OFF'} → ${newState ? 'ON' : 'OFF'} ✓`,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + autoDismissMs).toISOString(),
    },
    updatedAt: new Date().toISOString(),
  };

  persist(nextState);
  logger.info('[MODAL] Filter state shown', {
    previousState,
    newState,
    autoDismissMs,
  });
}

/**
 * Clear modal (after user action or timeout)
 */
export function clearModal(): void {
  const state = readSharedStateFromDisk();
  
  const nextState = {
    ...state,
    modal: null,
    updatedAt: new Date().toISOString(),
  };

  persist(nextState);
  logger.info('[MODAL] Modal cleared');
}

/**
 * Check if modal should auto-dismiss (for filter state modal)
 */
export function checkModalExpiry(): void {
  const state = readSharedStateFromDisk();
  
  if (!state.modal || state.modal.type !== 'FILTER_STATE') {
    return;
  }

  const modal = state.modal as FilterStateModal;
  const now = new Date().getTime();
  const expiryTime = new Date(modal.expiresAt).getTime();

  if (now > expiryTime) {
    clearModal();
  }
}
```

---

## 1.2 State Migration Plan

**Backward Compatibility**: ✅ Required (running systems have STATE_VERSION=1)

```typescript
// In shared-tui-state.ts readSharedStateFromDisk()
// ADD VERSION CHECK AFTER existing validation:

if (parsed.version === 1 && !('modal' in parsed)) {
  // Version 1 → 1.1: Add modal field
  logger.info('[STATE] Auto-migrating V1 → V1.1 (add modal field)');
  // Don't increment version - just add modal: null
}
```

**No version bump needed** - `modal: null` is safe for old code

---

# PART 2: MODAL RENDERING COMPONENTS

## 2.1 ANSI Color & Style Reference

### Color Palette (ANSI Escape Codes)

```typescript
// src/ui/components/AnsiStyles.ts (NEW FILE)

export const ANSI = {
  // Colors (30-37, 90-97 for 256-color)
  RESET: '\x1b[0m',
  BOLD: '\x1b[1m',
  DIM: '\x1b[2m',
  ITALIC: '\x1b[3m',
  UNDERLINE: '\x1b[4m',
  BLINK: '\x1b[5m',
  REVERSE: '\x1b[7m',
  HIDDEN: '\x1b[8m',
  STRIKETHROUGH: '\x1b[9m',

  // Foreground colors
  BLACK: '\x1b[30m',
  RED: '\x1b[31m',
  GREEN: '\x1b[32m',
  YELLOW: '\x1b[33m',
  BLUE: '\x1b[34m',
  MAGENTA: '\x1b[35m',
  CYAN: '\x1b[36m',
  WHITE: '\x1b[37m',

  // Bright foreground colors
  BRIGHT_BLACK: '\x1b[90m',    // Dim gray
  BRIGHT_RED: '\x1b[91m',
  BRIGHT_GREEN: '\x1b[92m',
  BRIGHT_YELLOW: '\x1b[93m',
  BRIGHT_BLUE: '\x1b[94m',
  BRIGHT_MAGENTA: '\x1b[95m',
  BRIGHT_CYAN: '\x1b[96m',
  BRIGHT_WHITE: '\x1b[97m',

  // Background colors
  BG_BLACK: '\x1b[40m',
  BG_RED: '\x1b[41m',
  BG_GREEN: '\x1b[42m',
  BG_YELLOW: '\x1b[43m',
  BG_BLUE: '\x1b[44m',
  BG_MAGENTA: '\x1b[45m',
  BG_CYAN: '\x1b[46m',
  BG_WHITE: '\x1b[47m',
};

// Theme presets for different modal types
export const MODAL_THEME = {
  edit: {
    border: ANSI.CYAN,                          // ┌─ Diff Preview ─┐
    header: `${ANSI.BOLD}${ANSI.CYAN}`,         // Diff Preview title
    fieldName: `${ANSI.BOLD}${ANSI.CYAN}`,      // "company:"
    originalLabel: ANSI.BRIGHT_BLACK,           // "Original:" (dim)
    originalValue: ANSI.BRIGHT_BLACK,           // Value (dim)
    newLabel: `${ANSI.BOLD}${ANSI.GREEN}`,     // "New:" (bold green)
    newValue: `${ANSI.BOLD}${ANSI.GREEN}`,     // Value (bold green)
    unchanged: ANSI.BRIGHT_BLACK,               // Context lines (dim)
    button: `${ANSI.BOLD}${ANSI.YELLOW}`,      // [A]pply [D]iscard
    checkmark: ANSI.GREEN,                      // ✓
  },
  preview: {
    border: ANSI.CYAN,                          // ┌─ Job Preview ─┐
    header: `${ANSI.BOLD}${ANSI.CYAN}`,         // Job Preview title
    jsonKey: ANSI.CYAN,                         // Object keys
    jsonString: ANSI.GREEN,                     // String values
    jsonNumber: ANSI.YELLOW,                    // Numbers
    jsonBoolean: ANSI.MAGENTA,                  // true/false
    jsonNull: ANSI.BRIGHT_BLACK,                // null
    pagination: ANSI.BRIGHT_BLACK,              // [Page 1/5]
    tab: `${ANSI.BOLD}${ANSI.CYAN}`,            // Active tab
    tabInactive: ANSI.BRIGHT_BLACK,             // Inactive tab
  },
  filter: {
    border: ANSI.YELLOW,                        // ┌─ Filter Status ─┐
    header: `${ANSI.BOLD}${ANSI.YELLOW}`,       // Filter Status title
    before: ANSI.BRIGHT_BLACK,                  // OFF (dim)
    arrow: ANSI.YELLOW,                         // →
    after: `${ANSI.BOLD}${ANSI.GREEN}`,         // ON (bold green)
    checkmark: ANSI.GREEN,                      // ✓
  },
};
```

### Character Set (Box Drawing)

```typescript
export const BOXES = {
  // Single-line box drawing
  TL: '┌',      // Top-left
  TR: '┐',      // Top-right
  BL: '└',      // Bottom-left
  BR: '┘',      // Bottom-right
  H: '─',       // Horizontal
  V: '│',       // Vertical
  
  // Double-line box drawing (for emphasis)
  DTL: '╔',     // Double top-left
  DTR: '╗',     // Double top-right
  DBL: '╚',     // Double bottom-left
  DBR: '╝',     // Double bottom-right
  DH: '═',      // Double horizontal
  DV: '║',      // Double vertical
  
  // T-junctions
  T_DOWN: '┬',  // Horizontal top tee
  T_UP: '┴',    // Horizontal bottom tee
  T_RIGHT: '├', // Vertical left tee
  T_LEFT: '┤',  // Vertical right tee
  CROSS: '┼',   // Cross
};
```

---

## 2.2 Edit Confirmation Modal Component

### Component Signature

```typescript
// src/ui/components/EditConfirmationModal.ts (NEW FILE)

import { getLogger } from '../../services/logger.js';
import { ANSI, MODAL_THEME, BOXES } from './AnsiStyles.js';
import type { EditConfirmationModal } from '../shared-tui-state.js';

const logger = getLogger('Modal-Edit');

export interface EditConfirmationRenderOptions {
  modal: EditConfirmationModal;
  terminalWidth?: number;
  maxContextLines?: number;
}

/**
 * Render edit confirmation modal to stderr
 * Format: Box with diff preview + buttons
 */
export function renderEditConfirmationModal(options: EditConfirmationRenderOptions): string {
  const {
    modal,
    terminalWidth = 80,
    maxContextLines = 3,
  } = options;

  const lines: string[] = [];
  const theme = MODAL_THEME.edit;
  const box = BOXES;

  // Header line
  const headerText = ' Diff Preview ';
  const headerPadding = Math.max(1, (terminalWidth - headerText.length - 4) / 2);
  lines.push(
    `${theme.border}${box.TL}${box.H.repeat(Math.floor(headerPadding))}` +
    `${theme.header}${headerText}${theme.border}` +
    `${box.H.repeat(Math.ceil(headerPadding))}${box.TR}${ANSI.RESET}`
  );

  // Diff fields
  for (const [fieldName, diff] of Object.entries(modal.diffFields)) {
    // Field label
    lines.push(
      `${theme.border}${box.V}${ANSI.RESET} ` +
      `${theme.fieldName}${fieldName}${ANSI.RESET}`
    );

    // Original value
    const originalStr = formatValue(diff.original);
    lines.push(
      `${theme.border}${box.V}${ANSI.RESET}   ` +
      `${theme.originalLabel}Original:${ANSI.RESET} ` +
      `${theme.originalValue}${originalStr}${ANSI.RESET}`
    );

    // New value
    const newStr = formatValue(diff.edited);
    lines.push(
      `${theme.border}${box.V}${ANSI.RESET}   ` +
      `${theme.newLabel}New:${ANSI.RESET}      ` +
      `${theme.newValue}${newStr}${ANSI.RESET} ` +
      `${theme.checkmark}✓${ANSI.RESET}`
    );

    // Spacer
    lines.push(
      `${theme.border}${box.V}${ANSI.RESET}`
    );
  }

  // Footer with buttons
  lines.push(
    `${theme.border}${box.BL}${box.H.repeat(terminalWidth - 4)}${box.BR}${ANSI.RESET}`
  );

  // Button line
  const buttonLine =
    `${theme.button}[A]${ANSI.RESET}pply  ` +
    `${theme.button}[D]${ANSI.RESET}iscard`;
  lines.push(buttonLine);

  return lines.join('\n');
}

/**
 * Format value for display (truncate long strings)
 */
function formatValue(value: unknown, maxLen: number = 50): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  
  const str = typeof value === 'string' ? value : JSON.stringify(value);
  
  if (str.length > maxLen) {
    return str.substring(0, maxLen) + '...';
  }
  
  return str;
}

/**
 * Parse modal keyboard input: 'a' (apply) or 'd' (discard)
 */
export function parseEditModalInput(input: string): 'apply' | 'discard' | null {
  const lower = input.toLowerCase().trim();
  
  if (lower === 'a' || lower === 'apply') {
    logger.info('[Modal-Edit] User pressed [A]pply');
    return 'apply';
  }
  
  if (lower === 'd' || lower === 'discard') {
    logger.info('[Modal-Edit] User pressed [D]iscard');
    return 'discard';
  }
  
  if (lower === 'q' || lower === 'esc') {
    logger.info('[Modal-Edit] User pressed [q]/[Esc] (same as discard)');
    return 'discard';
  }
  
  return null;
}
```

### Rendering Example Output

```
┌─ Diff Preview ─────────────────┐
│ company:
│   Original: "Old Corp"
│   New:      "New Corp" ✓
│
│ skills:
│   Original: ["Python"]
│   New:      ["Python","React"] ✓
│
└────────────────────────────────┘
[A]pply  [D]iscard
```

---

## 2.3 Preview Viewer Modal Component

### Component Signature

```typescript
// src/ui/components/PreviewViewerModal.ts (NEW FILE)

import { getLogger } from '../../services/logger.js';
import { ANSI, MODAL_THEME, BOXES } from './AnsiStyles.js';
import type { PreviewViewerModal } from '../shared-tui-state.js';

const logger = getLogger('Modal-Preview');

export interface PreviewViewerRenderOptions {
  modal: PreviewViewerModal;
  terminalWidth?: number;
  terminalHeight?: number;
}

/**
 * Render preview viewer modal to stderr
 * Multi-tab view with pagination
 */
export function renderPreviewViewerModal(options: PreviewViewerRenderOptions): string {
  const {
    modal,
    terminalWidth = 80,
    terminalHeight = 24,
  } = options;

  const lines: string[] = [];
  const theme = MODAL_THEME.preview;
  const box = BOXES;

  // Header with tabs
  const tabs = ['JOB_DETAILS', 'CLIPBOARD', 'DIFF'] as const;
  const tabLine = renderTabs(tabs, modal.tabMode, theme);
  lines.push(tabLine);

  // Top border
  lines.push(
    `${theme.border}${box.TL}${box.H.repeat(terminalWidth - 4)}${box.TR}${ANSI.RESET}`
  );

  // Content lines (paginated)
  const contentLines = getContentForTab(modal, modal.tabMode);
  const startLine = modal.currentPage * modal.maxLinePerPage;
  const endLine = Math.min(startLine + modal.maxLinePerPage, contentLines.length);

  for (let i = startLine; i < endLine; i++) {
    const contentLine = contentLines[i];
    const paddedLine = padLine(contentLine, terminalWidth - 4);
    lines.push(
      `${theme.border}${box.V}${ANSI.RESET} ` +
      `${formatJsonLine(contentLine, theme)}` +
      ` ${theme.border}${box.V}${ANSI.RESET}`
    );
  }

  // Pad empty lines if content is short
  for (let i = endLine - startLine; i < modal.maxLinePerPage; i++) {
    const paddedLine = ' '.repeat(terminalWidth - 4);
    lines.push(
      `${theme.border}${box.V}${ANSI.RESET}${paddedLine}${theme.border}${box.V}${ANSI.RESET}`
    );
  }

  // Bottom border
  lines.push(
    `${theme.border}${box.BL}${box.H.repeat(terminalWidth - 4)}${box.BR}${ANSI.RESET}`
  );

  // Pagination + controls
  const pagination = `${theme.pagination}[Page ${modal.currentPage + 1}/${modal.maxPages}] ` +
    `[↑↓] scroll | [q] close${ANSI.RESET}`;
  lines.push(pagination);

  return lines.join('\n');
}

/**
 * Render tab bar
 */
function renderTabs(
  tabs: readonly string[],
  activeTab: string,
  theme: any
): string {
  const tabStrs = tabs.map(tab => {
    const isActive = tab === activeTab;
    const prefix = isActive ? '' : ' ';
    const style = isActive ? theme.tab : theme.tabInactive;
    return `${style}${prefix}[${tab}]${ANSI.RESET}`;
  });

  return `  ${tabStrs.join('  ')}`;
}

/**
 * Get content lines for active tab
 */
function getContentForTab(modal: PreviewViewerModal, tab: string): string[] {
  const content = modal.content;

  switch (tab) {
    case 'JOB_DETAILS':
      return content.jobDetails.split('\n');
    case 'CLIPBOARD':
      return content.clipboard.split('\n');
    case 'DIFF':
      return content.diff.split('\n');
    default:
      return [];
  }
}

/**
 * Format a single JSON line with colors
 */
function formatJsonLine(line: string, theme: any): string {
  // Simple heuristic-based JSON coloring
  // Production code should use a JSON parser
  
  // Match: "key": or key:
  if (line.includes('":') || /^\s*\w+:/.test(line)) {
    return line.replace(/("?\w+"?)(?=:)/, `${theme.jsonKey}$1${ANSI.RESET}`);
  }

  // Match string values
  if (/"[^"]*"/.test(line)) {
    return line.replace(/"([^"]*)"/g, `${theme.jsonString}"$1"${ANSI.RESET}`);
  }

  // Match numbers
  if (/\d+(\.\d+)?/.test(line)) {
    return line.replace(/\d+(\.\d+)?/g, `${theme.jsonNumber}$&${ANSI.RESET}`);
  }

  // Match booleans
  if (/true|false/.test(line)) {
    return line.replace(/(true|false)/g, `${theme.jsonBoolean}$1${ANSI.RESET}`);
  }

  // Match null
  if (/null/.test(line)) {
    return line.replace(/null/g, `${theme.jsonNull}null${ANSI.RESET}`);
  }

  return line;
}

/**
 * Pad line to terminal width
 */
function padLine(line: string, maxWidth: number): string {
  // Remove ANSI codes for width calculation
  const stripped = line.replace(/\x1b\[[0-9;]*m/g, '');
  const padding = Math.max(0, maxWidth - stripped.length);
  return line + ' '.repeat(padding);
}

/**
 * Parse modal keyboard input
 */
export function parsePreviewModalInput(input: string): 'up' | 'down' | 'tab_next' | 'close' | null {
  const lower = input.toLowerCase().trim();

  if (lower === 'arrowup' || lower === 'w' || lower === 'k') {
    logger.info('[Modal-Preview] User pressed scroll up');
    return 'up';
  }

  if (lower === 'arrowdown' || lower === 's' || lower === 'j') {
    logger.info('[Modal-Preview] User pressed scroll down');
    return 'down';
  }

  if (lower === 'tab') {
    logger.info('[Modal-Preview] User pressed tab');
    return 'tab_next';
  }

  if (lower === 'q' || lower === 'esc') {
    logger.info('[Modal-Preview] User pressed [q]/[Esc] (close)');
    return 'close';
  }

  return null;
}
```

### Rendering Example Output

```
  [JOB_DETAILS]  [CLIPBOARD]  [DIFF]
┌────────────────────────────────────────┐
│ {                                      │
│   "messageId": "12345...",             │
│   "company": "TechCorp",               │
│   "position": "Full-Stack Engineer",   │
│   "salary": "$120-150k",               │
│   "location": "San Francisco, CA"      │
│ }                                      │
│                                        │
└────────────────────────────────────────┘
[Page 1/3] [↑↓] scroll | [q] close
```

---

## 2.4 Filter State Modal Component

### Component Signature

```typescript
// src/ui/components/FilterStateModal.ts (NEW FILE)

import { getLogger } from '../../services/logger.js';
import { ANSI, MODAL_THEME, BOXES } from './AnsiStyles.js';
import type { FilterStateModal } from '../shared-tui-state.js';

const logger = getLogger('Modal-Filter');

/**
 * Render filter state modal (auto-dismisses)
 * Simple banner showing state transition
 */
export function renderFilterStateModal(modal: FilterStateModal): string {
  const theme = MODAL_THEME.filter;
  const before = modal.previousState ? 'ON' : 'OFF';
  const after = modal.newState ? 'ON' : 'OFF';

  return (
    `${theme.border}┌─ Filter Status ───────────────────┐${ANSI.RESET}\n` +
    `${theme.border}│${ANSI.RESET} ` +
    `${theme.before}${before}${ANSI.RESET} ` +
    `${theme.arrow}→${ANSI.RESET} ` +
    `${theme.after}${after}${ANSI.RESET} ` +
    `${theme.checkmark}✓${ANSI.RESET} ` +
    `${theme.border}│${ANSI.RESET}\n` +
    `${theme.border}└───────────────────────────────────┘${ANSI.RESET}`
  );
}

/**
 * Check if modal has expired and should be cleared
 */
export function isFilterModalExpired(modal: FilterStateModal): boolean {
  const now = new Date().getTime();
  const expiryTime = new Date(modal.expiresAt).getTime();
  return now > expiryTime;
}
```

---

# PART 3: KEYBOARD HANDLER INTEGRATION

## 3.1 Modal-Aware Keyboard Input Handler

### Extension to KeyboardHandler.ts

```typescript
// src/ui/components/KeyboardHandler.ts - ADD THESE METHODS

/**
 * Handle keyboard input when modal is active
 * Modal has priority over job-level actions
 */
async handleModalInput(modalType: ModalType): Promise<ModalAction> {
  return new Promise((resolve) => {
    const handler = (input: string, key: any) => {
      let action: ModalAction | null = null;

      switch (modalType) {
        case 'EDIT_CONFIRMATION': {
          const { parseEditModalInput } = await import('./EditConfirmationModal.js');
          const result = parseEditModalInput(input);
          
          if (result === 'apply') {
            action = { type: 'EDIT_APPLY' };
          } else if (result === 'discard') {
            action = { type: 'EDIT_DISCARD' };
          }
          break;
        }

        case 'PREVIEW_VIEWER': {
          const { parsePreviewModalInput } = await import('./PreviewViewerModal.js');
          const result = parsePreviewModalInput(input);
          
          if (result === 'up') {
            action = { type: 'PREVIEW_SCROLL_UP' };
          } else if (result === 'down') {
            action = { type: 'PREVIEW_SCROLL_DOWN' };
          } else if (result === 'close') {
            action = { type: 'PREVIEW_CLOSE' };
          } else if (result === 'tab_next') {
            action = { type: 'PREVIEW_TAB_NEXT' };
          }
          break;
        }

        case 'FILTER_STATE': {
          // Filter modal only dismisses on keypress or timeout
          action = { type: 'FILTER_DISMISS' };
          break;
        }
      }

      if (action) {
        this.keyboard.off('input', handler);
        resolve(action);
      }
    };

    this.keyboard.on('input', handler);
  });
}

export type ModalAction = 
  | { type: 'EDIT_APPLY' }
  | { type: 'EDIT_DISCARD' }
  | { type: 'PREVIEW_SCROLL_UP' }
  | { type: 'PREVIEW_SCROLL_DOWN' }
  | { type: 'PREVIEW_TAB_NEXT' }
  | { type: 'PREVIEW_CLOSE' }
  | { type: 'FILTER_DISMISS' };
```

---

## 3.2 Modal Dispatch in ActionController

### Update dispatchAction() method

```typescript
// src/ui/action-controller.ts - MODIFY dispatchAction()

private async dispatchAction(action: KeyAction): Promise<void> {
  try {
    const current = getCurrentJob();

    // MODAL CHECK: If modal is active, don't dispatch job actions
    if (current.modal) {
      logger.info('[action-controller] Modal is active, queuing keyboard input', {
        modalType: current.modal.type,
      });
      // Handle modal input separately (see next section)
      await this.handleModalInput(action);
      return;
    }

    // NORMAL JOB ACTIONS (existing code)
    switch (action) {
      case 'queue':
        await this.handleQueue();
        break;
      // ... rest of actions
    }
  } catch (err) {
    logger.error('[action-controller] Action dispatch failed', { action, error: String(err) });
  }
}

/**
 * Handle keyboard input when modal is active
 */
private async handleModalInput(action: KeyAction): Promise<void> {
  const current = getCurrentJob();

  if (!current.modal) {
    return;
  }

  switch (current.modal.type) {
    case 'EDIT_CONFIRMATION': {
      if (action === 'apply_edit' || action === 'a') {
        await this.handleEditApply();
      } else if (action === 'discard_edit' || action === 'd') {
        await this.handleEditDiscard();
      }
      break;
    }

    case 'PREVIEW_VIEWER': {
      if (action === 'scroll_up' || action === 'up') {
        await this.handlePreviewScrollUp();
      } else if (action === 'scroll_down' || action === 'down') {
        await this.handlePreviewScrollDown();
      } else if (action === 'close_modal' || action === 'q') {
        await this.handlePreviewClose();
      }
      break;
    }

    case 'FILTER_STATE': {
      await this.handleFilterDismiss();
      break;
    }
  }
}

/**
 * Apply edits and close modal
 */
private async handleEditApply(): Promise<void> {
  const current = getCurrentJob();

  if (!current.modal || current.modal.type !== 'EDIT_CONFIRMATION') {
    return;
  }

  logger.info('[EDIT] User approved edits', {
    editedFields: Object.keys(current.modal.editedKVs).length,
  });

  // Clear modal but keep editedFields in state
  clearModal();

  // Job now shows with new state, next action ([j/d/s]) will use editedFields
  logger.info('[EDIT] Modal closed, edits preserved in state');
}

/**
 * Discard edits and close modal
 */
private async handleEditDiscard(): Promise<void> {
  const current = getCurrentJob();

  if (!current.modal || current.modal.type !== 'EDIT_CONFIRMATION') {
    return;
  }

  logger.info('[EDIT] User discarded edits', {
    discardedFields: Object.keys(current.modal.editedKVs).length,
  });

  // Clear modal AND discard edits
  clearModal();
  setEditedFields(null);  // Revert to original

  logger.info('[EDIT] Modal closed, edits reverted');
}

/**
 * Scroll preview up
 */
private async handlePreviewScrollUp(): Promise<void> {
  updatePreviewPage('up');
  logger.info('[PREVIEW] Scrolled up');
}

/**
 * Scroll preview down
 */
private async handlePreviewScrollDown(): Promise<void> {
  updatePreviewPage('down');
  logger.info('[PREVIEW] Scrolled down');
}

/**
 * Close preview modal
 */
private async handlePreviewClose(): Promise<void> {
  clearModal();
  logger.info('[PREVIEW] Modal closed');
}

/**
 * Dismiss filter state modal
 */
private async handleFilterDismiss(): Promise<void> {
  clearModal();
  logger.info('[FILTER] Modal dismissed');
}
```

---

# PART 4: RENDERER INTEGRATION

## 4.1 Modal Detection in Render Server

### Update ops-tui-app.ts render loop

```typescript
// src/ui/ops-tui-app.ts - MODIFY render section

async function renderJobCard(state: CurrentJobState): Promise<void> {
  // CHECK FOR MODAL FIRST
  if (state.modal) {
    await renderModal(state.modal);
    return;
  }

  // NORMAL JOB RENDERING (existing code)
  const job = state.job;
  if (!job) {
    console.error('[RENDER] No job to display');
    return;
  }

  renderJobDisplay(job);
}

/**
 * Dispatch modal rendering to appropriate component
 */
async function renderModal(modal: ModalState): Promise<void> {
  try {
    switch (modal.type) {
      case 'EDIT_CONFIRMATION': {
        const { renderEditConfirmationModal } = 
          await import('./components/EditConfirmationModal.js');
        const output = renderEditConfirmationModal({ modal });
        console.error(output);
        break;
      }

      case 'PREVIEW_VIEWER': {
        const { renderPreviewViewerModal } = 
          await import('./components/PreviewViewerModal.js');
        const output = renderPreviewViewerModal({
          modal,
          terminalWidth: process.stdout.columns || 80,
          terminalHeight: process.stdout.rows || 24,
        });
        console.error(output);
        break;
      }

      case 'FILTER_STATE': {
        const { renderFilterStateModal } = 
          await import('./components/FilterStateModal.js');
        const output = renderFilterStateModal(modal);
        console.error(output);
        break;
      }
    }
  } catch (err) {
    logger.error('[RENDER] Modal rendering failed', { error: String(err) });
  }
}
```

---

# PART 5: INTEGRATION POINTS (IMPLEMENTATION CHECKLIST)

## 5.1 [e] Edit Modal Integration

**Trigger Point**: [action-controller.ts] `handleEdit()` after diff computed

```typescript
// In handleEdit(), AFTER setEditedFields(editedKVs):

const originalRecord = current.job as unknown as Record<string, unknown>;
const editedJob = JSON.parse(editedJson) as Record<string, unknown>;
setEditedFields(editedKVs);

// NEW: Show modal
setEditConfirmationModal(originalRecord, editedJob, editedKVs);

// Modal now displayed on next render cycle
logger.info('[EDIT] Confirmation modal shown');
```

**Rendering**: `ops-tui-app.ts` detects `modal.type === 'EDIT_CONFIRMATION'` → calls `renderEditConfirmationModal()`

**Keyboard Dispatch**: `KeyboardHandler` captures [a] or [d] → calls `handleEditApply()` / `handleEditDiscard()`

**Checklist**:
- [ ] Add `setEditConfirmationModal()` to shared-tui-state.ts
- [ ] Add `renderEditConfirmationModal()` to EditConfirmationModal.ts
- [ ] Update `handleEdit()` to call `setEditConfirmationModal()`
- [ ] Add modal input handling to `dispatchAction()`
- [ ] Add `handleEditApply()` and `handleEditDiscard()` methods
- [ ] Update render loop to detect and render `EDIT_CONFIRMATION` modal
- [ ] Test: Press [e], verify modal shows, press [a], verify edits persist

---

## 5.2 [p] Preview Modal Integration

**Trigger Point**: [action-controller.ts] `handlePreview()` after clipboard read

```typescript
// In handlePreview(), AFTER clipboard read:

const clipboardArr = await clipboardGetter();
const clipboardHtml = clipboardArr[0] || '';

// NEW: Show modal
setPreviewViewerModal(
  current.job as Record<string, unknown>,
  clipboardHtml,
  current.editedFields
);

// Modal now displayed on next render cycle
logger.info('[PREVIEW] Viewer modal shown');
```

**Rendering**: `ops-tui-app.ts` detects `modal.type === 'PREVIEW_VIEWER'` → calls `renderPreviewViewerModal()`

**Keyboard Dispatch**: `KeyboardHandler` captures [↑/↓/q] → calls `handlePreviewScrollUp()` / `handlePreviewScrollDown()` / `handlePreviewClose()`

**Checklist**:
- [ ] Add `setPreviewViewerModal()` to shared-tui-state.ts
- [ ] Add `updatePreviewPage()` to shared-tui-state.ts
- [ ] Add `renderPreviewViewerModal()` to PreviewViewerModal.ts
- [ ] Update `handlePreview()` to call `setPreviewViewerModal()`
- [ ] Add modal pagination and tab switching to keyboard handler
- [ ] Add `handlePreviewScrollUp()`, `handlePreviewScrollDown()`, `handlePreviewClose()` methods
- [ ] Update render loop to detect and render `PREVIEW_VIEWER` modal
- [ ] Test: Press [p], verify modal shows, press [↓], verify pagination, press [q], verify close

---

## 5.3 [f] Filter State Integration

**Trigger Point**: [action-controller.ts] `handleFilterToggle()` after UDS response

```typescript
// In handleFilterToggle(), AFTER UDS call:

const udsStart = Date.now();
const res = await this.udsWriter.filterToggle();
const udsTook = Date.now() - udsStart;

// Parse UDS response (requires daemon update)
const responseBody = res.body ? JSON.parse(res.body) : {};
const newFilterState = responseBody.filterEnabled ?? null;

if (newFilterState !== null) {
  // NEW: Show modal
  setFilterStateModal(!newFilterState, newFilterState); // Invert previous state
  
  logger.info('[FILTER] State modal shown', { newFilterState });
} else {
  logger.warn('[FILTER] No state in UDS response');
}
```

**Rendering**: `ops-tui-app.ts` detects `modal.type === 'FILTER_STATE'` → calls `renderFilterStateModal()` → auto-dismisses after 1.5s

**Keyboard Dispatch**: Any key or timeout → calls `handleFilterDismiss()`

**Daemon Update Required**:
```typescript
// src/index.ts around line 740
} else if (action === 'filter_toggle') {
  filterEnabled = !filterEnabled;
  
  // RESPONSE BODY (NEW)
  res.writeHead(202, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ 
    accepted: true, 
    filterEnabled: filterEnabled  // RETURN NEW STATE
  }));
}
```

**Checklist**:
- [ ] Add `setFilterStateModal()` to shared-tui-state.ts
- [ ] Add `renderFilterStateModal()` to FilterStateModal.ts
- [ ] Update daemon UDS response to include `filterEnabled`
- [ ] Update `handleFilterToggle()` to parse response and call `setFilterStateModal()`
- [ ] Add `handleFilterDismiss()` method
- [ ] Update render loop to detect and render `FILTER_STATE` modal
- [ ] Add auto-dismiss timer (call `clearModal()` after 1.5s)
- [ ] Test: Press [f], verify modal shows, wait 1.5s, verify auto-dismiss

---

# PART 6: HEADLESS MODE HANDLING

## 6.1 Headless Mode Detection

```typescript
// src/ui/components/HeadlessDetector.ts (NEW FILE)

export function isHeadlessMode(): boolean {
  // Check environment indicators
  const isTTY = process.stdout.isTTY && process.stderr.isTTY;
  const isHeadlessEnv = 
    process.env.HEADLESS === '1' ||
    process.env.CI === 'true' ||
    process.env.TERM === 'dumb';

  return !isTTY || isHeadlessEnv;
}

/**
 * In headless mode:
 * - Modals render as plain stderr text (no ANSI codes if TERM=dumb)
 * - Modal actions auto-apply with sensible defaults
 * - Preview modal skipped, content logged instead
 */
export function getHeadlessModalBehavior(modalType: ModalType): 'render' | 'auto_apply' | 'skip' {
  if (!isHeadlessMode()) {
    return 'render';
  }

  switch (modalType) {
    case 'EDIT_CONFIRMATION':
      return 'auto_apply'; // Automatically apply edits
    case 'PREVIEW_VIEWER':
      return 'skip'; // Just log content
    case 'FILTER_STATE':
      return 'render'; // Always render state change
    default:
      return 'render';
  }
}
```

## 6.2 Headless Modal Rendering

```typescript
// Update renderEditConfirmationModal() to detect headless:

export function renderEditConfirmationModal(options: EditConfirmationRenderOptions): string {
  const { isHeadless } = options;

  if (isHeadless) {
    // Render as plain text (no ANSI codes for dumb terminals)
    const lines: string[] = [];
    lines.push('=== EDIT CONFIRMATION ===');
    
    for (const [fieldName, diff] of Object.entries(options.modal.diffFields)) {
      lines.push(`${fieldName}:`);
      lines.push(`  Original: ${JSON.stringify(diff.original)}`);
      lines.push(`  New:      ${JSON.stringify(diff.edited)}`);
      lines.push('');
    }

    lines.push('Press [A] to apply or [D] to discard');
    return lines.join('\n');
  }

  // Normal TTY rendering (existing code)
  // ...
}
```

## 6.3 State Machine for Headless Auto-Apply

```typescript
// In action-controller.ts handleEdit():

if (getHeadlessModalBehavior('EDIT_CONFIRMATION') === 'auto_apply') {
  logger.info('[EDIT] Headless mode: auto-applying edits');
  // Skip modal, edits remain in state automatically
  return;
}

// Normal mode: show modal and wait for [a/d]
setEditConfirmationModal(originalRecord, editedJob, editedKVs);
```

---

# PART 7: TEST CASES

## Test 7: [e] Edit Confirmation Modal

**Setup**: Job displayed in pane, ready for action

**Steps**:
1. Press [e]
2. Editor (nano) opens with job JSON
3. Modify a field (e.g., `company: "OldCo"` → `company: "NewCo"`)
4. Save editor (Ctrl+O, Enter, Ctrl+X)
5. Verify modal appears with diff

**Expected Output** (stderr):
```
┌─ Diff Preview ─────────────────┐
│ company:
│   Original: "OldCo"
│   New:      "NewCo" ✓
│
└────────────────────────────────┘
[A]pply  [D]iscard
```

**Step 6**: Press [a]
**Expected**: Modal closes, job shown with new company name

**Step 7**: Press [j] (queue)
**Expected**: Job routed with merged editedKVs

**Pass Criteria**:
- ✅ Modal rendered with correct diff
- ✅ [A]pply preserves edits
- ✅ [D]iscard reverts to original
- ✅ Job queued with correct merged state
- ✅ Diff display uses ANSI colors (green for new, gray for original)

---

## Test 8: [e] Edit Modal - Headless Mode

**Setup**: `HEADLESS=1 TERM=dumb ./start.sh`

**Steps**:
1. Press [e]
2. Editor opens and closes (in headless, may skip visual)
3. Edits auto-applied without modal

**Expected Output** (stderr, plain text):
```
[EDIT] Job modified in editor
fieldsChanged: ["company"]
fieldsCount: 1
```

**Pass Criteria**:
- ✅ No ANSI codes in output
- ✅ Edits auto-applied without interaction
- ✅ Job queued with edited fields

---

## Test 10: [p] Preview Modal with Pagination

**Setup**: Job + clipboard content available

**Steps**:
1. Press [p]
2. Modal appears with JOB_DETAILS tab active
3. Job JSON displayed (paginated)

**Expected Output** (stderr):
```
  [JOB_DETAILS]  [CLIPBOARD]  [DIFF]
┌────────────────────────────────────────┐
│ {                                      │
│   "messageId": "abc123",               │
│   "company": "TechCorp",               │
│   "position": "Engineer",              │
│   ...                                  │
│ }                                      │
└────────────────────────────────────────┘
[Page 1/3] [↑↓] scroll | [q] close
```

**Step 4**: Press [↓] (scroll down)
**Expected**: Page increments to [Page 2/3], new lines shown

**Step 5**: Press [tab]
**Expected**: Tab switches to [CLIPBOARD], content updates

**Step 6**: Press [q] (quit)
**Expected**: Modal closes, normal job display resumes

**Pass Criteria**:
- ✅ Modal renders with correct tab active
- ✅ Pagination works ([↑/↓] change page)
- ✅ Tab switching changes content
- ✅ [q] closes modal gracefully
- ✅ JSON coloring applied (keys cyan, strings green)

---

## Test 11: [f] Filter State Modal with Auto-Dismiss

**Setup**: Job displayed, filter currently OFF

**Steps**:
1. Press [f]
2. Modal appears showing state transition

**Expected Output** (stderr):
```
┌─ Filter Status ───────────────────┐
│ OFF → ON ✓                        │
└───────────────────────────────────┘
```

**Step 3**: Wait 1.5 seconds
**Expected**: Modal auto-dismisses, normal job display resumes

**Pass Criteria**:
- ✅ Modal shown immediately after [f]
- ✅ Correct state transition displayed
- ✅ Auto-dismiss after 1.5s (no key required)
- ✅ Job display resumes after dismiss

---

# PART 8: IMPLEMENTATION DELIVERY

## 8.1 File Manifest

**New Files to Create**:
```
src/ui/components/AnsiStyles.ts          (ANSI codes, themes)
src/ui/components/EditConfirmationModal.ts  (Edit modal renderer)
src/ui/components/PreviewViewerModal.ts     (Preview modal renderer)
src/ui/components/FilterStateModal.ts       (Filter modal renderer)
src/ui/components/HeadlessDetector.ts       (Headless mode detection)
```

**Files to Modify**:
```
src/ui/shared-tui-state.ts               (Add modal state + functions)
src/ui/action-controller.ts              (Add modal dispatch + handlers)
src/ui/ops-tui-app.ts                    (Add modal rendering logic)
src/ui/components/KeyboardHandler.ts     (Add modal input handling)
src/index.ts                             (Update /internal/action response)
```

## 8.2 Implementation Order

1. **Phase 1 (2-3 hours)**: State Management
   - [ ] Extend CurrentJobState with modal field
   - [ ] Add state setter functions
   - [ ] Add state migration logic

2. **Phase 2 (2-3 hours)**: ANSI Styles & Renderers
   - [ ] Create AnsiStyles.ts
   - [ ] Create modal component files
   - [ ] Test ANSI rendering manually

3. **Phase 3 (3-4 hours)**: Integration
   - [ ] Update action-controller.ts handlers
   - [ ] Update render loop
   - [ ] Update keyboard handler
   - [ ] Wire up modal dispatch

4. **Phase 4 (2-3 hours)**: Daemon & Headless
   - [ ] Update UDS response in index.ts
   - [ ] Add headless detection
   - [ ] Test in CI/headless mode

5. **Phase 5 (1-2 hours)**: Testing
   - [ ] Manual TEST 7, 8, 10, 11
   - [ ] E2E with modal flow
   - [ ] Edge cases (modal timeout, rapid keypresses)

## 8.3 Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| Keyboard input blocking | Modal captures input exclusively; timeout resets |
| ANSI code bloat | Pre-compute color codes in AnsiStyles.ts |
| State mutation bugs | Use immutable persist() pattern |
| Headless rendering | Test with HEADLESS=1 TERM=dumb |
| TTY detection | Check isTTY + DISPLAY env var |

---

# PART 9: QUESTIONS & ANSWERS

## Q1: Diff Display Format - Unified vs. Side-by-Side?

**Recommendation**: **Unified Diff (Current Proposal)**

**Rationale**:
- Compact (fits terminal width 80 chars)
- Shows changed fields prominently
- Side-by-side would require 160+ chars (impractical)
- Can truncate long strings

**Alternative**: Show 2-3 unchanged fields as context (not proposed here but easy to add)

---

## Q2: Terminal Dimensions - How to Detect?

**Recommendation**: Use `process.stdout.columns` and `process.stdout.rows`

```typescript
const terminalWidth = process.stdout.columns || 80;
const terminalHeight = process.stdout.rows || 24;

// Render components assume 80x24 minimum
// Graceful degradation if TTY unavailable
```

**Fallback**: Default to 80x24 if TTY unavailable (headless mode)

---

## Q3: Modal State Persistence - Immediate or After Action?

**Recommendation**: **Persist after each change**

- EditedFields persisted when [a] pressed
- Modal cleared immediately after [a/d]
- Filter state persisted when UDS response received
- Preview state persisted when [p] pressed

```typescript
// Pattern:
setEditConfirmationModal(...);  // Persists to disk
// User presses [a]
clearModal();                   // Clears modal, keeps editedFields
// Job queued with editedFields still in state
```

---

## Q4: Modal Expiry & Auto-Dismiss - Who Checks Timeout?

**Recommendation**: **Render server checks on each render cycle**

```typescript
// In ops-tui-app.ts render loop:
if (state.modal?.type === 'FILTER_STATE') {
  if (isFilterModalExpired(state.modal)) {
    clearModal();
    return; // Render normal job instead
  }
}
```

---

## Q5: Keyboard Input Priority - Modal vs. Job?

**Recommendation**: **Modal has exclusive input** (current proposal)

```typescript
// Pattern:
if (current.modal) {
  await handleModalInput(action);  // Modal-specific keys
  return;
}

// Normal job actions only if no modal
await dispatchAction(action);
```

---

## Q6: Preview Content Source - Parsed Job vs. Raw Email?

**Recommendation**: **Show current job state** (what's in memory)

- Reflects Stage 2 parsing if completed
- Shows editedKVs if user edited
- Consistent with what will be queued

```typescript
setPreviewViewerModal(
  current.job,              // Current parsed job
  clipboard,
  current.editedFields      // Includes any edits
);
```

---

# PART 10: PRODUCTION CHECKLIST

Before deploying to production, verify:

- [ ] All modal states persist to disk
- [ ] Modal input doesn't block other processes
- [ ] ANSI codes degrade in headless mode
- [ ] Terminal width/height detected correctly
- [ ] Modal timeout/expiry works (1.5s for filter)
- [ ] [q] and [Esc] work consistently
- [ ] Modal can be interrupted cleanly
- [ ] No memory leaks in state watchers
- [ ] Daemon returns state in UDS response
- [ ] TEST 7, 8, 10, 11 pass end-to-end
- [ ] Performance: modal render < 50ms
- [ ] Coverage: modal paths in E2E tests

---

**End of Specification**

---

**Next Steps**:
1. Review this spec with team
2. Create feature branch: `feature/modals-edit-preview`
3. Implement in order (Phase 1-5)
4. Run TEST 7, 8, 10, 11 in MANUAL_TESTING_GUIDE
5. Merge after E2E validation
