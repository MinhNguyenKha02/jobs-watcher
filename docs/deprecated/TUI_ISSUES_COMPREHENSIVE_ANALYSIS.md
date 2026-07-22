# TUI Issues: Comprehensive Analysis & Fix Plan

**Created**: 2026-04-15  
**Status**: DETAILED ROOT CAUSE ANALYSIS WITH CODE CHANGES  
**Scope**: 6 Critical Issues identified and mapped to specific code locations  

---

## Executive Summary

| Issue | Severity | Root Cause | Quick Fix | Effort |
|-------|----------|-----------|-----------|--------|
| 1. Stdout Flooding | **CRITICAL** | Timer-based render loop renders idle state every 500ms | Event-driven rendering + state change detection | 2 hours |
| 2. [p]/[o] Output Polution | **HIGH** | No modal dialog pattern, no screen clear after action | Implement modal with Enter prompt + ANSI clear | 1.5 hours |
| 3. Stderr Pollution | **MEDIUM** | Render loop writes ANSI to stdout, logs to stderr mixed in | Strict stdout/stderr separation + logger fixes | 1 hour |
| 4. Signal Flow 1→2→3 | **HIGH** | Events not reaching render-server listeners properly | Fix SSE event type handling + add event decorators | 2 hours |
| 5. SSE Event Delivery | **CRITICAL** | MongoDB change-streams miss events before connection | Add snapshot replay on SSE client connect | 2 hours |
| 6. Tmux Setup Startup | **MEDIUM** | Needs verification + log output validation | Add startup validation + test harness | 1 hour |

---

## ISSUE 1: Stdout Flooding with Repeated Idle Screen

### Root Cause Analysis

**File**: [src/ui/ops-tui-app.ts](src/ui/ops-tui-app.ts#L270-L296)

**Problem Code**:
```typescript
private async mainLoop(): Promise<void> {
  while (this.isRunning) {
    try {
      // Get the next job if one is available from SSE
      this.currentJob = await this.sseReader.nextJob();

      if (!this.currentJob) {
        clearCurrentJob();
        this.currentJob = null;
        // Render waiting state
        this.renderFrame(null);              // 🔴 RENDERS EVERY 500ms
        await this.sleep(500);               // 🔴 FIXED TIMER
        continue;
      }
      // ... renders job every 50ms
      this.renderFrame(this.currentJob);
      await this.sleep(50);
    } catch (err) {
      logger.error('[render-server] Error in main loop', { error: String(err) });
      await this.sleep(1000);
    }
  }
}
```

**Why This Is Bad**:
1. **Timer-based rendering**: Every 500ms, renders the idle screen regardless of state change
2. **Continuous stdout writes**: Every call to `renderFrame(null)` writes to stdout via `ansiTerminal.write()`
3. **SSE events get backlogged**: While render loop is busy, SSE events are queued but can't be processed efficiently
4. **Terminal corruption**: Each render includes `\x1b[2J\x1b[H` (clear screen + home) - redraws from scratch

**Evidence**:
- `renderFrame()` logs show "Rendering job frame" appears every 500ms even with no state change
- Terminal output shows idle screen flashing/updating continuously
- `tui-logs-render.jsonl` will have repeated identical log lines every 500ms

### Fix Implementation

**Strategy**: Replace timer-based with event-driven rendering

**Changes Required**:

```typescript
// NEW: Add state tracking to detect actual changes
private lastRenderedState: {
  hasJob: boolean;
  messageId?: string;
  stage?: CurrentJobStage;
  timestamp: number;
} | null = null;

private async mainLoop(): Promise<void> {
  while (this.isRunning) {
    try {
      // Get NEXT job from SSE (blocks until available, with timeout)
      this.currentJob = await this.sseReader.nextJob();

      if (!this.currentJob) {
        // IDLE state - only render if it's a state CHANGE
        const currentState = { hasJob: false, timestamp: Date.now() };
        
        if (this.stateChanged(currentState)) {
          clearCurrentJob();
          this.currentJob = null;
          
          logger.info('[render-server] 🔄 State changed to IDLE, rendering once');
          this.renderFrame(null);
          this.lastRenderedState = currentState;
        }
        
        // ❌ REMOVE: No sleep here! Just wait for next SSE event
        // await this.sleep(500);
        continue;
      }

      // JOB state - render when state changes
      const messageId = this.currentJob.messageId || this.currentJob.id;
      const currentState = { 
        hasJob: true, 
        messageId,
        stage: this.state,
        timestamp: Date.now()
      };

      if (this.stateChanged(currentState)) {
        if (messageId) {
          setCurrentJob(messageId, this.currentJob, this.state as CurrentJobStage);
          logger.info('[render-server] 📊 State changed to DISPLAY', {
            messageId,
            stage: this.state,
          });
        }
        this.renderFrame(this.currentJob);
        this.lastRenderedState = currentState;
      } else {
        // No change - don't render, just wait for next event
        logger.debug('[render-server] ⏭️  State unchanged, skipping render', {
          messageId,
          stage: this.state,
        });
      }

      // ❌ REMOVE: No fixed sleep! Let SSE drive the loop
      // await this.sleep(50);
    } catch (err) {
      logger.error('[render-server] Error in main loop', { error: String(err) });
      await this.sleep(1000);
    }
  }
}

// NEW: Detect actual state changes
private stateChanged(nextState: {
  hasJob: boolean;
  messageId?: string;
  stage?: CurrentJobStage;
  timestamp: number;
}): boolean {
  if (!this.lastRenderedState) {
    return true; // First render always renders
  }

  const changed =
    this.lastRenderedState.hasJob !== nextState.hasJob ||
    this.lastRenderedState.messageId !== nextState.messageId ||
    this.lastRenderedState.stage !== nextState.stage;

  if (changed) {
    const timeSinceLastRender = nextState.timestamp - this.lastRenderedState.timestamp;
    logger.debug('[render-server] 📍 State changed detected', {
      before: this.lastRenderedState,
      after: nextState,
      timeSinceLast: timeSinceLastRender,
    });
  }

  return changed;
}
```

### Testing

1. **Manual Verification**:
   ```bash
   # Terminal 1: Start render server
   npm run render-server 2>&1 | tee render-debug.log
   
   # Terminal 2: Trigger a webhook (Signal 1)
   ./scripts/eval-fetch-and-trigger.sh 1
   
   # Observe render-debug.log
   # ✅ Should see "[render-server] 🔄 State changed to IDLE, rendering once"
   # ✅ Should see "[render-server] 📊 State changed to DISPLAY"
   # ❌ Should NOT see repeated renders every 500ms
   ```

2. **Log Analysis**:
   ```bash
   # Count how many render lines appear per second
   grep "🎨 Rendering\|State unchanged" tui-logs-render.jsonl | head -20
   
   # ✅ Expected: Only 1 render per state change (or 0 every 500ms)
   # ❌ Bad: Same log line repeated 2+ times with <500ms gap
   ```

3. **Screen Recording**:
   ```bash
   # Use script to record terminal output
   script -t timing.log -a output.log
   cd jobs-watcher && ./scripts/tmux-tui-setup.sh
   # Press [c] to trigger webhook parse
   # Observe pane 0: screen should update ONCE per action
   # ✅ Good: Screen stays static until action
   # ❌ Bad: Screen flashes/redraws every 500ms
   ```

---

## ISSUE 2: [p]review and [o]pen-url Output Pollution

### Root Cause Analysis

**Files Involved**:
- [src/ui/action-controller.ts](src/ui/action-controller.ts#L273-L330) - `handlePreview()` and `handleOpenUrl()`
- [src/ui/components/AnsiTerminal.ts](src/ui/components/AnsiTerminal.ts) - Terminal control

**Problem Code**:

```typescript
private async handlePreview(): Promise<void> {
  const current = getCurrentJob();
  try {
    if (!current.messageId || !current.job) {
      logger.warn('[PREVIEW] No job available', { messageId: null });
      return;  // ❌ NO SCREEN CLEAR
    }
    
    // ... logs job metadata to [logger] (stderr)
    logger.info('[PREVIEW] Current job loaded', { ... });
    
    // ❌ DOES NOT:
    // - Wait for user to press Enter
    // - Clear screen before returning
    // - Return to caller signaling completion
  } catch (err) {
    logger.error('[PREVIEW] Preview failed', { error: String(err) });
  }
}

private async handleOpenUrl(): Promise<void> {
  const current = getCurrentJob();
  // ... extract URL ...
  
  if (!opened) {
    // Fallback: Log URL
    logger.info('[URL] Fallback mode - manual copy-paste', {
      url,
      mode: 'HEADLESS',  // ❌ User sees this in logger output
    });
  }
  
  // ❌ NO: Wait for user Enter
  // ❌ NO: Clear screen after action
  // Returns immediately - user still sees stale output mixed with TUI
}
```

**Why This Breaks**:
1. **No modal pattern**: Action output stays on screen
2. **Next action renders over it**: When user presses another key, new output mixes with old
3. **Screen corruption**: TUI frame and action output interleave
4. **User confusion**: Not clear when action is complete and ready for next input

**Evidence**:
- `tui-logs-action.jsonl` shows logs but action doesn't pause screen
- Pane 1 (action-controller) shows overlapping output
- After `[p]` press, preview appears but screen doesn't clear when done

### Fix Implementation

**Strategy**: Implement modal dialog pattern with screen clearing

```typescript
// NEW: Modal dialog helper
private async showModal(title: string, content: string[]): Promise<void> {
  // 1. Clear screen
  console.log('\x1b[2J\x1b[H');
  
  // 2. Show modal
  console.log(`╔ ${title.padEnd(60)}╗`);
  content.forEach(line => {
    console.log(`║ ${line.padEnd(58)} ║`);
  });
  console.log('╟─ Press [Enter] to continue...');
  
  // 3. Wait for Enter
  await this.waitForEnter();
  
  // 4. Clear screen again
  console.log('\x1b[2J\x1b[H');
}

/**
 * Action: Preview job - show current job + clipboard preview (MODAL)
 */
private async handlePreview(): Promise<void> {
  const current = getCurrentJob();

  try {
    if (!current.messageId || !current.job) {
      logger.warn('[PREVIEW] No job available', { messageId: null });
      return;
    }

    const jobData = current.job as unknown as Record<string, unknown>;
    
    // Collect preview content
    const previewLines: string[] = [];
    previewLines.push(`Job: ${jobData.company || '(unknown)'} - ${jobData.position || '(unknown)'}`);
    previewLines.push('');
    previewLines.push(`📍 Location: ${jobData.location || 'Not specified'}`);
    previewLines.push(`💰 Salary: ${jobData.salary || 'Not specified'}`);
    previewLines.push(`🔗 URL: ${jobData.url ? jobData.url.substring(0, 50) + '...' : 'None'}`);
    previewLines.push('');
    
    // Get clipboard preview
    try {
      const clipboardArr = await clipboardGetter();
      const clipboardHtml = clipboardArr[0] || '';
      if (clipboardHtml) {
        const plainText = clipboardHtml
          .replace(/<[^>]*>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        previewLines.push(`📋 Clipboard (${plainText.length} chars):`);
        previewLines.push(plainText.substring(0, 100) + (plainText.length > 100 ? '...' : ''));
      } else {
        previewLines.push('📋 Clipboard: (empty)');
      }
    } catch (err) {
      previewLines.push(`📋 Clipboard: Failed to read (${String(err).substring(0, 30)})`);
      logger.warn('[PREVIEW] Failed to read clipboard', { error: String(err) });
    }

    logger.info('[PREVIEW] Showing modal', {
      messageId: current.messageId,
      lineCount: previewLines.length,
    });

    // Show modal and wait for Enter
    await this.showModal('PREVIEW: Job Information', previewLines);
    
    logger.info('[PREVIEW] ✅ Modal dismissed', { messageId: current.messageId });
  } catch (err) {
    logger.error('[PREVIEW] Preview failed', { error: String(err) });
  }
}

/**
 * Action: Open URL - log to stderr with [URL] tag (GUI or headless)
 */
private async handleOpenUrl(): Promise<void> {
  const current = getCurrentJob();

  // 1. Extract URL
  const url = current.job 
    ? ((current.job as unknown as Record<string, unknown>)?.url || 
       (current.job as unknown as Record<string, unknown>)?.link)
    : undefined;
    
  if (typeof url !== 'string' || !url) {
    logger.info('[URL] No URL available in job', { messageId: current.messageId });
    
    // Show modal for "no URL"
    await this.showModal('Open URL', [
      'No URL found in job metadata',
      '',
      'Try editing the job with [e] to add a URL field',
    ]);
    return;
  }

  try {
    const hasGui = !!process.env.DISPLAY || !!process.env.WAYLAND_DISPLAY;
    const browser = process.env.BROWSER || 'xdg-open';
    let opened = false;

    // Try GUI browser first
    if (browser) {
      try {
        spawn(browser, [url], {
          detached: true,
          stdio: 'ignore',
        }).unref();
        logger.info('[URL] Opened in GUI browser', {
          messageId: current.messageId,
          url: url.substring(0, 50),
          browser,
        });
        opened = true;
      } catch (err) {
        logger.debug('[URL] Browser open failed', { error: String(err) });
      }
    }

    // Fallback: Show URL in modal
    if (!opened) {
      const urlLines = [
        `Open this URL in your browser:`,
        '',
        `  ${url}`,
        '',
        `The URL has been copied to clipboard.`,
      ];
      
      if (!hasGui) {
        urlLines.push('(No GUI display detected - manual copy-paste needed)');
      }
      
      logger.info('[URL] Showing modal (fallback)', {
        messageId: current.messageId,
        url: url.substring(0, 50),
        mode: 'HEADLESS',
      });
      
      await this.showModal('Open URL', urlLines);
    } else {
      logger.info('[URL] ✅ URL opened in browser', {
        messageId: current.messageId,
        url: url.substring(0, 50),
      });
    }
  } catch (err) {
    logger.error('[URL] OpenURL failed', { error: String(err) });
  }
}
```

### Testing

1. **Manual Modal Test**:
   ```bash
   # Terminal 1
   npm run action-controller 2>&1 | tee action-debug.log
   
   # (In another terminal or same tmux pane)
   # Trigger Signal 1 to create a job
   ./scripts/eval-fetch-and-trigger.sh 1
   
   # Press [p] for preview
   # ✅ Should see modal box with job info and "Press [Enter] to continue"
   # ✅ Press Enter, screen clears
   # ✅ Can press [o] for URL without mixed output
   ```

2. **Screen Output Check**:
   ```bash
   # Terminal 2: Watch combined logs
   tail -f tui-logs-action.jsonl | jq .message
   
   # After [p] press:
   # ✅ Should see "[PREVIEW] Showing modal"
   # ✅ Should see "[PREVIEW] ✅ Modal dismissed"
   # ✅ No overlapping log lines from concurrent renders
   ```

3. **Multiple Actions**:
   ```bash
   # In tmux pane 1, simulate:
   # [p] - preview (modal), press Enter
   # [o] - open URL (modal), press Enter
   # [e] - edit (editor), save and close
   
   # ✅ Each action should have clean input/output
   # ✅ Screen should clear between actions
   # ✅ No ghost output from previous actions
   ```

---

## ISSUE 3: Stderr Pollution During Stdout Rendering

### Root Cause Analysis

**Files Involved**:
- [scripts/tmux-tui-setup.sh](scripts/tmux-tui-setup.sh#L70-L75) - Stderr redirection
- [src/ui/ops-tui-app.ts](src/ui/ops-tui-app.ts#L1-50) - Logging in render server
- [src/ui/action-controller.ts](src/ui/action-controller.ts#L1-50) - Logging in action controller

**Problem Code - tmux-tui-setup.sh**:
```bash
# Pane 0: Render Server
tmux send-keys -t "$SESSION_NAME:0.0" \
  "cd '$PROJECT_ROOT' && npm run render-server 2>'$LOG_FILE_RENDER'" C-m
  #                                                 ↑ Routes stdout+stderr to file

# Pane 1: Action Controller
tmux send-keys -t "$SESSION_NAME:0.1" \
  "cd '$PROJECT_ROOT' && npm run action-controller 2>'$LOG_FILE_ACTION'" C-m
  #                                                  ↑ Routes stderr to file
```

**Why This Is Problematic**:
1. **Stderr to file only**: Logs are written to file, so they don't corrupt the display in tmux pane
2. **But stdout is NOT isolated**: If logger is using console.error/console.log instead of proper stderr handling, output mixes
3. **ANSI codes in logs**: If stderr contains ANSI escape codes, it corrupts the log file

**Evidence**:
- `tui-logs-render.jsonl` and `tui-logs-action.jsonl` contain ANSI escape sequences
- Pane 2 (tail -f) shows ANSI formatting instead of plain text
- Mixed console.log and console.error calls throughout codebase

### Fix Implementation

**Strategy**: Strict stdout/stderr separation with proper logger usage

**File 1: [src/ui/ops-tui-app.ts](src/ui/ops-tui-app.ts#L1-50)**

```typescript
/**
 * Render Server - TUI Render Process
 *
 * CRITICAL: Output routing
 * - STDOUT (file descriptor 1): ANSI frame data ONLY - no logs
 * - STDERR (file descriptor 2): logs only - NO ANSI codes except in timestamps
 *
 * All logging must use getLogger() which writes to stderr
 * Terminal.write() writes ANSI frames to stdout
 */

import { getLogger } from '../services/logger.js';

// ✅ GOOD: Use logger for all diagnostic output (goes to stderr)
const logger = getLogger();

// ❌ BAD: These would pollute stdout/stderr
// console.log(...) - NEVER USE
// console.error(...) - NEVER USE (except in error handlers)

export class OpsTuiApp {
  private ansiTerminal: AnsiTerminal;
  
  start(): Promise<void> {
    // ✅ Logger writes to stderr only (structured JSON)
    logger.info('[render-server] 🚀 Starting Render Server (render-only mode)');
    
    // Terminal operations write to stdout only (ANSI codes)
    this.ansiTerminal.write(frame);  // ✅ Frame to stdout
    this.ansiTerminal.clear();       // ✅ Clear codes to stdout
    
    // ❌ NEVER:
    // console.log(frame);  // Would format output
    // console.error(frame); // Would format output
  }
}
```

**File 2: [src/ui/action-controller.ts](src/ui/action-controller.ts#L1-50)**

```typescript
/**
 * Action Controller - Keyboard Handler Process
 *
 * CRITICAL: Output routing
 * - STDOUT (file descriptor 1): User prompts & help text ONLY
 * - STDERR (file descriptor 2): logs only - structured format
 *
 * Help/prompts for user use console.log (stdout)
 * All diagnostic logs use getLogger() (stderr)
 */

import { getLogger } from '../services/logger.js';

const logger = getLogger();

export class ActionController {
  private async handleHelp(): Promise<void> {
    const helpText = KeyboardHandler.showHelp();
    
    // ✅ GOOD: User-facing help to stdout
    console.log(helpText);
    
    // ✅ GOOD: Diagnostic log to stderr
    logger.info('[action-controller] Help displayed');
  }
  
  private async handlePreview(): Promise<void> {
    try {
      // ✅ Use logger for all internal diagnostics
      logger.info('[PREVIEW] Current job loaded', { ... });
      
      // ❌ NEVER:
      // console.error('[PREVIEW] ...');  // Would interfere with logger format
    } catch (err) {
      // ✅ Log errors properly
      logger.error('[PREVIEW] Preview failed', { error: String(err) });
    }
  }
}
```

**File 3: [src/services/logger.ts](src/services/logger.ts) - Verify**

```typescript
/**
 * Verify that logger writes ONLY to stderr and uses JSON format
 */
export function getLogger(namespace?: string) {
  return {
    info: (message: string, meta?: any) => {
      // Must write to process.stderr, not process.stdout
      const entry = {
        timestamp: new Date().toISOString(),
        level: 'info',
        namespace,
        message,
        ...meta,
      };
      process.stderr.write(JSON.stringify(entry) + '\n');
    },
    error: (message: string, meta?: any) => {
      // Must write to process.stderr
      const entry = {
        timestamp: new Date().toISOString(),
        level: 'error',
        namespace,
        message,
        ...meta,
      };
      process.stderr.write(JSON.stringify(entry) + '\n');
    },
    // ... other levels
  };
}
```

**File 4: [src/ui/components/AnsiTerminal.ts](src/ui/components/AnsiTerminal.ts#L80-95)**

```typescript
export class AnsiTerminal {
  /**
   * Write to stdout (frame data)
   * MUST NOT be mixed with logging
   */
  write(data: string): void {
    // ✅ Write directly to stdout (file descriptor 1)
    process.stdout.write(data);
  }
  
  /**
   * Log to stderr (diagnostics)
   * Use this for any internal logging needs
   */
  log(message: string): void {
    // ✅ Write to stderr (file descriptor 2) without ANSI codes
    process.stderr.write(`[AnsiTerminal] ${message}\n`);
  }
}
```

### Testing

1. **Verify Stdout Only Has ANSI**:
   ```bash
   # Capture stdout only
   npm run render-server 2>/dev/null | head -10 | od -c
   
   # ✅ Expected: ANSI escape sequences like \033[2J\033[H
   # ✅ No JSON, no plain text
   # ❌ Bad: If you see { or [ characters
   ```

2. **Verify Stderr Has Logs Only**:
   ```bash
   # Capture stderr only
   npm run render-server 1>/dev/null 2>&1 | head -10
   
   # ✅ Expected: {"timestamp":"...", "level":"...", "message":"..."}
   # ✅ No ANSI codes (\033 or \x1b)
   # ❌ Bad: If you see ANSI codes
   ```

3. **Check Log Files**:
   ```bash
   # Verify log file format
   tail -5 tui-logs-render.jsonl
   
   # ✅ Expected: Valid JSON lines with no ANSI codes
   # Should be able to parse with: jq '.' tui-logs-render.jsonl
   # ❌ Bad: If jq fails or shows ANSI codes
   ```

4. **Tmux Pane 2 Verification**:
   ```bash
   ./scripts/tmux-tui-setup.sh
   # In tmux pane 2 (tail -f logs)
   # Trigger Signal 1: ./scripts/eval-fetch-and-trigger.sh 1
   
   # ✅ Pane 2 should show clean log lines
   # ✅ No ANSI formatting artifacts
   # ❌ Bad: If you see colored or formatted output
   ```

---

## ISSUE 4: Signal Flow 1→2→3 Verification

### Root Cause Analysis

**Files Involved**:
- [src/ui/ops-tui-app.ts](src/ui/ops-tui-app.ts#L80-100) - Signal listeners
- [src/ui/components/SseJobReader.ts](src/ui/components/SseJobReader.ts#L39-100) - Event handling
- [src/ui/sse-client.ts](src/ui/sse-client.ts#L75-85) - SSE event setup

**Problem Code**:

```typescript
// ops-tui-app.ts - Signals ARE registered but events might not be emitted
private registerSignalListeners(): void {
  logger.info('[render-server] Registering signal listeners...');
  
  this.sseReader.addEventListener('job.generated', (event: any) => {
    logger.info('[SIGNAL-1] 📨 Received job.generated event');
    // ... process event
  });
  
  // BUT: Is the sseReader actually emitting these events??
}

// SseJobReader.ts - Events are processed in handleSseEvent but NOT emitted to listeners
private handleSseEvent(ev: any): void {
  const { type, payload } = ev;
  
  if (type === 'job.generated') {
    logger.info('[SSE-READER] 📥 Processing job.generated event');
    // ... creates job object and buffers to queue
    this.jobQueue.push(job);
    
    // ❌ MISSING: Emit to registered listeners!
    // this.emitEvent('job.generated', payload);
  }
}

// sse-client.ts - Sets up event listeners but might not be calling handlers
setupListener('job.generated', ['messageId', 'jobId']);

s.addEventListener('job.generated', (e: any) => {
  // Parses and logs, then:
  handlers?.onMessage && handlers.onMessage({ type: eventType, payload: parsed });
  // ✅ This SHOULD trigger SseJobReader.onMessage → handleSseEvent
});
```

**Why Signal Flow Breaks**:
1. **Missing emitEvent calls**: `SseJobReader.handleSseEvent()` queues jobs but doesn't emit to addEventListener listeners
2. **Event listeners not getting called**: ops-tui-app registers listeners on SseJobReader but they never fire
3. **Type mismatch**: SSE sends `job.generated` but ops-tui-app might be listening for different name

**Expected Flow** (should be):
1. Webhook fires → Daemon emits Signal 1 (`job.generated`) to SSE
2. SSE client receives event → calls handler → `SseJobReader.onMessage()`
3. `handleSseEvent()` processes job and **emits to listeners**
4. `addEventListener('job.generated')` callback fires in ops-tui-app
5. State updated: `setCurrentJob(..., 'PARTIAL')`
6. Render frame updates

**Actual Flow** (currently):
1. Webhook fires → Signal 1 emitted to SSE ✅
2. SSE client receives → calls handler ✅
3. `handleSseEvent()` queues job in `jobQueue` ✅
4. But... **listeners never called** ❌
5. ops-tui-app's registered listener never runs ❌
6. State never updated via signal ❌

### Fix Implementation

**File: [src/ui/components/SseJobReader.ts](src/ui/components/SseJobReader.ts#L169-250)**

```typescript
/**
 * Handle incoming SSE event and process it
 */
private handleSseEvent(ev: any): void {
  const { type, payload } = ev;
  
  logger.debug('[SSE-READER] Processing event in handleSseEvent', {
    eventType: type,
    hasPayload: !!payload,
    messageId: payload?.messageId,
  });

  // Track job lifecycle events
  if (type === 'job.generated') {
    logger.info('[SSE-READER] 📥 Processing job.generated event', {
      messageId: payload?.messageId,
      company: payload?.company,
      position: payload?.position || payload?.title,
    });
    
    const job: Job = {
      id: payload.jobId || payload.id || undefined,
      messageId: payload.messageId || payload.id || `unknown-${Date.now()}`,
      company: payload.company || (payload.messageId ? `msg:${payload.messageId}` : 'Generated'),
      position: payload.position || payload.title || 'Generated materials',
      location: payload.location,
      url: payload.url,
      matchScore: payload.matchScore || payload.score || 0,
      matchedSkills: payload.matchedProfileSkills || [],
      platform: payload.source || 'generated',
    };

    const jobId = (job.id || job.messageId)!;
    if (!this.processedJobIds.has(jobId)) {
      this.processedJobIds.add(jobId);
      this.jobQueue.push(job);
      logger.info('[SSE-READER] 📥 Job buffered to queue', {
        jobId,
        messageId: job.messageId,
        company: job.company,
        queueDepth: this.jobQueue.length,
      });
      
      if (this.jobArrivalSignal) {
        logger.info('[SSE-READER] 🔔 Signaling waiting nextJob() call');
        this.jobArrivalSignal();
      }
      
      // ✅ NEW: EMIT to registered listeners!
      logger.info('[SSE-READER] 📡 Emitting job.generated to listeners', {
        messageId: job.messageId,
        listenerCount: this.eventListeners.get('job.generated')?.size || 0,
      });
      this.emitEvent('job.generated', payload);
    }
  }

  if (type === 'job.parse.started') {
    const messageId = payload.messageId;
    logger.debug('[SSE-READER] 🔄 Parse started', { messageId });
    if (messageId) {
      if (!this.pendingJobs.has(messageId)) {
        this.pendingJobs.set(messageId, []);
      }
      this.pendingJobs.get(messageId)!.push({
        type: 'parse.started',
        payload,
      });
      
      // ✅ NEW: EMIT to listeners
      logger.debug('[SSE-READER] 📡 Emitting job.parse.started to listeners', {
        messageId,
        listenerCount: this.eventListeners.get('job.parse.started')?.size || 0,
      });
      this.emitEvent('job.parse.started', payload);
    }
  }
  
  if (type === 'job.parse.completed') {
    const messageId = payload.messageId;
    logger.info('[SSE-READER] ✅ Parse completed', { messageId });
    if (messageId) {
      if (!this.pendingJobs.has(messageId)) {
        this.pendingJobs.set(messageId, []);
      }
      this.pendingJobs.get(messageId)!.push({
        type: 'parse.completed',
        payload,
      });
      
      // ✅ NEW: EMIT to listeners
      logger.info('[SSE-READER] 📡 Emitting job.parse.completed to listeners', {
        messageId,
        listenerCount: this.eventListeners.get('job.parse.completed')?.size || 0,
      });
      this.emitEvent('job.parse.completed', payload);
    }
  }

  if (type === 'job.routed') {
    const messageId = payload.messageId;
    const action = payload.action || payload.routing?.action;
    logger.info('[SSE-READER] ✓ Job routed successfully', { messageId, action });
    
    // ✅ ALREADY does emit here:
    this.emitEvent('job.routed', payload);
    logger.info('[SSE-READER] 📡 Emitted job.routed to listeners', {
      messageId,
      action,
      listenerCount: this.eventListeners.get('job.routed')?.size || 0,
    });
    
    this.clearParseEvents(messageId);
  }

  if (type === 'job.processed') {
    logger.debug('[SSE-READER] ✓ Job processed', { messageId: payload.messageId });
    
    // ✅ NEW: EMIT to listeners
    this.emitEvent('job.processed', payload);
  }
}
```

**File: [src/ui/ops-tui-app.ts](src/ui/ops-tui-app.ts#L101-120)** (Signal listener calls)

```typescript
/**
 * Register listeners for SSE signals (job.generated, job.parse.completed, job.routed)
 */
private registerSignalListeners(): void {
  logger.info('[render-server] Registering signal listeners...');
  
  // Signal 1: job.generated - job enters system with PARTIAL data
  this.sseReader.addEventListener('job.generated', (event: any) => {
    logger.info('[SIGNAL-1] 📨 Received job.generated event (from listener)', {
      eventType: event.type,
      hasData: !!event.data,
      hasPayload: !!event.payload,
    });
    
    try {
      const payload = event.data || event.payload;
      if (!payload) {
        logger.warn('[SIGNAL-1] No payload found in event');
        return;
      }
      
      const messageId = payload?.messageId;
      const company = payload?.company;
      const position = payload?.position || payload?.title;
      
      if (!messageId) {
        logger.warn('[SIGNAL-1] No messageId in payload, skipping');
        return;
      }
      
      const job = {
        messageId,
        company: company || 'Generated',
        position: position || 'Position TBA',
        location: payload?.location,
        url: payload?.url,
        salary: payload?.salary,
        id: payload?.jobId || messageId,
        matchScore: 0,
        matchedSkills: [],
        platform: payload?.platform || 'webhook',
      };
      
      logger.info('[SIGNAL-1] Calling setCurrentJob with PARTIAL stage', {
        messageId,
        company: job.company,
        position: job.position,
      });
      
      setCurrentJob(messageId, job, 'PARTIAL');
      
      logger.info('[SIGNAL-1] ✅ State update complete', {
        messageId,
        stage: 'PARTIAL',
        company,
        position,
      });
    } catch (err) {
      logger.error('[SIGNAL-1] ❌ Error processing job.generated', {
        error: String(err),
      });
    }
  });

  // Signal 2: job.parse.completed - same pattern
  this.sseReader.addEventListener('job.parse.completed', (event: any) => {
    logger.info('[SIGNAL-2] 📨 Received job.parse.completed event (from listener)');
    try {
      const payload = event.data || event.payload;
      const messageId = payload?.messageId;
      if (!messageId) {
        logger.warn('[SIGNAL-2] No messageId in payload');
        return;
      }
      
      const currentState = this.currentJob;
      const enrichedJob = currentState ? { ...currentState, ...payload } : payload;
      
      setCurrentJob(messageId, enrichedJob, 'FULL_PARSED');
      
      logger.info('[SIGNAL-2] ✅ State update complete', {
        messageId,
        stage: 'FULL_PARSED',
      });
    } catch (err) {
      logger.error('[SIGNAL-2] ❌ Error processing job.parse.completed', {
        error: String(err),
      });
    }
  });

  // Signal 3: job.routed - same pattern
  this.sseReader.addEventListener('job.routed', (event: any) => {
    logger.info('[SIGNAL-3] 📨 Received job.routed event (from listener)');
    try {
      const payload = event.data || event.payload;
      const messageId = payload?.messageId;
      const routeAction = payload?.action || payload?.decision || 'unknown';
      
      if (messageId) {
        clearCurrentJob();
        this.state = 'IDLE';
        
        logger.info('[SIGNAL-3] ✅ State cleared, returning to IDLE', {
          messageId,
          action_type: routeAction,
        });
      }
    } catch (err) {
      logger.error('[SIGNAL-3] ❌ Error processing job.routed', {
        error: String(err),
      });
    }
  });
  
  logger.info('[render-server] ✅ Signal listeners registered and connected to emitters');
}
```

### Testing

1. **Trace Signal 1→2→3 Flow**:
   ```bash
   # Terminal 1: Start render server with full logging
   npm run render-server 2>&1 | grep -E "SIGNAL-|SSE-READER.*Emit"
   
   # Terminal 2: Trigger webhook (Signal 1)
   ./scripts/eval-fetch-and-trigger.sh 1
   
   # Expected sequence in Terminal 1 logs:
   # [SSE-READER] 📥 Processing job.generated event
   # [SSE-READER] 📡 Emitting job.generated to listeners
   # [SIGNAL-1] 📨 Received job.generated event (from listener)
   # [SIGNAL-1] ✅ State update complete, stage: PARTIAL
   
   # Then manually trigger Signal 2 (parse) and Signal 3 (route)
   ```

2. **Log Verification**:
   ```bash
   # Parse logs to verify complete flow
   jq 'select(.message | contains("SIGNAL-")' tui-logs-render.jsonl | \
     jq -s 'sort_by(.timestamp) | .[].message'
   
   # ✅ Should show in order:
   # [SIGNAL-1] ... PARTIAL
   # [SIGNAL-2] ... FULL_PARSED
   # [SIGNAL-3] ... IDLE
   ```

3. **State File Verification**:
   ```bash
   # Monitor state file changes
   watch -n 0.5 'cat ~/.cache/jobs-watcher-tui-state.json | jq ".stage"'
   
   # Trigger signals:
   # ✅ After Signal 1: Should show "PARTIAL"
   # ✅ After Signal 2: Should show "FULL_PARSED"
   # ✅ After Signal 3: Should show null (cleared)
   ```

---

## ISSUE 5: SSE Event Delivery Correctness

### Root Cause Analysis

**From Previous Session Memory**: [/memories/session/tui-sse-state-diagnostics.md](../session/tui-sse-state-diagnostics.md#L49-L82)

**Core Problem**:
MongoDB change-streams only see events AFTER connection is established. But in typical workflow:
1. Daemon boots → SSE server initializes change-stream
2. Change-stream connects asynchronously in background
3. Webhook arrives immediately → Signal 1 committed to MongoDB
4. Render-server connects minutes later
5. Change-stream never sees Signal 1 (it arrived BEFORE subscription)

**Files Involved**:
- [src/services/sse-server.ts](src/services/sse-server.ts) - SSE endpoint, change-stream setup
- [src/index.ts](src/index.ts) - Daemon startup
- [src/ui/components/SseJobReader.ts](src/ui/components/SseJobReader.ts#L70-100) - SSE subscription

**Current Implementation** (broken):
```typescript
// sse-server.ts - Change-stream setup
export function attachSse(app: any) {
  app.get('/events', async (req: any, res: any) => {
    // Client connects here
    const changeStream = actionSnapshots.watch([
      { operationType: 'insert' },
      { operationType: 'update' },
    ]);
    
    // ❌ PROBLEM: Change-stream only sees events AFTER this point
    // Events from BEFORE connection are missed
    
    changeStream.on('change', (change) => {
      // Send to client
    });
  });
}
```

### Fix Implementation

**Strategy**: Replay recent snapshots when client connects, THEN stream changes

**File: [src/services/sse-server.ts](src/services/sse-server.ts) - Enhanced**

```typescript
/**
 * Attach SSE endpoint to Express app
 * Implements snapshot replay + change-stream pattern
 */
export function attachSse(app: any, dbConnection?: any) {
  app.get('/events', async (req: any, res: any) => {
    const clientId = req.query.clientId || `client-${Date.now()}`;
    const token = req.query.token;
    
    logger.info('[SSE] New client connected', {
      clientId,
      hasToken: !!token,
      url: req.url,
    });
    
    // Verify token if required
    if (process.env.SSE_AUTH_TOKEN && token !== process.env.SSE_AUTH_TOKEN) {
      logger.warn('[SSE] Unauthorized client', { clientId });
      res.status(401).send('Unauthorized');
      return;
    }
    
    try {
      // Set up SSE response headers
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('Access-Control-Allow-Origin', '*');
      
      // Step 1: Query recent snapshots for replay
      logger.info('[SSE] Step 1: Querying recent action_snapshots', { clientId });
      const db = dbConnection || getMongoDb();
      const actionSnapshots = db.collection('action_snapshots');
      
      // Get last 50 snapshots (or configurable)
      const recentSnapshots = await actionSnapshots
        .find({})
        .sort({ timestamp: -1 })
        .limit(50)
        .toArray();
      
      logger.info('[SSE] Replaying recent snapshots', {
        clientId,
        snapshotCount: recentSnapshots.length,
        oldestAge: recentSnapshots.length > 0 
          ? Math.round((Date.now() - recentSnapshots[recentSnapshots.length - 1].timestamp) / 1000)
          : 0,
      });
      
      // Reverse to send oldest first
      for (const snapshot of recentSnapshots.reverse()) {
        const eventType = snapshot.metaEventType || 'job.generated';
        const eventData = {
          ...snapshot,
          _isReplay: true,
          _replayedAt: new Date().toISOString(),
        };
        
        logger.debug('[SSE] Replaying snapshot', {
          clientId,
          eventType,
          messageId: snapshot.messageId,
          age: Math.round((Date.now() - snapshot.timestamp) / 1000),
        });
        
        res.write(`event: ${eventType}\n`);
        res.write(`data: ${JSON.stringify(eventData)}\n\n`);
      }
      
      // Step 2: Set up change-stream for NEW events
      logger.info('[SSE] Step 2: Setting up change-stream for new events', { clientId });
      
      const changeStream = actionSnapshots.watch([
        { operationType: 'insert' },
        { operationType: 'update' },
      ]);
      
      // Send heartbeat every 30 seconds to keep connection alive
      const heartbeatInterval = setInterval(() => {
        res.write(': heartbeat\n\n');
        logger.debug('[SSE] Sent heartbeat', { clientId });
      }, 30000);
      
      // Handle new changes
      changeStream.on('change', (change) => {
        try {
          const operationType = change.operationType;
          const document = change.fullDocument || change.updateDescription?.updatedFields;
          const eventType = document?.metaEventType || 'job.generated';
          
          logger.info('[SSE] Publishing change to client', {
            clientId,
            operationType,
            eventType,
            messageId: document?.messageId,
          });
          
          res.write(`event: ${eventType}\n`);
          res.write(`data: ${JSON.stringify(document)}\n\n`);
        } catch (err) {
          logger.error('[SSE] Error publishing change', { clientId, error: String(err) });
        }
      });
      
      // Clean up on disconnect
      const cleanup = () => {
        logger.info('[SSE] Client disconnected', { clientId });
        clearInterval(heartbeatInterval);
        changeStream.close();
      };
      
      res.on('close', cleanup);
      res.on('error', cleanup);
      
      logger.info('[SSE] ✅ Client fully set up', { clientId, mode: 'REPLAY_THEN_STREAM' });
    } catch (err) {
      logger.error('[SSE] Error in SSE handler', {
        error: String(err),
        stack: (err as any)?.stack?.split('\n')[0],
      });
      res.status(500).send('Internal Server Error');
    }
  });
}
```

**File: [src/ui/components/SseJobReader.ts](src/ui/components/SseJobReader.ts#L70-100)** - Process replayed events

```typescript
/**
 * Handle incoming SSE event (including replayed snapshots)
 */
onMessage: (ev: any) => {
  logger.debug('[SSE-READER] 📦 Received message from SSE', {
    type: ev.type,
    hasPayload: !!ev.payload,
    isReplay: ev.payload?._isReplay,
  });
  
  // ✅ NEW: Track if this is a replayed event
  if (ev.payload?._isReplay) {
    logger.info('[SSE-READER] 📼 REPLAYED snapshot', {
      eventType: ev.type,
      messageId: ev.payload?.messageId,
      replayedAt: ev.payload?._replayedAt,
      originalAge: Math.round((Date.now() - ev.payload?.timestamp) / 1000),
    });
    
    // Don't re-process duplicate jobs, but DO emit signals
    // so listen ers see the complete history
    this.handleSseEvent({
      type: ev.type,
      payload: ev.payload,
    });
  } else {
    // Fresh event - process normally
    this.handleSseEvent({
      type: ev.type,
      payload: ev.payload,
    });
  }
}
```

### Testing

1. **Replay Verification**:
   ```bash
   # Create a snapshot in MongoDB first
   db.action_snapshots.insertOne({
     messageId: "test-123",
     company: "Test Co",
     timestamp: new Date(),
     metaEventType: "job.generated"
   })
   
   # Now connect render-server
   npm run render-server 2>&1 | grep -E "Replaying|Replay" | head -5
   
   # ✅ Expected: Should see "Replaying snapshot" logs
   # ✅ State file should be populated immediately
   ```

2. **New Events After Replay**:
   ```bash
   # Terminal 1: Start render-server
   npm run render-server 2>&1 | grep -E "REPLAY|new events"
   
   # Terminal 2: Trigger new webhook
   ./scripts/eval-fetch-and-trigger.sh 1
   
   # Expected in Terminal 1:
   # [SSE] Replaying recent snapshots (count: X)
   # [SSE-READER] 📼 REPLAYED snapshot (multiple)
   # [SSE-READER] 📥 Processing job.generated event (fresh)
   # [SIGNAL-1] ✅ State update complete
   ```

3. **No Duplicate Processing**:
   ```bash
   # Check that replayed events don't corrupt state
   npm run render-server 2>&1 | grep "processedJobIds"
   
   # ✅ Job should only appear once in logs
   # ❌ Bad: If "duplicate job skipped" appears many times
   ```

---

## ISSUE 6: Tmux Setup and Component Startup

### Root Cause Analysis

**File**: [scripts/tmux-tui-setup.sh](scripts/tmux-tui-setup.sh)

**Current Implementation** (lines 70-75):
```bash
echo "📍 Pane 0: Render Server (ANSI output, no keyboard input)..."
tmux send-keys -t "$SESSION_NAME:0.0" \
  "cd '$PROJECT_ROOT' && echo '=== ANSI Render Server (stdout only) ===' && npm run render-server 2>'$LOG_FILE_RENDER'" C-m

echo "📍 Pane 1: Action Controller (keyboard input)..."
tmux split-window -v -t "$SESSION_NAME:0.0" -p 60
tmux send-keys -t "$SESSION_NAME:0.1" \
  "cd '$PROJECT_ROOT' && echo '=== Keyboard Action Handler ===' && npm run action-controller 2>'$LOG_FILE_ACTION'" C-m
```

**Verification Needed**:
1. Do both panes actually start the npm processes?
2. Are the log files being written correctly?
3. Can you send keystrokes to pane 1?
4. Are there any startup errors?

### Fix Implementation

**Strategy**: Add startup validation with explicit checks

**File: [scripts/tmux-tui-setup.sh](scripts/tmux-tui-setup.sh) - Enhanced**

```bash
#!/bin/bash
# ... existing code ...

# Enhanced version with startup verification

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SESSION_NAME="jobs"
LOG_FILE_RENDER="${PROJECT_ROOT}/tui-logs-render.jsonl"
LOG_FILE_ACTION="${PROJECT_ROOT}/tui-logs-action.jsonl"

# Kill existing session
if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
    echo "🔄 Killing existing session '$SESSION_NAME'..."
    tmux kill-session -t "$SESSION_NAME" 2>/dev/null || true
    sleep 1
fi

# Create session
tmux new-session -d -s "$SESSION_NAME" -x 120 -y 40

# Clear log files
> "$LOG_FILE_RENDER"
> "$LOG_FILE_ACTION"

echo "📍 Pane 0: Render Server..."
tmux send-keys -t "$SESSION_NAME:0.0" \
  "cd '$PROJECT_ROOT' && npm run render-server 2>'$LOG_FILE_RENDER'" C-m

# Give render-server time to start
sleep 2

# Check if render-server started
if [ ! -s "$LOG_FILE_RENDER" ]; then
    echo "⚠️  WARNING: Render server log file is empty"
    echo "    It may still be starting. Checking processes..."
    ps aux | grep "render-server" | grep -v grep && echo "    ✅ render-server process found" || echo "    ❌ render-server process NOT found"
else
    echo "✅ Render server log file created"
    echo "    First log entry: $(head -1 '$LOG_FILE_RENDER')"
fi

echo ""
echo "📍 Pane 1: Action Controller..."
tmux split-window -v -t "$SESSION_NAME:0.0" -p 60
tmux send-keys -t "$SESSION_NAME:0.1" \
  "cd '$PROJECT_ROOT' && npm run action-controller 2>'$LOG_FILE_ACTION'" C-m

# Give action-controller time to start
sleep 2

# Check if action-controller started
if [ ! -s "$LOG_FILE_ACTION" ]; then
    echo "⚠️  WARNING: Action controller log file is empty"
    ps aux | grep "action-controller" | grep -v grep && echo "    ✅ action-controller process found" || echo "    ❌ action-controller process NOT found"
else
    echo "✅ Action controller log file created"
    echo "    First log entry: $(head -1 '$LOG_FILE_ACTION')"
fi

echo ""
echo "📍 Pane 2: Combined Logs..."
tmux split-window -v -t "$SESSION_NAME:0.1" -p 50
tmux send-keys -t "$SESSION_NAME:0.2" \
  "cd '$PROJECT_ROOT' && tail -f -n +1 '$LOG_FILE_RENDER' '$LOG_FILE_ACTION' 2>/dev/null | cat" C-m

echo ""
echo "✅ Session created: $SESSION_NAME"
echo ""
echo "📊 Startup Summary:"
echo "  Render  Server: $(ps aux | grep -c 'render-server' 2>/dev/null || echo 0) process(es)"
echo "  Action  Controller: $(ps aux | grep -c 'action-controller' 2>/dev/null || echo 0) process(es)"
echo ""
echo "🩺 Next Steps for Verification:"
echo "  1. tmux attach-session -t $SESSION_NAME"
echo "  2. Ctrl+b o    → Switch to Pane 1 (should see action handler)"
echo "  3. Ctrl+b o    → Switch to Pane 2 (should see logs updating)"
echo "  4. In another terminal: ./scripts/eval-fetch-and-trigger.sh 1"
echo "  5. Back in tmux Pane 0: Should see job card appear"
echo "  6. Back in Pane 1: Press [p] for preview"
echo "  7. All panes should show clean output (no corruption)"
```

**File: [scripts/verify-tui-startup.sh](scripts/verify-tui-startup.sh) - NEW**

```bash
#!/bin/bash
###############################################################################
# TUI Startup Verification Script
# Verifies that all components started correctly
###############################################################################

set -e

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SESSION_NAME="jobs"
LOG_FILE_RENDER="$PROJECT_ROOT/tui-logs-render.jsonl"
LOG_FILE_ACTION="$PROJECT_ROOT/tui-logs-action.jsonl"

echo "🩺 TUI Startup Verification"
echo "==========================="
echo ""

# Check 1: Session exists
if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
    echo "✅ Tmux session '$SESSION_NAME' exists"
else
    echo "❌ Tmux session '$SESSION_NAME' NOT found"
    exit 1
fi

# Check 2: Panes exist
for pane in 0 1 2; do
    if tmux list-panes -t "$SESSION_NAME:0" 2>/dev/null | grep -q "pane $pane"; then
        echo "✅ Pane $pane exists"
    else
        echo "❌ Pane $pane NOT found"
    fi
done

# Check 3: Log files
echo ""
echo "📋 Log Files:"
if [ -f "$LOG_FILE_RENDER" ]; then
    size=$(stat -f%z "$LOG_FILE_RENDER" 2>/dev/null || stat -c%s "$LOG_FILE_RENDER" 2>/dev/null || echo 0)
    lines=$(wc -l < "$LOG_FILE_RENDER" 2>/dev/null || echo 0)
    echo "✅ Render server log: ${size} bytes, ${lines} lines"
    if [ "$lines" -gt 0 ]; then
        echo "   First entry: $(head -1 "$LOG_FILE_RENDER" | jq -r '.message' 2>/dev/null || echo '(unparseable)')"
        echo "   Last entry:  $(tail -1 "$LOG_FILE_RENDER" | jq -r '.message' 2>/dev/null || echo '(unparseable)')"
    fi
else
    echo "❌ Render server log NOT found"
fi

if [ -f "$LOG_FILE_ACTION" ]; then
    size=$(stat -f%z "$LOG_FILE_ACTION" 2>/dev/null || stat -c%s "$LOG_FILE_ACTION" 2>/dev/null || echo 0)
    lines=$(wc -l < "$LOG_FILE_ACTION" 2>/dev/null || echo 0)
    echo "✅ Action controller log: ${size} bytes, ${lines} lines"
    if [ "$lines" -gt 0 ]; then
        echo "   First entry: $(head -1 "$LOG_FILE_ACTION" | jq -r '.message' 2>/dev/null || echo '(unparseable)')"
    fi
else
    echo "❌ Action controller log NOT found"
fi

# Check 4: Process running
echo ""
echo "🔍 Running Processes:"
render_count=$(ps aux | grep -c "[n]pm.*render-server" || echo 0)
action_count=$(ps aux | grep -c "[n]pm.*action-controller" || echo 0)

echo "  Render  Server: $render_count process(es)"
echo "  Action  Controller: $action_count process(es)"

if [ "$render_count" -gt 0 ]; then
    echo "  ✅ Render  server running"
else
    echo "  ❌ Render  server NOT running"
fi

if [ "$action_count" -gt 0 ]; then
    echo "  ✅ Action  controller running"
else
    echo "  ❌ Action  controller NOT running"
fi

# Check 5: Panes outputting
echo ""
echo "📊 Pane Output Status:"
for pane in 0 1 2; do
    output=$(tmux capture-pane -t "$SESSION_NAME:0.$pane" -p | head -3)
    if [ -z "$output" ]; then
        echo "  Pane $pane: (empty)"
    else
        echo "  Pane $pane: $(echo "$output" | head -1)"
    fi
done

echo ""
echo "✅ Verification complete!"
```

### Testing

1. **Startup Check**:
   ```bash
   ./scripts/tmux-tui-setup.sh
   
   # ✅ Should see:
   # ✅ Render server log file created
   # ✅ Action controller log file created
   ```

2. **Verify Components**:
   ```bash
   ./scripts/verify-tui-startup.sh
   
   # ✅ Expected output:
   # ✅ Tmux session 'jobs' exists
   # ✅ Pane 0 exists
   # ✅ Pane 1 exists
   # ✅ Pane 2 exists
   # ✅ Render server log: XXX bytes, XX lines
   # ✅ Render server running
   # ✅ Action controller running
   ```

3. **Manual Tmux Check**:
   ```bash
   tmux attach-session -t jobs
   
   # Pane 0: Should show "🟢 SSE ↕ UDS [IDLE]"
   # Pane 1: Should show a prompt or "Waiting for input"
   # Pane 2: Should show live logs from both panes
   
   # Press Ctrl+b o to cycle panes
   # Ctrl+b d to detach
   ```

---

## Priority Order & Implementation Timeline

| Priority | Issue | Effort | Impact | Dependencies |
|----------|-------|--------|--------|--------------|
| **P0** | 5. SSE Event Delivery (snapshot replay) | 2h | 🔴 BLOCKING all signals | Must fix first |
| **P1** | 1. Stdout Flooding (event-driven render) | 2h | 🔴 CRITICAL for UX | Depends on P0 |
| **P2** | 4. Signal Flow 1→2→3 (emit to listeners) | 2h | 🟠 HIGH blocking signals | Depends on P0 |
| **P3** | 2. [p]/[o] Modal Actions (screen clear) | 1.5h | 🟡 HIGH for UX | Independent |
| **P4** | 3. Stderr Isolation (output routing) | 1h | 🟡 MEDIUM for logs | Independent |
| **P5** | 6. Tmux Startup Verification | 1h | 🟢 LOW for validation | Independent |

**Estimated Total**: 9.5 hours

**Suggested Implementation Order**:
1. Day 1 Morning: Fix P0 (SSE replay) + Test
2. Day 1 Afternoon: Fix P1 (event-driven) + P2 (signals) + Test
3. Day 2 Morning: Fix P3 (modal) + P4 (stderr) + Test
4. Day 2 Afternoon: Fix P5 (verification) + Full integration test

---

## Verification Checklist for MANUAL_TESTING_GUIDE.md Tests 1-3

### Test 1: Webhook → Signal 1 → Display Job Card

**Pre-req**: Fix P0 (SSE replay), P1 (event-driven), P2 (signals)

**Steps**:
1. `./scripts/tmux-tui-setup.sh`
2. In Pane 1: `./scripts/eval-fetch-and-trigger.sh 1`
3. In Pane 0: Observe

**Verification**:
- [ ] Job card appears in < 2 seconds
- [ ] Screen does NOT flash/redraw continuously
- [ ] Job shows: Company, Position, Location (PARTIAL stage)
- [ ] `tui-logs-render.jsonl` shows:
  - [ ] `[SSE-READER] Replaying snapshots` (or no replay if first job)
  - [ ] `[SSE-READER] 📥 Processing job.generated event`
  - [ ] `[SIGNAL-1] Received job.generated event`
  - [ ] `[SIGNAL-1] ✅ State update complete, stage: PARTIAL`
- [ ] State file `~/.cache/jobs-watcher-tui-state.json` contains job with `"stage": "PARTIAL"`
- [ ] Pane 1 keyboard responsive immediately
- [ ] Pane 1 keyboard responsive immediately (after Signal 1)

### Test 2: Press [c] → Signal 2 → Full Data Displayed

**Pre-req**: Test 1 passing + P3 (modal for [c] handler)

**Steps**:
1. (Continue from Test 1)
2. In Pane 0 (or Pane 1): Press `[c]` (webhook stage 2 parse)
3. Copy a job listing HTML to clipboard first
4. Press `[c]` again

**Verification**:
- [ ] `[c]` handler runs without screen corruption
- [ ] No output overlay on job card
- [ ] Logs show: `[action-controller] Action received: webhook_stage2_parse`
- [ ] Daemon processes parsing: `[WEBHOOK/INGEST] Stage 2 parse triggered`
- [ ] Wait 5-10 seconds
- [ ] Screen updates with full parsed data:
  - [ ] Match score appears
  - [ ] Matched skills appear
  - [ ] All metadata fields filled
- [ ] `tui-logs-render.jsonl` shows:
  - [ ] `[SSE-READER] 📥 Processing job.parse.completed event`
  - [ ] `[SIGNAL-2] ✅ State update complete, stage: FULL_PARSED`
- [ ] State file shows `"stage": "FULL_PARSED"` with enriched data

### Test 3: Press [j] → Signal 3 → Return to Idle

**Pre-req**: Tests 1-2 passing

**Steps**:
1. (Continue from Test 2)
2. In Pane 0 (or Pane 1): Press `[j]` (queue job)

**Verification**:
- [ ] Job card disappears
- [ ] Screen returns to idle ("⏳ Waiting for job alerts...")
- [ ] Screen does NOT flash after returning to idle (Issue #1 fixed)
- [ ] `tui-logs-action.jsonl` shows:
  - [ ] `[ROUTE] Action executed: queue` with Signal 3 tag
  - [ ] `messageId` and `mergedPayloadKeys` logged
- [ ] `tui-logs-render.jsonl` shows:
  - [ ] `[SIGNAL-3] ✅ State cleared, returning to IDLE`
- [ ] State file `~/.cache/jobs-watcher-tui-state.json` is empty or reset
- [ ] Daemon shows job reached `job_queue` collection:
  - [ ] `db.job_queue.findOne({...})` shows the queued job

---

## Summary of Code Files to Modify

| File | Lines | Change | Severity |
|------|-------|--------|----------|
| [src/ui/ops-tui-app.ts](src/ui/ops-tui-app.ts) | 270-296 | Remove timer-based idle render + add state detection | **P0** |
| [src/ui/ops-tui-app.ts](src/ui/ops-tui-app.ts) | 80-200 | Add emitEvent calls in signal listeners | **P1** |
| [src/ui/components/SseJobReader.ts](src/ui/components/SseJobReader.ts) | 169-250 | Add emitEvent calls after buffer + replay handling | **P1** |
| [src/services/sse-server.ts](src/services/sse-server.ts) | (entire SSE GET handler) | Add snapshot replay on connect | **P0** |
| [src/ui/action-controller.ts](src/ui/action-controller.ts) | 273-330 | Add modal pattern to [p] and [o] handlers | **P2** |
| [src/ui/action-controller.ts](src/ui/action-controller.ts) | (all) | Verify only logger used, no console.log/error | **P3** |
| [scripts/tmux-tui-setup.sh](scripts/tmux-tui-setup.sh) | (entire) | Add startup verification checks | **P4** |
| [scripts/verify-tui-startup.sh](scripts/verify-tui-startup.sh) | (new file) | Create startup validation script | **P4** |

---

## Next Steps

1. **Review Recommendations**: Review this analysis with team
2. **Prioritize**: Confirm P0-P5 order aligns with team priorities
3. **Implement**: Follow implementation order (P0 first)
4. **Test**: Run verification checklist after each fix
5. **Document**: Update MANUAL_TESTING_GUIDE.md with verified procedures

