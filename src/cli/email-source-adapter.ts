/**
 * Email source adapter (CLI layer only)
 * - data-testing: DB snapshot runner
 * - data-listening: Gmail webhook runner
 */

import { GmailService } from '../services/gmail.js';
import { EventDrivenWebhook } from '../services/event-webhook.js';
import { config } from '../config.js';
import { getLogger } from '../services/logger.js';

const logger = getLogger();

export type EmailSourceMode = 'data-testing' | 'data-listening';

export interface EmailSourceAdapter {
  name: string;
  mode: EmailSourceMode;
  run(): Promise<void>;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
}

export class DbEmailSourceAdapter implements EmailSourceAdapter {
  name = 'db';
  mode: EmailSourceMode = 'data-testing';

  constructor(private runner: () => Promise<void>) {}

  async run(): Promise<void> {
    await this.runner();
  }

  async connect(): Promise<void> {
    // DB adapter doesn't need connection setup
  }

  async disconnect(): Promise<void> {
    // DB adapter doesn't need cleanup
  }
}

export class GmailEmailSourceAdapter implements EmailSourceAdapter {
  name = 'gmail';
  mode: EmailSourceMode = 'data-listening';
  private webhook: EventDrivenWebhook | null = null;

  constructor(private options?: { port?: number }) {}

  async connect(): Promise<void> {
    // Initialize webhook with MongoDB storage
    if (!config.gmail.clientId || !config.gmail.clientSecret) {
      throw new Error('Gmail credentials not configured. Run: npm run setup');
    }

    const gmailService = new GmailService();
    await gmailService.authenticate();
    
    this.webhook = new EventDrivenWebhook(gmailService);
    await this.webhook.connect();
  }

  async disconnect(): Promise<void> {
    if (this.webhook) {
      await this.webhook.disconnect();
    }
  }

  async run(): Promise<void> {
    logger.info('🚀 Starting Gmail data-listening adapter...');

    if (!this.webhook) {
      // Fallback if connect() wasn't called (for backward compatibility)
      if (!config.gmail.clientId || !config.gmail.clientSecret) {
        throw new Error('Gmail credentials not configured. Run: npm run setup');
      }

      const gmailService = new GmailService();
      await gmailService.authenticate();
      logger.info('✅ Authenticated with Gmail');

      this.webhook = new EventDrivenWebhook(gmailService);
      await this.webhook.connect();
    }

    const port = this.options?.port ?? config.webhook.port;
    await this.webhook.start(port);

    logger.info(`✅ Webhook listening on port ${port}`);
    logger.info(`📧 Watching Gmail label: "${config.gmail.labelName}"`);
    logger.info('⏰ Waiting for job alerts...');

    // Keep the process alive - never resolve to maintain MongoDB connection
    return new Promise(() => {
      // This promise never resolves, keeping the service running
    });
  }
}
