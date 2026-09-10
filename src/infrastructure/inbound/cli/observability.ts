const POLL_INTERVAL_MS = 5000;
const OBSERVABILITY_URL = process.env.OBSERVABILITY_URL || 'http://localhost:9090/health/observability';

function clearAndMoveTop(): void {
  process.stdout.write('\x1b[2J\x1b[H');
}

import {
  renderObserveCompactPane,
  renderObserveErrorFrame,
} from '../../../presentation/tui/components/ObserveCompactPane.js';

async function fetchWithTimeout(url: string, ms = 2000): Promise<Response> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try {
    return await fetch(url, { signal: ac.signal });
  } finally {
    clearTimeout(t);
  }
}

export async function startObservabilityPolling(): Promise<void> {
  const compact = process.argv.includes('--compact');

  const poll = async (): Promise<void> => {
    const width = process.stdout.columns || 64;
    try {
      const res = await fetchWithTimeout(OBSERVABILITY_URL);
      if (!res.ok) {
        clearAndMoveTop();
        process.stdout.write(renderObserveErrorFrame(width, 9090, `HTTP ${res.status}`) + '\n');
        return;
      }
      const data: unknown = await res.json();
      clearAndMoveTop();
      if (compact) {
        const { renderObserveCompactPane: fn } = await import('../../../presentation/tui/components/ObserveCompactPane.js');
        void fn;
        const frame = renderObserveCompactPane(data as never, width);
        const inner = Math.max(10, width - 2);
        const title = ` daemon 9090 `;
        const left = Math.floor((inner - title.length) / 2);
        const right = inner - title.length - left;
        const titleLine = `┌${'─'.repeat(left)}${title}${'─'.repeat(right)}┐`;
        const lines = frame.split('\n');
        lines[0] = titleLine;
        process.stdout.write(lines.join('\n') + '\n');
      } else {
        process.stdout.write(JSON.stringify(data, null, 2) + '\n');
      }
    } catch (err) {
      clearAndMoveTop();
      const width2 = process.stdout.columns || 64;
      const msg = err instanceof Error ? (err.name === 'AbortError' ? 'timeout 2s' : err.message) : String(err);
      process.stdout.write(renderObserveErrorFrame(width2, 9090, msg) + '\n');
    }
  };

  await poll();
  setInterval(poll, POLL_INTERVAL_MS);
  process.stdout.on('resize', () => {
    void poll();
  });
  process.on('SIGWINCH', () => {
    void poll();
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startObservabilityPolling().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
