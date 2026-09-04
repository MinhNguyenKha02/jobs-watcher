#!/usr/bin/env tsx
/**
 * PC poll — local-only 1s RMQ consumer pane (60% w, `h12` 4-line).
 * tmux P3: `npx tsx scripts/poll-rmq-pane.ts --width 96`
 * Reads snapshot via shared reader? Standalone polls via amqplib passive check disabled — local-only file seam placeholder.
 * For now polls the TUI shared-state + in-mem reader via importing RabbitMqJobReader snapshot if connected,
 * otherwise renders empty snapshot + border. Real tmux PC will be fed via `tui-stdout` thread snapshot export;
 * this script provides the 1s local-only poll loop for PC pane.
 */

import { renderRmqConsumerPane } from '../src/presentation/tui/components/RmqConsumerPane.js';

const width =
  Number(
    process.argv.find((a) => a === '--width')
      ? process.argv[process.argv.indexOf('--width') + 1]
      : 96
  ) || 96;

function clear(): void {
  process.stdout.write('\x1b[2J\x1b[H');
}

async function poll(): Promise<void> {
  // local-only: no amqplib; render empty/Q:0 snapshot until reader wires via IPC file
  const snapshot = {
    depth: 0,
    partial: 0,
    full: 0,
    deferred: 0,
    deferredIds: [] as string[],
    peekIds: [] as string[],
    peekStages: [] as Array<'partial' | 'full'>,
    connected: false,
    queueMode: true,
  };
  clear();
  process.stdout.write(renderRmqConsumerPane(snapshot, width) + '\n');
}

await poll();
setInterval(poll, 1000);
