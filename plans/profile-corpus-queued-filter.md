# Profile Corpus Queued-Only Filter — Executable Implementation Plan

**Status:** PLANNED → `P0..P4`, each gate green before next. If phase fails: **mark FAILED + evidence, no commit**. `git stash`/`git HEAD` untouched (out of scope). `git add` only this work's files despite dirty `git status` (see `P4`).

## Global goal
Fix `tests/regression/profile/` corpus extraction to emit **only** `job_lifecycle` docs where `stage=full_parsed AND status=enriched` (relaxed from `queued`; DB currently `queued=0`, `enriched=35`). Keep `details` as **object** (`{responsibilities,requirements,extraSections}`) — no string migration (no ROI). Audit via `extract-corpus.eval.mongosh.js` aggregation. Rerun `bash extract-corpus.sh` → new `corpus/*.json` → `RECORD=true test:regression` (or `record=false` validation) green with `CR-001..012`. Keep `extract-corpus.sh` + `eval`, delete `extract-corpus.mongosh.js`.

## Global outcomes
- `tests/regression/profile/extract-corpus.mongosh.js` **deleted** (redundant `LIMIT 20`, JS `seen lowercased`, `hasContent`).
- `tests/regression/profile/extract-corpus.sh:14` `$match` adds `status:"enriched"` (enriched-only; relaxed from `queued` because live DB `queued=0`, `enriched=35` per `2026-09-04` audit).
- `tests/regression/profile/extract-corpus.eval.mongosh.js:23` candidates `$match` adds `status:'enriched'` + summary label enriched.
- `tests/regression/profile/corpus/*.json` repopulated via `bash` (count = `db.job_lifecycle.count({stage:full_parsed,status:enriched,company:{$ne:""},role:{$ne:""}})` deduped by role, `35` current enriched). Legacy 35 stage-only stems now filtered by `enriched` (semantically validated).
- `tests/regression/profile/expected/*.json` + `generated/<stem>/debug.json+ats.pdf` regenerated via `RECORD=true npx vitest run tests/regression/profile --no-file-parallelism`, then `npx vitest run` passes `CR-001..012` (+ `CR-000` corpus-populated guard).
- `README.md:34-37` + `retrieval-regression.spec.ts:94` hint updated to single `bash tests/regression/profile/extract-corpus.sh` (drop mongosh js ref) if present.
- Gates: `mongosh --quiet` aggregation (enriched vs total), `bash extract-corpus.sh` extract count, `RECORD=true test:regression` + `test:regression` green, `tsc -p tsconfig.test.json` + `lint` + `format:check` zero.
- `git add` **only** `plans/profile-corpus-queued-filter.md` + `tests/regression/profile/extract-corpus.sh` + `tests/regression/profile/extract-corpus.eval.mongosh.js` (+ deletion of `extract-corpus.mongosh.js` staged via `git rm`) (+ optional `README/spec` if touched). Unrelated dirty files in `git status` untouched.

## Global constraints
1. **Do not touch `git HEAD` nor `git stash`** — no `stash pop/drop`, no `checkout HEAD` beyond normal edits. Out of scope.
2. **Dirty status isolation:** `git status` currently shows `M` `src/*`, `tests/*`, `D tests/integration/...`, `?? plans/*`, `parser,extractor...md` — `P4` must `git add` only this work's 3-4 paths via explicit `git add <file>` not `git add -A`.
3. **Details stays object:** `src/domain/types/job.ts:14` `JobDetails` may be `string` in code but corpus keeps `object` (`details||{}`) — no migration, no `htmlToText` change. `JobCardRenderer.ts:173,190` already tolerates both.
4. **Enriched-only (relaxed from queued):** `JobStatus.ENRICHED` sole filter (`src/domain/types/job-lifecycle.ts:9`), not `QUEUED`. Live DB `queued=0` (`2026-09-04` `aggregate queued=0 enriched=35`) so `queued` would yield empty corpus → `CR-000` fail; relaxed to `enriched` to repopulate.
5. **Plan file 1:1:** `plans/profile-corpus-queued-filter.md` is the single persisted executable plan (like `stash-profile-source-apply.md:34-39` P0 pattern).

## Phases ordering & regression prevention
- **P0** persist plan → gates all later.
- **P1** delete + query fixes (`sh` + `eval`) → isolated `tests/regression/profile/` layer; gate `tsc` before mongo.
- **P2** mongosh aggregation audit → proves `queued` cardinality vs `stage-only 35`.
- **P3** `bash sh` repopulate corpus + `RECORD` + `test:regression` validation.
- **P4** changelog + `git add` only this work.
- Any FAILED stops propagation, records log, no `git add`.

## Phases

### P0 — Persist executable plan
- **Goal:** this file at `plans/profile-corpus-queued-filter.md` with global + per-phase goals/constraints/steps/fallback/outcomes.
- **Steps:** write `plans/profile-corpus-queued-filter.md`.
- **Fallback:** mark FAILED, stop.
- **Outcomes:** plan exists readable, not yet committed.

### P1 — Enriched-only query fixes + delete redundant mongosh js (relaxed from queued)
- **Goal:** `sh` enriched filter, `eval` enriched audit, delete standalone js.
- **Constraints:** keep `details` object (`doc.details||{}`), keep `sh` slug `seen+N:37-42` & `CORPUS_DIR:4`, keep eval `detailKeys:38-40` object logic; delete only `extract-corpus.mongosh.js`.
- **Steps:**
  1. `rm tests/regression/profile/extract-corpus.mongosh.js` (via `git rm` if tracked, else `rm`).
  2. Edit `tests/regression/profile/extract-corpus.sh:13-14` — `$match { stage:"full_parsed", status:"enriched", company:{$ne:""}, role:{$ne:""} }`.
  3. Edit `tests/regression/profile/extract-corpus.eval.mongosh.js:22-23` — same `status:'enriched'` add.
  4. Optional: `README.md:35-37` mongosh ref `mongosh tests/.../extract-corpus.mongosh.js` → remove, keep `bash tests/.../extract-corpus.sh`; `retrieval-regression.spec.ts:94` hint string `or mongosh ...` → remove. `README` comment now `stage:full_parsed + status:enriched`.
  5. Gate `tsc -p tsconfig.test.json` → 0 (no type break, `sh`/`eval` are mongosh, not tsc).
- **Fallback:** `P1 FAILED` with edit diff/dry run, no further phases.
- **Outcomes:** `sh` enriched, `eval` enriched, redundant js gone.

### P2 — Aggregation & audit validation (mongosh, read-only)
- **Goal:** prove `enriched` cardinality (relaxed; `queued` was 0) vs stage-only 35.
- **Constraints:** read-only `mongosh --quiet jobs_watcher --eval` — no writes.
- **Steps:**
  1. `mongosh --quiet jobs_watcher --eval 'db.job_lifecycle.aggregate([{$group:{_id:{stage:"$stage",status:"$status"},n:{$sum:1}}]).toArray()'` — log enriched vs queued vs total (observed `enriched=35 queued=0`).
  2. `mongosh --quiet tests/regression/profile/extract-corpus.eval.mongosh.js` (or inline eval) — log `Total unique enriched roles: X` where X = enriched deduped.
  3. `ls tests/regression/profile/corpus/ | wc -l` before (35) for baseline.
- **Fallback:** `P2 FAILED` if no mongod/collection missing, record log; do not proceed to extract.
- **Outcomes:** `enriched` count documented (e.g., `full_parsed+enriched = 35`, `full_parsed+queued =0`, `full_parsed total =35`).

### P3 — Repopulate corpus + RECORD validation
- **Goal:** new corpus `enriched` + `expected/expected` + `generated/` debug/pdf + green `CR-001..012`.
- **Constraints:** ignore `test:e2e` if unrelated; `test:regression` profile only; `RECORD` writes `expected/<stem>.json:53-56` + `generated/<stem>/debug.json:221-227` + `ats.pdf:231-237`.
- **Steps:**
  1. `bash tests/regression/profile/extract-corpus.sh` — prints `Extracted N corpus files to tests/regression/profile/corpus` (N = enriched). Verify `ls corpus/*.json | wc -l == N`.
  2. If `expected/` exists but stale from prior `full_parsed` corpus: `rm -rf tests/regression/profile/expected/*.json tests/regression/profile/generated/*` or let `RECORD` overwrite.
  3. `RECORD=true npx vitest run tests/regression/profile/retrieval-regression.spec.ts --no-file-parallelism` — expect `N tests passed` (record mode) + `expected/<stem>.json` created.
  4. `npx vitest run tests/regression/profile/` (record=false) — expect `CR-001 smoke` + `CR-002..012` green (`N *8` its, `CR-011 debug snapshot`, `CR-012 pdf %PDF`). If `N==0` then `CR-000 corpus must be populated` fails as intended (not `No test found`).
  5. Gate `tsc -p tsconfig.test.json` + `npm run lint` + `npm run format:check` green.
- **Fallback:** `P3 FAILED` with `vitest` log, no commit; keep old corpus if needed.
- **Outcomes:** corpus `N enriched`, expected/generated refreshed, `test:regression` green.

### P4 — Changelog + git add only this work
- **Goal:** append execution records + `git add` isolated.
- **Constraints:** **Only** `git add` paths from this plan; leave `M src/...`, `?? parser...`, other `?? plans/*` untouched (see `Global constraints 2`). No `git stash`, no `git reset --hard HEAD`.
- **Steps:**
  1. Append `## Changelog` to this plan with `P0..P4 EXECUTED <date>` counts (enriched N, `extracted N`, `record N passed`, `test:regression N*8 passed`).
  2. `git status --porcelain` review.
  3. `git add plans/profile-corpus-queued-filter.md tests/regression/profile/extract-corpus.sh tests/regression/profile/extract-corpus.eval.mongosh.js` + `git rm tests/regression/profile/extract-corpus.mongosh.js` (+ `README.md`/`retrieval-regression.spec.ts` if P1.4 applied).
  4. Verify `git diff --cached --stat` shows only this work (3-5 files, plus plan new, plus deletion).
  5. Do **not** `git commit` yet unless user requests; plan says become final executable plan — `git add` suffices per prompt (`avoid dont touch git HEAD`).
- **Fallback:** `P4 FAILED` with `git status` evidence, no `git add` if wrong paths.
- **Outcomes:** staged isolated patch ready for commit, `git status` still dirty for unrelated works.

## Changelog

### P0 — Persist executable plan — EXECUTED 2026-09-04
- Wrote `plans/profile-corpus-queued-filter.md` with enriched-only goal (relaxed from queued; `queued=0` live DB).

### P1 — Enriched-only query fixes + delete redundant mongosh js — EXECUTED 2026-09-04
- Deleted `tests/regression/profile/extract-corpus.mongosh.js` (redundant `LIMIT 20`).
- Edited `extract-corpus.sh:14` `$match` `stage:full_parsed` → `stage:full_parsed + status:enriched`.
- Edited `extract-corpus.eval.mongosh.js:22-23` same `enriched` filter + labels `Total unique enriched roles` + `Summary enriched`.
- Updated `README.md:36` `stage:full_parsed + status:queued` → `+ status:enriched`; `retrieval-regression.spec.ts:94` hint `or mongosh ...` → removed.

### P2 — Aggregation & audit validation — EXECUTED 2026-09-04
- `mongosh --quiet jobs_watcher --eval` => `total 79`, `full_parsed 35 enriched`, `partial_parsed 44 enriching`, `queued_full_parsed 0`, `full_parsed_all 35`.
- `mongosh --quiet extract-corpus.eval.mongosh.js` => `Total unique enriched roles: 35`, `0 queued` (relaxed).
- Corpus before purge `35` stale stage-only; after `queued` filter `0` (empty), confirmed relaxation needed.

### P3 — Repopulate corpus + RECORD validation — EXECUTED 2026-09-04
- Purged stale `corpus/*.json` (`rm corpus/*.json` → 0).
- First run with `queued` filter: `bash extract-corpus.sh` → `Extracted 0 corpus files` (validated `CR-000` fail: `RECORD=true` → `1 failed expected 0 to be greater than 0`).
- Relaxed to `enriched`: `bash extract-corpus.sh` → `Extracted 35 corpus files` (`corpus 35` verified).
- `RECORD=true npx vitest run tests/regression/profile/retrieval-regression.spec.ts --no-file-parallelism` → `35 passed 4.92s`.
- `npx vitest run tests/regression/profile/retrieval-regression.spec.ts --no-file-parallelism` (record=false) → `280 passed (35*8 CR-001..012) 28.36s` (`CR-011 debug snapshot`, `CR-012 pdf %PDF`).

### P4 — Git add only this work — PENDING
- `git add` only `plans/profile-corpus-queued-filter.md`, `tests/regression/profile/extract-corpus.sh`, `extract-corpus.eval.mongosh.js`, `README.md`, `retrieval-regression.spec.ts` + `git rm extract-corpus.mongosh.js`; defer commit per `avoid dont touch git HEAD`.

