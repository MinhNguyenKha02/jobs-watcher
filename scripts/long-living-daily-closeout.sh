#!/usr/bin/env bash
set -euo pipefail

# Daily closeout for long-living 24/7 mode.
# This script intentionally does NOT truncate DB and does NOT re-seed E2E fixtures.
# It snapshots real-income state into artifacts and validates hard gates.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

source "$ROOT_DIR/scripts/log-format.sh"
log info long-living-daily "Exporting canonical artifacts from real DB state..."
npm run export:e2e

log info long-living-daily "Running hard gate verification (P0/P1/P2)..."
VERIFY_P0_HARD=1 VERIFY_P1P2_HARD=1 VERIFY_OPERATOR_FRESHNESS=1 OPERATOR_EVIDENCE_MAX_AGE_HOURS=24 npm run verify:e2e-output

log info long-living-daily "Inspecting DB and logs..."
npm run inspect:db
npm run inspect:logs

log success long-living-daily "Done. Review src/db/e2e-output/* as source-of-truth."
