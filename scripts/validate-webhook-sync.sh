#!/usr/bin/env bash
# validate-webhook-sync.sh
# Compares persisted Gmail messageIds with webhook-processed messageIds for sync validation.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GMAIL_FILE="$ROOT_DIR/logs/gmail-messageids-latest.json"
WEBHOOK_FILE="$ROOT_DIR/logs/webhook-messageids-latest.json"
MISSING_FILE="$ROOT_DIR/logs/webhook-missing-messageids.json"

if [ ! -f "$GMAIL_FILE" ]; then
  echo "[validate-webhook-sync] Gmail messageId file not found: $GMAIL_FILE"
  exit 1
fi
if [ ! -f "$WEBHOOK_FILE" ]; then
  echo "[validate-webhook-sync] Webhook messageId file not found: $WEBHOOK_FILE"
  exit 1
fi

node <<'EOF'
const fs = require('fs');
const gmailList = JSON.parse(fs.readFileSync(process.env.GMAIL_FILE, 'utf8'));
const webhookList = JSON.parse(fs.readFileSync(process.env.WEBHOOK_FILE, 'utf8'));
const webhookIds = new Set(webhookList.map(x => x.messageId));
const missing = gmailList.filter(x => !webhookIds.has(x.messageId));
fs.writeFileSync(process.env.MISSING_FILE, JSON.stringify(missing, null, 2));
console.log(`[validate-webhook-sync] Missing in webhook: ${missing.length}`);
if (missing.length > 0) process.exit(2);
EOF
