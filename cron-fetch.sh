#!/bin/bash

# Daily cron job: Fetch emails, analyze, and cleanup old months
# Run once per day (e.g., 0 8 * * * /path/to/cron-fetch.sh)

set -e
cd "$(dirname "$0")"

# Set fetch limit (default 30 days)
export FETCH_LIMIT=${FETCH_LIMIT:-30}

echo "[$(date)] Starting daily job..."

# Step 1: Fetch new emails from Gmail
echo "[$(date)] Fetching emails..."
npm run fetch:raw-emails

# Step 2: Analyze emails and filter jobs
echo "[$(date)] Analyzing email














s..."
npm run analyze:raw-emails

# Step 3: Cleanup old monthly directories (older than current month)
echo "[$(date)] Cleaning up old months..."
CURRENT_MONTH=$(date +%Y-%m)
if [[ -d "src/db/emails" ]]; then
  find src/db/emails -maxdepth 1 -type d -name "????-??" | while read monthdir; do
    if [[ "$monthdir" != "src/db/emails/$CURRENT_MONTH" ]]; then
      echo "[$(date)] Removing old month: $monthdir"
      rm -rf "$monthdir"
    fi
  done
fi

echo "[$(date)] Daily job completed successfully"
