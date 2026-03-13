#!/usr/bin/env bash
# eval-fetch-and-trigger.sh
# Isolated eval: fetch new Gmail messageIds and POST them to the webhook for ingestion.

set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# Config
FETCH_LIMIT="${1:-10}"
WEBHOOK_URL="http://127.0.0.1:PORT/webhook" # Replace PORT with actual port
LABEL_NAME="${LABEL_NAME:-test-ingest}" # Optionally override with env

# 1. Fetch new emails (outputs messageIds to a temp file)
TMP_MSGIDS="$ROOT_DIR/logs/eval-messageids.json"
node <<'EOF'
const { GmailService } = require('../src/services/gmail.js');
const { config } = require('../src/config.js');
const fs = require('fs');
(async () => {
  const gmail = new GmailService();
  await gmail.authenticate();
  const label = process.env.LABEL_NAME || config.gmail.labelName;
  const msgs = await gmail.listMessagesByLabel(await gmail.getLabelId(label), parseInt(process.env.FETCH_LIMIT || '10', 10));
  fs.writeFileSync(process.env.TMP_MSGIDS, JSON.stringify(msgs.map(m => ({ messageId: m.id })), null, 2));
  console.log(`[eval-fetch-and-trigger] Saved messageIds: ${msgs.length}`);
})();
EOF

# 2. Batch POST messageIds to webhook
if [ -f "$TMP_MSGIDS" ]; then
  node <<'EOF'
const fs = require('fs');
const fetch = require('node-fetch');
const msgids = JSON.parse(fs.readFileSync(process.env.TMP_MSGIDS, 'utf8'));
const url = process.env.WEBHOOK_URL;
(async () => {
  for (const entry of msgids) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messageId: entry.messageId })
    });
    console.log(`[eval-fetch-and-trigger] POST ${entry.messageId} status=${res.status}`);
  }
})();
EOF
else
  echo "[eval-fetch-and-trigger] No messageIds found to POST."
fi
