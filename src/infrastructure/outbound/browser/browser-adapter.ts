import { type Browser, type BrowserContext, type Page } from 'playwright';
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

import { BrowserPort } from '../../../application/ports/browser.port.js';
import { AntiBotBlockedError, matchBlockedContents } from '../../../domain/services/blocked-page-guard.js';
import { createLogger } from '../logging/logger.js';

chromium.use(StealthPlugin());
const logger = createLogger('BrowserExtractor');

// Managed-challenge markers: title carries the verdict while the JS challenge self-resolves.
const CHALLENGE_TITLE_MARKERS = /just a moment|attention required|access denied|verify you are human/i;
const CHALLENGE_WAIT_MS = 15000;

export interface BrowserAdapterOpts {
  headless?: boolean;
  timeout?: number;
  /** Inter-goto pacing window (anti burst-velocity scoring). Zero disables (tests). */
  pacingMinMs?: number;
  pacingMaxMs?: number;
  /** Skip real-Chrome channel attempt (bundled Chromium only). */
  noRealChromeChannel?: boolean;
}

export class PlaywrightBrowserAdapter implements BrowserPort {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private headless: boolean;
  private timeout: number;
  private pacingMinMs: number;
  private pacingMaxMs: number;
  private noRealChromeChannel: boolean;

  constructor(opts: BrowserAdapterOpts = {}) {
    this.headless = opts.headless ?? true;
    this.timeout = opts.timeout ?? 30000;
    this.pacingMinMs = opts.pacingMinMs ?? 1500;
    this.pacingMaxMs = opts.pacingMaxMs ?? 3500;
    this.noRealChromeChannel = opts.noRealChromeChannel ?? false;
  }

  async start(): Promise<void> {
    if (this.browser) return;
    const baseArgs = ['--no-sandbox', '--disable-blink-features=AutomationControlled'];
    // Real-Chrome channel narrows the TLS/JA3 gap bundled Chromium leaves; stealth (JS-only)
    // cannot touch the handshake. Fall back to bundled Chromium where Chrome is not installed
    // (CI/contract runners) so the BrowserPort contract holds everywhere.
    if (!this.noRealChromeChannel) {
      try {
        this.browser = await chromium.launch({
          channel: 'chrome',
          headless: this.headless,
          args: baseArgs,
        });
        logger.info('Playwright browser started', { headless: this.headless, channel: 'chrome' });
      } catch (err) {
        logger.warn('Real-Chrome channel unavailable, falling back to bundled Chromium', {
          error: String(err),
        });
        this.browser = null;
      }
    }
    if (!this.browser) {
      this.browser = await chromium.launch({ headless: this.headless, args: baseArgs });
      logger.info('Playwright browser started', { headless: this.headless, channel: 'bundled' });
    }
    // Single context for process lifetime: VN-consistent locale/timezone matches the VN egress IP
    // (geo-consistency signal), and `cf_clearance` cookies carry over across jobs in the run.
    this.context = await this.browser.newContext({
      locale: 'vi-VN',
      timezoneId: 'Asia/Ho_Chi_Minh',
    });
  }

  private async paceGoto(): Promise<void> {
    if (this.pacingMaxMs <= 0) return;
    const min = Math.max(0, this.pacingMinMs);
    const max = Math.max(min, this.pacingMaxMs);
    const waitMs = min + Math.random() * (max - min);
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }

  private async waitForChallengeToClear(page: Page): Promise<void> {
    // String expression evaluates in-page (Node tsconfig has no DOM lib); resolves true once
    // no challenge marker remains in title/DOM. `#challenge-form` is legacy (pre-2024 IUAM) and
    // absent on current Cloudflare challenge pages — Turnstile widget selectors used instead.
    // Timeout = still challenged; the block-page guard below classifies the result.
    const clearedExpr = `(() => { const re = ${CHALLENGE_TITLE_MARKERS.toString()}; const t = document.title || ''; if (re.test(t)) return false; if (document.querySelector('iframe[src*="challenges.cloudflare.com"], .cf-turnstile, input[name="cf-turnstile-response"]')) return false; return true; })()`;
    try {
      await page.waitForFunction(clearedExpr, null, { timeout: CHALLENGE_WAIT_MS });
      // Settle after challenge clears before reading innerHTML.
      await page.waitForTimeout(1500);
    } catch {
      // still challenged — the block-page guard below classifies the result.
    }
  }

  async extract(url: string): Promise<{ html: string }> {
    if (!this.context) throw new Error('Browser not started. Call start() first.');

    await this.paceGoto();
    const page: Page = await this.context.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });
    try {
      const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: this.timeout });
      // `cf-mitigated: challenge` is Cloudflare's own challenge signal (sufficient but not necessary:
      // header-less WAF blocks exist, e.g. topcv) — enter the wait only when challenged to save time.
      let challenged = false;
      try {
        challenged = (await response?.headerValue('cf-mitigated')) === 'challenge';
      } catch {
        challenged = false;
      }
      if (challenged) await this.waitForChallengeToClear(page);
      const html = await page.evaluate<string>(`document.body.innerHTML`);
      logger.info('Extracted HTML', { url: page.url(), htmlLength: html.length });
      // Adapter-inline anti-bot guard: hard edge blocks route to the scheduler fallback,
      // never persist as FULL downstream.
      const marker = matchBlockedContents(html);
      if (marker) throw new AntiBotBlockedError(url, marker);
      return { html };
    } finally {
      try {
        await page.close();
      } catch (closeErr) {
        logger.warn('page.close failed, recreating context', { error: String(closeErr) });
        if (this.browser) {
          try {
            await this.context?.close();
          } catch (ctxCloseErr) {
            logger.warn('context.close failed');
          }
          this.context = await this.browser.newContext({
            locale: 'vi-VN',
            timezoneId: 'Asia/Ho_Chi_Minh',
          });
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
    logger.info('Playwright browser stopped');
  }
}
