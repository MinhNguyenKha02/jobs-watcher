#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$ROOT_DIR/logs"
mkdir -p "$LOG_DIR"

AUTOSTART_LINE="@reboot cd $ROOT_DIR && npm run ll:infra:autostart >> logs/infra-autostart.log 2>&1"
MORNING_LINE="0 9 * * * cd $ROOT_DIR && npm run ll:scheduled:cycle >> logs/ll-scheduled-cycle.cron.log 2>&1"
EVENING_LINE="0 21 * * * cd $ROOT_DIR && npm run ll:scheduled:cycle >> logs/ll-scheduled-cycle.cron.log 2>&1"

CURRENT_CRON="$(crontab -l 2>/dev/null || true)"
FILTERED_CRON="$(printf '%s\n' "$CURRENT_CRON" | grep -v -E 'll:infra:autostart|ll:scheduled:cycle' || true)"

NEW_CRON_CONTENT="$(
  printf '%s\n' "$FILTERED_CRON"
  printf '%s\n' "$AUTOSTART_LINE"
  printf '%s\n' "$MORNING_LINE"
  printf '%s\n' "$EVENING_LINE"
)"

printf '%s\n' "$NEW_CRON_CONTENT" | sed '/^$/d' | crontab -

echo "[ll-cron] installed entries:"
crontab -l | grep -E 'll:infra:autostart|ll:scheduled:cycle' || true
