#!/usr/bin/env bash
# eval-fetch-and-trigger.sh
# Isolated eval: fetch new Gmail messageIds and POST them to the webhook for ingestion.

set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

FETCH_LIMIT="${1:-10}"
WEBHOOK_URL="${WEBHOOK_URL:-http://127.0.0.1:8080/webhook}"
LABEL_NAME="${LABEL_NAME:-test-ingest}"

TMP_MSGIDS="$ROOT_DIR/logs/eval-messageids.json"
mkdir -p "$ROOT_DIR/logs"

# 1. Fetch new emails (outputs messageIds to a temp file)
node --loader ts-node/esm --experimental-specifier-resolution=node <<'EOF'
import { GmailService } from '../../src/infrastructure/inbound/gmail/gmail.js';
import { config } from '../../src/config.js';
import fs from 'fs';

async function main() {
  const gmail = new GmailService();
  await gmail.authenticate();
  const label = process.env.LABEL_NAME || config.gmail.labelName;
  const labelId = await gmail.getLabelId(label);
  const msgs = await gmail.listMessagesByLabel(labelId, parseInt(process.env.FETCH_LIMIT || '10', 10));
  fs.writeFileSync(process.env.TMP_MSGIDS, JSON.stringify(msgs.map(m => ({ messageId: m.id })), null, 2));
  console.log(`[eval-fetch-and-trigger] Saved messageIds: ${msgs.length}`);
}
main().catch(err => { console.error(err); process.exit(1); });
EOF

# 2. Batch POST messageIds to webhook
if [ -f "$TMP_MSGIDS" ]; then
  node --loader ts-node/esm --experimental-specifier-resolution=node <<'EOF'
import fs from 'fs';
import fetch from 'node-fetch';

async function main() {
  const msgids = JSON.parse(fs.readFileSync(process.env.TMP_MSGIDS, 'utf8'));
  const url = process.env.WEBHOOK_URL;
  for (const entry of msgids) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messageId: entry.messageId })
    });
    console.log(`[eval-fetch-and-trigger] POST ${entry.messageId} status=${res.status}`);
  }
}
main().catch(err => { console.error(err); process.exit(1); });
EOF
else
  echo "[eval-fetch-and-trigger] No messageIds found to POST."
fi
