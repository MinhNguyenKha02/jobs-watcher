# Long-Living 24/7 Evaluation Phase (Single Source)

This document is the canonical operational gate for long-living readiness and runtime governance.

## Phase Model (Single Long-Living Phase)

The project no longer separates beta/pre-prod/prod as independent readiness tracks.
Use one 24/7 long-living phase with four micro stages:

1. **Micro A — Fire Readiness**: runbook execution + hard-gate pass.
2. **Micro B — Runtime Validation**: manual TUI routing evidence + artifact correlation.
3. **Micro C — Stability & Safety**: fallback triggers, monitoring, alerting, and restart behavior.
4. **Micro D — Commit Governance**: CI graph checks and hot-commit exit criteria.

## Required Fire Sequence (Hard Gate)

Run in strict order:

```bash
npm run ll:fire:verify
npm run ll:human:loop
npm run ll:gate:hard
```

Long-living fire is allowed only when all commands pass.

For a one-time lab reset flow (truncate + rebuild + export + inspect), use:

```bash
npm run integrity:once
```

## Two-Terminal Operations Runbook

Use exactly two terminals during fire validation:

- **Terminal A (service/operator path)**
  - `npm run ll:infra:autostart` (starts bash supervisor for `serve:hybrid`)
  - `npm run ll:infra:monitor` (status, metrics, latest CASE verdict)
  - `npm run clipboard:trigger` (run only when operator wants clipboard ingest)
  - `npm run ll:human:loop`
  - Operator actions must flow through `manual-enrichment -> enhanced-tui`.

- **Terminal B (gate/verifier path)**
  - `npm run ll:daily:closeout`
  - `npm run ll:gate:hard`

Gate exposure rule: if Terminal B hard-gate fails at any point, Terminal A is not promotable.

### Bash-First Autostart (Ubuntu Live Session)

This phase uses bash supervision as default infra control (no Docker/systemd dependency).

Recommended power-on setup:

```bash
crontab -e
@reboot cd /home/minh-nguyen/node_projects/jobs-watcher && npm run ll:infra:autostart >> logs/infra-autostart.log 2>&1
```

Manual controls:

```bash
npm run ll:infra:autostart
npm run ll:infra:monitor
npm run ll:infra:stop
```

## Responsibility Split (Operator vs CI vs Artifacts)

- **Operator terminal responsibility**: keep human-in-loop decisions explicit and deterministic (`manual_validate_to_queue` or `manual_reject_to_trash`).
- **CI responsibility**: enforce hard-gate truth on every commit and block promotion on evidence mismatch.
- **Artifact responsibility**: serve as source-of-truth for compliance; if artifacts disagree with logs or assumptions, artifacts win.

## 7:3 Ratio Control (Automated vs Manual)

Target baseline from narrative:

- **70% automated path**: direct flow to `job_queue` where enrichment is not required.
- **30% manual path**: `needs_enrichment` decisions finalized by TUI to `job_queue` or `job_trash`.

Operational interpretation:

1. Track ratio daily from exported artifacts.
2. If manual share rises persistently above target, investigate parser/filter quality and backlog pressure.
3. If manual share drops sharply with rising trash rate, investigate false rejects and route quality.
4. Ratio changes are allowed only with artifact-backed reasoning and documented decision in cycle notes.

## TUI Human-in-the-Loop Routing Logic

Deterministic routing contract:

1. `manual_validate_to_queue` -> `finalRoute=job_queue` -> record must exist in `job_queue`.
2. `manual_reject_to_trash` -> `finalRoute=job_trash` -> record must exist in `job_trash`.
3. Every finalized manual route must have correlated `messageId` across action log + enrichment + terminal collection.

TUI correctness is accepted only via runtime evidence in exported artifacts.

## Artifact Evaluation (Daily, API/Manual)

Canonical evidence directory: `src/db/e2e-output/`.

Daily checklist:

1. `e2e-raw-ingest.json` exists, JSON-valid, non-stale.
2. `e2e-parse-log.json` reflects current input volume.
3. `e2e-needs-enrichment.json` includes explainable reason/status progression.
4. `e2e-action-log.json` contains terminal TUI action evidence.
5. `needs_enrichment.finalRoute` correlates to correct terminal collection write.
6. `e2e-metrics.json` contains queue lag, concurrency, backpressure, memory trend points.

If any item fails, hold promotion and treat as no-data-loss risk.

## Daily Cycle (24/7 Operations)

Run this cycle once per day (or per shift boundary):

1. Keep Terminal A running for operator decisions.
2. Execute Terminal B verification commands.
3. Read and sample artifacts from `src/db/e2e-output/*`.
4. Decide GO/HOLD/NO-GO using Decision Matrix.
5. Record one improvement action for next cycle (parser, routing, monitoring, or runbook quality).

Suggested command block:

```bash
npm run ll:daily:closeout
```

For end-of-day real-income closeout (without DB truncate), use:

```bash
npm run ll:daily:closeout
```

## Crash Fallback Triggers

Trigger fallback and incident handling when any condition occurs:

- Webhook ingest unavailable or unstable for sustained period.
- Memory/pressure alerts hit critical threshold repeatedly.
- Unexpected restart spikes or process instability.
- Hard-gate verification fails after recent healthy state.

Fallback response:

1. Keep ingest durable in `raw_ingest`.
2. Route uncertain jobs to `needs_enrichment`.
3. Keep terminal writes deterministic (`job_queue`/`job_trash`).
4. Re-run hard-gate verification before re-promoting.

## Monitoring and Alerting Controls

Required controls:

- Queue lag trend monitoring.
- Concurrency and backpressure monitoring.
- Memory trend monitoring (warning + critical thresholds).
- Alert routing truthfulness (`desktop`, `webhook`, `email`).

Alert resolution rule: no unresolved critical alert before GO decision.

Laptop baseline guardrails (Ubuntu 22, 16GiB RAM profile):

- Keep one long-living service process for core ingress (`MAX_SERVICE_PROCS=1`).
- Keep human TUI in a separate terminal (do not embed in service process).
- Watch swap pressure and restart frequency in daily automation.
- Run `npm run ll:daily:feedback` for closeout + hard gate + infra warnings.
- Review `logs/feedback-reports/daily-cases-latest.json` for GO/HOLD/NO-GO case verdict.

### Hardware-Aware Threshold Policy (i5 10th-gen, 16GiB, zRAM + ~10GiB swapfile)

Policy intent:

- Keep bash-only supervision/monitoring as primary control plane.
- Keep OS swappiness tuning independent (for example `vm.swappiness=15`) and do not force swap reduction from app scripts.
- Gate on sustained risk using thresholds, not on any swap usage.

Recommended persistent `.env` policy:

```bash
INFRA_PROFILE=i5_10th_16g_zram_swapfile
MAX_SWAP_USED_MB=4608
MAX_DISK_PERCENT=90
MAX_SERVICE_PROCS=1
MAX_RESTARTS_DAILY=5
MAX_CPU_PERCENT=95
```

Temporary strict mode (incident drill):

```bash
MAX_SWAP_USED_MB=3072 npm run ll:daily:feedback
```

Temporary relaxed mode (multitask-heavy day):

```bash
MAX_SWAP_USED_MB=5120 npm run ll:daily:feedback
```

Decision rule:

- Use strict mode for stress tests and incident rehearsal.
- Use persistent baseline for normal long-living operation.
- Record any temporary threshold override in daily notes before GO decision.

## Daily CI Issue Cases and Thresholds

### Policy Configuration (Finalized)

**Queue Lag Threshold**: `P1_QUEUE_LAG_MAX_MS=300000` (5 minutes)  
**Failure Policy**: Hard fail - gate failures block commit/promotion immediately  
**Alert Routing**: webhook + email + log (comprehensive validation)

Use these named cases in daily reports and incident notes:

- `CASE_P1_QUEUE_LAG`: queue lag exceeds threshold (`P1_QUEUE_LAG_MAX_MS`, default `300000`).
- `CASE_P1_ALERT_ROUTE_MISSING`: no routed alert evidence in action log (`desktop|webhook|email`).
- `CASE_P2_CONCURRENCY_MISSING`: missing `concurrency_inflight` metric points.
- `CASE_P2_BACKPRESSURE_MISSING`: missing `backpressure_queue_depth` metric points.
- `CASE_P2_MEMORY_TREND`: memory trend not improving (`memory_rss_mb` last > first).
- `CASE_INFRA_SWAP_PRESSURE`: swap pressure exceeds profile threshold (`MAX_SWAP_USED_MB`).
- `CASE_INFRA_RESTART_SPIKE`: restart count exceeds `MAX_RESTARTS_DAILY`.
- `CASE_INFRA_SERVICE_DOWN`: core pipeline pid unhealthy.
- `CASE_INFRA_SUPERVISOR_DOWN`: infra supervisor pid unhealthy.
- `CASE_INFRA_DUPLICATE_PROCS`: process-group count exceeds `MAX_SERVICE_PROCS`.
- `CASE_INFRA_DISK_PRESSURE`: disk usage exceeds `MAX_DISK_PERCENT`.

Recommended command loop:

```bash
npm run ll:daily:closeout
P1_QUEUE_LAG_MAX_MS=300000 npm run ll:gate:hard
npm run inspect:db
npm run inspect:logs
```

## CI, CI Graph, and Commit Governance

CI pass is necessary but not sufficient.

Interpretation rules:

- Green CI with missing runtime evidence => **HOLD**.
- Rising `needs_enrichment` with weak terminal transitions => human-loop bottleneck.
- Rising `job_trash` at stable intake => parser/filter regression risk.

Hard-gate pass (`verify:e2e-output`) is the required CI graph anchor.

## Commit-Time Cycle (Every New Commit)

For commits touching core pipeline or routing paths:

1. Run `npm run test:e2e`.
2. Run `npm run ll:commit:gate`.
3. Confirm manual-path runtime evidence still appears in artifacts.
4. Re-check hard gate via `npm run ll:gate:hard` if any post-gate artifact changed.

Commit is not promotable if any step fails, even when unit/integration tests pass.

Convenience command:

```bash
npm run ll:commit:gate
```

CI commit evaluation expectation:

- Keep case names stable (`CASE_*`) so CI and incident records remain diffable.
- For commits touching infra/gates, attach latest `daily-cases-latest.json` verdict in review notes.
- Promotion requires gate pass + no critical CASE + documented threshold profile.

## Fixture vs Real Ingress Rule

- Real 24/7 ingress must run with fixture mode disabled:
  - `INGRESS_FIXTURE_MODE=0`
  - `CLIPBOARD_FIXTURE_MODE=0`
- Fixture-driven adapter ingestion is test-only and must be explicit (`INGRESS_FIXTURE_MODE=1`).
- Production long-living mode must not enable fixture ingress.

## TUI Waiting I/O and Non-Blocking Rule

- Manual enrichment is human-latency-tolerant by design; waiting for operator input must not disable verification loop.
- Keep verifier commands independent in Terminal B so gate status remains observable during TUI waiting periods.
- If TUI becomes unresponsive or slow under volume, enter HOLD, trigger incident handling, and prioritize safe fallback routing.

## Hot Commit Exit Criteria

Hot commits touching parse/filter/score/routing/manual-enrichment/export/verify paths must satisfy all:

1. Re-run full fire sequence.
2. Re-validate TUI runtime routing evidence.
3. Hard gates pass with `VERIFY_P0_HARD=1 VERIFY_P1P2_HARD=1 VERIFY_OPERATOR_FRESHNESS=1`.
4. No unresolved critical monitoring alert.

If any criterion fails: rollback or patch, then re-run from step 1.

## Decision Matrix

- **GO**: fire sequence passed + runtime routing evidence valid + hard gates green + no critical alerts.
- **HOLD**: CI green but routing/artifact/monitoring evidence incomplete.
- **NO-GO**: hard-gate failure, data-loss risk, or unresolved critical incident.

## Weekly Improvement Loop (Solo SWE)

Use artifact trends to drive one-week improvements:

1. Identify biggest drift (ratio, queue lag, trash growth, or missing correlation).
2. Apply smallest safe change.
3. Re-run daily + commit-time cycles.
4. Keep change only when hard-gate truth and artifact quality both improve.
