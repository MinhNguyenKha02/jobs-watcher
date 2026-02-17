import { GmailService } from '../src/services/gmail.js';
import { config } from '../src/config.js';
import { getLogger } from '../src/services/logger.js';
import { notifyUser } from '../src/services/notifications.js';
import fs from 'fs';
import path from 'path';

const logger = getLogger();

async function main() {
  try {
    const limit = parseInt(process.env.FETCH_LIMIT || '5', 10);
    const baseDir = path.join(process.cwd(), 'src', 'db', 'emails', 'external-sample');
    let savedCount = 0;
    let errorCount = 0;

    logger.info(`📥 Starting external sample fetch (limit: ${limit}, baseDir: ${baseDir})`);

    const gmail = new GmailService();
    await gmail.authenticate();
    logger.info(`✅ Gmail authenticated`);

    const labelId = await gmail.getLabelId(config.gmail.labelName);
    logger.info(`📂 Label ID: ${labelId}`);

    const messages = await gmail.listMessagesByLabel(labelId, limit);
    logger.info(`📮 Found ${messages.length} messages`);

    if (!fs.existsSync(baseDir)) {
      fs.mkdirSync(baseDir, { recursive: true });
    }

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

        const bodyFile = path.join(baseDir, `${msg.id}.body.txt`);
        fs.writeFileSync(bodyFile, body, 'utf-8');

        logger.info(`✓ Saved ${msg.id}: ${subject}`);
        savedCount++;
      } catch (err) {
        logger.warn(`✗ Failed to save ${msg.id}: ${err instanceof Error ? err.message : String(err)}`);
        errorCount++;
      }
    }

    logger.info(`📊 Complete: ${savedCount} saved, ${errorCount} errors`);

    if (savedCount === 0 && errorCount === 0) {
      logger.info(`ℹ️  No messages to fetch.`);
    }

    if (savedCount >= 10) {
      await notifyUser({
        title: '📥 External Sample Fetched',
        message: `Fetched ${savedCount} new job emails (external sample)`,
        urgency: 'normal',
      }).catch(() => {});
    }

    if (errorCount > 0 && savedCount > 0 && errorCount / (savedCount + errorCount) > 0.3) {
      await notifyUser({
        title: '⚠️ Fetch Errors',
        message: `${errorCount} errors while fetching ${savedCount + errorCount} emails (external sample)`,
        urgency: 'normal',
      }).catch(() => {});
    }

  } catch (err) {
    logger.error(`external-sample-fetch failed: ${err instanceof Error ? err.message : String(err)}`);
    await notifyUser({
      title: '❌ External Sample Fetch Failed',
      message: `Email fetch error: ${err instanceof Error ? err.message : 'Unknown'}`,
      urgency: 'high',
    }).catch(() => {});
    process.exit(1);
  }
}

main();
