/**
 * Data listening mode runner
 * Uses Gmail webhook adapter (Pub/Sub notifications)
 * Listens for incoming job alerts and processes them in real-time
 */

import { GmailEmailSourceAdapter } from './email-source-adapter.js';
import { config } from '../config.js';
import { getLogger } from '../services/logger.js';

const logger = getLogger();

export async function runDataListening(): Promise<void> {
  logger.info('📋 Data Listening Service');
  logger.info('========================');
  logger.info('Initializing Gmail webhook adapter...');
  
  const adapter = new GmailEmailSourceAdapter({ port: config.webhook.port });

  try {
    // Connect to MongoDB storage before starting webhook
    await adapter.connect();
    
    // Setup graceful shutdown handlers
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
    
    // This will never return, keeping the process alive
    await adapter.run();
    
    // Log that we're ready
    logger.info('✅ Email listening service is ready');
    logger.info(`📧 Watching for emails with label: "${config.gmail.labelName}"`);
    logger.info('💡 Tip: Use "npm run simulate-webhook" to test with sample data');
    logger.info('💡 Tip: Use "SEND_REAL_EMAIL=true npm run simulate-webhook" to send real emails');
  } catch (err) {
    logger.error(`❌ Data listening failed: ${err instanceof Error ? err.message : String(err)}`);
    await adapter.disconnect();
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runDataListening();
}
