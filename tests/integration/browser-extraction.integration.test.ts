import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import http from 'node:http';
import { PlaywrightBrowserAdapter } from '../../src/infrastructure/outbound/browser/browser-adapter.js';

const FIXTURE_HTML = `<html><body><div class="test-fixture"><h1>Integration Test</h1><p>Hello from Playwright + stealth</p></div></body></html>`;

const hasPlaywright = (() => {
  try {
    const { chromium } = require('playwright-extra');
    const execPath = chromium.executablePath();
    return fs.existsSync(execPath);
  } catch {
    return false;
  }
})();

const describeBrowser = hasPlaywright ? describe : describe.skip;

describeBrowser('PlaywrightBrowserAdapter — integration', { timeout: 30000 }, () => {
  let server: http.Server;
  let serverUrl: string;
  let adapter: PlaywrightBrowserAdapter;

  beforeAll(async () => {
    server = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(FIXTURE_HTML);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address() as import('net').AddressInfo;
    serverUrl = `http://127.0.0.1:${addr.port}/`;

    adapter = new PlaywrightBrowserAdapter({ headless: true, timeout: 5000 });
    await adapter.start();
  });

  afterAll(async () => {
    await adapter.stop().catch(() => {});
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('extracts HTML from a local HTTP server', async () => {
    const result = await adapter.extract(serverUrl);
    expect(result).toBeDefined();
    expect(typeof result.html).toBe('string');
    expect(result.html).toContain('Integration Test');
    expect(result.html).toContain('Hello from Playwright + stealth');
  });

  it('extract return shape matches BrowserPort contract', async () => {
    const result = await adapter.extract(serverUrl);
    expect(Object.keys(result)).toEqual(['html']);
  });

  it('multiple extractions return consistent content', async () => {
    const [r1, r2] = await Promise.all([
      adapter.extract(serverUrl),
      adapter.extract(serverUrl),
    ]);
    expect(r1.html).toContain('Integration Test');
    expect(r2.html).toContain('Integration Test');
  });

  it('stop is safe to call twice', async () => {
    await adapter.stop();
    await adapter.stop();
    await adapter.start();
    const result = await adapter.extract(serverUrl);
    expect(result.html).toContain('Integration Test');
  });
});
