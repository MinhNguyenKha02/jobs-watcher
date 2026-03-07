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
- Legacy `manual-enrichment-loop.ts` is fallback only and must not be auto-started by default.
- Manual route outcomes are explicit: validate/edit -> `job_queue`, reject -> `job_trash`.

## P-index readiness

### P0 (must hold now)

1. No-data-loss gate and canonical export verification pass.
2. E2E integrity pass (`full-integration-e2e.test.ts`, `webhook-flow.test.ts`).
3. Runtime TUI evidence exists in `action_log`: at least one `manual_validate_to_queue` or `manual_reject_to_trash`.
4. Correlation is explicit: records leaving `needs_enrichment` have `finalRoute` matching terminal write target (`job_queue` or `job_trash`).
5. Operator path is unified (no split UX ambiguity); TUI test matrices are not accepted as sole proof for TUI correctness.

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
4. `VERIFY_P0_HARD=1 VERIFY_P1P2_HARD=1 npm run verify:e2e-output`

Ready state is true only when queue/trash transitions, `src/db/e2e-output/*` artifacts, and `action_log` runtime evidence satisfy P0; test matrices alone do not satisfy TUI correctness.

## Long-living fire playbook

Use this sequence when firing long-living on `main`:

1. Run required pre-prod verification in order.
2. Confirm canonical artifacts in `src/db/e2e-output/*` were refreshed for current run.
3. Confirm runtime TUI evidence exists in `action_log` with at least one terminal action (`manual_validate_to_queue` or `manual_reject_to_trash`).
4. Confirm route correlation: `needs_enrichment.finalRoute` matches terminal target (`job_queue` or `job_trash`) for sampled records.
5. Fire service only after hard gate verification reports OK.

## CI and CI graph loop meaning

- CI loop is accepted only when hard-gate verification is green and artifact counts are non-empty for required collections.
- CI graph trend must be read with artifact context, not pass/fail alone: rising `needs_enrichment` with flat terminal transitions is backlog risk.
- Core pipeline confidence requires stable relationship across `raw_ingest -> parse_log -> (job_queue|job_trash|needs_enrichment)`.
- Any drift that suggests missing terminal transitions is treated as potential no-data-loss breach until resolved.

## Hot commit protocol during core pipeline

- Scope includes changes to parse/filter/score/routing/manual enrichment/export/verification paths.
- Required after each hot commit in scope: rerun pre-prod verification + hard gates before merge.
- Do not mark ready based on unit matrices alone when routing behavior changed.
- If CI is green but runtime evidence contract is broken, block promotion and revert/patch immediately.

## TUI routing evidence contract

Runtime evidence must prove both operator action and terminal route outcome:

1. Action evidence in `action_log` for terminal decision (`manual_validate_to_queue` or `manual_reject_to_trash`).
2. Route evidence in `needs_enrichment.finalRoute`.
3. Terminal write evidence in corresponding target collection (`job_queue` for validate, `job_trash` for reject).

This contract is mandatory for P0; static tests are supportive only.

## No-data-loss compliance by design

- Canonical artifacts in `src/db/e2e-output/*` are the compliance record for evaluation cycles.
- Compliance is design-level, not post-hoc: every transition path must leave durable evidence in Mongo and export artifacts.
- Verification must be reproducible from commands and artifacts without relying on local operator memory.
- Promotion decision is compliance-gated by P-index, with P0 mandatory on `main`.

