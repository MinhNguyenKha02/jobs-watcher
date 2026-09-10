import {
  sumMetric,
  findMetric,
  getMetrics,
  avgDuration,
  truncate,
} from '../services/metrics-view.js';

export interface ObserveSnapshot {
  metrics?: Record<string, Array<{ labels: Record<string, string>; value: number }>>;
  containers?: unknown;
  health?: unknown;
  [key: string]: unknown;
}

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

  const brokered = sumMetric(metrics, 'jobsBrokeredTotal');
  const stage = sumMetric(metrics, 'jobStageTotal');
  const errors = sumMetric(metrics, 'jobErrorsTotal');
  const flight = sumMetric(metrics, 'jobsInFlight');
  const line1 = ` jobs_brokered:${brokered} stage:${stage} err:${errors} flight:${flight}`;
  lines.push(`│${truncate(line1, inner).padEnd(inner)}│`);

  const mem = findMetric(metrics, 'systemMemoryBytes', { type: 'rss' }) ?? sumMetric(metrics, 'systemMemoryBytes');
  const heap = findMetric(metrics, 'systemMemoryBytes', { type: 'heapUsed' });
  const cpu = findMetric(metrics, 'systemCpuPercent', {}) ?? (metrics.systemCpuPercent?.[0]?.value as number | undefined);
  const lag = findMetric(metrics, 'eventLoopLagSeconds', {}) ?? (metrics.eventLoopLagSeconds?.[0]?.value as number | undefined) ?? 0;
  const memMb = mem ? `${Math.round(Number(mem) / 1024 / 1024)}M` : '—';
  const heapMb = heap ? ` heap ${Math.round(Number(heap) / 1024 / 1024)}M` : '';
  const cpuStr = cpu !== undefined ? `${Number(cpu).toFixed(1)}` : '—';
  const lagStr = lag ? `${Number(lag).toFixed(3)}s` : '—';
  const line2 = ` mem ${memMb}${heapMb} cpu ${cpuStr}% lag ${lagStr}`;
  lines.push(`│${truncate(line2, inner).padEnd(inner)}│`);

  const infra = (component: string): string => {
    const v = findMetric(metrics, 'infraReady', { component });
    return v !== undefined ? `${v ? '1' : '0'}` : '—';
  };
  const line3 = ` infra mongo:${infra('mongo')} rmq:${infra('rabbitmq')} browser:${infra('browser')} uds:${infra('uds')} webhook:${infra('webhook')} sched:${infra('scheduler')}`;
  lines.push(`│${truncate(line3, inner).padEnd(inner)}│`);

  const enq = sumMetric(metrics, 'extractionQueueEnqueueTotal');
  const deq = sumMetric(metrics, 'extractionQueueDequeueTotal');
  const depth = findMetric(metrics, 'extractionQueueDepth', {}) ?? enq - deq;
  const depthStr = depth ? `${depth}` : '0';
  const pub = sumMetric(metrics, 'rmqPublishedTotal');
  const line4 = ` extr_q depth:${depthStr} enq:${enq} deq:${deq} pub:${pub}`;
  lines.push(`│${truncate(line4, inner).padEnd(inner)}│`);

  const dS1S2 = avgDuration(metrics, 's1_s2') ?? avgDuration(metrics, 's1-s2');
  const dS2S3 = avgDuration(metrics, 's2_s3') ?? avgDuration(metrics, 's2-s3');
  const dExtr = avgDuration(metrics, 'extraction');
  const parts: string[] = [];
  if (dS1S2 !== undefined) parts.push(`s1_s2 ${dS1S2.toFixed(2)}s`);
  if (dS2S3 !== undefined) parts.push(`s2_s3 ${dS2S3.toFixed(2)}s`);
  if (dExtr !== undefined) parts.push(`extr ${dExtr.toFixed(2)}s`);
  const line5 = parts.length ? ` dur ${parts.join(' ')}` : ' dur —';
  lines.push(`│${truncate(line5, inner).padEnd(inner)}│`);

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
