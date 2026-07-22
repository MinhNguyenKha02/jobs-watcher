import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPage = {
  url: vi.fn(() => 'https://example.com/job'),
  goto: vi.fn(),
  evaluate: vi.fn(),
  close: vi.fn(),
  setViewportSize: vi.fn(),
};

const mockContext = {
  newPage: vi.fn(() => Promise.resolve(mockPage)),
  close: vi.fn(),
};

const mockBrowser = {
  newContext: vi.fn(() => Promise.resolve(mockContext)),
  close: vi.fn(),
};

const mockChromium = {
  use: vi.fn(),
  launch: vi.fn(() => Promise.resolve(mockBrowser)),
};

vi.mock('playwright-extra', () => ({
  chromium: mockChromium,
}));

vi.mock('puppeteer-extra-plugin-stealth', () => ({
  default: vi.fn(() => ({})),
}));

vi.mock('../../../src/services/logger.js', () => ({
  getLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

describe('PlaywrightBrowserAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('launches browser with headless option on start', async () => {
    const { PlaywrightBrowserAdapter } = await import('../../../../src/infrastructure/outbound/browser/browser-extractor.js' );
    const adapter = new PlaywrightBrowserAdapter({ headless: true, timeout: 10000 });

    await adapter.start();

    expect(mockChromium.launch).toHaveBeenCalledWith({
      headless: true,
      args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
    });
  });

  it('creates browser context after launch', async () => {
    const { PlaywrightBrowserAdapter } = await import('../../../../src/infrastructure/outbound/browser/browser-extractor.js' );
    const adapter = new PlaywrightBrowserAdapter();

    await adapter.start();

    expect(mockBrowser.newContext).toHaveBeenCalled();
  });

  it('is idempotent on repeated start calls', async () => {
    const { PlaywrightBrowserAdapter } = await import('../../../../src/infrastructure/outbound/browser/browser-extractor.js' );
    const adapter = new PlaywrightBrowserAdapter();

    await adapter.start();
    await adapter.start();

    expect(mockChromium.launch).toHaveBeenCalledTimes(1);
  });

  it('extracts HTML from a URL', async () => {
    const { PlaywrightBrowserAdapter } = await import('../../../../src/infrastructure/outbound/browser/browser-extractor.js' );
    const adapter = new PlaywrightBrowserAdapter();
    mockPage.evaluate.mockResolvedValue('<html><body>Test content</body></html>');

    await adapter.start();
    const result = await adapter.extract('https://example.com/job');

    expect(mockContext.newPage).toHaveBeenCalled();
    expect(mockPage.setViewportSize).toHaveBeenCalledWith({ width: 1280, height: 800 });
    expect(mockPage.goto).toHaveBeenCalledWith('https://example.com/job', {
      waitUntil: 'networkidle',
      timeout: 30000,
    });
    expect(mockPage.evaluate).toHaveBeenCalledWith('document.body.innerHTML');
    expect(result).toEqual({ html: '<html><body>Test content</body></html>' });
    expect(mockPage.close).toHaveBeenCalled();
  });

  it('throws if extract is called before start', async () => {
    const { PlaywrightBrowserAdapter } = await import('../../../../src/infrastructure/outbound/browser/browser-extractor.js' );
    const adapter = new PlaywrightBrowserAdapter();

    await expect(adapter.extract('https://example.com')).rejects.toThrow('Browser not started');
  });

  it('stops the browser and cleans up', async () => {
    const { PlaywrightBrowserAdapter } = await import('../../../../src/infrastructure/outbound/browser/browser-extractor.js' );
    const adapter = new PlaywrightBrowserAdapter();

    await adapter.start();
    await adapter.stop();

    expect(mockContext.close).toHaveBeenCalled();
    expect(mockBrowser.close).toHaveBeenCalled();
  });

  it('recreates context when page.close fails during extract', async () => {
    const { PlaywrightBrowserAdapter } = await import('../../../../src/infrastructure/outbound/browser/browser-extractor.js' );
    const adapter = new PlaywrightBrowserAdapter();
    mockPage.evaluate.mockResolvedValue('<html>ok</html>');
    mockPage.close.mockRejectedValue(new Error('Browser closed'));

    await adapter.start();
    const result = await adapter.extract('https://example.com');

    expect(result).toEqual({ html: '<html>ok</html>' });
    expect(mockBrowser.newContext).toHaveBeenCalledTimes(2);
  });

  it('handles goto timeout gracefully', async () => {
    const { PlaywrightBrowserAdapter } = await import('../../../../src/infrastructure/outbound/browser/browser-extractor.js' );
    const adapter = new PlaywrightBrowserAdapter({ timeout: 1000 });
    mockPage.goto.mockRejectedValue(new Error('Timeout 30000ms exceeded'));

    await adapter.start();
    await expect(adapter.extract('https://example.com')).rejects.toThrow('Timeout');
  });

  it('accepts custom timeout option', async () => {
    const { PlaywrightBrowserAdapter } = await import('../../../../src/infrastructure/outbound/browser/browser-extractor.js' );
    const adapter = new PlaywrightBrowserAdapter({ headless: false, timeout: 5000 });

    await adapter.start();

    expect(mockChromium.launch).toHaveBeenCalledWith({
      headless: false,
      args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
    });
  });
});
