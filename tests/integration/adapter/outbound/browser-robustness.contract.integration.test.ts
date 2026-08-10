import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import http from 'http';
import { PlaywrightBrowserAdapter } from '../../../../src/infrastructure/outbound/browser/browser-adapter.js';

function startHtmlServer(): Promise<{
  server: http.Server;
  url: string;
  close: () => Promise<void>;
}> {
  return new Promise((resolve) => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(
        '<html><body><h1>Job Detail</h1><div class="job-detail__info--title">Software Engineer</div></body></html>'
      );
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as any;
      resolve({
        server,
        url: `http://127.0.0.1:${addr.port}/`,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

describe('PRC-004 — Browser adapter robustness + crash fallback', () => {
  let server: Awaited<ReturnType<typeof startHtmlServer>>;
  let adapter: PlaywrightBrowserAdapter;

  const swallowBrowserRejection = (err: unknown): void => {
    const msg = err instanceof Error ? err.message : String(err);
    // playback-extra emits an async cdpSession rejection when navigations to
    // unreachable hosts race browser/context teardown. It is expected and does
    // not affect assertions; swallow only that, rethrow anything else.
    if (/cdpSession|Target page, context or browser has been closed|Target closed/i.test(msg)) {
      return;
    }
    process.removeListener('unhandledRejection', swallowBrowserRejection);
    process.nextTick(() => (process as NodeJS.EventEmitter).emit('unhandledRejection', err));
  };

  beforeAll(async () => {
    process.on('unhandledRejection', swallowBrowserRejection);
    server = await startHtmlServer();
  }, 30000);

  afterEach(async () => {
    // close each browser cleanly so a pending cdpSession on an unreachable-host
    // navigation rejects within this file (caught here) instead of leaking as an
    // unhandled rejection after the test.
    try {
      await adapter?.stop();
    } catch {
      /* best-effort */
    }
    // playwright-extra surfaces the cdpSession "target closed" rejection asynchronously
    // AFTER stop() returns; give it a tick-window while the guard is still attached.
    await new Promise((r) => setTimeout(r, 1200));
  });

  afterAll(async () => {
    await server.close();
    // let any in-flight playwright-extra cdpSession rejections surface while the
    // guard is still attached, then detach it so it does not mask later files.
    await new Promise((r) => setTimeout(r, 8000));
    process.removeListener('unhandledRejection', swallowBrowserRejection);
  });

  it('GIVEN the PRC precondition WHEN the port is exercised on the real PRC THEN start→extract returns page HTML (real Playwright)', async () => {
    adapter = new PlaywrightBrowserAdapter({ headless: true });
    await adapter.start();
    const result = await adapter.extract(server.url);
    expect(result.html).toContain('Job Detail');
  }, 60000);

  it('GIVEN the PRC precondition WHEN the port is exercised on the real PRC THEN extract before start throws explicit error (no silent hang)', async () => {
    adapter = new PlaywrightBrowserAdapter({ headless: true });
    await expect(adapter.extract(server.url)).rejects.toThrow(/not started|Browser not started/);
  }, 30000);

  it('GIVEN the PRC precondition WHEN the port is exercised on the real PRC THEN double-stop is idempotent (no throw on second stop)', async () => {
    adapter = new PlaywrightBrowserAdapter({ headless: true });
    await adapter.start();
    await adapter.stop();
    await expect(adapter.stop()).resolves.toBeUndefined();
  }, 30000);

  it('GIVEN the PRC precondition WHEN the port is exercised on the real PRC THEN multiple extractions on same browser instance succeed (idempotent extraction)', async () => {
    adapter = new PlaywrightBrowserAdapter({ headless: true });
    await adapter.start();
    const r1 = await adapter.extract(server.url);
    const r2 = await adapter.extract(server.url);
    expect(r1.html).toContain('Job Detail');
    expect(r2.html).toContain('Job Detail');
  }, 60000);

  it('GIVEN the PRC precondition WHEN the port is exercised on the real PRC THEN goto timeout on unreachable host throws (adapter surfaces failure, not silent)', async () => {
    adapter = new PlaywrightBrowserAdapter({ headless: true, timeout: 2000 });
    await adapter.start();
    await expect(adapter.extract('http://127.0.0.1:1/unreachable')).rejects.toBeTruthy();
  }, 60000);

  it('GIVEN the PRC precondition WHEN the port is exercised on the real PRC THEN adapter recovers after a failed extraction (context recreated)', async () => {
    adapter = new PlaywrightBrowserAdapter({ headless: true, timeout: 2000 });
    await adapter.start();
    await adapter.extract('http://127.0.0.1:1/unreachable').catch(() => {});
    const ok = await adapter.extract(server.url);
    expect(ok.html).toContain('Job Detail');
  }, 60000);
});
