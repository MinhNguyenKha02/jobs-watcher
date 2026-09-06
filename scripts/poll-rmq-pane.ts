#!/usr/bin/env tsx
/**
 * PC poll — 1s RMQ consumer pane (60% w, `h12` 4-line) via TUI health observability.
 * tmux P3: `npx tsx scripts/poll-rmq-pane.ts --width 96`
 * Reads TuiMetricsRegistry via TUI health port (9091) — registry reader, not direct getPendingSnapshot.
 */

import { renderRmqConsumerPaneFromMetrics } from '../src/presentation/tui/components/RmqConsumerPane.js';

const width =
  Number(
    process.argv.find((a) => a === '--width')
      ? process.argv[process.argv.indexOf('--width') + 1]
      : 96
  ) || 96;

const TUI_URL = process.env.TUI_OBSERVABILITY_URL || process.env.TUI_HEALTH_URL || 'http://localhost:9091/health/observability';

function clear(): void {
  process.stdout.write('\x1b[2J\x1b[H');
}

async function poll(): Promise<void> {
  try {
    const res = await fetch(TUI_URL);
    if (!res.ok) {
      clear();
      process.stdout.write(`HTTP ${res.status}\n`);
      return;
    }
    const data = (await res.json()) as { metrics?: Record<string, Array<{ labels: Record<string, string>; value: number }>> };
    const metrics = data.metrics;
    clear();
    process.stdout.write(renderRmqConsumerPaneFromMetrics(metrics, width) + '\n');
  } catch {
    // fallback empty metrics (disconnected)
    clear();
    process.stdout.write(renderRmqConsumerPaneFromMetrics(undefined, width) + '\n');
  }
}

await poll();
setInterval(poll, 1000);
