/**
 * Data listening mode runner
 * Uses Gmail webhook adapter (Pub/Sub notifications)
 * Listens for incoming job alerts and processes them in real-time
 */

import 'dotenv/config';
import { GmailWebhookAdapter, ClipboardOnlyAdapter, GmailApiAdapter } from './email-source-adapter.js';
import { clipboardGetter } from './clipboard-getter.js';
import { config } from '../config.js';
import { getLogger } from '../services/logger.js';

const logger = getLogger();


async function runDataListening() {
  logger.info('📋 Data Listening Service');
  logger.info('========================');
  // Parse --adapter flag (default: gmailWebhook)
  const adapterFlag = process.argv.find(arg => arg.startsWith('--adapter='));
  const adapterType = adapterFlag ? adapterFlag.split('=')[1] : 'gmailWebhook';
  // Parse --schedule or --interval flag (e.g., --schedule=1h, --interval=3600)
  const scheduleFlag = process.argv.find(arg => arg.startsWith('--schedule=')) || process.argv.find(arg => arg.startsWith('--interval='));
  let scheduleMs: number | undefined;
  if (scheduleFlag) {
    const val = scheduleFlag.split('=')[1];
    // Support "1h", "30m", "3600" (seconds)
    if (/^\d+$/.test(val)) {
      scheduleMs = parseInt(val, 10) * 1000;
    } else if (/^\d+h$/.test(val)) {
      scheduleMs = parseInt(val, 10) * 60 * 60 * 1000;
    } else if (/^\d+m$/.test(val)) {
      scheduleMs = parseInt(val, 10) * 60 * 1000;
    } else {
      logger.warn(`Unrecognized schedule/interval value: ${val}`);
    }
  }
  let adapter;
  if (adapterType === 'gmailWebhook') {
    logger.info('Using GmailWebhookAdapter (Pub/Sub)...');
    adapter = new GmailWebhookAdapter({ port: config.webhook.port });
    if (scheduleMs) {
      logger.warn('Schedule/interval flag ignored for persistent webhook adapter.');
    }
  } else if (adapterType === 'clipboardOnly') {
    logger.info('Using ClipboardOnlyAdapter (manual/clipboard)...');
    adapter = new ClipboardOnlyAdapter({ clipboardGetter });
  } else if (adapterType === 'gmailApi') {
    logger.info('Using GmailApiAdapter (Gmail API fallback)...');
    adapter = new GmailApiAdapter();
  } else {
    logger.error(`Unknown adapter: ${adapterType}`);
    process.exit(1);
  }

  try {
    await adapter.connect();
    process.on('SIGINT', async () => {
      logger.info('🛑 Received SIGINT, shutting down gracefully...');
      await adapter.disconnect();
      process.exit(0);
    });
    process.on('SIGTERM', async () => {
      logger.info('🛑 Received SIGTERM, shutting down gracefully...');
      await adapter.disconnect();
      process.exit(0);
    });
    // Scheduled batch mode for batch adapters
    if ((adapterType === 'gmailApi' || adapterType === 'clipboardOnly') && scheduleMs) {
      logger.info(`⏰ Scheduled batch mode: running every ${scheduleMs / 1000}s`);
      const runBatch = async () => {
        logger.info('🔄 Scheduled batch fetch starting...');
        try {
          await adapter.run();
          logger.info('✅ Batch fetch complete.');
        } catch (err) {
          logger.error(`❌ Batch fetch failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      };
      await runBatch();
      const interval = setInterval(runBatch, scheduleMs);
      // Keep process alive until SIGINT/SIGTERM
      return;
    } else {
      // One-time batch mode (default)
      await adapter.run();
      logger.info('✅ Data listening service is ready');
      if (adapterType === 'gmailApi' || adapterType === 'clipboardOnly') {
        logger.info('👋 Batch mode complete, exiting.');
        process.exit(0);
      }
    }
  } catch (err) {
    logger.error(`❌ Data listening failed: ${err instanceof Error ? err.message : String(err)}`);
    await adapter.disconnect();
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runDataListening();
}
