// scripts/eval-fetch-and-trigger.ts
// Node.js/TS eval: fetch Gmail messageIds (since 7 days by default), POST to webhook for ingestion.
import { GmailService } from '../src/services/gmail.js';
import { config } from '../src/config.js';
import fetch from 'node-fetch';
import fs from 'fs';
import { getLogger } from '../src/services/logger.js';

const WEBHOOK_URL = process.env.WEBHOOK_URL || 'http://127.0.0.1:PORT/webhook'; // Set PORT/env as needed
const LABEL_NAME = process.env.LABEL_NAME || config.gmail.labelName;
const FETCH_LIMIT = parseInt(process.env.FETCH_LIMIT || '20', 10);
const SINCE =
  process.env.FETCH_SINCE || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
const TMP_MSGIDS = process.env.TMP_MSGIDS || 'logs/eval-messageids.json';

async function main() {
  const gmail = new GmailService();
  await gmail.authenticate();
  const labelId = await gmail.getLabelId(LABEL_NAME);
  const msgs = await gmail.listMessagesByLabel(labelId, FETCH_LIMIT, SINCE);

  fs.writeFileSync(
    TMP_MSGIDS,
    JSON.stringify(
      msgs.map((m) => ({ messageId: m.id })),
      null,
      2
    )
  );
  getLogger().info(`[eval-fetch-and-trigger] Saved messageIds: ${msgs.length}`);

  // Batch POST messageIds to webhook in Pub/Sub-compatible format
  for (const entry of msgs) {
    const payload = {
      message: {
        data: Buffer.from(JSON.stringify({ messageId: entry.id })).toString('base64'),
      },
    };
    const res = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    getLogger().info(`[eval-fetch-and-trigger] POST ${entry.id} status=${res.status}`);
  }
}

main().catch((err) => {
  getLogger().error(`[eval-fetch-and-trigger] Error:`, err);
  process.exit(1);
});
