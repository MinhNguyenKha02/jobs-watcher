// scripts/eval-fetch-and-trigger.ts — fetcher (msgs assigned) direct to processed json
import fs from 'fs';

import fetch from 'node-fetch';

import { config } from '../src/config.js';
import { GmailService } from '../src/infrastructure/outbound/gmail.js';

const WEBHOOK_URL = process.env.WEBHOOK_URL || `http://127.0.0.1:${process.env.WEBHOOK_PORT || '3000'}${process.env.WEBHOOK_PATH || '/webhook/gmail'}`;
const LABEL_NAME = process.env.LABEL_NAME || config.gmail.labelName;
const FETCH_LIMIT = parseInt(process.env.FETCH_LIMIT || '500', 10);
const SINCE = process.env.FETCH_SINCE || new Date(Date.now() - parseInt(process.env.SINCE_DAYS || '7', 10) * 864e5).toISOString();
const UNTIL = process.env.FETCH_UNTIL || (process.env.UNTIL_DAYS ? new Date(Date.now() - parseInt(process.env.UNTIL_DAYS, 10) * 864e5).toISOString() : undefined);
const PROCESSED = process.env.PROCESSED || 'logs/eval-messageids.json';

async function main() {
  const gmail = new GmailService();
  await gmail.authenticate();
  const labelId = await gmail.getLabelId(LABEL_NAME);
  const msgs = await gmail.listMessagesByLabel(labelId, FETCH_LIMIT, SINCE, UNTIL);
  let processed: { messageId: string }[];
  try {
    processed = JSON.parse(fs.readFileSync(PROCESSED, 'utf8'));
  } catch {
    processed = [];
    fs.writeFileSync(PROCESSED, JSON.stringify(processed, null, 2));
  }
  for (const m of msgs) {
    const messageId = m.id!;
    if (processed.find((p) => p.messageId === messageId)) {
      console.log(`\x1b[31m[eval] POST ${messageId} 400 already processed\x1b[0m`);
      continue;
    }
    const res = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messageId }),
    });
    if (res.status === 200 || res.status === 202) {
      console.log(`\x1b[32m[eval] POST ${messageId} ${res.status}\x1b[0m`);
      processed.push({ messageId });
      fs.writeFileSync(PROCESSED, JSON.stringify(processed, null, 2));
    } else {
      console.log(`\x1b[31m[eval] POST ${messageId} ${res.status}\x1b[0m`);
    }
  }
}

main().catch((err) => {
  console.error('[eval-fetch-and-trigger] Error:', err);
  process.exit(1);
});
