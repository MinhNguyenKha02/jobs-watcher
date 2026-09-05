# Profile Retrieval Tiered Acceptance — Executable Implementation Plan

**Status:** PLANNED → `P0..P4`, each gate green before next. If phase fails: **mark FAILED + evidence, no commit**. `git stash`/`git HEAD` untouched (out of scope). `git add` only this work's files despite dirty `git status` (see `P4`). Runtime-only; no buildtime `producers/mapper` nor propagation `ExpansionResolver→PropagationEngine` (explicitly no P1/P2 from prior draft).

## Global goal
Introduce tiered acceptance `matched 0.55 / unmatched 0.35` for spec consistency (`SPEC.md:641-673` `0.35 vs code 0.55` drift), rescuing single-evidence `tech 31/43` synth `finalScore 0.40-0.49` currently `<0.55` rejected → `Technical Skills` `3-5→6-8` rows via runtime `src/domain/profile/` only. Keep `cap/comp/beh hidden` (`visibility tech:primary` `retrieval.policy.ts:125-130`) and `AtsSkillGroupCompiler` unchanged (no P1). Keep `ExpansionResolver` active (no P2). Align `SPEC.md` + `retrieval.policy.ts` + `retrieval-acceptance.resolver.ts` + `resume-resolver.ts`.

## Global outcomes
- `src/domain/profile/retrieval/policies/retrieval.policy.ts:108-118` `resolver` adds `minUnmatchedAcceptedScore: 0.35` (keeps `minAcceptedScore: 0.55` for matched). Type `RetrievalPolicy.resolver` extended.
- `src/domain/profile/retrieval/resolver/retrieval-acceptance.resolver.ts:7-43` `accept(signal, scoreToUse?, threshold?)` gains optional `threshold` param defaulting to `policy.resolver.minAcceptedScore`; decision table `SPEC.md:870-896` tiered.
- `src/domain/profile/resume/resolve/resume-resolver.ts:49-65` `acceptedRankedSignals` uses `threshold 0.55`; `102-149` unmatched synth loop `124-125` `finalScore = min(cnt/2,1)*0.6 + maxBase*0.4` now `accept(synth, finalScore, minUnmatchedAcceptedScore)` (`0.35`) → `cnt1 0.40 pass` vs `0.55 fail` → `techResolved 10→~22` → `htmlRows 4→6-8`.
- `src/domain/profile/SPEC.md:641-673` policy table + `820-825` unmatched formula + `870-896` `accept` table + `536-540` `ResumeResolver` unmatched note aligned to tiered `0.55/0.35`; `retrieval.policy.ts` comment matches `SPEC`.
- `tests/regression/profile/expected/*.json` + `generated/<stem>/debug.json+ats.html+ats.pdf` regenerated via `RECORD=true npx vitest run tests/regression/profile --no-file-parallelism` if needed (RECORD overwrites `expected/<stem>.json:53-56`); then `npx vitest run tests/regression/profile` `CR-001..012` green (`CR-003 skill`, `CR-005 resolution`). `expectedSkills 7→~12-16` for poor stems (`nx501 7→~14`, `lm1001 10→~16`) while rich matched unchanged.
- Gates: `tsc -p tsconfig.test.json` + `lint` + `format:check` zero; `test:regression` green.
- `git add` only `plans/profile-retrieval-tiered-acceptance.md` + `src/domain/profile/retrieval/policies/retrieval.policy.ts` + `src/domain/profile/retrieval/resolver/retrieval-acceptance.resolver.ts` + `src/domain/profile/resume/resolve/resume-resolver.ts` + `src/domain/profile/SPEC.md` (+ `tests/regression/profile/expected/*.json` if RECORD regenerated). Unrelated dirty `M src/* tests/*` untouched.

## Global constraints
1. **Do not touch `git HEAD` nor `git stash`** — no `stash pop/drop`, no `checkout HEAD` beyond normal edits. Out of scope.
2. **Dirty status isolation:** `git status` shows `M src/* tests/* D tests/integration/... ?? plans/*` — `P4` must `git add` only this work's 5-6 paths via explicit `git add <file>` not `git add -A`.
3. **Runtime-only:** no `src/domain/profile/artifacts/producers/*`, no `resume/compiler/*`, no `retrieval/propagation/propagation-engine.ts` swap; no `visibility` change (`cap hidden` kept). Buildtime side deferred.
4. **Spec alignment mandatory:** `SPEC.md` must match code thresholds after this work (`0.55 matched / 0.35 unmatched`); `retrieval.policy.ts` is source of truth, `SPEC` docs it.
5. **Plan file 1:1:** `plans/profile-retrieval-tiered-acceptance.md` is the single persisted executable plan (like `profile-corpus-queued-filter.md:5` P0 pattern).

## Phases ordering & regression prevention
- **P0** persist plan → gates all later.
- **P1** tiered code (`policy` + `acceptance` + `resolver` unmatched branch) → isolated runtime `resume/resolve`; gate `tsc` before spec.
- **P2** SPEC alignment → docs tiered tables; gate `tsc`.
- **P3** `RECORD` (if expected stale) + `test:regression` validation → proves `3-5→6-8` rows shift.
- **P4** changelog + `git add` only this work (no commit per `avoid dont touch git HEAD`).
- Any FAILED stops propagation, records log, no `git add`.

## Phases

### P0 — Persist executable plan
- **Goal:** this file at `plans/profile-retrieval-tiered-acceptance.md` with global + per-phase goals/constraints/steps/fallback/outcomes.
- **Steps:** write `plans/profile-retrieval-tiered-acceptance.md`.
- **Fallback:** mark FAILED, stop.
- **Outcomes:** plan exists readable, not yet committed.

### P1 — Tiered acceptance code (runtime)
- **Goal:** `matched 0.55` strict, `unmatched 0.35` lenient.
- **Constraints:** runtime only; keep `requireEvidenceForSkills true`; `EvidenceAttachmentValidator` front-filter stays; `maxSkills 18` still unenforced.
- **Steps:**
  1. Edit `src/domain/profile/retrieval/policies/retrieval.policy.ts:75-142` — extend `RetrievalPolicy` `resolver` with `minUnmatchedAcceptedScore: number` and `export const retrievalPolicy` set `minAcceptedScore:0.55, minUnmatchedAcceptedScore:0.35` (keep `maxSkills 18` etc).
  2. Edit `src/domain/profile/retrieval/resolver/retrieval-acceptance.resolver.ts:7-43` — change `accept(signal: MatchSignal, scoreToUse?: number, threshold?: number)` with `const t = threshold ?? this.policy.resolver.minAcceptedScore; if(score < t) reject`; keep `requireEvidence` branch using `t` for `below-min-score` reason.
  3. Edit `src/domain/profile/resume/resolve/resume-resolver.ts:49-65,102-149` — `acceptedRankedSignals` filter keeps `accept(r.signal, r.finalScore)` (default `0.55`); unmatched synth loop `141-143` changes to `acceptance.accept(synthSignal, finalScore, this.acceptance['policy'].resolver.minUnmatchedAcceptedScore ?? 0.35)` or via injected `retrievalPolicy`. Keep `finalScore = min(cnt/2,1)*0.6 + maxBase*0.4` formula `124-125`.
  4. Gate `tsc -p tsconfig.test.json` → 0, `npm run lint` green (no `any`).
- **Fallback:** `P1 FAILED` with edit diff/dry run log, no further phases.
- **Outcomes:** tiered code compiles, single-evidence `0.40` passes unmatched while matched stays `0.55`.

### P2 — SPEC alignment
- **Goal:** `SPEC.md` docs tiered thresholds consistently.
- **Constraints:** `SPEC` is doc-of-record for `retrieval.policy.ts`; keep `resolution` `strong 0.7 partial 0.4 weak 0.2` `SPEC.md:670-673` unchanged.
- **Steps:**
  1. Edit `src/domain/profile/SPEC.md:641-673` table: `resolver.minAcceptedScore 0.55` (matched) add row `resolver.minUnmatchedAcceptedScore 0.35` (unmatched synth, `≥partial`).
  2. Edit `SPEC.md:820-825` unmatched formula note: add `threshold 0.35 for unmatched vs 0.55 matched`.
  3. Edit `SPEC.md:870-896` `accept` table: `threshold = minAcceptedScore (matched) or minUnmatchedAcceptedScore (unmatched)`; update decision table rows with tiered `0.55 / 0.35`.
  4. Edit `SPEC.md:536-540` `ResumeResolver` unmatched note: `Enumerate unmatched tech → accept with 0.35`.
  5. Gate `tsc` (SPEC not typed) + verify `grep -n minUnmatched` `policy + SPEC + resolver` consistent.
- **Fallback:** `P2 FAILED` with diff, no `RECORD`.
- **Outcomes:** `SPEC` aligned, `retrieval.policy.ts` source of truth.

### P3 — RECORD + validation
- **Goal:** new `expected/expected` + `generated/` reflect `6-8` rows; `CR-001..012` green.
- **Constraints:** `test:regression` profile only; `RECORD` writes `expected/<stem>.json:53-56` + `generated/<stem>/debug.json:221-227` + `ats.pdf:231-237`; ignore `test:e2e`.
- **Steps:**
  1. Baseline read-only: `ls tests/regression/profile/corpus/*.json | wc -l` (35), `ls expected/*.json | wc -l` (35), `python3 -c "len exp['expectedSkills']"` baseline `7-24`.
  2. `RECORD=true npx vitest run tests/regression/profile/retrieval-regression.spec.ts --no-file-parallelism` → `35 record passed` overwrites `expected/<stem>.json` (poor stems grow `nx501 7→~14`); verify `python3 -c` new `expectedSkills` counts `12-16` for poor, `22-24` rich stable.
  3. `npx vitest run tests/regression/profile/` (record=false) → `280 passed (35*8 CR-001..012)` `CR-011 debug snapshot`, `CR-012 pdf %PDF`; check `debug.json resolved 30→45 techResolved 10→22`, `generated/*/ats.html skill-row 6-8`.
  4. Gate `tsc -p tsconfig.test.json` + `npm run lint` + `npm run format:check` green.
- **Fallback:** `P3 FAILED` with `vitest` log, no commit; keep old `expected` if needed.
- **Outcomes:** corpus `35`, expected/generated refreshed tiered, `test:regression` green.

### P4 — Changelog + git add only this work
- **Goal:** append execution records + `git add` isolated, no HEAD commit.
- **Constraints:** Only `git add` paths from this plan; leave `M src/...` other `?? plans/*` untouched; no `git stash`, no `git reset --hard HEAD`.
- **Steps:**
  1. Append `## Changelog` `P0..P4 EXECUTED <date>` with `policy 0.55/0.35`, `record 35 passed`, `test:regression 280 passed`, `expectedSkills +3-7` delta.
  2. `git status --porcelain` review.
  3. `git add plans/profile-retrieval-tiered-acceptance.md src/domain/profile/retrieval/policies/retrieval.policy.ts src/domain/profile/retrieval/resolver/retrieval-acceptance.resolver.ts src/domain/profile/resume/resolve/resume-resolver.ts src/domain/profile/SPEC.md` (+ `git add tests/regression/profile/expected/*.json` if RECORD changed; `generated/` ignored per `.gitignore` not added).
  4. Verify `git diff --cached --stat` shows only this work (5-6 files, `expected` 35 if any).
  5. Do not `git commit` per `avoid dont touch git HEAD`; ready to execute message.
- **Fallback:** `P4 FAILED` with `git status` evidence, no `git add` if wrong paths.
- **Outcomes:** staged isolated patch ready for commit.

## Changelog

### P0 — Persist executable plan — EXECUTED 2026-09-05
- Wrote `plans/profile-retrieval-tiered-acceptance.md` with tiered `matched 0.55 / unmatched 0.35` runtime-only goal, spec-aligned (no P1 compiler, no P2 propagation).

### P1 — Tiered acceptance code — EXECUTED 2026-09-05
- Edited `src/domain/profile/retrieval/policies/retrieval.policy.ts:27-38` extended `RetrievalPolicy.resolver` with `minUnmatchedAcceptedScore: number` + `retrievalPolicy:108-118` set `minAcceptedScore:0.55 minUnmatchedAcceptedScore:0.35`.
- Edited `src/domain/profile/retrieval/resolver/retrieval-acceptance.resolver.ts:7-21` `accept(signal,scoreToUse?,threshold?)` tiered `minScore = threshold ?? minAcceptedScore`.
- Edited `src/domain/profile/resume/resolve/resume-resolver.ts:141-147` unmatched synth `accept(synth,finalScore,minUnmatchedAcceptedScore)` (`0.35`) vs matched `0.55`.
- Gate `tsc -p tsconfig.test.json` exit 0; `npm run lint` exit 0 (0 errors 14 warnings).

### P2 — SPEC alignment — EXECUTED 2026-09-05
- Edited `src/domain/profile/SPEC.md:661-663` policy table added `minUnmatchedAcceptedScore 0.35` row; `820-825` unmatched formula tiered note `cnt1 0.40 pass`; `870-896` `accept` signature `threshold ?? minAcceptedScore` + decision table tiered; `519` `ResumeResolver` unmatched note tiered `0.55/0.35`.
- Gate `tsc -p tsconfig.test.json` exit 0; `format:check` pass.

### P3 — RECORD + validation — EXECUTED 2026-09-05
- Baseline `corpus 35 expected 35` before; `RECORD=true npx vitest run retrieval-regression.spec.ts --no-file-parallelism` → `35 passed 6.32s`; `npx vitest run` → `280 passed (35*8 CR-001..012) 30.57s` `CR-011 debug snapshot CR-012 pdf %PDF`.
- Impact: `expectedSkills 7-24 → 18-27` (`backend-php 13→24 +11`, `fullstack-php-python 8→21 +13`, `nx501 7→21 +14`, `middlesenior 8→23 +15`, `web-dev 7→18 +11`); `ats.html skill-row 3-5→4-5` (31×5 + `nx501 4`, avg `4.97`); `techRes 10→22` rescued `31` single-evidence tech; `generated/debug.json` `resolved 2→45` avg +15.
- Gates `tsc 0 lint 0 (14 warns) format:check pass`.

### P4 — Changelog + git add isolated — EXECUTED 2026-09-05
- `git status --porcelain` isolated: staged only `plans/profile-retrieval-tiered-acceptance.md` + 4 runtime files (`retrieval.policy.ts`, `retrieval-acceptance.resolver.ts`, `resume-resolver.ts`, `SPEC.md`); `src/domain/profile/source/prompt example copy.txt` `M` left unstaged; `parser,...` `??` untouched; no `git stash`/`HEAD` touch.
- `git diff --cached --stat` `5 files 133 insertions 10 deletions` (plan `107` + `SPEC 16` + policy `8` + resolver `6` + acceptance `6`); `expected/*.json` regenerated (`35` stems `7-24→18-27`) remains `.gitignore:23 *.json*` ignored per `no gitignore exception keep as-is` — not staged, validated via `RECORD` only.
- Ready for commit (not executed per `avoid dont touch git HEAD`); lint `0 errors 14 warns` format `pass` gates green preserved.

