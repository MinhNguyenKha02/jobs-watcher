import type { DaemonMetricsRegistry, TuiMetricsRegistry } from '../../src/infrastructure/outbound/monitoring/metrics-registry.js';

type Labeled = Array<{ labels: Record<string, string>; value: number }>;

function toCamel(s: string): string {
  return s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

async function getMetricsMap(registry: DaemonMetricsRegistry | TuiMetricsRegistry): Promise<Record<string, Labeled>> {
  const json = (await (registry as any).register.getMetricsAsJSON()) as Array<{
    name: string;
    values: Array<{ labels: Record<string, string>; value: number }>;
  }>;
  const map: Record<string, Labeled> = {};
  for (const m of json) {
    const camelName = toCamel(m.name);
    const labeled = m.values
      .filter((v) => typeof v.value === 'number' && !Number.isNaN(v.value))
      .map((v) => {
        const labels: Record<string, string> = {};
        for (const [k, val] of Object.entries(v.labels || {})) {
          labels[toCamel(k)] = String(val);
        }
        return { labels, value: Number(v.value) };
      });
    map[camelName] = labeled;
  }
  return map;
}

export async function getDaemonMetrics(registry: DaemonMetricsRegistry): Promise<Record<string, Labeled>> {
  return getMetricsMap(registry);
}

export async function getTuiMetrics(registry: TuiMetricsRegistry): Promise<Record<string, Labeled>> {
  return getMetricsMap(registry);
}

export function findMetric(metrics: Record<string, Labeled> | undefined, key: string, labels: Record<string, string>): number | undefined {
  const arr = metrics?.[key];
  if (!arr) return undefined;
  const found = arr.find((v) => Object.entries(labels).every(([k, val]) => String(v.labels[k]) === String(val)));
  return found ? Number(found.value) : undefined;
}

export function sumMetric(metrics: Record<string, Labeled> | undefined, key: string): number {
  const arr = metrics?.[key];
  if (!arr) return 0;
  return arr.reduce((a, v) => a + Number(v.value), 0);
}

// daemon asserts
export async function assertJobsBrokered(registry: DaemonMetricsRegistry, source: string, min = 1): Promise<void> {
  const m = await getDaemonMetrics(registry);
  const v = findMetric(m, 'jobsBrokeredTotal', { source }) ?? 0;
  if (v < min) throw new Error(`jobsBrokeredTotal{source=${source}} ${v} < ${min} — metrics ${JSON.stringify(m.jobsBrokeredTotal)}`);
}

export async function assertJobStageTotal(registry: DaemonMetricsRegistry, labels: { stage: string; status: string }, min = 1): Promise<void> {
  const m = await getDaemonMetrics(registry);
  const v = findMetric(m, 'jobStageTotal', labels) ?? 0;
  if (v < min) throw new Error(`jobStageTotal{stage=${labels.stage},status=${labels.status}} ${v} < ${min}`);
}

export async function assertJobErrors(registry: DaemonMetricsRegistry, labels: { stage: string; errorType: string }, min = 1): Promise<void> {
  const m = await getDaemonMetrics(registry);
  const v = findMetric(m, 'jobErrorsTotal', labels) ?? 0;
  if (v < min) throw new Error(`jobErrorsTotal{stage=${labels.stage},errorType=${labels.errorType}} ${v} < ${min}`);
}

export async function assertRmqPublished(registry: DaemonMetricsRegistry, routingKey: string, min = 1): Promise<void> {
  const m = await getDaemonMetrics(registry);
  const v = findMetric(m, 'rmqPublishedTotal', { routingKey }) ?? 0;
  if (v < min) throw new Error(`rmqPublishedTotal{routingKey=${routingKey}} ${v} < ${min}`);
}

export async function assertExtractionEnqueue(registry: DaemonMetricsRegistry, min = 1): Promise<void> {
  const m = await getDaemonMetrics(registry);
  const v = sumMetric(m, 'extractionQueueEnqueueTotal');
  if (v < min) throw new Error(`extractionQueueEnqueueTotal ${v} < ${min}`);
}

// tui asserts (registry-driven)
export async function assertRmqPending(registry: TuiMetricsRegistry, queue: string, expected: number): Promise<void> {
  const m = await getTuiMetrics(registry);
  const v = findMetric(m, 'rmqPendingDepth', { queue }) ?? findMetric(m, 'rmqPendingDepth', { queue: 'total' }) ?? 0;
  if (v !== expected) throw new Error(`rmqPendingDepth{queue=${queue}} ${v} !== ${expected}`);
}

export async function assertRmqPartial(registry: TuiMetricsRegistry, expected: number): Promise<void> {
  const m = await getTuiMetrics(registry);
  const v = sumMetric(m, 'rmqPendingPartial');
  if (v !== expected) throw new Error(`rmqPendingPartial ${v} !== ${expected}`);
}

export async function assertRmqDeferred(registry: TuiMetricsRegistry, expected: number): Promise<void> {
  const m = await getTuiMetrics(registry);
  const v = sumMetric(m, 'rmqDeferredCount');
  if (v !== expected) throw new Error(`rmqDeferredCount ${v} !== ${expected}`);
}

export async function assertRmqConnected(registry: TuiMetricsRegistry, expected: 0 | 1): Promise<void> {
  const m = await getTuiMetrics(registry);
  const v = sumMetric(m, 'rmqConnected');
  if (v !== expected) throw new Error(`rmqConnected ${v} !== ${expected}`);
}

export async function assertRmqQueueMode(registry: TuiMetricsRegistry, expected: 0 | 1): Promise<void> {
  const m = await getTuiMetrics(registry);
  const v = sumMetric(m, 'rmqQueueMode');
  if (v !== expected) throw new Error(`rmqQueueMode ${v} !== ${expected}`);
}
