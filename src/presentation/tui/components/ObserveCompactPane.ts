/**
 * ObserveCompactPane — 4-line compact PD pane (40% w, `h12`).
 * Compact readability from `/health/observability` JSON.
 */

export interface ObserveSnapshot {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  jobs_brokered_total?: number;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  job_stage_total?: number;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  job_errors_total?: number;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  jobs_in_flight?: number;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  job_stage_duration_seconds?: number;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  system_memory_bytes?: number;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  system_cpu_percent?: number;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  event_loop_lag_seconds?: number;
  [key: string]: unknown;
}

export function renderObserveCompactPane(data: ObserveSnapshot, width = 64): string {
  const inner = Math.max(10, width - 2);
  const border = '─'.repeat(inner);
  const lines: string[] = [];
  lines.push(`┌${border}┐`);

  const brokered = data.jobs_brokered_total ?? 0;
  const stage = data.job_stage_total ?? 0;
  const errors = data.job_errors_total ?? 0;
  const flight = data.jobs_in_flight ?? 0;
  const line1 = ` jobs_brokered:${brokered} stage:${stage} err:${errors} flight:${flight}`;
  lines.push(`│${truncate(line1, inner).padEnd(inner)}│`);

  // memory/cpu/lag may be gauges with object shapes — fallback to raw
  const mem =
    (data.jobs_brokered_total !== undefined
      ? (data.system_memory_bytes as number | undefined)
      : undefined) ?? 0;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  const cpuRaw =
    (data.system_cpu_percent as number | undefined) ??
    (data as Record<string, unknown>).system_cpu_percent;
  const cpu = cpuRaw;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  const lag = (data.event_loop_lag_seconds as number | undefined) ?? 0;
  const memMb = mem ? `${Math.round(Number(mem) / 1024 / 1024)}M` : '—';
  const line2 = ` mem ${memMb} cpu ${cpu ?? '—'}% lag ${lag ? `${Number(lag).toFixed(3)}s` : '—'}`;
  lines.push(`│${truncate(line2, inner).padEnd(inner)}│`);

  const line3 = ` health ok ready /metrics ${Object.keys(data).length} keys`;
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
