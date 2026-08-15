import http from 'node:http';

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';

import { PlaywrightBrowserAdapter } from '../../../src/infrastructure/outbound/browser/browser-adapter.js';

const FIXTURE_HTML = `<html><body><div class="test-fixture"><h1>Integration Test</h1><p>Hello from Playwright + stealth</p></div></body></html>`;

function startHtmlServer(): Promise<{
  server: http.Server;
  url: string;
  close: () => Promise<void>;
}> {
  return new Promise((resolve) => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(FIXTURE_HTML);
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as import('net').AddressInfo;
      resolve({
        server,
        url: `http://127.0.0.1:${addr.port}/`,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

/**
 * BrowserPort contract over the real Playwright adapter with a local HTTP
 * fixture server. Each `it` owns a fresh adapter instance so teardown of one
 * browser cannot leak into the next. playwright-extra emits an async cdpSession
 * rejection when navigations to unreachable hosts race browser/context
 * teardown; an `unhandledRejection` guard swallows only that expected race.
 */
describe('BrowserPort — playwright adapter contract · contract browser', { timeout: 30000 }, () => {
  let server: Awaited<ReturnType<typeof startHtmlServer>>;

  const swallowBrowserRejection = (err: unknown): void => {
    const msg = err instanceof Error ? err.message : String(err);
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
    try {
      await adapter?.stop();
    } catch {
      /* best-effort */
    }
    await new Promise((r) => setTimeout(r, 1200));
  });

  afterAll(async () => {
    await server.close();
    await new Promise((r) => setTimeout(r, 8000));
    process.removeListener('unhandledRejection', swallowBrowserRejection);
  });

  let adapter: PlaywrightBrowserAdapter;

  describe('(a) lifecycle — start → extract → stop on the real browser', () => {
    it('GIVEN a reachable fixture url WHEN start → extract on the real BrowserPort THEN the page HTML is returned', async () => {
      adapter = new PlaywrightBrowserAdapter({ headless: true, timeout: 5000 });
      await adapter.start();
      const result = await adapter.extract(server.url);
      expect(result).toBeDefined();
      expect(typeof result.html).toBe('string');
      expect(result.html).toContain('Integration Test');
    }, 60000);

    it('GIVEN the browser extracted page WHEN extract runs twice on the real BrowserPort THEN multiple extractions return consistent content', async () => {
      adapter = new PlaywrightBrowserAdapter({ headless: true, timeout: 5000 });
      await adapter.start();
      const [r1, r2] = await Promise.all([
        adapter.extract(server.url),
        adapter.extract(server.url),
      ]);
      expect(r1.html).toContain('Integration Test');
      expect(r2.html).toContain('Integration Test');
    }, 60000);

    it('GIVEN a browser lifecycle WHEN stop → start → extract on the real BrowserPort THEN the adapter is reusable after a clean stop', async () => {
      adapter = new PlaywrightBrowserAdapter({ headless: true, timeout: 5000 });
      await adapter.start();
      await adapter.stop();
      await adapter.start();
      const result = await adapter.extract(server.url);
      expect(result.html).toContain('Integration Test');
    }, 60000);
  });

  describe('(b) contract shape — BrowserPort return surface on the real browser', () => {
    it('GIVEN a reachable fixture url WHEN extract on the real BrowserPort THEN the return shape matches the { html } BrowserPort contract', async () => {
      adapter = new PlaywrightBrowserAdapter({ headless: true, timeout: 5000 });
      await adapter.start();
      const result = await adapter.extract(server.url);
      expect(Object.keys(result)).toEqual(['html']);
    }, 60000);
  });

  describe('(c) failure — extract surfaces failures on the real browser', () => {
    it('GIVEN a stopped browser WHEN extract on the real BrowserPort THEN an explicit error is thrown (no silent hang)', async () => {
      adapter = new PlaywrightBrowserAdapter({ headless: true });
      await expect(adapter.extract(server.url)).rejects.toThrow(/not started|Browser not started/);
    }, 30000);

    it('GIVEN an unreachable host WHEN extract on the real BrowserPort THEN the adapter surfaces the failure (goto rejects)', async () => {
      adapter = new PlaywrightBrowserAdapter({ headless: true, timeout: 2000 });
      await adapter.start();
      await expect(adapter.extract('http://127.0.0.1:1/unreachable')).rejects.toBeTruthy();
    }, 60000);
  });

  describe('(d) stop idempotence + recovery on the real browser', () => {
    it('GIVEN a started browser WHEN stop twice on the real BrowserPort THEN double-stop is idempotent (no throw on the second stop)', async () => {
      adapter = new PlaywrightBrowserAdapter({ headless: true });
      await adapter.start();
      await adapter.stop();
      await expect(adapter.stop()).resolves.toBeUndefined();
    }, 30000);

    it('GIVEN a failed extraction WHEN the port is exercised again on the real BrowserPort THEN the adapter recovers (context recreated, next extract succeeds)', async () => {
      adapter = new PlaywrightBrowserAdapter({ headless: true, timeout: 2000 });
      await adapter.start();
      await adapter.extract('http://127.0.0.1:1/unreachable').catch(() => {});
      const ok = await adapter.extract(server.url);
      expect(ok.html).toContain('Integration Test');
    }, 60000);
  });
});
