#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

LOG_DIR="$ROOT_DIR/logs"
SHIFT_DIR="$LOG_DIR/shift-reports"
mkdir -p "$LOG_DIR" "$SHIFT_DIR"

TIMESTAMP="$(date +%Y-%m-%d_%H-%M-%S)"
REPORT_TXT="$SHIFT_DIR/shift-$TIMESTAMP.txt"
REPORT_JSON="$SHIFT_DIR/shift-$TIMESTAMP.json"
LATEST_TXT="$SHIFT_DIR/shift-latest.txt"
LATEST_JSON="$SHIFT_DIR/shift-latest.json"
LATEST_CASES_FILE="$LOG_DIR/feedback-reports/daily-cases-latest.json"

RUN_HARD_GATE="${RUN_HARD_GATE:-1}"
RUN_DAILY_FEEDBACK="${RUN_DAILY_FEEDBACK:-1}"

{
  echo "[shift] started at $(date -Iseconds)"
  echo "[shift] collecting infra monitor"
} > "$REPORT_TXT"

MONITOR_OUTPUT="$(npm run ll:infra:monitor 2>&1 || true)"
printf '%s\n' "$MONITOR_OUTPUT" >> "$REPORT_TXT"

GATE_STATUS="skipped"
if [ "$RUN_HARD_GATE" = "1" ]; then
  echo "[shift] running hard gate" >> "$REPORT_TXT"
  if npm run ll:gate:hard >> "$REPORT_TXT" 2>&1; then
    GATE_STATUS="pass"
  else
    GATE_STATUS="fail"
  fi
fi

FEEDBACK_STATUS="skipped"
if [ "$RUN_DAILY_FEEDBACK" = "1" ]; then
  echo "[shift] running daily feedback baseline" >> "$REPORT_TXT"
  if npm run ll:daily:feedback:baseline >> "$REPORT_TXT" 2>&1; then
    FEEDBACK_STATUS="pass"
  else
    FEEDBACK_STATUS="warn"
  fi
fi

VERDICT="unknown"
CASE_COUNT="0"
TOP_CASES="none"
if [ -f "$LATEST_CASES_FILE" ]; then
  VERDICT="$(node -e "const fs=require('fs');const d=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));console.log(d.verdict||'unknown')" "$LATEST_CASES_FILE" 2>/dev/null || echo unknown)"
  CASE_COUNT="$(node -e "const fs=require('fs');const d=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));console.log(Array.isArray(d.cases)?d.cases.length:0)" "$LATEST_CASES_FILE" 2>/dev/null || echo 0)"
  TOP_CASES="$(node -e "const fs=require('fs');const d=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));const list=Array.isArray(d.cases)?d.cases.slice(0,5).map(c=>c.case+':'+(c.severity||'na')).join(', '):'none';console.log(list||'none')" "$LATEST_CASES_FILE" 2>/dev/null || echo none)"
fi

GATE_STATUS="$GATE_STATUS" FEEDBACK_STATUS="$FEEDBACK_STATUS" VERDICT="$VERDICT" CASE_COUNT="$CASE_COUNT" TOP_CASES="$TOP_CASES" REPORT_JSON="$REPORT_JSON" node -e "
const fs = require('fs');
const report = {
  generatedAt: new Date().toISOString(),
  hardGate: process.env.GATE_STATUS,
  dailyFeedback: process.env.FEEDBACK_STATUS,
  verdict: process.env.VERDICT,
  caseCount: Number(process.env.CASE_COUNT || '0'),
  topCases: process.env.TOP_CASES || 'none'
};
fs.writeFileSync(process.env.REPORT_JSON, JSON.stringify(report, null, 2));
"

{
  echo "[shift] summary"
  echo "hard_gate=$GATE_STATUS"
  echo "daily_feedback=$FEEDBACK_STATUS"
  echo "verdict=$VERDICT"
  echo "cases=$CASE_COUNT"
  echo "top_cases=$TOP_CASES"
  echo "report_json=$REPORT_JSON"
} >> "$REPORT_TXT"

cp "$REPORT_TXT" "$LATEST_TXT"
cp "$REPORT_JSON" "$LATEST_JSON"

if [ "${DISABLE_NOTIFY:-0}" != "1" ] && command -v notify-send >/dev/null 2>&1; then
  urgency="normal"
  if [ "$VERDICT" = "NO-GO" ] || [ "$GATE_STATUS" = "fail" ]; then
    urgency="critical"
  fi
  notify-send -u "$urgency" "Jobs Watcher Shift" "gate=$GATE_STATUS verdict=$VERDICT cases=$CASE_COUNT"
fi

cat "$REPORT_TXT"
