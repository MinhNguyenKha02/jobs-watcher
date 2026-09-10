# tmux metrics infraReady hard-cut + hex separation — Plan

## Global

**Goal:** Replace harmless `ns`/`12 keys`/`/metrics` literals with single dynamic `infra_ready{component}` gauge + live depths, hard-cut legacy `rmq_connected/queue_mode`, expose full registry only via `metrics` (no hidden work status), and enforce hexagonal import separation via lint, with 2 poll panes (PC `9091` tui / PD `9090` daemon) compatible but not confused (no linear monitor).

**Outcomes:**
- `infra_ready` single gauge daemon `{mongo,rabbitmq,browser,uds,webhook,scheduler}` + `extraction_queue_depth` and tui `{rmq,rmq_channels,uds_client,ipc,queue_mode}` are prom counters/gauges, `/metrics` text + `/health/observability` JSON `metrics.infraReady` contain them.
- Panes PC 1s 96-col tui + PD 5s 64-col daemon render 6-7 lines bordered, dynamic `stdout.columns`, `AbortSignal.timeout(2000)`, bordered title `┌─ daemon 9090 ─┐`/`┌─ tui 9091 ─┐` (only static) + bordered error on `!ok/catch/wrong-port`, no static `pref 5/5/1/5`, `ns`, `keys` hints.
- MetricPort DIP: `application` depends on `DaemonMetricsPort` not concrete, `presentation/tui` on `TuiMetricsPort`; shared `metrics-view.ts` deduplicates `sumMetric/findMetric/toCamel`.
- Lint `import/no-restricted-paths` + `no-restricted-imports` passes; `vitest` unit+contract green before smoke; smoke `npm run daemon` + `curl` + `tmux list-panes` validates live infra.

**Constraints:**
- More lines OK, no scroll, row/col compat (`inner=max(10,width-2)`, `truncate`).
- Hard-cut (delete aliases, no fallback).
- `metrics` only accepted in panes; `containers/health` ignored for display.
- Proc eval fetcher out of concern for smoke; smoke is curl+tmux.

**Phases-ordering prevention (regression failure):**
- P1 lint → P2 registry → P3 ports → P4 shared view → P5 container wiring → P6 panes+polls → P7 tests/helpers hard-cut → P8 verification vitest→smoke → P9 commit. Ordering prevents: lint after code (would miss hex violations), tests before panes (would test stubs), smoke before vitest (would chase flakes).

---

## Per-Phase

### P1 — Lint hex separation

**Goal:** Enforce `domain∤infra/presentation`, `application∤infra`, `application/ports∤infra`, inbound∤outbound browser, presentation∤persistence/application impl; forbid importing `metrics-registry` concretely.

**Outcomes:** `.eslintrc.json` new `import/no-restricted-paths` zones + `no-restricted-imports` for `DaemonMetricsRegistry/TuiMetricsRegistry` → `npm run lint` fails on violations.

**Constraints:** Extend `import` plugin; keep `prettier` compat; tests keep lenient overrides.

**Steps:**
1. Edit `.eslintrc.json:27-66` rules add zones + patterns (domain→infra/presentation/application, application→infra/presentation, ports→infra, inbound→outbound browser).
2. `npm run lint -- src/application/ingestor.ts` smoke to see blocked import.

**Fallback:** If zone too strict, relax one zone to `warn`.

### P2 — Registry hard-cut + single gauge

**Goal:** Single `infra_ready` dynamic gauge, hard-cut `rmq_connected/queue_mode`, add depth.

**Outcomes:** `metrics-registry.ts:3-220` Daemon adds `infraReady{component}`, `extractionQueueDepth`; TUI adds `infraReady{component}` and deletes `rmqConnected/QueueMode` + init `set(0/1)` + `syncSnapshot` fields.

**Constraints:** One gauge per registry (label cardinality ≤6/5); prom `15.1.3` compatible.

**Steps:**
1. Daemon `DaemonMetricsRegistry` add `infraReady` Gauge `infra_ready` label `component`, `extractionQueueDepth` Gauge.
2. TUI `TuiMetricsRegistry` add `infraReady`, delete `rmqConnected/QueueMode` fields + `syncSnapshot {connected,queueMode}` rename to `{rmq, queueMode}` labels via `infraReady`, update `incConsumed` unchanged.

**Fallback:** If TUI deletes break contract, temporary keep thin alias one commit then delete next.

### P3 — MetricPort DIP

**Goal:** `application` + `tui` depend on ports.

**Outcomes:** `src/application/ports/metrics.port.ts` `DaemonMetricsPort` + `src/presentation/tui/ports/tui-metrics.port.ts` `TuiMetricsPort`; registries `implements`; adapters `ingestor.ts:15`/`extraction-scheduler.ts:4`/`rabbitmq-*.ts`/`mongo-extraction-queue-adapter.ts` import port.

**Constraints:** Container still `new DaemonMetricsRegistry()` structurally satisfies port; `src/index.ts:{}` unchanged.

**Steps:**
1. Create port files with `setInfraReady`, `setExtractionQueueDepth`, `inc*`, `observeDuration`.
2. Update imports in 5 files.

**Fallback:** `any` cast if type loop.

### P4 — Shared metrics-view helper

**Goal:** Deduplicate `sumMetric/findMetric/toCamel/avgDuration`.

**Outcomes:** `src/presentation/tui/services/metrics-view.ts` exported helpers reused by both panes + helpers/tests.

**Constraints:** Pure, no infra/app import.

**Steps:**
1. Extract helpers from `ObserveCompactPane:13`/`RmqConsumerPane:28`.

### P5 — Container wiring infraReady + depth

**Goal:** Real infra readiness reflected.

**Outcomes:** `container.ts:170-194` daemon sets `infraReady{component}=1` after each `await connect/start`, `0` on catch/stop, `setInterval 2s gauge.set(await queue.size())`; tui `329-346` sets `rmq/rmq_channels/uds_client/ipc/queue_mode` via `fs.existsSync` + `reader.start`.

**Constraints:** Best-effort `close` on stop.

**Steps:**
1. Wire daemon 6 components + depth interval.
2. Wire tui 5 components.

**Fallback:** Depth via `enq-deq` delta if `size()` throws.

### P6 — Panes + poll scripts

**Goal:** 6-7 line dynamic panes with bordered title/error, no harmless.

**Outcomes:** `ObserveCompactPane`/`RmqConsumerPane` rewrite to tables in prompt §4; `poll-rmq-pane.ts:10,23` + `observability.ts:2,19` add `fetchWithTimeout(AbortSignal.timeout(2000))`, `width=stdout.columns||64/96`, `SIGWINCH`, bordered error + wrong-port guard.

**Constraints:** `inner=max(10,width-2)`, `truncate`, no scroll.

### P7 — Tests/helpers hard-cut

**Goal:** No hidden status; infraReady asserted.

**Outcomes:** `helpers/assert-metrics.ts` deduplicated + `assertInfraReady`, `assertExtractionQueueDepth`; `observe-compact.test.ts` 1→7, `rmq-pane.test.ts` 3→8 (infraReady, depth, NaN, truncate, containers-ignored); `health-monitor.contract.test.ts` 3→7 (infraReady labels, depth, histogram buckets, heap, snake-key absent).

### P8 — Verification (vitest before smoke)

**Goal:** Gate.

**Outcomes:** Lint/type-check/vitest green, then smoke curl+tmux green.

**Constraints:** Vitest must pass before smoke started.

**Steps:**
1. `npm run lint && npm run type-check && npm run type-check:tests && npx vitest run tests/unit/presentation/tui/rmq-pane.test.ts tests/unit/presentation/tui/observe-compact.test.ts tests/contract/inbound/health-monitor.contract.test.ts --reporter=verbose`
2. `npm run test:unit && npm run test:contract`
3. `npm run daemon` proc A (sleep 3) + `curl 9090/9091/health/observability|metrics|jq` + `tmux list-panes` as §4 smoke.

**Fallback:** If smoke flake, `freePort()` helper pattern reused.

### P9 — Commit

**Goal:** Git add code-only + commit by log convention, add changelog to this plan.

**Outcomes:** `git add` only code + plan (exclude logs), commit `feat(metrics): single infraReady + depth hard-cut + hex lint`, plan Changelog section appended.

**Constraints:** Don't touch HEAD beyond new commit; no stash.

**Steps:**
1. `git add` code + `.eslintrc.json` + `plans/2026-09-10-tmux-metrics-infra-ready.md`.
2. `git commit -m "..."` per `git log --oneline` feat/fix style.

## Changelog
- 2026-09-10 initial plan persisted.
- 2026-09-10 build: P1 lint zones + no-restricted-imports (metrics-registry, shared-tui-state); P2 infraReady single gauge + extractionQueueDepth hard-cut rmqConnected/queueMode; P3 MetricPort DIP (DaemonMetricsPort/TuiMetricsPort) + LoggerPort injection; P4 metrics-view dedup; P5 container infraReady wiring + depth interval; P6 panes 6-7L bordered title/error dynamic width timeout SIGWINCH wrong-port guard, poll-rmq-pane moved src/infrastructure/inbound/cli + shim + tmux path; P7 assert-metrics + contract/unit hard-cut (infraReady, depth, consumed, containers-ignored); P8 vitest unit+contract green before smoke (lint/type-check pass); P9 pending commit.
- 2026-09-10 hex fix: domain return/throw (artifact.builder, html-job-parser logger removal), ProfileSource via asset-producing.port re-export (no lazy, json file only), application only container.ts override kept, presentation/tui explicit hex kept.
