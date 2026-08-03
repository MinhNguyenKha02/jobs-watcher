import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import { PlaywrightBrowserAdapter } from '../../../../src/infrastructure/outbound/browser/browser-adapter.js';

const hasPlaywright = ((): boolean => {
  try {
    require.resolve('playwright');
    return true;
  } catch {
    return false;
  }
})();

function startHtmlServer(): Promise<{ server: http.Server; url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html><body><h1>Job Detail</h1><div class="job-detail__info--title">Software Engineer</div></body></html>');
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

describe.skipIf(!hasPlaywright)('PRC-004 — Browser adapter robustness + crash fallback', () => {
  let server: Awaited<ReturnType<typeof startHtmlServer>>;
  let adapter: PlaywrightBrowserAdapter;

  beforeAll(async () => {
    server = await startHtmlServer();
  }, 30000);

  afterAll(async () => {
    await server.close();
  });

  it('start→extract returns page HTML (real Playwright)', async () => {
    adapter = new PlaywrightBrowserAdapter({ headless: true });
    await adapter.start();
    const result = await adapter.extract(server.url);
    expect(result.html).toContain('Job Detail');
  }, 60000);

  it('extract before start throws explicit error (no silent hang)', async () => {
    adapter = new PlaywrightBrowserAdapter({ headless: true });
    await expect(adapter.extract(server.url)).rejects.toThrow(/not started|Browser not started/);
  }, 30000);

  it('double-stop is idempotent (no throw on second stop)', async () => {
    adapter = new PlaywrightBrowserAdapter({ headless: true });
    await adapter.start();
    await adapter.stop();
    await expect(adapter.stop()).resolves.toBeUndefined();
  }, 30000);

  it('multiple extractions on same browser instance succeed (idempotent extraction)', async () => {
    adapter = new PlaywrightBrowserAdapter({ headless: true });
    await adapter.start();
    const r1 = await adapter.extract(server.url);
    const r2 = await adapter.extract(server.url);
    expect(r1.html).toContain('Job Detail');
    expect(r2.html).toContain('Job Detail');
  }, 60000);

  it('goto timeout on unreachable host throws (adapter surfaces failure, not silent)', async () => {
    adapter = new PlaywrightBrowserAdapter({ headless: true, timeout: 2000 });
    await adapter.start();
    await expect(adapter.extract('http://127.0.0.1:1/unreachable')).rejects.toBeTruthy();
  }, 60000);

  it('adapter recovers after a failed extraction (context recreated)', async () => {
    adapter = new PlaywrightBrowserAdapter({ headless: true, timeout: 2000 });
    await adapter.start();
    await adapter.extract('http://127.0.0.1:1/unreachable').catch(() => {});
    const ok = await adapter.extract(server.url);
    expect(ok.html).toContain('Job Detail');
  }, 60000);
});
