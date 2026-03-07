#!/usr/bin/env bash
set -euo pipefail

# Commit-time gate for core pipeline/hot-commit changes.
# Focus: prove runtime evidence contract without truncating live DB.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "[long-living:commit] Running E2E suite..."
npm run test:e2e

echo "[long-living:commit] Exporting artifacts..."
npm run export:e2e

echo "[long-living:commit] Verifying hard gates..."
VERIFY_P0_HARD=1 VERIFY_P1P2_HARD=1 VERIFY_OPERATOR_FRESHNESS=1 OPERATOR_EVIDENCE_MAX_AGE_HOURS=24 npm run verify:e2e-output

echo "[long-living:commit] Gate PASS. Commit is promotable (subject to review)."
