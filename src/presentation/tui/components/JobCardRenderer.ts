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
}

export class JobCardRenderer {
  private terminalWidth: number;
  private terminalHeight: number;

  constructor(width?: number, height?: number) {
    this.terminalWidth = width || process.stdout.columns || 80;
    this.terminalHeight = height || process.stdout.rows || 24;
  }

  /**
   * Render a complete job card with header, metadata, and footer.
   * Returns complete ANSI frame as single string (cleared + rendered).
   */
  renderCard(job: Job | null, status: CardStatus, actionInProgress?: string): string {
    const lines: string[] = [];

    // Clear screen and home cursor
    lines.push('\x1b[2J\x1b[H');

    // Header with status indicators
    lines.push(this.renderHeader(status));

    if (!job) {
      lines.push('');
      lines.push(this.renderWaitingState(status));
      lines.push('');
      lines.push(this.renderFooter(false, status));
      return lines.join('\n');
    }

    // Job metadata
    lines.push('');
    lines.push(this.renderMetadata(job));

    // Action in progress
    if (actionInProgress) {
      lines.push('');
      lines.push(`║  🔄 ${actionInProgress}...`);
    }

    // Always show footer (actions guide)
    lines.push('');
    lines.push(this.renderFooter(true, status));

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

    const padding = Math.max(0, this.terminalWidth - titleLine.length - 3);
    return `╔ ${titleLine}${' '.repeat(padding)}╗`;
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
   * Display ALL job fields as-is from SSE payload (Stage 1 PARTIAL or Stage 2 FULL_PARSED).
   * When `details` is present, render sub-fields indented and skip flat `description`.
   */
  private renderMetadata(job: Job): string {
    const lines: string[] = [];
    const hasDetails = job.details !== undefined && job.details !== null;
    lines.push('╟─ Job Details (as-is from SSE):');

    const excludeKeys = new Set(['platform', 'jobLifecycleId', '_id', 'ts', 'timestamp', 'recordedAt', 'source', 'action', 'stage', 'ingestSource', 'receivedAt']);
    
    for (const [key, value] of Object.entries(job)) {
      if (excludeKeys.has(key)) continue;

      // Render details sub-fields individually instead of flat description
      if (key === 'details' && value && typeof value === 'object') {
        this.renderDetails(lines, value as JobDetails);
        continue;
      }
      if (key === 'description' && hasDetails) continue;

      const displayValue = this.formatValue(value);
      const kvLine = `${key}: ${displayValue}`;
      lines.push(`║  ${this.truncate(kvLine, this.terminalWidth - 6)}`);
    }

    lines.push('╟─────────────────────────────────────────────────────────');
    return lines.join('\n');
  }

  /**
   * Render structured details sub-fields as indented key-value pairs.
   * Follows the job_lifecycle[job] contract where details replaces flat description.
   */
  private renderDetails(lines: string[], details: JobDetails): void {
    lines.push(`║  details:`);

    const labelMap: Record<string, string> = {
      responsibilities: 'Responsibilities',
      requirements: 'Requirements',
      benefits: 'Benefits',
      companyInfo: 'Company Info',
      contact: 'Contact',
      applicationProcess: 'Application Process',
      additionalInfo: 'Additional Info',
      pay: 'Pay',
      jobType: 'Job Type',
    };

    for (const [key, value] of Object.entries(details)) {
      if (key === 'extraSections' && value && typeof value === 'object') {
        for (const [section, content] of Object.entries(value as Record<string, string>)) {
          if (content && content.trim()) {
            lines.push(`║    ${section}: ${this.truncate(content, this.terminalWidth - 14)}`);
          }
        }
        continue;
      }
      if (value && typeof value === 'string' && value.trim()) {
        const label = labelMap[key] || key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase());
        lines.push(`║    ${label}: ${this.truncate(value, this.terminalWidth - 14)}`);
      }
    }
  }

  /**
   * Format a value for display (handle arrays, objects, nulls, etc.)
   */
  private formatValue(value: unknown): string {
    if (value === null || value === undefined) {
      return '(empty)';
    }
    if (typeof value === 'object') {
      if (Array.isArray(value)) {
        return `[${value.slice(0, 3).join(', ')}${value.length > 3 ? '...' : ''}]`;
      }
      // Nested object
      return JSON.stringify(value).substring(0, 50);
    }
    if (typeof value === 'boolean') {
      return value ? '✓' : '✗';
    }
    if (typeof value === 'number') {
      return String(value);
    }
    return String(value);
  }

  /**
   * Render the footer with keyboard help.
   */
  private renderFooter(hasJob: boolean, status?: CardStatus): string {
    const isDirect = status?.queueMode === false;
    const lines: string[] = [];

    if (!hasJob) {
      if (isDirect) {
        lines.push('╚ i=ingest  p=preview  q=quit  b=queue');
      } else {
        lines.push('╚ q=quit  b=direct');
      }
      return lines.join('\n');
    }

    lines.push('╟─ Actions:');
    if (isDirect) {
      lines.push('║  j=queue  d=trash  p=preview');
      lines.push('║  b=queue  ?=help  q=quit');
    } else {
      lines.push('║  j=queue  d=trash  p=preview  e=edit  o=open-url  c=stage2  f=filter');
      lines.push('║  b=direct  ?=help  q=quit');
    }
    lines.push('╚' + '═'.repeat(Math.max(0, this.terminalWidth - 2)) + '╝');

    return lines.join('\n');
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
   * Truncate a string to a maximum width, adding "..." if needed.
   */
  private truncate(text: string, maxWidth: number): string {
    if (text.length <= maxWidth) {
      return text;
    }
    return text.substring(0, maxWidth - 3) + '...';
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
