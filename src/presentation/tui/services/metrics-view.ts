type Labeled = Array<{ labels: Record<string, string>; value: number }>;

export function toCamel(s: string): string {
  return s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

export function sumMetric(metrics: Record<string, Labeled> | undefined, key: string): number {
  const arr = metrics?.[key];
  if (!arr) return 0;
  return arr.reduce((a, v) => a + Number(v.value), 0);
}

export function findMetric(
  metrics: Record<string, Labeled> | undefined,
  key: string,
  labels: Record<string, string>,
): number | undefined {
  const arr = metrics?.[key];
  if (!arr) return undefined;
  const found = arr.find((v) => Object.entries(labels).every(([k, val]) => String(v.labels[k]) === String(val)));
  return found ? Number(found.value) : undefined;
}

export function getMetrics(data: {
  metrics?: Record<string, Labeled>;
  [key: string]: unknown;
}): Record<string, Labeled> {
  if (data.metrics && typeof data.metrics === 'object') return data.metrics as Record<string, Labeled>;
  const legacy = data as Record<string, unknown>;
  const metrics: Record<string, Labeled> = {};
  for (const [k, v] of Object.entries(legacy)) {
    if (typeof v === 'number') metrics[k] = [{ labels: {}, value: v }];
  }
  return metrics;
}

export function avgDuration(metrics: Record<string, Labeled> | undefined, stage: string): number | undefined {
  // jobStageDurationSeconds: Histogram → values include {labels:{stage,le},value} plus sum/count with le-less? prom-client uses _sum/_count as separate? For getMetricsAsJSON, histogram yields entries with labels le and sum/count as aggregate values with special keys.
  // We handle via sumMetric on _sum / _count synthetic keys if present, fallback by scanning labels.le.
  const sum = findMetric(metrics, 'jobStageDurationSecondsSum', { stage }) ?? sumMetric(metrics, 'jobStageDurationSecondsSum');
  const count = findMetric(metrics, 'jobStageDurationSecondsCount', { stage }) ?? sumMetric(metrics, 'jobStageDurationSecondsCount');
  if (sum !== undefined && count !== undefined && count > 0) return sum / count;
  // fallback scan values where key jobStageDurationSeconds and labels stage match, look for le= sum/count via _sum/_count naming with toCamel already
  const s = findMetric(metrics, 'jobStageDurationSeconds', { stage });
  if (s !== undefined) return s;
  return undefined;
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 3) + '...';
}

export function truncateMid(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 3) + '...';
}
