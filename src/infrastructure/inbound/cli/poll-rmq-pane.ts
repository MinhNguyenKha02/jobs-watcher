#!/usr/bin/env tsx
/**
 * PC poll — 1s RMQ consumer pane (dynamic width, h~9) via TUI health observability.
 * tmux P3: `npx tsx scripts/poll-rmq-pane.ts --width 96` (width fallback, stdout.columns dynamic)
 * Reads TuiMetricsRegistry via TUI health port (9091) — registry reader, not direct getPendingSnapshot.
 */

import {
  renderRmqConsumerPaneFromMetrics,
  renderRmqErrorFrame,
} from '../../../presentation/tui/components/RmqConsumerPane.js';

function resolveWidth(): number {
  const col = process.stdout.columns;
  if (col && col > 10) return col;
  const argIdx = process.argv.indexOf('--width');
  if (argIdx !== -1) {
    const v = Number(process.argv[argIdx + 1]);
    if (v) return v;
  }
  return 96;
}

const TUI_URL = process.env.TUI_OBSERVABILITY_URL || process.env.TUI_HEALTH_URL || 'http://localhost:9091/health/observability';

function clear(): void {
  process.stdout.write('\x1b[2J\x1b[H');
}

async function fetchWithTimeout(url: string, ms = 2000): Promise<Response> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try {
    return await fetch(url, { signal: ac.signal });
  } finally {
    clearTimeout(t);
  }
}

async function poll(): Promise<void> {
  const width = resolveWidth();
  try {
    const res = await fetchWithTimeout(TUI_URL);
    if (!res.ok) {
      clear();
      process.stdout.write(renderRmqErrorFrame(width, 9091, `HTTP ${res.status}`) + '\n');
      return;
    }
    const data = (await res.json()) as { metrics?: Record<string, Array<{ labels: Record<string, string>; value: number }>> };
    const metrics = data.metrics;
    clear();
    const innerTitle = (() => {
      const inner = Math.max(10, width - 2);
      const title = ` tui 9091 `;
      const left = Math.floor((inner - title.length) / 2);
      const right = inner - title.length - left;
      return `┌${'─'.repeat(left)}${title}${'─'.repeat(right)}┐`;
    })();
    const frame = renderRmqConsumerPaneFromMetrics(metrics, width);
    const lines = frame.split('\n');
    lines[0] = innerTitle;
    process.stdout.write(lines.join('\n') + '\n');
  } catch (err) {
    clear();
    // fallback bordered error, not bare
    const msg = err instanceof Error ? (err.name === 'AbortError' ? 'timeout 2s' : err.message) : String(err);
    // empty metrics fallback still bordered via error title
    process.stdout.write(renderRmqErrorFrame(width, 9091, msg) + '\n');
  }
}

await poll();
setInterval(poll, 1000);
process.stdout.on('resize', () => {
  void poll();
});
// SIGWINCH fallback
process.on('SIGWINCH', () => {
  void poll();
});
