#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

LATEST_CASES_FILE="$ROOT_DIR/logs/feedback-reports/daily-cases-latest.json"

if [ ! -f "$LATEST_CASES_FILE" ]; then
  echo "[ll-notify] cases artifact missing: $LATEST_CASES_FILE"
  if command -v notify-send >/dev/null 2>&1; then
    notify-send -u normal "Jobs Watcher" "No latest CASE artifact found"
  fi
  exit 0
fi

VERDICT="$(node -e "const fs=require('fs');const d=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));console.log(d.verdict||'unknown')" "$LATEST_CASES_FILE")"
CASE_COUNT="$(node -e "const fs=require('fs');const d=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));console.log(Array.isArray(d.cases)?d.cases.length:0)" "$LATEST_CASES_FILE")"
TOP_CASES="$(node -e "const fs=require('fs');const d=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));const list=Array.isArray(d.cases)?d.cases.slice(0,3).map(c=>c.case).join(', '):'';console.log(list||'none')" "$LATEST_CASES_FILE")"

echo "[ll-notify] verdict=$VERDICT cases=$CASE_COUNT top=$TOP_CASES"
cat "$LATEST_CASES_FILE"

if command -v notify-send >/dev/null 2>&1; then
  urgency="normal"
  if [ "$VERDICT" = "NO-GO" ]; then
    urgency="critical"
  fi
  notify-send -u "$urgency" "Jobs Watcher CASE" "verdict=$VERDICT cases=$CASE_COUNT top=$TOP_CASES"
fi
