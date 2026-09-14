# TUI IPC code-only 4-phase — Plan (no new P1/P2 tests, states preserved)

## Global

**Goal:** Fix `PA blank while PC cur/pend live` (confirmed bug: `resetState` wipe + `mainLoop` never renders on `jobId` change + `Q/P/F/D 0` hardcoded; `uds_client/ipc 0` never written in prod `OpsTuiApp` path; `PD pub` single-sum meaningless). No new test files. States preserved across `tmux` reruns (no `--purge`).

**Outcomes:**
- `PA` preserves file on `start/stop`, repaints on `IPC` change (`watchStateFile` + `jobId/mode/modal` diff), header `Q/P/F/D cur` real from `reader`.
- `PB` (`ActionController`) unchanged behavior (verify-only).
- `PC infra uds:1 ipc:1` when daemon healthy via dual probe (`existsSync` + active `GET /`).
- `PD` per-key `pub g/pc/pf/q/t/rf` (no total) + `jobs_brok[a/m]` rename.
- Gates: `npx vitest run` (existing unit P1/P2-adjacent suites) + `npm run build + lint` + `npm run test:unit + test:contract + test:integration` unchanged green (cascade updates to existing tests only, logged below).

**Constraints:**
- `IPC` = file seam only (`shared-tui-state.ts`, `TUI_SHARED_STATE_PATH`, `.lock/.tmp` atomic). No new transport.
- No `POST` in probe (no ingestor side effect). `GET / → 401/404 = alive`.
- `PC 96w / PD 64w`, `inner=max(10,width-2)`, no tmux height change.
- Code-only commit; never add `daemon_dev_log.text/guide/logs/tui-logs-*`.
- Hex separation: probe lives in `src/infrastructure/utils/` (importable by both `application/container` and `presentation/tui`).

**Phases-ordering prevention (regression-failure, parallelism safety):**
- `First persist → P1 STDOUT → P2 STDIN verify → P3 probe metric → P4 PD render → Verify(unit→build+lint→contract→integration) → Last commit`.
- Prevents: `P3` before `P1` masks repaint bug; `P4` before `P3` asserts per-key against stale infra; verify before code chases flakes; commit before green violates gate.
- `P1/P2` same seam but different processes; `P3` touches both roots so strictly after.

## First-step: persist plan

Wrote this file to `./plans/2026-09-14-tui-ipc-codeonly-4phase.md`. No code.

## P1 — STDOUT `OpsTuiApp` serves `IPC` (preserve + repaint)

**Goal:** `PA` follows file, never wipes on rerun.
**Outcomes:** Remove `resetState()` on `start` and `clearCurrentJob()` on `stop`; `watchStateFile` + `jobId/mode/modal` diff → `renderFrame()`; real `pending/deferred` from `reader` getters.
**Code-steps:**
1. `tui-stdout-adapter.ts`: drop `resetState/clearCurrentJob` imports-uses; add `watchStateFile` subscription + `lastRenderedJobId`; add probe timer hook point (P3); thread `getQueueDepth/getPendingPartial/getPendingFull/getDeferredCount` into `CardStatus`.
2. `RabbitMqJobReader.ts`: add `getPendingPartial/getPendingFull/getDeferredCount` getters (backward-compatible).
**Fallback:** `100ms` poll diff if `watch` flaky.
**Constraints:** `PA` never `setCurrentJob`.

## P2 — STDIN `ActionController` verify (no change, no new test)

**Goal:** Confirm `PB` reads `IPC` → `UDS`, no wipe.
**Outcomes:** No prod change (no `reset/clear` in stdin path). Existing `keyboard/stdin-status/tui-x-daemon` gate.
**Code-steps:** Read-only check. Skip file if clean.
**Constraints:** Never `set/clear job`.

## P3 — `uds_client/ipc` dual probe (PC infra line)

**Goal:** Truthful `PC infra`.
**Outcomes:** NEW `src/infrastructure/utils/uds-probe.ts` (`probeIpcPath`, `probeUdsActive`); wired `2s` in `OpsTuiApp.start()` + `buildTuiContainer.start()` (shared import); `9091→poll-rmq-pane→RmqConsumerPane`.
**Code-steps:** 1. Create probe. 2. Wire both roots + `clearInterval/unref` on `stop`.
**Fallback:** `/health` alias path.
**Constraints:** No `POST`; infra union unchanged.

## P4 — `PD` per-key `pub` + rename (render-only)

**Goal:** Meaningful `PD`.
**Outcomes:** `ObserveCompactPane.ts` `jobs_brok[a/m]` + `pub g/pc/pf/q/t/rf` no total; update `observe-compact.test.ts` cascade (`pub:5→g:5`, `jobs_brokered→jobs_brok[a/m]`).
**Code-steps:** 1. Edit pane + key map. 2. Update existing test (cascade, no new file).
**Constraints:** `ActionEvent` keys canonical.

## Verify (gate)

1. `npx vitest run tests/unit/presentation/tui/ --reporter=verbose` (existing P1/P2-adjacent, no new files).
2. `npm run build` + `npm run lint`.
3. `npm run test:unit`, `npm run test:contract`, `npm run test:integration` unchanged green; cascade fixes minimal + Changelog.

## Last-step: git code-only + commit + changelog

`git add` only: `src/presentation/tui/tui-stdout-adapter.ts`, `src/presentation/tui/components/RabbitMqJobReader.ts`, `src/infrastructure/utils/uds-probe.ts`, `src/application/container.ts`, `src/presentation/tui/components/ObserveCompactPane.ts`, `tests/unit/presentation/tui/observe-compact.test.ts` (cascade), `plans/2026-09-14-tui-ipc-codeonly-4phase.md`. Never logs/guide. Commit `fix(tui): …` per log convention. Append Changelog below.

## Changelog
- 2026-09-14 initial code-only plan persisted (no new P1/P2 tests, preserve on rerun).
- 2026-09-14 build P1 stdout preserve+repaint: `tui-stdout-adapter.ts` dropped `resetState()` on `start` and `clearCurrentJob()` on `stop` (rerun no-purge restores job), added `watchStateFile` subscription + `jobLifecycleId/mode/modal` diff → `renderFrame()` (fixes DISPLAY enrich + IDLE→new-job miss + first-frame null), threaded `getQueueDepth/getPendingPartial/getPendingFull/getDeferredCount` into `CardStatus`; `RabbitMqJobReader.ts` added 3 backward-compatible getters.
- 2026-09-14 build P2 stdin verify: `tui-stdin-adapter.ts` untouched (no `reset/clear/set` in PB path; reads `IPC` → `UDS`, `b→setQueueMode` only) — no new test file.
- 2026-09-14 build P3 dual probe: NEW `src/infrastructure/utils/uds-probe.ts` (`probeIpcPath` existsSync + `probeUdsActive` existsSync + `GET /` 500ms, any HTTP = 1, never POST); wired `2s` refresh + `unref`/`clearInterval` in `OpsTuiApp.start()/stop()` and `buildTuiContainer.start()/stop()` via shared import (hex-safe); `PC infra uds/ipc` now live on `:9091`.
- 2026-09-14 build P4 PD render: `ObserveCompactPane.ts` `jobs_brokered→jobs_brok[a/m]` (browser-auto/manual only) + `pub` per-key `g/pc/pf/q/t/rf` no total (truncate-safe 64w).
- 2026-09-14 cascade resolved (chore/test, no new file): `tests/unit/presentation/tui/observe-compact.test.ts` updated (`jobs_brok[a/m]:12`, `g:5/pc:0`, empty `jobs_brok[a/m]:0`) to match P4 render.
- 2026-09-14 verify gates green: `vitest tests/unit/presentation/tui/` 10 files/102 tests passed; `npm run build` clean; `npm run lint` 0 errors (14 pre-existing warnings); `npm run test:unit` 45 files/451 passed; `npm run test:contract` 12 files/111 passed; `npm run test:integration` 10 files/32 passed + 1 skipped.
