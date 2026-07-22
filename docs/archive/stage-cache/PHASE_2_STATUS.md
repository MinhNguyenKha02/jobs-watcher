# Phase 2 Stage Cache

**Date**: 2026-02-14
**Purpose**: Snapshot of Phase 2 validation state for quick traversal.

## Gate Status

- 2.3 Export fixtures: ✅ Completed
  - failed-parses.json: 0 entries
  - parse-samples.json: 3 entries
  - export-stats.json: counts at 0

- 2.4 End-to-end webhook test: ✅ Completed
  - MessageId: 19c5cab0f443ce10
  - raw_ingest record created
  - parse_log entries for rawIngestId: 2

- 2.5 Stress + memory check: ❌ Failed (memory)
  - raw_before=3 → raw_after=13 (Δ +10)
  - parse_before=5 → parse_after=25 (Δ +20)
  - RSS observed ~173 MB (target < 100 MB)

## Readiness Notes

- Phase 3 prerequisites:
  - seed-test-db script: ✅ Ready
  - beta CI workflow: ✅ Ready

## Source of Truth

- Roadmap: [IMPLEMENTATION_ROADMAP.md](IMPLEMENTATION_ROADMAP.md)
- Gate checklist: [PHASE_2_VALIDATION_GATE.md](PHASE_2_VALIDATION_GATE.md)
- Long-living canonical gate: [../LONG_LIVING_EVALUATION.md](../LONG_LIVING_EVALUATION.md)
