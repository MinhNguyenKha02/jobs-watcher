/**
 * StdinStatusPane — 2-line `PB` stdin pane (60% w, `h8`).
 * Owns stdin raw only; stderr-free except pino, 60/40 bottom split.
 */

export interface StdinStatus {
  lastAction?: string | null;
  jobLifecycleId?: string | null;
  queueMode: boolean;
  processedCount: number;
  udsTookMs?: number | null;
  modalActive: boolean;
  lastError?: string | null;
}

export function renderStdinStatusPane(status: StdinStatus, width = 96): string {
  const inner = Math.max(10, width - 2);
  const lines: string[] = [];
  const border = '─'.repeat(inner);

  lines.push(`┌${border}┐`);

  const last = status.lastAction
    ? `${status.lastAction} ${status.jobLifecycleId ? midTruncateId(status.jobLifecycleId, 14) : ''} ${status.udsTookMs ? `✓ ${status.udsTookMs}ms` : ''}`.trim()
    : '—';
  const line1 = ` last: ${last} | mode: queue:${status.queueMode ? 'ON' : 'OFF'} | proc: ${status.processedCount}/1000${status.modalActive ? ' | modal: ↑/↓' : ' | card: ↑/↓'}`;
  lines.push(`│${truncate(line1, inner).padEnd(inner)}│`);

  const line2 = status.lastError
    ? ` err: ${truncate(status.lastError, inner - 7)}`
    : ' keys: j d p c o i b ? q  • ↑/↓ scroll ESC modal';
  lines.push(`│${truncate(line2, inner).padEnd(inner)}│`);

  lines.push(`└${border}┘`);
  return lines.join('\n');
}

function midTruncateId(id: string, maxLen = 14): string {
  if (id.length <= maxLen) return id;
  const dash = id.lastIndexOf('-');
  const suffix = dash !== -1 ? id.slice(dash) : id.slice(-6);
  return `${id.slice(0, 4)}…${suffix.replace(/^-/, 'job-')}`;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 3) + '...';
}
