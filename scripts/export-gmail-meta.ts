// scripts/export-gmail-meta.ts
// Eval: fetch Gmail messageIds (since 2026-07-01, July 1-17 window, both topcv & indeed)
// and export per-msgid gmailMeta classified by platform into tests/fixtures/{platform}-gmailmeta.json.
import fs from 'fs';
import path from 'path';

import { config } from '../src/config.js';

const LABEL = process.env.GMAIL_LABEL_NAME || config.gmail.labelName;
const SINCE = '2026-07-01'; // window start (inclusive)
const WINDOW_END = '2026-07-18'; // window end (exclusive, covers July 1-17)
const FETCH_LIMIT = 500; // static, ensures the full July 1-17 scope is fetched

const ROOT_DIR = process.cwd();
const OUT_DIR = path.join(ROOT_DIR, 'tests', 'fixtures');

if (
  !fs.existsSync(path.join(ROOT_DIR, 'token.json')) ||
  !fs.existsSync(path.join(ROOT_DIR, 'credentials.json'))
) {
  console.error(`[export-gmail-meta] token.json / credentials.json missing in ${ROOT_DIR}`);
  process.exit(1);
}

// gmail.ts resolves token.json/credentials.json via `__dir/../..` where __dir
// falls back to process.cwd() under tsx loaders. Chdir to a depth-2 dir so that
// `../../` resolves back to the repo root that owns token.json/credentials.json.
const RUNTIME_CWD = path.join(ROOT_DIR, 'logs', 'eval');
fs.mkdirSync(RUNTIME_CWD, { recursive: true });
process.chdir(RUNTIME_CWD);

const { GmailService } = await import('../src/infrastructure/outbound/gmail.js');

async function main(): Promise<void> {
  const gmail = new GmailService();
  await gmail.authenticate();
  const labelId = await gmail.getLabelId(LABEL);
  const msgs = await gmail.listMessagesByLabel(labelId, FETCH_LIMIT, SINCE);

  const windowStart = Date.parse(SINCE + 'T00:00:00Z');
  const windowEnd = Date.parse(WINDOW_END + 'T00:00:00Z');

  console.log(
    `[export-gmail-meta] since=${SINCE} window=${SINCE}..${WINDOW_END} label=${LABEL} fetched=${msgs.length}`
  );

  const topcv: unknown[] = [];
  const indeed: unknown[] = [];

  for (const m of msgs) {
    const id = m.id;
    if (!id) continue;
    const msg = await gmail.getMessage(id);
    const internalDate = msg.internalDate ? parseInt(msg.internalDate, 10) : NaN;
    if (!(internalDate >= windowStart && internalDate < windowEnd)) {
      console.log(
        `[export-gmail-meta] outside window ${new Date(internalDate).toISOString()} skip ${id}`
      );
      continue;
    }
    const from = gmail.extractHeader(msg, 'from');
    const subject = gmail.extractHeader(msg, 'subject');
    const to = gmail.extractHeader(msg, 'to');
    const threadId = msg.threadId ?? gmail.extractHeader(msg, 'message-id');
    const body = gmail.extractBody(msg);

    const entry = {
      messageId: id,
      threadId,
      from,
      to,
      subject,
      body,
    };

    if (/topcv/i.test(from)) {
      topcv.push(entry);
    } else if (/indeed/i.test(from)) {
      indeed.push(entry);
    } else {
      console.log(`[export-gmail-meta] skip ${id} from=${from}`);
    }
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const topcvOut = path.join(OUT_DIR, 'topcv-gmailmeta.json');
  const indeedOut = path.join(OUT_DIR, 'indeed-gmailmeta.json');
  fs.writeFileSync(topcvOut, JSON.stringify(topcv, null, 2));
  fs.writeFileSync(indeedOut, JSON.stringify(indeed, null, 2));

  console.log(`[export-gmail-meta] topcv=${topcv.length} indeed=${indeed.length}`);
  console.log(`[export-gmail-meta] wrote ${topcvOut}`);
  console.log(`[export-gmail-meta] wrote ${indeedOut}`);
}

main().catch((err) => {
  console.error('[export-gmail-meta] error:', err);
  process.exit(1);
});