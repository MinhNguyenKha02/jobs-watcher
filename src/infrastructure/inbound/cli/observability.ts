const POLL_INTERVAL_MS = 5000;
const OBSERVABILITY_URL = 'http://localhost:9090/health/observability';

function clearAndMoveTop(): void {
  process.stdout.write('\x1b[2J\x1b[H');
}

import { renderObserveCompactPane } from '../../../presentation/tui/components/ObserveCompactPane.js';

export async function startObservabilityPolling(): Promise<void> {
  const compact = process.argv.includes('--compact');
  clearAndMoveTop();
  process.stdout.write(
    compact
      ? 'Observe PD compact — polling /health/observability every 5s (4-line)\n\n'
      : 'Observability pane started — polling /health/observability every 5s\n\n'
  );

  const poll = async (): Promise<void> => {
    try {
      const res = await fetch(OBSERVABILITY_URL);
      if (!res.ok) {
        process.stdout.write(`HTTP ${res.status}\n`);
        return;
      }
      const data: unknown = await res.json();
      clearAndMoveTop();
      if (compact) {
        const width = process.stdout.columns || 64;
        const frame = renderObserveCompactPane(data as Record<string, unknown> as never, width);
        process.stdout.write(frame + '\n');
      } else {
        process.stdout.write(JSON.stringify(data, null, 2) + '\n');
      }
    } catch (err) {
      clearAndMoveTop();
      process.stdout.write(`Poll error: ${err instanceof Error ? err.message : String(err)}\n`);
    }
  };

  await poll();
  setInterval(poll, POLL_INTERVAL_MS);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startObservabilityPolling().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
