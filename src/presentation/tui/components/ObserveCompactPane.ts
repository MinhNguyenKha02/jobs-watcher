/**
 * ObserveCompactPane — 4-line compact PD pane (40% w, `h12`).
 * Compact readability from `/health/observability` JSON (camelCase labeled map).
 */

export interface ObserveSnapshot {
  metrics?: Record<string, Array<{ labels: Record<string, string>; value: number }>>;
  containers?: unknown;
  health?: unknown;
  [key: string]: unknown;
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

function getMetrics(data: ObserveSnapshot): Record<string, Array<{ labels: Record<string, string>; value: number }>> {
  if (data.metrics && typeof data.metrics === 'object') return data.metrics as Record<string, Array<{ labels: Record<string, string>; value: number }>>;
  // legacy flat shape fallback (treat data itself as flat map) — convert to metrics-like
  const legacy = data as Record<string, unknown>;
  const metrics: Record<string, Array<{ labels: Record<string, string>; value: number }>> = {};
  for (const [k, v] of Object.entries(legacy)) {
    if (typeof v === 'number') metrics[k] = [{ labels: {}, value: v }];
  }
  return metrics;
}

export function renderObserveCompactPane(data: ObserveSnapshot, width = 64): string {
  const inner = Math.max(10, width - 2);
  const border = '─'.repeat(inner);
  const lines: string[] = [];
  lines.push(`┌${border}┐`);

  const metrics = getMetrics(data);
  const brokered = sumMetric(metrics, 'jobsBrokeredTotal');
  const stage = sumMetric(metrics, 'jobStageTotal');
  const errors = sumMetric(metrics, 'jobErrorsTotal');
  const flight = sumMetric(metrics, 'jobsInFlight');
  const line1 = ` jobs_brokered:${brokered} stage:${stage} err:${errors} flight:${flight}`;
  lines.push(`│${truncate(line1, inner).padEnd(inner)}│`);

  const mem = findMetric(metrics, 'systemMemoryBytes', { type: 'rss' }) ?? sumMetric(metrics, 'systemMemoryBytes');
  const cpu = findMetric(metrics, 'systemCpuPercent', {}) ?? (metrics.systemCpuPercent?.[0]?.value as number | undefined);
  const lag = findMetric(metrics, 'eventLoopLagSeconds', {}) ?? (metrics.eventLoopLagSeconds?.[0]?.value as number | undefined) ?? 0;
  const memMb = mem ? `${Math.round(Number(mem) / 1024 / 1024)}M` : '—';
  const cpuStr = cpu !== undefined ? `${Number(cpu).toFixed(1)}` : '—';
  const lagStr = lag ? `${Number(lag).toFixed(3)}s` : '—';
  const line2 = ` mem ${memMb} cpu ${cpuStr}% lag ${lagStr}`;
  lines.push(`│${truncate(line2, inner).padEnd(inner)}│`);

  const totalKeys = Object.keys(metrics).length;
  const line3 = ` health ok ready /metrics ${totalKeys} keys`;
  lines.push(`│${truncate(line3, inner).padEnd(inner)}│`);

  const line4 = ` poll 5s full JSON → PD compact`;
  lines.push(`│${truncate(line4, inner).padEnd(inner)}│`);

  lines.push(`└${border}┘`);
  return lines.join('\n');
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 3) + '...';
}
