import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { getLogger } from '../logging/logger.js';

const logger = getLogger();

export class PlaywrightBrowserAdapter {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private headless: boolean;
  private timeout: number;

  constructor(opts: { headless?: boolean; timeout?: number } = {}) {
    this.headless = opts.headless ?? true;
    this.timeout = opts.timeout ?? 30000;
  }

  async start(): Promise<void> {
    if (this.browser) return;
    this.browser = await chromium.launch({
      headless: this.headless,
      args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
    });
    this.context = await this.browser.newContext();
    logger.info('[BrowserExtractor] Playwright browser started', { headless: this.headless });
  }

  async extract(url: string): Promise<{ html: string }> {
    if (!this.context) throw new Error('Browser not started. Call start() first.');

    const page: Page = await this.context.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: this.timeout });
      const html = await page.evaluate<string>(`document.body.innerHTML`);
      logger.info('[BrowserExtractor] Extracted HTML', { url: page.url(), htmlLength: html.length });
      return { html };
    } finally {
      try {
        await page.close();
      } catch (closeErr) {
        logger.warn('[BrowserExtractor] page.close failed, recreating context', { error: String(closeErr) });
        if (this.browser) {
          try { await this.context?.close(); } catch (ctxCloseErr) {
            logger.warn('[BrowserExtractor] context.close failed');
          }
          this.context = await this.browser.newContext();
        }
      }
    }
  }

  async stop(): Promise<void> {
    if (this.context) {
      await this.context.close();
      this.context = null;
    }
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
    logger.info('[BrowserExtractor] Playwright browser stopped');
  }
}
