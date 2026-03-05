# Pre-Long-Living Narrative (Hybrid Ratio)

We are now enforcing pre-long-living readiness on `main` with a strict gate model.

## Goal
Serve real incoming job data reliably through two ingestion gates while preserving no-data-loss guarantees and continuous improvement.

## Hybrid model

- **Gate A (automated):** Gmail webhook + scheduled API fetch.
- **Gate B (human):** manual enrichment via enhanced TUI.

### Hybrid ratio target

- **70% automated**
- **30% human-enriched**
- Ratio is adjustable by queue pressure and parse quality trend.

## Core loop (enforced)

`parse -> filter -> score -> (job_queue | needs_enrichment | job_trash)`

- `job_queue`: validated and ready for downstream generation/sending.
- `needs_enrichment`: pending human-in-loop completion.
- `job_trash`: rejected with explicit reason.
- Canonical artifacts: `src/db/e2e-output/*` only.

## UX boundary (enforced)

- Single operator path: `manual-enrichment` delegates to `enhanced-tui`.
- Legacy `manual-enrichment-loop.ts` is not the default operator UX path.
- Manual route outcomes are explicit: validate/edit -> `job_queue`, reject -> `job_trash`.

## P-index readiness

### P0 (must hold now)

1. No-data-loss gate and canonical export verification pass.
2. E2E integrity pass (`full-integration-e2e.test.ts`, `webhook-flow.test.ts`).
3. TUI route correctness for queue/trash boundaries.
4. Operator path is unified (no split UX ambiguity).

### P1 (next)

1. Alert routing truthfulness (desktop/webhook/email).
2. Queue-lag metrics and thresholds.
3. Restart/incident runbook coverage.

### P2 (stability/perf)

1. Bounded concurrency and backpressure behavior.
2. Memory reduction trend under sustained loop.

### P3 (prod ops)

1. Backup/restore drills.
2. SLO dashboard.
3. Deployment hardening and rollback policy.

## Required pre-prod verification

Run in order:

1. `npm run test:e2e`
2. `npm run integrity:once`
3. `npm run manual-enrichment -- --poll-ms=5000`

Ready state is true only when queue/trash transitions and `src/db/e2e-output/*` artifacts match expected evidence.

