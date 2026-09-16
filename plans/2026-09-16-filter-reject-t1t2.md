# P1 filter-reject routing (T1 daemon-only, T2 trash + terminal upsert)

## Global

- Goal: tui-poll `s3s4` no longer polluted by T1 (s1) tier filter rejects; T2 (s2)
  rejects keep trash emit and persist terminal status on the s1 doc.
- Outcomes:
  - T1 reject: daemon log + `continue` only, zero RMQ traffic (no TUI side).
  - T2 reject: `job.trash` emit unchanged + mongo doc `partial/trashed`
    (was stale `partial/enriching`).
  - Gates green with cascade test edits only if a current suite goes red.
- Constraints:
  - Code-only commit; never add logs/state/env/token files.
  - No new test files; update current suites only when src change forces red.
  - No `git HEAD` moves (no reset/amend/rebase), no `git stash`.
  - Duplicate-skip branch, operator route path, manual 2a/2b, routing keys,
    TUI reader all out of scope.
- Phases-ordering: T1 edit -> T2 edit -> gates (unit, contract, integration,
  lint) -> cascade edits if red -> re-gate -> commit + changelog.
- Parallelism safety: single file (`src/application/ingestor.ts`), sequential.

## Phase 1 — T1 daemon-only (`ingestor.ts:220-233`)

- Goal: s1 filter reject emits nothing.
- Outcomes: `emitJobTrashed` call removed; `logger.info` + `continue` kept;
  rejected ids never persisted (unchanged) and never published (fixed).
- Code-steps: delete the 4-line `emitJobTrashed` block in the
  `if (!filterResult.passed)` branch. Fallback: revert hunk.
- Constraints: no signature changes; RoutePort untouched.

## Phase 2 — T2 terminal upsert (`ingestor.ts:455-465`)

- Goal: s2 filter reject leaves terminal mongo state.
- Outcomes: upsert `{status: trashed, updatedAt/stageTimestamp: now}` on the
  persisted s1 doc before the existing `emitJobTrashed`; metric
  `jobErrors{s2,filter_rejected}` and trash emit unchanged.
- Code-steps: insert upsert via `jobLifecycleColPort` in the
  `if (!passed.passed)` branch. Fallback: revert hunk.
- Constraints: stage stays `partial_parsed`; no TUI-side change needed.

## Phase 3 — Verify + cascade

- Goal: gates green; test edits only if forced red.
- Outcomes: `build`, `test:unit`, `test:contract`, `test:integration`, `lint`
  pass; any red suite updated minimally in place (no new files).
- Constraints: read-only otherwise; unrelated worktree mods stay unstaged.

## Last-step

- `git add` only `src/application/ingestor.ts` (+ cascade test files if any,
  + this plan); `git commit` per `fix(...)` convention; changelog below.

## Changelog

- (pending commit sha)
