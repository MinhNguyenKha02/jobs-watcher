/**
 * Job Card Renderer
 *
 * Renders a job card in pure ANSI terminal format (no Ink/React).
 * Displays job metadata, status indicators, and keyboard help.
 * Single-frame, idempotent rendering - full redraw per update.
 */

import type { Job, JobDetails } from '../../../domain/types/job.js';

export interface CardStatus {
  sseConnected: boolean;
  udsReady: boolean;
  state?: 'IDLE' | 'DISPLAY' | 'WAITING_ACTION' | 'ACTION_DISPATCH';
  message?: string;
  queueMode?: boolean;
  pendingDepth?: number;
  pendingPartial?: number;
  pendingFull?: number;
  deferredCount?: number;
  currentJobId?: string | null;
  currentStage?: string | null;
}

export interface CardBodyStats {
  total: number;
  visible: number;
  maxOffset: number;
}

export class JobCardRenderer {
  private terminalWidth: number;
  private terminalHeight: number;

  constructor(width?: number, height?: number) {
    this.terminalWidth = width || process.stdout.columns || 80;
    this.terminalHeight = height || process.stdout.rows || 24;
  }

  /**
   * B1-5 overflow gate: body/window metrics for the PA publish step.
   * Pure function of (job, status, action, pane height) — PA persists
   * `maxOffset` via `setCardScrollMax` so PB can no-op without rendering.
   */
  cardBodyStats(job: Job | null, status: CardStatus, actionInProgress?: string): CardBodyStats {
    const headLen = 2; // clear + header
    const footLen = 1; // single ╚═══╝ closer (no footer)
    const bodyLen = !job
      ? 2 + this.renderWaitingState(status).split('\n').length
      : 2 +
        this.renderMetadata(job).split('\n').length +
        (actionInProgress ? 2 : 0);
    const reserved = headLen + footLen + 1; // +1 scroll indicator line
    const visible = Math.max(1, this.terminalHeight - reserved);
    return { total: bodyLen, visible, maxOffset: Math.max(0, bodyLen - visible) };
  }

  /**
   * Render a complete job card with header, metadata, and footer.
   * Returns complete ANSI frame as single string (cleared + rendered).
   * Head/foot are fixed; the body window scrolls by `cardScroll` lines when
   * it overflows the visible pane height. Output is byte-identical to the
   * unwindowed frame whenever the body fits.
   */
  renderCard(
    job: Job | null,
    status: CardStatus,
    actionInProgress?: string,
    cardScroll = 0
  ): string {
    // Fixed head: clear + header
    const head: string[] = ['\x1b[2J\x1b[H', this.renderHeader(status)];

    // Scrollable body + fixed foot (single closer line; actions live in PB)
    let body: string[];
    const foot: string[] = [this.renderCloser()];
    if (!job) {
      body = ['', ...this.renderWaitingState(status).split('\n'), ''];
    } else {
      body = ['', ...this.renderMetadata(job).split('\n')];
      if (actionInProgress) {
        body.push('', `║  🔄 ${actionInProgress}...`);
      }
      body.push('');
    }

    // Window the body to the visible pane height (single source: cardBodyStats)
    const { total, visible, maxOffset } = this.cardBodyStats(job, status, actionInProgress);
    const offset = Math.max(0, Math.min(Math.floor(cardScroll) || 0, maxOffset));
    const shown = body.slice(offset, offset + visible);

    const lines = [...head];
    if (total > visible) {
      lines.push(`╟─ ↕ ${offset + 1}–${offset + shown.length}/${total} (↑/↓ scroll)`);
    }
    lines.push(...shown, ...foot);
    return lines.join('\n');
  }

  /**
   * Render the header with connection status and current state.
   */
  private renderHeader(status: CardStatus): string {
    const sseIndicator = status.sseConnected ? '🟢' : '🔴';
    const udsIndicator = status.udsReady ? '↕' : '✗';
    const stateStr = status.state || 'IDLE';

    let titleLine = `${sseIndicator} SSE ${udsIndicator} UDS [${stateStr}]`;

    if (status.message) {
      titleLine += ` • ${status.message}`;
    }

    // New line in current job — Q/P/F/D badge in header
    if (
      status.pendingDepth !== undefined ||
      status.pendingPartial !== undefined ||
      status.deferredCount !== undefined
    ) {
      const q = status.pendingDepth ?? 0;
      const p = status.pendingPartial ?? 0;
      const f = status.pendingFull ?? 0;
      const d = status.deferredCount ?? 0;
      titleLine += ` Q:${q} P:${p} F:${f} D:${d}`;
    }

    if (status.currentJobId) {
      const shortId = this.midTruncateId(status.currentJobId, 13);
      const stageLabel = status.currentStage ? ` ${status.currentStage}` : '';
      titleLine += ` cur:${shortId}${stageLabel}`;
    }

    const padding = Math.max(0, this.terminalWidth - titleLine.length - 3);
    return `╔ ${titleLine}${' '.repeat(padding)}╗`;
  }

  private midTruncateId(id: string, maxLen = 13): string {
    if (id.length <= maxLen) return id;
    const dash = id.lastIndexOf('-');
    const suffix = dash !== -1 ? id.slice(dash) : id.slice(-6);
    const head = id.slice(0, 4);
    return `${head}…${suffix.replace(/^-/, 'job-')}`;
  }

  /**
   * Render "waiting for jobs" state.
   */
  private renderWaitingState(status?: CardStatus): string {
    const isDirect = status?.queueMode === false;
    const lines: string[] = [];
    lines.push('╟─ Status:');
    lines.push('║');
    if (isDirect) {
      lines.push('║  Direct mode — [i] ingest from clipboard, [p] preview clipboard');
      lines.push('║');
      lines.push('║  Switch to queue mode with [b] for auto-dequeue');
    } else {
      lines.push('║  ⏳ Waiting for job alerts from webhook...');
      lines.push('║');
      lines.push('║  Trigger jobs with: ./scripts/eval-fetch-and-trigger.sh');
    }
    return lines.join('\n');
  }

  /**
   * Render job metadata in a readable format.
   * Renders every field of the pruned RMQ payload generically — no
   * allowlist, no excludes, no truncation (long lines wrap). Payload is
   * clean by construction (Phase B/C), so the renderer trusts it.
   * When `details` is present, render sub-fields indented and skip flat `description`.
   */
  private renderMetadata(job: Job): string {
    const lines: string[] = [];
    const hasDetails = job.details !== undefined && job.details !== null;
    // PA new line — job identity + stage badge
    if (job._id) {
      const stageBadge = hasDetails ? 'FULL' : 'PARTIAL';
      lines.push(`╟─ Job # ${this.midTruncateId(job._id, 18)} [${stageBadge}]`);
    }
    lines.push('╟─ Job Details:');

    const width = this.terminalWidth - 6;
    for (const [key, value] of Object.entries(job)) {
      // Render details as plain text block instead of flat description
      if (key === 'details' && typeof value === 'string' && value) {
        this.renderDetails(lines, value);
        continue;
      }
      if (key === 'description' && hasDetails) continue;
      if (key === 'url') continue; // functional only: consumed by [o] open-url, never displayed

      const kvLine = `${key}: ${this.formatValue(value)}`;
      for (const wrapped of this.wrapLine(kvLine, width)) {
        lines.push(`║  ${wrapped}`);
      }
    }

    lines.push('╟─────────────────────────────────────────────────────────');
    return lines.join('\n');
  }

  /**
   * Render details as an indented plain-text block, wrapped in full.
   * Follows the job_lifecycle[job] contract where details is a string
   * produced by htmlToText at stage 2.
   */
  private renderDetails(lines: string[], details: JobDetails): void {
    lines.push(`║  details:`);
    for (const line of details.split('\n')) {
      if (!line.trim()) continue;
      for (const wrapped of this.wrapLine(line, this.terminalWidth - 6)) {
        lines.push(`║    ${wrapped}`);
      }
    }
  }

  /**
   * Word-wrap a line at maxWidth (hard-break fallback for overlong tokens).
   * Never truncates — every input char appears in the output.
   */
  private wrapLine(text: string, maxWidth: number): string[] {
    if (text.length <= maxWidth) return [text];
    const lines: string[] = [];
    let cur = '';
    for (const word of text.split(' ')) {
      if (word.length > maxWidth) {
        if (cur) {
          lines.push(cur);
          cur = '';
        }
        for (let i = 0; i < word.length; i += maxWidth) {
          lines.push(word.slice(i, i + maxWidth));
        }
        continue;
      }
      const next = cur ? `${cur} ${word}` : word;
      if (next.length > maxWidth) {
        lines.push(cur);
        cur = word;
      } else {
        cur = next;
      }
    }
    if (cur) lines.push(cur);
    return lines.length > 0 ? lines : [''];
  }

  /**
   * Format a value for display (payload is scalar-only by construction).
   */
  private formatValue(value: unknown): string {
    if (value === null || value === undefined) {
      return '(empty)';
    }
    if (typeof value === 'object') {
      return JSON.stringify(value);
    }
    if (typeof value === 'boolean') {
      return value ? '✓' : '✗';
    }
    return String(value);
  }

  /**
   * Single bottom-border closer. Action labels live in PB (StdinStatusPane).
   */
  private renderCloser(): string {
    return '╚' + '═'.repeat(Math.max(0, this.terminalWidth - 2)) + '╝';
  }

  /**
   * Render a simple score bar (0-100%).
   */
  private renderScoreBar(score: number): string {
    const clipped = Math.max(0, Math.min(100, score));
    const filled = Math.round((clipped / 100) * 10);
    const empty = 10 - filled;
    return `[${String('█').repeat(filled)}${String('░').repeat(empty)}]`;
  }

  /**
   * Clear the screen and position the cursor.
   */
  private clearScreen(): string {
    return '\x1B[2J\x1B[H'; // ANSI: clear screen + home cursor
  }

  /**
   * Test render with sample data (for unit tests).
   */
  static renderSample(): string {
    const renderer = new JobCardRenderer(80, 24);
    const sampleJob: Job = {
      _id: 'msg-123',
      company: 'Acme Inc.',
      role: 'Senior Engineer',
      location: 'San Francisco, CA',
      url: 'https://example.com/job/123',
    };

    return renderer.renderCard(sampleJob, {
      sseConnected: true,
      udsReady: true,
    });
  }
}
