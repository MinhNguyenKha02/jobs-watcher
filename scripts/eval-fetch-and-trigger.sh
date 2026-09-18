#!/usr/bin/env bash
# eval-fetch-and-trigger.sh — wrapper 1 sh + 1 node + 1 processed json (no fetched file)
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
FETCH_LIMIT="${1:-500}"
SINCE_DAYS="${2:-7}"
UNTIL_DAYS="${3:-}"
CLEAN_FLAG="${4:-}"
WEBHOOK_URL="${WEBHOOK_URL:-http://127.0.0.1:${WEBHOOK_PORT:-3000}${WEBHOOK_PATH:-/webhook/gmail}}"
LABEL_NAME="${LABEL_NAME:-${GMAIL_LABEL_NAME:-Job-Alerts}}"
PROCESSED="$ROOT_DIR/logs/eval-messageids.json"
mkdir -p "$ROOT_DIR/logs"
if [[ "$CLEAN_FLAG" == "clean" || "$CLEAN_FLAG" == "--clean" ]]; then rm -f "$PROCESSED"; fi
export FETCH_LIMIT SINCE_DAYS UNTIL_DAYS WEBHOOK_URL LABEL_NAME PROCESSED
npx tsx scripts/eval-fetch-and-trigger.ts || exit 1
