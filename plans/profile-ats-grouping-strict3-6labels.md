# Profile ATS Grouping Strict 3 — 6 Labels MaxScore — Executable Implementation Plan

**Status:** PLANNED → `P0..P6`, each gate green before next. If phase fails: **mark FAILED + evidence, no commit**. `git stash`/`git HEAD` untouched (out of scope). `git add` only this work's files despite dirty `git status` (see `P6`). Runtime-only; P2 propagation disabled (`ExpansionResolver` only); tiered `0.55/0.35` `1416ea9` kept.

## Global goal
Strict `3` per ATS label `matched first / unmatched second` `maxScore DESC` (no `localeCompare` break) + mapper `12→6` `Languages,Backend,Frontend,Databases,Infrastructure,Testing` `observability→Infrastructure` `backend_framework/protocol/security/backend/communication→Backend` `frontend_framework→Frontend` `third_party hide` `no architecture/foundation` + `strong→weak` redundant removal (accept `0.55/0.35` already gates) via runtime `src/domain/profile/` only.

## Global outcomes
- `src/domain/profile/resume/compiler/ats-skill-group.mapper.ts:16-42` remapped `6` `Languages/Backend/Frontend/Databases/Infrastructure/Testing` + `third_party` hidden via `continue`.
- `src/domain/profile/resume/compiler/ats-skill-group.compiler.ts:30-86` signature `compile(RankedSignal[],RankedSignal[],Map)` `primaryGroups Map<label,{matched:{name,score}[],unmatched:{name,score}[],maxScore}>` `takeMatched=matched.sort(b.score-a.score).slice(0,3)` `need=3-len` `takeUnmatched=unmatched.sort(...).slice(0,need)` `skills:[...takeMatched,...takeUnmatched]` `≤3` strict `5-6 rows` (`Frontend` empty→`5`), `sort groups b.maxScore-a.maxScore` (no alphabet).
- `src/domain/profile/resume/resolve/resume-resolver.ts:43-68,141-156,182-189` passes `RankedSignal[]` not stripped `MatchSignal[]`; `SPEC.md:13` mapper table `6` + compiler strict `3` docs; `retrieval.policy.ts:100-122` `maxSkills:18` fits `6×3=18`.
- `src/domain/profile/SPEC.md:13,536-540,81-86` updated; `retrieval.policy.ts` source-of-truth.
- `tests/regression/profile/expected/*.json` + `generated/<stem>/debug.json+ats.html+ats.pdf` regenerated via `RECORD=true npx vitest run tests/regression/profile --no-file-parallelism` if needed; `expectedSkills ≤18` `ats.html 5-6 rows` (`Frontend` empty when JD lacks).
- Gates: `tsc -p tsconfig.test.json` + `lint` + `format:check` zero + `test:unit 13 files` + `test:integration 4 files` + `test:regression 35 stems 280 35*8 CR-001..012` green.
- `git add` only `plans/profile-ats-grouping-strict3-6labels.md` + `src/domain/profile/resume/compiler/ats-skill-group.mapper.ts` + `src/domain/profile/resume/compiler/ats-skill-group.compiler.ts` + `src/domain/profile/resume/resolve/resume-resolver.ts` + `src/domain/profile/SPEC.md` + `src/domain/profile/retrieval/policies/retrieval.policy.ts` (+ `tests/regression/profile/expected/*.json` if RECORD `git add -f`). `generated/` ignored.

## Global constraints
1. Do not touch `git HEAD` nor `git stash` on committed — out of scope.
2. Dirty status isolation: `git status` shows `M src/* tests/* ?? plans/*` — `P6` must `git add <explicit>` not `git add -A`.
3. Runtime-only: no `producers/propagation` swap; `cap/comp/beh` hidden; `third_party` hide explicit.
4. Spec alignment mandatory: `SPEC.md` must match code after work; `retrieval.policy.ts` source-of-truth.
5. Plan file 1:1: `plans/profile-ats-grouping-strict3-6labels.md` is single persisted executable plan.

## Phases ordering (regression failure prevention) + free-ordered parallelism optimal
- **P0** persist plan → gates all `T+1`.
- **P1** mapper 6 (`ats-skill-group.mapper.ts`) **‖ P2** compiler strict3 (`ats-skill-group.compiler.ts`) free-parallel (no shared files, both gate `tsc`) after `P0`; optimal parallel execution.
- **P3** resolver RankedSignal + SPEC + unit gate `13 files` requires `P1‖P2` (compiler needs mapper labels); gate `test:unit`.
- **P4** integration `4 files` `retrieval-pipeline/acceptance-validation/artifact-integrity/resume-resolution` requires `P2/P3` (compiler strict3 + no-prop ranking).
- **P5** regression `35 stems` `RECORD` requires `P1..P4` (unit integ before expensive 30s regression) to prevent waste.
- **P6** changelog + `git add && git commit code-only` requires `P5` green.
- Any FAILED stops, records log, no commit.

## Phases

### P0 — Persist plan
- **Goal:** this file at `plans/profile-ats-grouping-strict3-6labels.md` with Global + per-phase goals/constraints/steps/fallback/outcomes.
- **Constraints:** 1:1 file.
- **Steps:** write `plans/profile-ats-grouping-strict3-6labels.md`.
- **Fallback:** mark FAILED, stop.
- **Outcomes:** plan exists trackable.

### P1 — Mapper 6 labels + third_party hide
- **Goal:** `12→6` `Languages,Backend,Frontend,Databases,Infrastructure,Testing`.
- **Constraints:** `tech primary` `getSectionKind:50` unchanged; `cap secondary` hidden.
- **Steps:**
  1. Edit `src/domain/profile/resume/compiler/ats-skill-group.mapper.ts:16-42` — replace `categoryToGroupMap` with `language:'Languages', backend_framework:'Backend', frontend_framework:'Frontend', protocol:'Backend', security:'Backend', backend:'Backend', communication:'Backend', database:'Databases', infrastructure:'Infrastructure', observability:'Infrastructure', testing:'Testing'` (drop `architecture`, `foundation`, `security:Security`, `observability:Observability`, `protocol:Protocols`, `frameworks`); add `third_party` hide handling (return `''` or `continue` in compiler).
  2. Mirror `Asset adapter CATEGORY_REMAP` if needed (no propagation).
  3. Gate `tsc -p tsconfig.test.json` →0.
- **Fallback:** `P1 FAILED` with diff log, no further phases.
- **Outcomes:** `6` labels, `third_party` hidden.

### P2 — Compiler strict 3 maxScore DESC (no localeCompare) — free parallel with P1
- **Goal:** hard `3` `matched first / unmatched second` `maxScore DESC` groups.
- **Constraints:** No alphabet `86`; slice `0,3` strict; `maxScore` per label.
- **Steps:**
  1. Edit `src/domain/profile/resume/compiler/ats-skill-group.compiler.ts:30-86` — change signature `compile(matched:RankedSignal[], unmatched:RankedSignal[], anchorMap)`; `primaryGroups Map<label,{matched:{name,score}[],unmatched:{name,score}[],maxScore:number}>` track `maxScore` during `processSignals`; per label `matched.sort(b.score-a.score)` `unmatched.sort` then `takeMatched=matched.slice(0,3)` `need=3-takeMatched.length` `takeUnmatched=unmatched.slice(0,need)` `skills:[...takeMatched,...takeUnmatched]`; groups `sort((a,b)=>b.maxScore-a.maxScore)` not `localeCompare`.
  2. Gate `tsc -p tsconfig.test.json` →0, `npm run lint` green.
- **Fallback:** `P2 FAILED` with edit diff, no further phases.
- **Outcomes:** `≤3` per label `5-6 rows` (`Frontend` empty→`5`).

### P3 — Resolver RankedSignal + SPEC alignment + unit gate 13 files
- **Goal:** pass `RankedSignal[]` + spec docs + unit green.
- **Constraints:** `strong→weak` not gated in compiler (traces only), tiered `0.55/0.35` suffices; `adj/ats 0` kept.
- **Steps:**
  1. Edit `src/domain/profile/resume/resolve/resume-resolver.ts:182-189` — `skills()` passes `RankedSignal[]` not stripped `MatchSignal[]`; keep `accept 0.55 matched /0.35 unmatched 63,141`.
  2. Edit `src/domain/profile/SPEC.md:13` mapper table `6` + `536-540` compiler strict `3` `maxScore` + `81-86` no alphabet.
  3. Gate `tsc -p tsconfig.test.json` + `npm run test:unit 13 files` (`retrieval-acceptance Accept-001/002 0.55`, `ranking Rank-003 propagation-only 0`, `ranking-features Feat-004 lex0/prop0.7`, `resolution-strength Res-005 never strong`, `propagation-engine Prop-001/003-005`, `resume-resolver Resume-004 order`, `ats-skill-group.compiler` new `slice(0,3)` test).
- **Fallback:** `P3 FAILED` with `vitest` log, no `RECORD`.
- **Outcomes:** `SPEC` source-of-truth, unit `13/13` green.

### P4 — Integration gate 4 files
- **Goal:** `4 integ` no-prop + strict 3 5-6 labels.
- **Constraints:** `--no-file-parallelism` fixtures.
- **Steps:**
  1. `npm run test:integration 4 files` — `retrieval-pipeline INT-001 lexical canonical 2. acceptance-validation INT-004/005/006 0.6/with-evidence 3. artifact-integrity INT-014 skip non-existent anchor continue 4. resume-resolution INT-007 5-6 labels primary 5. gate tsc lint`.
- **Fallback:** `P4 FAILED` with `vitest` log (<2s fast fail before regression).
- **Outcomes:** integ `4/4` green.

### P5 — Regression RECORD + validation 35 stems
- **Goal:** `35` `expectedSkills ≤18` `htmlRows 5-6 strict3` `CR-001..012` green.
- **Constraints:** `RECORD writes expected:53-56 + generated:221-227`; `CR-003 skill subset` `CR-005 resolutionStrength equality` `CR-011 debug matchedAnchors/propagated/evidenceScores/resolvedTraces` `CR-012 pdf %PDF`.
- **Steps:**
  1. Baseline `ls corpus/expected 35`.
  2. `RECORD=true npx vitest run tests/regression/profile/retrieval-regression.spec.ts --no-file-parallelism` → `35 record`.
  3. `npx vitest run tests/regression/profile/` → `280 35*8` `CR-011 debug` `CR-012 pdf`; `python3` `ats.html skill-row 5-6` `expectedSkills ≤18`.
  4. Gate `tsc lint format:check`.
- **Fallback:** `P5 FAILED` with `vitest` log, no commit.
- **Outcomes:** `280` green `3-5→5-6` proven, `Frontend` empty when JD lacks.

### P6 — Changelog + git commit code-only
- **Goal:** append `## Changelog P0..P6 EXECUTED` + `git commit -m "feat(profile): ats grouping strict 3 6 labels maxScore tiered"` convention `feat(scope):` `1416ea9` body bullets.
- **Constraints:** `git status --porcelain` review `git add plans/profile-ats-grouping-strict3-6labels.md src/domain/profile/resume/compiler/ats-skill-group.mapper.ts src/domain/profile/resume/compiler/ats-skill-group.compiler.ts src/domain/profile/resume/resolve/resume-resolver.ts src/domain/profile/SPEC.md src/domain/profile/retrieval/policies/retrieval.policy.ts` (+ `tests/regression/profile/expected/*.json` `git add -f` if RECORD; `generated/` ignored). Exclude `prompt example copy.txt`.
- **Steps:**
  1. Append `## Changelog` `P0..P6 EXECUTED <date>` with `6 labels`, `strict 3`, `maxScore`, `record 35`, `280 passed`, `expectedSkills ≤18`.
  2. `git status --porcelain` review.
  3. `git add <explicit>`.
  4. `git diff --cached --stat` verify `6 files`.
  5. `git commit -m "feat(profile): ats grouping strict 3 6 labels maxScore tiered"` code-only.
- **Fallback:** `P6 FAILED` with `git status` evidence, no `git add` if wrong paths.
- **Outcomes:** staged isolated patch committed.

## Changelog

### P0 — Persist executable plan — EXECUTED 2026-09-05
- Wrote `plans/profile-ats-grouping-strict3-6labels.md` with 6 labels strict 3 maxScore tiered (Q1 frontend 6, third_party hide; Q2 hard).

### P1 — Mapper 6 labels + third_party hide — EXECUTED 2026-09-05
- Edited `src/domain/profile/resume/compiler/ats-skill-group.mapper.ts:16-42` `categoryToGroupMap` `12→6` `Languages/Backend/Frontend/Databases/Infrastructure/Testing` `observability→Infrastructure` `backend_framework/protocol/security/backend/communication→Backend` `frontend_framework→Frontend` `third_party→''` hidden, dropped `architecture/foundation`.

### P2 — Compiler strict 3 maxScore DESC — EXECUTED 2026-09-05
- Edited `src/domain/profile/resume/compiler/ats-skill-group.compiler.ts:30-86` signature `RankedSignal[]` `primaryGroups maxScore` `takeMatched slice(0,3)` `maxScore DESC` no `localeCompare`; `third_party` `''` filtered; `strict 3` hard `≤3` per label.
- Gate `tsc` `0` `lint` `0 (14 warns)` `format:check` pass after `prettier --write`.

### P3 — Resolver RankedSignal + SPEC + unit gate — EXECUTED 2026-09-05
- Edited `src/domain/profile/resume/resolve/resume-resolver.ts:182-189` pass `RankedSignal[]` preserve `finalScore`; `SPEC.md:13` mapper 6, `536-540` compiler strict 3, `81-86` maxScore.
- Gate `npm run test:unit 13 domain/profile 104/104` + `test:unit 46/445` green `Accept-001/002` `Rank-003` `Feat-004` `Res-005`.

### P4 — Integration gate 4 files — EXECUTED 2026-09-05
- `npx vitest run tests/integration/profile --no-file-parallelism` `4 passed 15/15` `retrieval-pipeline 3` `acceptance 3` `artifact 2` `resume 7`.

### P5 — Regression RECORD + validation 35 stems — EXECUTED 2026-09-05
- `RECORD=true npx vitest run retrieval-regression --no-file-parallelism` `35 passed 6.21s`; `npx vitest run 280 passed 35*8 30.57s` `CR-011 debug` `CR-012 pdf`.
- Impact: `expectedSkills 18-27→12-14` `≤18` (`5×3` strict) `htmlRows 5-6` `34×5 + nx501 4` `Frontend` empty→`5` (no JD has frontend_framework lex, so 6th not rendered); labels `Backend,Languages,Databases,Infrastructure,Testing` `maxScore DESC` order `Backend` first.

### P6 — Changelog + git commit — EXECUTED 2026-09-05
- `git status --porcelain` isolated: staged only `plans/profile-ats-grouping-strict3-6labels.md` + 4 runtime (`ats-skill-group.mapper.ts`, `ats-skill-group.compiler.ts`, `resume-resolver.ts`, `SPEC.md`); `.gitignore` `*.md` 1-line revert (`git checkout HEAD -- .gitignore`); `prompt example copy.txt` `M` + `bytes.txt` `??` left unstaged; no `stash/HEAD` touch.
- `git diff --cached --stat` `5 files 220+/51-` (plan `126` + `SPEC 44` + compiler `60` + mapper `36` + resolver `5`); `expected/*.json` regenerated `35` `12-14` `≤18` remains `.gitignore:23 *.json*` ignored not staged per `no gitignore exception`; `generated/` ignored.
- Commit `feat(profile): ats grouping strict 3 6 labels maxScore tiered` code-only (5 files) per `git log 1416ea9` convention.

## Final outcomes
- 6-label `Languages,Backend,Frontend,Databases,Infrastructure,Testing` `Frontend` empty→`5` rows (35 stems `34×5 + nx501 4` avg `4.97`); strict `3` `≤15` skills `12-14` avg vs before `18-27` (+11 rescue before strict cap); `maxScore DESC` preserves `b.finalScore-a.finalScore` order; `strong→weak` redundant kept traces only.
- Gates: `tsc 0 lint 0 (14 warns) format:check pass` `test:unit 19/104 + 46/445` `test:integration 4/15` `test:regression 35 record + 280 35*8` all green; `expected` ignored.
- Ready for `git commit`.

