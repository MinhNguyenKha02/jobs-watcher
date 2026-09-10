/**
 * RmqConsumerPane — 4-line compact local-only RMQ consumer strip for PC pane (60% w).
 * Registry-driven: renders from TuiMetricsRegistry metrics (rmq_* gauges).
 */

export function midTruncateId(id: string, maxLen = 11): string {
  if (id.length <= maxLen) return id;
  const dashIdx = id.lastIndexOf('-');
  const suffix = dashIdx !== -1 ? id.slice(dashIdx) : id.slice(-6);
  const head = id.slice(0, 4);
  const candidate = `${head}…${suffix.replace(/^-/, 'job-')}`;
  // ensure `19ee…job-1` style: suffix already `job-1` if original `-job-1`
  if (candidate.length <= maxLen) return candidate;
  // fallback: head…tail6
  return `${head}…${id.slice(-6)}`;
}

export interface RmqMetricsSnapshot {
  depth: number;
  partial: number;
  full: number;
  deferred: number;
  connected: boolean;
  queueMode: boolean;
  peekIds: string[];
}

function sumMetric(metrics: Record<string, Array<{ labels: Record<string, string>; value: number }>> | undefined, key: string): number {
  const arr = metrics?.[key];
  if (!arr) return 0;
  return arr.reduce((a, v) => a + Number(v.value), 0);
}

function findMetric(metrics: Record<string, Array<{ labels: Record<string, string>; value: number }>> | undefined, key: string, labels: Record<string, string>): number | undefined {
  const arr = metrics?.[key];
  if (!arr) return undefined;
  const found = arr.find((v) => Object.entries(labels).every(([k, val]) => String(v.labels[k]) === String(val)));
  return found ? Number(found.value) : undefined;
}

export function toRmqSnapshot(metrics?: Record<string, Array<{ labels: Record<string, string>; value: number }>>): RmqMetricsSnapshot {
  if (!metrics) return { depth: 0, partial: 0, full: 0, deferred: 0, connected: false, queueMode: true, peekIds: [] };
  const depth = findMetric(metrics, 'rmqPendingDepth', { queue: 'total' }) ?? sumMetric(metrics, 'rmqPendingDepth');
  const partial = sumMetric(metrics, 'rmqPendingPartial');
  const full = sumMetric(metrics, 'rmqPendingFull');
  const deferred = sumMetric(metrics, 'rmqDeferredCount');
  const connected = (sumMetric(metrics, 'rmqConnected') ?? 0) > 0;
  const queueMode = (sumMetric(metrics, 'rmqQueueMode') ?? 1) > 0;
  const peekIds = (metrics?.rmqPendingIds ?? [])
    .map((v) => String(v.labels.id))
    .slice(0, 5);
  return { depth, partial, full, deferred, connected, queueMode, peekIds };
}

export function renderRmqConsumerPaneFromMetrics(
  metrics: Record<string, Array<{ labels: Record<string, string>; value: number }>> | undefined,
  width = 96
): string {
  const snap = toRmqSnapshot(metrics);
  return renderRmqConsumerPane(snap, width);
}

export function renderRmqConsumerPane(snapshot: RmqMetricsSnapshot, width = 96): string {
  const inner = Math.max(10, width - 2);
  const lines: string[] = [];
  const border = '─'.repeat(inner);

  lines.push(`┌${border}┐`);

  // Line1 full labels
  const line1 = ` Q:${snapshot.depth} P:${snapshot.partial} F:${snapshot.full} D:${snapshot.deferred} · tui.jobs.s1/s2/s2d/s3s4 · ${snapshot.connected ? '🟢' : '🔴'} pref 5/5/1/5 queue:${snapshot.queueMode ? 'ON' : 'OFF'}`;
  lines.push(`│${truncateMid(line1, inner).padEnd(inner)}│`);

  // Line2 cur — first peekId 19ee…job-N
  let curLine = ' cur: —';
  if (snapshot.peekIds.length > 0) {
    const first = snapshot.peekIds[0];
    const stageLabel = snapshot.full > 0 && snapshot.partial === 0 ? 'FULL' : snapshot.partial > 0 && snapshot.full === 0 ? 'PARTIAL' : snapshot.depth > 0 ? 'mixed' : '';
    curLine = stageLabel ? ` cur: ${first} ${stageLabel}` : ` cur: ${first}`;
  }
  lines.push(`│${truncateMid(curLine, inner).padEnd(inner)}│`);

  // Line3 pend: 5× midTruncate 19ee…job-N +N more on 96 cols
  let pendLine = ' pend: ';
  if (snapshot.depth === 0) pendLine += '—';
  else if (snapshot.peekIds.length > 0) {
    const shown = snapshot.peekIds.slice(0, 5).join(' ');
    pendLine += shown;
    if (snapshot.depth > snapshot.peekIds.length) pendLine += ` +${snapshot.depth - snapshot.peekIds.length} more`;
  } else pendLine += `${snapshot.depth} pending (P:${snapshot.partial} F:${snapshot.full})`;
  lines.push(`│${truncateMid(pendLine, inner).padEnd(inner)}│`);

  // Line4 def
  let defLine = ' def: ';
  if (snapshot.deferred === 0) defLine += '—';
  else defLine += `${snapshot.deferred} deferred TTL 30s`;
  lines.push(`│${truncateMid(defLine, inner).padEnd(inner)}│`);

  lines.push(`└${border}┘`);
  return lines.join('\n');
}

function truncateMid(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 3) + '...';
}
