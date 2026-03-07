#!/usr/bin/env bash
# persist-gmail-messageids.sh
# Fetches Gmail messageIds from the last 7 days and persists them with timestamp for sync validation.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_FILE="$ROOT_DIR/logs/gmail-messageids-latest.json"

# Use Node.js script to fetch and persist messageIds with timestamp
node <<'EOF'
const { GmailService } = require('../src/services/gmail.js');
const fs = require('fs');
const path = require('path');
(async () => {
  const gmail = new GmailService();
  await gmail.authenticate();
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const labelId = await gmail.getLabelId(require('../src/config.js').config.gmail.labelName);
  const messages = await gmail.listMessagesByLabel(labelId, 500, since);
  const out = messages.map(m => ({ messageId: m.id, timestamp: m.internalDate || null }));
  fs.writeFileSync(process.argv[1], JSON.stringify(out, null, 2));
  console.log(`[persist-gmail-messageids] Saved ${out.length} messageIds to ${process.argv[1]}`);
})(OUT_FILE).catch(e => { console.error(e); process.exit(1); });
EOF
