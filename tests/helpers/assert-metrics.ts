import type { DaemonMetricsPort } from '../../src/application/ports/metrics.port.js';
import type { TuiMetricsPort } from '../../src/presentation/tui/ports/metrics.port.js';
import { toCamel as viewToCamel, sumMetric as viewSumMetric, findMetric as viewFindMetric } from '../../src/presentation/tui/services/metrics-view.js';

type Labeled = Array<{ labels: Record<string, string>; value: number }>;

function toCamel(s: string): string {
  return viewToCamel(s);
}

async function getMetricsMap(registry: DaemonMetricsPort | TuiMetricsPort): Promise<Record<string, Labeled>> {
  const r = registry as unknown as { register: { getMetricsAsJSON: () => Promise<Array<{ name: string; values: Array<{ labels: Record<string, string>; value: number }> }>> } };
  const json = (await r.register.getMetricsAsJSON()) as Array<{
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

export async function getDaemonMetrics(registry: DaemonMetricsPort): Promise<Record<string, Labeled>> {
  return getMetricsMap(registry);
}

export async function getTuiMetrics(registry: TuiMetricsPort): Promise<Record<string, Labeled>> {
  return getMetricsMap(registry);
}

export function findMetric(metrics: Record<string, Labeled> | undefined, key: string, labels: Record<string, string>): number | undefined {
  return viewFindMetric(metrics, key, labels);
}

export function sumMetric(metrics: Record<string, Labeled> | undefined, key: string): number {
  return viewSumMetric(metrics, key);
}

// daemon asserts
export async function assertJobsBrokered(registry: DaemonMetricsPort, source: string, min = 1): Promise<void> {
  const m = await getDaemonMetrics(registry);
  const v = findMetric(m, 'jobsBrokeredTotal', { source }) ?? 0;
  if (v < min) throw new Error(`jobsBrokeredTotal{source=${source}} ${v} < ${min} — metrics ${JSON.stringify(m.jobsBrokeredTotal)}`);
}

export async function assertJobStageTotal(registry: DaemonMetricsPort, labels: { stage: string; status: string }, min = 1): Promise<void> {
  const m = await getDaemonMetrics(registry);
  const v = findMetric(m, 'jobStageTotal', labels) ?? 0;
  if (v < min) throw new Error(`jobStageTotal{stage=${labels.stage},status=${labels.status}} ${v} < ${min}`);
}

export async function assertJobErrors(registry: DaemonMetricsPort, labels: { stage: string; errorType: string }, min = 1): Promise<void> {
  const m = await getDaemonMetrics(registry);
  const v = findMetric(m, 'jobErrorsTotal', labels) ?? 0;
  if (v < min) throw new Error(`jobErrorsTotal{stage=${labels.stage},errorType=${labels.errorType}} ${v} < ${min}`);
}

export async function assertRmqPublished(registry: DaemonMetricsPort, routingKey: string, min = 1): Promise<void> {
  const m = await getDaemonMetrics(registry);
  const v = findMetric(m, 'rmqPublishedTotal', { routingKey }) ?? 0;
  if (v < min) throw new Error(`rmqPublishedTotal{routingKey=${routingKey}} ${v} < ${min}`);
}

export async function assertExtractionEnqueue(registry: DaemonMetricsPort, min = 1): Promise<void> {
  const m = await getDaemonMetrics(registry);
  const v = sumMetric(m, 'extractionQueueEnqueueTotal');
  if (v < min) throw new Error(`extractionQueueEnqueueTotal ${v} < ${min}`);
}

export async function assertExtractionDequeue(registry: DaemonMetricsPort, min = 1): Promise<void> {
  const m = await getDaemonMetrics(registry);
  const v = sumMetric(m, 'extractionQueueDequeueTotal');
  if (v < min) throw new Error(`extractionQueueDequeueTotal ${v} < ${min}`);
}

export async function assertExtractionQueueDepth(registry: DaemonMetricsPort, expected: number): Promise<void> {
  const m = await getDaemonMetrics(registry);
  const v = findMetric(m, 'extractionQueueDepth', {}) ?? sumMetric(m, 'extractionQueueDepth');
  if (v !== expected) throw new Error(`extractionQueueDepth ${v} !== ${expected}`);
}

export async function assertInfraReady(registry: DaemonMetricsPort | TuiMetricsPort, component: string, expected: 0 | 1): Promise<void> {
  const m = await getMetricsMap(registry);
  const v = findMetric(m, 'infraReady', { component }) ?? 0;
  if (v !== expected) throw new Error(`infraReady{component=${component}} ${v} !== ${expected} — ${JSON.stringify(m.infraReady)}`);
}

export async function assertRmqReady(registry: TuiMetricsPort, queue: string, expected: number): Promise<void> {
  const m = await getTuiMetrics(registry);
  const v = findMetric(m, 'rmqReady', { queue }) ?? 0;
  if (v !== expected) throw new Error(`rmqReady{queue=${queue}} ${v} !== ${expected}`);
}

export async function assertRmqPendingIds(registry: TuiMetricsPort, expectedCount: number): Promise<void> {
  const m = await getTuiMetrics(registry);
  const ids = m.rmqPendingIds ?? [];
  if (ids.length !== expectedCount) throw new Error(`rmqPendingIds count ${ids.length} !== ${expectedCount}`);
}

// tui asserts (registry-driven)
export async function assertRmqPending(registry: TuiMetricsPort, queue: string, expected: number): Promise<void> {
  const m = await getTuiMetrics(registry);
  const v = findMetric(m, 'rmqPendingDepth', { queue }) ?? findMetric(m, 'rmqPendingDepth', { queue: 'total' }) ?? 0;
  if (v !== expected) throw new Error(`rmqPendingDepth{queue=${queue}} ${v} !== ${expected}`);
}

export async function assertRmqPartial(registry: TuiMetricsPort, expected: number): Promise<void> {
  const m = await getTuiMetrics(registry);
  const v = sumMetric(m, 'rmqPendingPartial');
  if (v !== expected) throw new Error(`rmqPendingPartial ${v} !== ${expected}`);
}

export async function assertRmqDeferred(registry: TuiMetricsPort, expected: number): Promise<void> {
  const m = await getTuiMetrics(registry);
  const v = sumMetric(m, 'rmqDeferredCount');
  if (v !== expected) throw new Error(`rmqDeferredCount ${v} !== ${expected}`);
}

export async function assertRmqConnected(registry: TuiMetricsPort, expected: 0 | 1): Promise<void> {
  const m = await getTuiMetrics(registry);
  const v = findMetric(m, 'infraReady', { component: 'rmq' }) ?? 0;
  if (v !== expected) throw new Error(`infraReady{component=rmq} ${v} !== ${expected}`);
}

export async function assertRmqQueueMode(registry: TuiMetricsPort, expected: 0 | 1): Promise<void> {
  const m = await getTuiMetrics(registry);
  const v = findMetric(m, 'infraReady', { component: 'queue_mode' }) ?? 0;
  if (v !== expected) throw new Error(`infraReady{component=queue_mode} ${v} !== ${expected}`);
}
