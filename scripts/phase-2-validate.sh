#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "🔎 Phase 2 Validation (Lean Gates)"

echo "\n[2.3] Export fixtures"
if ! npm run export-fixtures; then
  echo "❌ export-fixtures failed"
  exit 1
fi

echo "\n[2.4] End-to-end test (manual)"
cat <<'EOF'
Run in two terminals:
  Terminal 1: npm run data-listening
  Terminal 2: SEND_REAL_EMAIL=true npm run simulate-webhook
Then verify:
  mongosh --eval "use('jobs_watcher'); db.raw_ingest.countDocuments()"
  mongosh --eval "use('jobs_watcher'); db.parse_log.countDocuments()"
EOF

echo "\n[2.5] Stress + memory check (manual)"
cat <<'EOF'
Run:
  for i in {1..10}; do npm run simulate-webhook; sleep 2; done
Then verify:
  ps aux | grep "data-listening" | grep -v grep
EOF

echo "\n✅ Phase 2 validation script finished (manual steps remain)"
