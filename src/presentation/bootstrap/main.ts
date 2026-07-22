import { GmailService } from '../../infrastructure/outbound/gmail.js';
import { EventDrivenWebhook } from '../../infrastructure/inbound/web/event-webhook.js';
import { config } from '../../config.js';
import { getLogger } from '../../infrastructure/outbound/logging/logger.js';

const logger = getLogger();

// Global state
let webhook: EventDrivenWebhook | null = null;
let gmailService: GmailService | null = null;
let isShuttingDown = false;

/**
 * Graceful shutdown handler
 */
async function shutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.info(`Received ${signal}, shutting down gracefully...`);

  try {
    if (webhook) {
      await webhook.stop();
      logger.info('Webhook server stopped');
    }

    if (gmailService) {
      logger.info('Gmail service closed');
    }

    logger.info('Shutdown complete');
    process.exit(0);
  } catch (error: any) {
    logger.error(`Error during shutdown: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Uncaught exception handler
 */
process.on('uncaughtException', (error: Error) => {
  logger.error(`Uncaught Exception: ${error.message}`);
  logger.error(error.stack || '');
  process.exit(1);
});

/**
 * Unhandled rejection handler
 */
process.on('unhandledRejection', (reason: any) => {
  logger.error(`Unhandled Rejection: ${reason}`);
  process.exit(1);
});

/**
 * Graceful shutdown on signals
 */
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

async function main() {
  try {
    logger.info('🚀 Starting Jobs Watcher (Event-Driven)...');

    // Validate configuration
    if (!config.gmail.clientId || !config.gmail.clientSecret) {
      throw new Error('Gmail credentials not configured. Run: npm run setup');
    }

    // Initialize Gmail service
    gmailService = new GmailService();
    await gmailService.authenticate();
    logger.info('✅ Authenticated with Gmail');

    // Start event-driven webhook server
    webhook = new EventDrivenWebhook(gmailService);
    await webhook.start(config.webhook.port);

    logger.info(`✅ Jobs Watcher is running`);
    logger.info(`📧 Watching Gmail label: "${config.gmail.labelName}"`);
    logger.info(`🌐 Webhook listening on port ${config.webhook.port}`);
    logger.info('⏰ Waiting for job alerts...');
  } catch (error: any) {
    logger.error(`Fatal error: ${error.message}`);
    logger.error(error.stack || '');
    process.exit(1);
  }
}

main();
