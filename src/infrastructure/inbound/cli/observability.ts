const POLL_INTERVAL_MS = 5000;
const OBSERVABILITY_URL = 'http://localhost:9090/health/observability';

function clearAndMoveTop(): void {
  process.stdout.write('\x1b[2J\x1b[H');
}

export async function startObservabilityPolling(): Promise<void> {
  clearAndMoveTop();
  process.stdout.write('Observability pane started — polling /health/observability every 5s\n\n');

  const poll = async (): Promise<void> => {
    try {
      const res = await fetch(OBSERVABILITY_URL);
      if (!res.ok) {
        process.stdout.write(`HTTP ${res.status}\n`);
        return;
      }
      const data: unknown = await res.json();
      clearAndMoveTop();
      process.stdout.write(JSON.stringify(data, null, 2) + '\n');
    } catch (err) {
      clearAndMoveTop();
      process.stdout.write(`Poll error: ${err instanceof Error ? err.message : String(err)}\n`);
    }
  };

  await poll();
  setInterval(poll, POLL_INTERVAL_MS);
}
