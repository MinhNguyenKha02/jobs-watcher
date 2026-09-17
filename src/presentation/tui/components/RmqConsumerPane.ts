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
  unack?: Record<string, number>;
  ready?: Record<string, number>;
}

export function toRmqSnapshot(metrics?: Record<string, Array<{ labels: Record<string, string>; value: number }>>): RmqMetricsSnapshot {
  if (!metrics) return { depth: 0, partial: 0, full: 0, deferred: 0, connected: false, queueMode: true, peekIds: [], curId: null, curStage: null, infra: {}, unack: {}, ready: {} };
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
  const curEntry = (metrics?.rmqCur ?? [])[0];
  const curId = curEntry ? String(curEntry.labels.id ?? '') || null : null;
  const curStage = curEntry ? String(curEntry.labels.stage ?? '') || null : null;
  // pend excludes cur: the displayed job is normally already shifted out of
  // pending by autoAdvance, but an s1 redelivery (nack requeue / duplicate
  // publish) can re-push its id while it is still on screen — the s1 dedup
  // guard (RabbitMqJobReader) covers the pending list only, not the
  // displayed id. Filtering here keeps `shown + N = depth` reconciled.
  // FUTURE: optionally extend that guard with `id !== currentJobId`; that is
  // consumer-logic behavior change (ack/tag implications), parked out of scope.
  // (rmqPendingIds stores trunc11 ids while rmqCur now stores the full id,
  // so compare trunc11 forms at this seam.)
  const curHead = curId ? midTruncateId(curId) : null;
  const peekIds = (metrics?.rmqPendingIds ?? [])
    .map((v) => String(v.labels.id))
    .filter((id) => (curHead ? id !== curHead : true))
    .slice(0, 5);
  const unack: Record<string, number> = {};
  for (const v of metrics.rmqUnack ?? []) {
    const q = String(v.labels.queue ?? '');
    if (!q) continue;
    unack[q] = (unack[q] ?? 0) + Number(v.value);
  }
  // Broker-ready total (per-queue detail stays in 9091 JSON for the PC join).
  const ready: Record<string, number> = {};
  for (const v of metrics.rmqReady ?? []) {
    const q = String(v.labels.queue ?? '');
    if (!q) continue;
    ready[q] = (ready[q] ?? 0) + Number(v.value);
  }
  return { depth, partial, full, deferred, connected, queueMode, peekIds, curId, curStage, infra, unack, ready };
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

  const readyTot = Object.values(snapshot.ready ?? {}).reduce((a, b) => a + b, 0);
  const line1 = ` Q(tui):${snapshot.depth} P:${snapshot.partial} F:${snapshot.full} D:${snapshot.deferred} R:${readyTot}`;
  lines.push(`│${truncateMid(line1, inner).padEnd(inner)}│`);

  let curLine = ' cur: —';
  if (snapshot.curId) {
    // PA-identical fragment: `cur:<trunc13(id)> <raw stage>` (JobCardRenderer
    // header). Stage is IPC-verbatim (partial_parsed/full_parsed), never
    // normalized, so both panes agree byte-for-byte.
    const shortId = midTruncateId(snapshot.curId, 13);
    curLine = snapshot.curStage ? ` cur:${shortId} ${snapshot.curStage}` : ` cur:${shortId}`;
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

  const unack = snapshot.unack ?? {};
  const short = (q: string): string =>
    q === 'tui.s1' ? 's1' : q === 'tui.s2' ? 's2' : q === 'tui.s2direct' ? 's2d' : q === 'tui.s3s4' ? 's34' : q;
  const unackKeys = Object.keys(unack);
  let ackLine = ' unack: —';
  if (unackKeys.length) {
    const order = ['tui.s1', 'tui.s2', 'tui.s2direct', 'tui.s3s4'];
    const u = order.map((q) => `${short(q)}:${unack[q] ?? 0}`).join(' ');
    ackLine = ` unack ${u}`;
  }
  lines.push(`│${truncateMid(ackLine, inner).padEnd(inner)}│`);

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
