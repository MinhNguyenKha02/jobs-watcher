import {
  sumMetric,
  sumMetricWhere,
  findMetric,
  getMetrics,
  avgDuration,
  truncate,
} from '../services/metrics-view.js';

export interface ObserveSnapshot {
  metrics?: Record<string, Array<{ labels: Record<string, string>; value: number }>>;
  containers?: unknown;
  health?: unknown;
  /** Best-effort TUI-port (9091) metrics joined by the poller for pub-vs-consumed balance. */
  tuiMetrics?: Record<string, Array<{ labels: Record<string, string>; value: number }>>;
  [key: string]: unknown;
}

// Scheduler worker pool size mirrors ExtractionScheduler WORKER_COUNT (single-process daemon).
const EXTRACTION_WORKERS = 3;
// Operator bounds: flag, never hide. Extr budget covers challenge-wait (15s) + proc + jitter.
const DUR_SLOW_S = 60;
const EXTR_SLOW_S = 25;

function renderTitle(width: number, port: number): string {
  const inner = Math.max(10, width - 2);
  const title = ` daemon ${port} `;
  const left = Math.floor((inner - title.length) / 2);
  const right = inner - title.length - left;
  return `┌${'─'.repeat(left)}${title}${'─'.repeat(right)}┐`;
}
void renderTitle;

function renderErrorFrame(width: number, port: number, msg: string): string {
  const inner = Math.max(10, width - 2);
  const lines: string[] = [];
  lines.push(renderTitle(width, port));
  lines.push(`│${truncate(` ERR ${msg}`, inner).padEnd(inner)}│`);
  lines.push(`└${'─'.repeat(inner)}┘`);
  return lines.join('\n');
}

export function renderObserveCompactPane(data: ObserveSnapshot, width = 64): string {
  // wrong-port guard: if data contains tui keys but not daemon expected keys, signal
  const inner = Math.max(10, width - 2);
  const border = '─'.repeat(inner);
  // border title is rendered by poller if width known; pane itself uses generic border for tests
  const metrics = getMetrics(data);
  const hasWrong = metrics.rmqPendingDepth !== undefined && metrics.jobsBrokeredTotal === undefined;
  if (hasWrong) {
    const lines: string[] = [];
    lines.push(`┌${border}┐`);
    lines.push(`│${truncate(' WRONG PORT expected daemon 9090 got tui 9091', inner).padEnd(inner)}│`);
    lines.push(`└${border}┘`);
    return lines.join('\n');
  }

  const lines: string[] = [];
  lines.push(`┌${border}┐`);

  // L1: s3 resolutions by origin source (doc source at resolution) + tier-filter rejects.
  const qa =
    findMetric(metrics, 'jobStageTotal', { stage: 's3', status: 'queued', source: 'browser-auto' }) ?? 0;
  const qm =
    findMetric(metrics, 'jobStageTotal', { stage: 's3', status: 'queued', source: 'manual' }) ?? 0;
  const ta =
    findMetric(metrics, 'jobStageTotal', { stage: 's3', status: 'trashed', source: 'browser-auto' }) ?? 0;
  const tm =
    findMetric(metrics, 'jobStageTotal', { stage: 's3', status: 'trashed', source: 'manual' }) ?? 0;
  const flt = (source: string, stage: string): number =>
    findMetric(metrics, 'jobFilterRejectTotal', { source, stage }) ?? 0;
  // Path stage/phase inflight (independent of flt, inc/dec at transitions).
  // PC runs at 60% width so all 4 groups fit; narrow widths truncate the tail gracefully.
  const inGrp = (source: string, phase: string): number =>
    sumMetricWhere(metrics, 'jobsInFlight', { source, phase });
  // flt labels compact (flt[a1] = auto/s1) to hold the 64-col pane without truncation.
  const line1 = ` q[a]:${qa} q[m]:${qm} t[a]:${ta} t[m]:${tm} flt[a1]:${flt('browser-auto', 's1')} flt[a2]:${flt('browser-auto', 's2')} flt[m2]:${flt('manual', 's2')} in[a1e]:${inGrp('browser-auto', 'enriching')} in[a2e]:${inGrp('browser-auto', 'enriched')} in[m1e]:${inGrp('manual', 'enriching')} in[m2e]:${inGrp('manual', 'enriched')}`;
  lines.push(`│${truncate(line1, inner).padEnd(inner)}│`);

  // L2: merged process + infra (component names kept verbatim; truncate, full names in JSON).
  const mem = findMetric(metrics, 'systemMemoryBytes', { type: 'rss' }) ?? sumMetric(metrics, 'systemMemoryBytes');
  const heap = findMetric(metrics, 'systemMemoryBytes', { type: 'heapUsed' });
  const cpu = findMetric(metrics, 'systemCpuPercent', {}) ?? (metrics.systemCpuPercent?.[0]?.value as number | undefined);
  const lag = findMetric(metrics, 'eventLoopLagSeconds', {}) ?? (metrics.eventLoopLagSeconds?.[0]?.value as number | undefined) ?? 0;
  const memMb = mem ? `${Math.round(Number(mem) / 1024 / 1024)}M` : '—';
  const heapMb = heap ? ` heap ${Math.round(Number(heap) / 1024 / 1024)}M` : '';
  const cpuStr = cpu !== undefined ? `${Number(cpu).toFixed(1)}` : '—';
  const lagStr = lag ? `${Number(lag).toFixed(3)}s` : '—';
  const infra = (component: string): string => {
    const v = findMetric(metrics, 'infraReady', { component });
    return v !== undefined ? `${v ? '1' : '0'}` : '—';
  };
  const line2 = ` mem ${memMb}${heapMb} cpu ${cpuStr}% lag ${lagStr} | mongo:${infra('mongo')} rmq:${infra('rabbitmq')} bro:${infra('browser')} uds:${infra('uds')} web:${infra('webhook')} sch:${infra('scheduler')}`;
  lines.push(`│${truncate(line2, inner).padEnd(inner)}│`);

  // L3: errors grouped by canonical stage + total (per-type detail stays in observability JSON).
  const errStage = (stage: string): number => sumMetricWhere(metrics, 'jobErrorsTotal', { stage });
  const e1 = errStage('s1');
  const e2 = errStage('s2');
  const e3 = errStage('s3');
  const ee = errStage('extraction');
  const er = errStage('resolution');
  const etot = sumMetric(metrics, 'jobErrorsTotal');
  const line3 = ` error[s1:${e1} s2:${e2} s3:${e3} ext:${ee} res:${er} tot:${etot}]`;
  lines.push(`│${truncate(line3, inner).padEnd(inner)}│`);

  // L4: extraction backlog + worker saturation (busy derived, idle clamped; pool size const above).
  const enq = sumMetric(metrics, 'extractionQueueEnqueueTotal');
  const deq = sumMetric(metrics, 'extractionQueueDequeueTotal');
  const depth = findMetric(metrics, 'extractionQueueDepth', {}) ?? enq - deq;
  const depthStr = depth ? `${depth}` : '0';
  const flight = sumMetricWhere(metrics, 'jobsInFlight', {
    stage: 's1',
    source: 'browser-auto',
    phase: 'enriching',
  });
  const busy = Math.max(0, Math.min(EXTRACTION_WORKERS, flight));
  const idle = EXTRACTION_WORKERS - busy;
  // Extraction scope only (s1/auto/enriching): worker saturation signal.
  // Enriched-awaiting-resolution groups stay in JSON, not on this 64-col line.
  const line4 = ` extr_q depth:${depthStr} inflight:${flight} idle:${idle}`;
  lines.push(`│${truncate(line4, inner).padEnd(inner)}│`);

  // L5: stage durations, always shown, red-flagged over bound (never hidden).
  const dS1S2 = avgDuration(metrics, 's1_s2') ?? avgDuration(metrics, 's1-s2');
  const dS2S3 = avgDuration(metrics, 's2_s3') ?? avgDuration(metrics, 's2-s3');
  const dExtr = avgDuration(metrics, 'extraction');
  const flag = (v: number | undefined, bound: number): string =>
    v === undefined ? '—' : `${v.toFixed(2)}s${v > bound ? '🔴' : ''}`;
  const line5 = ` dur s1_s2 ${flag(dS1S2, DUR_SLOW_S)} s2_s3 ${flag(dS2S3, DUR_SLOW_S)} extr ${flag(dExtr, EXTR_SLOW_S)}`;
  lines.push(`│${truncate(line5, inner).padEnd(inner)}│`);

  // L6: publisher-vs-held balance (no ack series: broker forgets acks, so an
  // in-mem ack counter resets on TUI restart while daemon pubs persist).
  // Δ[q] = pubs[q] − ready[q] − unack[q] rebuilds identically after restart
  // (redelivery restores unack, checkQueue restores ready). Fanout note: one
  // pc publish lands in BOTH s2 and s2direct, but the two lifecycles differ:
  // s2 is held-until-s34 (tag kept, ack deferred to s34 drain), while s2direct
  // in queue-mode is an immediate nack(drop) and never enters held (prefetch 1,
  // no pending accumulation); direct-mode mirrors this. The inactive branch is
  // therefore measured against 0 pubs, not pc (else a permanent +pc bias).
  // Polls stay 1s (daemon+tui); ready refresh stays 5s (stale-ready flicker only).
  const g = findMetric(metrics, 'rmqPublishedTotal', { routingKey: 'job.generated' }) ?? 0;
  const pc = findMetric(metrics, 'rmqPublishedTotal', { routingKey: 'job.parse.completed' }) ?? 0;
  const pf = findMetric(metrics, 'rmqPublishedTotal', { routingKey: 'job.parse.failed' }) ?? 0;
  const q = findMetric(metrics, 'rmqPublishedTotal', { routingKey: 'job.queue' }) ?? 0;
  const t = findMetric(metrics, 'rmqPublishedTotal', { routingKey: 'job.trash' }) ?? 0;
  const rf = findMetric(metrics, 'rmqPublishedTotal', { routingKey: 'job.route.failed' }) ?? 0;
  const tui = data.tuiMetrics;
  let line6: string;
  if (tui) {
    const held = (queue: string): number =>
      sumMetricWhere(tui, 'rmqReady', { queue }) + sumMetricWhere(tui, 'rmqUnack', { queue });
    const d = (pub: number, queue: string): string => {
      const v = pub - held(queue);
      return `${v > 0 ? '+' : ''}${v}`;
    };
    const d34v = pf + q + t + rf - held('tui.s3s4');
    const d34 = `${d34v > 0 ? '+' : ''}${d34v}`;
    const qmode = findMetric(tui, 'infraReady', { component: 'queue_mode' });
    let s2pub = pc;
    let s2dpub = pc;
    if (qmode !== undefined) {
      if (qmode > 0) {
        s2dpub = 0;
      } else {
        s2pub = 0;
      }
    }
    line6 = ` pub s1:${d(g, 'tui.s1')} s2:${d(s2pub, 'tui.s2')} s2d:${d(s2dpub, 'tui.s2direct')} s3s4:${d34} (g:${g} pc:${pc} pf:${pf} q:${q} t:${t} rf:${rf})`;
  } else {
    line6 = ` pub s1:— s2:— s2d:— s3s4:— (g:${g} pc:${pc} pf:${pf} q:${q} t:${t} rf:${rf})`;
  }
  lines.push(`│${truncate(line6, inner).padEnd(inner)}│`);

  lines.push(`└${border}┘`);
  return lines.join('\n');
}

export function renderObserveCompactPaneWithTitle(
  data: ObserveSnapshot,
  width = 64,
  port = 9090,
): string {
  const inner = Math.max(10, width - 2);
  const frame = renderObserveCompactPane(data, width);
  const framedLines = frame.split('\n');
  // replace first border with title
  framedLines[0] = renderTitle(width, port);
  void inner;
  return framedLines.join('\n');
}

export function renderObserveErrorFrame(width = 64, port = 9090, msg: string): string {
  return renderErrorFrame(width, port, msg);
}
