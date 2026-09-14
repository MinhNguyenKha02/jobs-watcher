import { sumMetric, findMetric, truncateMid } from '../services/metrics-view.js';

export function midTruncateId(id: string, maxLen = 11): string {
  if (id.length <= maxLen) return id;
  const dashIdx = id.lastIndexOf('-');
  const suffix = dashIdx !== -1 ? id.slice(dashIdx) : id.slice(-6);
  const head = id.slice(0, 4);
  const candidate = `${head}…${suffix.replace(/^-/, 'job-')}`;
  if (candidate.length <= maxLen) return candidate;
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
  curId?: string | null;
  curStage?: string | null;
  infra?: Record<string, number>;
  consumed?: Record<string, number>;
}

export function toRmqSnapshot(metrics?: Record<string, Array<{ labels: Record<string, string>; value: number }>>): RmqMetricsSnapshot {
  if (!metrics) return { depth: 0, partial: 0, full: 0, deferred: 0, connected: false, queueMode: true, peekIds: [], curId: null, curStage: null, infra: {}, consumed: {} };
  // wrong-port guard: daemon metrics on tui port
  const depth = findMetric(metrics, 'rmqPendingDepth', { queue: 'total' }) ?? sumMetric(metrics, 'rmqPendingDepth');
  const partial = sumMetric(metrics, 'rmqPendingPartial');
  const full = sumMetric(metrics, 'rmqPendingFull');
  const deferred = sumMetric(metrics, 'rmqDeferredCount');
  // hard-cut: infraReady replaces rmqConnected/QueueMode
  const infraEntries = metrics.infraReady ?? [];
  const infra: Record<string, number> = {};
  for (const v of infraEntries) {
    const comp = String(v.labels.component ?? v.labels.Component ?? '');
    if (comp) infra[comp] = Number(v.value);
  }
  const connected = (infra.rmq ?? sumMetric(metrics, 'rmqConnected') ?? 0) > 0;
  const queueMode = (infra.queue_mode ?? infra['queueMode'] ?? infra.queueMode ?? sumMetric(metrics, 'rmqQueueMode') ?? 1) > 0;
  const peekIds = (metrics?.rmqPendingIds ?? []).map((v) => String(v.labels.id)).slice(0, 5);
  const curEntry = (metrics?.rmqCur ?? [])[0];
  const curId = curEntry ? String(curEntry.labels.id ?? '') || null : null;
  const curStage = curEntry ? String(curEntry.labels.stage ?? '') || null : null;
  const consumed: Record<string, number> = {};
  for (const v of metrics.rmqConsumedTotal ?? []) {
    const q = String(v.labels.queue ?? '');
    if (!q) continue;
    consumed[q] = (consumed[q] ?? 0) + Number(v.value);
  }
  return { depth, partial, full, deferred, connected, queueMode, peekIds, curId, curStage, infra, consumed };
}

export function renderRmqConsumerPaneFromMetrics(
  metrics: Record<string, Array<{ labels: Record<string, string>; value: number }>> | undefined,
  width = 96,
): string {
  // wrong-port guard
  if (metrics && metrics.jobsBrokeredTotal !== undefined && metrics.rmqPendingDepth === undefined) {
    const inner = Math.max(10, width - 2);
    const border = '─'.repeat(inner);
    return `┌${border}┐\n│${' WRONG PORT expected tui 9091 got daemon 9090'.slice(0, inner).padEnd(inner)}│\n└${border}┘`;
  }
  const snap = toRmqSnapshot(metrics);
  return renderRmqConsumerPane(snap, width);
}

export function renderRmqConsumerPane(snapshot: RmqMetricsSnapshot, width = 96): string {
  const inner = Math.max(10, width - 2);
  const lines: string[] = [];
  const border = '─'.repeat(inner);

  lines.push(`┌${border}┐`);

  const line1 = ` Q(tui):${snapshot.depth} P:${snapshot.partial} F:${snapshot.full} D:${snapshot.deferred} · s1/s2/s2d/s3s4`;
  lines.push(`│${truncateMid(line1, inner).padEnd(inner)}│`);

  let curLine = ' cur: —';
  if (snapshot.curId) {
    const stageLabel =
      snapshot.curStage === 'partial_parsed' || snapshot.curStage === 'PARTIAL'
        ? 'PARTIAL'
        : snapshot.curStage === 'full_parsed' || snapshot.curStage === 'FULL_PARSED' || snapshot.curStage === 'FULL'
          ? 'FULL'
          : snapshot.curStage
            ? String(snapshot.curStage)
            : '';
    curLine = stageLabel ? ` cur: ${snapshot.curId} ${stageLabel}` : ` cur: ${snapshot.curId}`;
  } else if (snapshot.peekIds.length > 0) {
    const first = snapshot.peekIds[0];
    const stageLabel = snapshot.full > 0 && snapshot.partial === 0 ? 'FULL' : snapshot.partial > 0 && snapshot.full === 0 ? 'PARTIAL' : snapshot.depth > 0 ? 'mixed' : '';
    curLine = stageLabel ? ` cur: ${first} ${stageLabel}` : ` cur: ${first}`;
  }
  lines.push(`│${truncateMid(curLine, inner).padEnd(inner)}│`);

  let pendLine = ' pend: ';
  if (snapshot.depth === 0) pendLine += '—';
  else if (snapshot.peekIds.length > 0) {
    const shown = snapshot.peekIds.slice(0, 5).join(' ');
    pendLine += shown;
    if (snapshot.depth > snapshot.peekIds.length) pendLine += ` +${snapshot.depth - snapshot.peekIds.length} more`;
  } else pendLine += `${snapshot.depth} pending (P:${snapshot.partial} F:${snapshot.full})`;
  lines.push(`│${truncateMid(pendLine, inner).padEnd(inner)}│`);

  let defLine = ' def: ';
  if (snapshot.deferred === 0) defLine += '—';
  else defLine += `${snapshot.deferred} deferred TTL 30s`;
  lines.push(`│${truncateMid(defLine, inner).padEnd(inner)}│`);

  const infra = snapshot.infra ?? {};
  const rmq = infra.rmq !== undefined ? infra.rmq : snapshot.connected ? 1 : 0;
  const ch = infra.rmq_channels !== undefined ? infra.rmq_channels : rmq ? 1 : 0;
  const uds = infra.uds_client ?? 0;
  const ipc = infra.ipc ?? 0;
  const qmode = infra.queue_mode ?? (snapshot.queueMode ? 1 : 0);
  const infraLine = ` infra rmq:${rmq} ch:${ch ? '4/4' : '0/4'} uds:${uds} ipc:${ipc} qmode:${qmode} ${snapshot.connected ? '🟢' : '🔴'}`;
  lines.push(`│${truncateMid(infraLine, inner).padEnd(inner)}│`);

  const consumed = snapshot.consumed ?? {};
  const consumedKeys = Object.keys(consumed);
  let consLine = ' consumed: —';
  if (consumedKeys.length) {
    const parts = consumedKeys.sort().map((k) => `${k} ${consumed[k]}`);
    const total = Object.values(consumed).reduce((a, b) => a + b, 0);
    consLine = ` consumed: ${parts.join(' ')} tot ${total}`;
  }
  lines.push(`│${truncateMid(consLine, inner).padEnd(inner)}│`);

  lines.push(`└${border}┘`);
  return lines.join('\n');
}

export function renderRmqPaneWithTitle(snapshot: RmqMetricsSnapshot, width = 96, port = 9091): string {
  const inner = Math.max(10, width - 2);
  const title = ` tui ${port} `;
  const left = Math.floor((inner - title.length) / 2);
  const right = inner - title.length - left;
  const frame = renderRmqConsumerPane(snapshot, width);
  const fl = frame.split('\n');
  fl[0] = `┌${'─'.repeat(left)}${title}${'─'.repeat(right)}┐`;
  void inner;
  return fl.join('\n');
}

export function renderRmqErrorFrame(width = 96, port = 9091, msg: string): string {
  const inner = Math.max(10, width - 2);
  const title = ` tui ${port} `;
  const left = Math.floor((inner - title.length) / 2);
  const right = inner - title.length - left;
  return `┌${'─'.repeat(left)}${title}${'─'.repeat(right)}┐\n│${truncateMid(` ERR ${msg}`, inner).padEnd(inner)}│\n└${'─'.repeat(inner)}┘`;
}
