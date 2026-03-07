#!/usr/bin/env bash
# trigger-webhook-missing.sh
# For each missing messageId, triggers the webhook endpoint to reprocess the message.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MISSING_FILE="$ROOT_DIR/logs/webhook-missing-messageids.json"
WEBHOOK_URL="http://127.0.0.1:PORT/webhook" # Replace PORT with actual port if needed

if [ ! -f "$MISSING_FILE" ]; then
  echo "[trigger-webhook-missing] No missing messageId file found: $MISSING_FILE"
  exit 0
fi

node <<'EOF'
const fs = require('fs');
const fetch = require('node-fetch');
const missing = JSON.parse(fs.readFileSync(process.env.MISSING_FILE, 'utf8'));
const url = process.env.WEBHOOK_URL;
(async () => {
  for (const entry of missing) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messageId: entry.messageId })
    });
    console.log(`[trigger-webhook-missing] POST ${entry.messageId} status=${res.status}`);
  }
})();
EOF
