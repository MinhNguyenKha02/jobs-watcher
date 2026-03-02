import { GmailService } from '../src/services/gmail.js';
import { config } from '../src/config.js';
import { getLogger } from '../src/services/logger.js';
import { notifyUser } from '../src/services/notifications.js';
import { RawEmailStorage } from '../src/services/storage/raw-email-storage.js';

const logger = getLogger();

async function main() {
  try {

    const limit = parseInt(process.env.FETCH_LIMIT || '5', 10);
    const since = process.env.FETCH_SINCE || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(); // default: last 24h
    const storage = new RawEmailStorage();
    const baseDir = RawEmailStorage.resolveBaseDir();
    let savedCount = 0;
    let errorCount = 0;

    logger.info(`📥 Starting raw email fetch (limit: ${limit}, since: ${since}, baseDir: ${baseDir})`);

    const gmail = new GmailService();
    await gmail.authenticate();
    logger.info(`✅ Gmail authenticated`);

    const labelId = await gmail.getLabelId(config.gmail.labelName);
    logger.info(`📂 Label ID: ${labelId}`);

    // Fetch messages since the given date (if supported)
    let messages = [];
    try {
      messages = await gmail.listMessagesByLabel(labelId, limit, since);
    } catch (err) {
      logger.error(`Failed to fetch messages by label: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
    logger.info(`📮 Found ${messages.length} messages`);

    for (const msg of messages) {
      if (!msg.id) {
        logger.warn(`Skipped message with no ID`);
        continue;
      }

      try {
        const full = await gmail.getMessage(msg.id);
        const subject = gmail.extractHeader(full, 'Subject') || '(no subject)';
        const from = gmail.extractHeader(full, 'From') || '(unknown sender)';
        const body = gmail.extractBody(full);

        const { jsonlFile, bodyFile } = storage.append({
          messageId: msg.id,
          from,
          subject,
          body,
          baseDirOverride: baseDir,
        });

        logger.info(`✓ Saved ${msg.id}: ${subject}`);
        savedCount++;
      } catch (err) {
        logger.warn(`✗ Failed to save ${msg.id}: ${err instanceof Error ? err.message : String(err)}`);
        errorCount++;
      }
    }

    logger.info(`📊 Complete: ${savedCount} saved, ${errorCount} errors`);

    // Cleanup old emails (>30 days)
    logger.info(`🧹 Cleaning up old emails...`);
    const deleted = storage.cleanupOldEmails(baseDir);
    for (const entry of deleted) {
      logger.info(`🗑️  Deleted old emails: ${entry}`);
    }
    
    if (savedCount === 0 && errorCount === 0) {
      logger.info(`ℹ️  No messages to fetch.`);
    }

    // Notify on successful fetch (if fetched enough emails)
    if (savedCount >= 10) {
      await notifyUser({
        title: '📥 Emails Fetched',
        message: `Fetched ${savedCount} new job emails`,
        urgency: 'normal',
      }).catch(() => {});
    }

    // Notify if high error rate
    if (errorCount > 0 && savedCount > 0 && errorCount / (savedCount + errorCount) > 0.3) {
      await notifyUser({
        title: '⚠️ Fetch Errors',
        message: `${errorCount} errors while fetching ${savedCount + errorCount} emails`,
        urgency: 'normal',
      }).catch(() => {});
    }

  } catch (err) {
    logger.error(`fetch-raw-emails failed: ${err instanceof Error ? err.message : String(err)}`);
    
    // Notify on critical error
    await notifyUser({
      title: '❌ Fetch Failed',
      message: `Email fetch error: ${err instanceof Error ? err.message : 'Unknown'}`,
      urgency: 'high',
    }).catch(() => {});
    
    process.exit(1);
  }
}

main();
