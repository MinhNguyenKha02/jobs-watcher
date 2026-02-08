# Clean Code Plan + Current Status

Date: 2026-02-06

## Scope
- Codebase: src/ and tests/
- Goal: modular, scalable, and low-noise linting with typed contracts

## Clean Code Plan (Phased)
### Phase 1 — Stabilize lint + types (1–2 days)
- Keep lint focused on src/ and tests/ (avoid subprojects in bored-cv-refinement).
- Replace noisy console logs with logger or gated debug helper.
- Replace `any` with `unknown` + guards, or real DTO types.
- Normalize import order via autofix + manual pass.

### Phase 2 — Modularize services (3–5 days)
- Split large services into focused modules:
  - Gmail: `gmail-client`, `gmail-parser`, `gmail-storage`
  - Parsing: `html-parser`, `email-parser`, `job-extraction`
  - Data: `raw-email-storage`, `enriched-storage`, `database`
- Introduce explicit interface types in src/types.ts
- Add clear boundaries: CLI → services → data/storage

### Phase 3 — Tests at scale (2–4 days)
- Enforce consistent fixtures and helpers in tests/__fixtures__
- Avoid conditional `expect` and rely on deterministic inputs
- Add typed factory helpers for Job/ParsedEmail

### Phase 4 — UX/TUI cleanup (optional)
- Centralize TUI colors in ui/theme.ts
- Reduce repeated TUI logic: shared hooks/services

---

## Current Type/Compile Errors (from Problems)
- Status (2026-02-06): none.

- Status update (2026-02-06):
- Removed non-core scripts: demo-flow, refresh-enriched-records, staging-integration, validate, e2e-db-test.
- Kept only core scripts: analyze-raw-emails, fetch-raw-emails.
- Removed integration tests for analyze/fetch raw emails.
- Added `matchedSkills` to `Job` and aligned enrichment tests with `null` failure mode.
- Remaining integration tests: generator/gmail/notifications/smart-generator/webhook-real.
- E2E tests ignored; unit tests are primary gate.

Diagnostics note:
- If Problems list still shows removed files, reload TS server or restart the editor.

Notes:
- Unit tests are the primary quality gate.
- Integration tests are optional; E2E is ignored for now.
- Scripts are non-negotiable and must remain runnable.

---

## Data-Testing State (confirmed)
From PIPELINE1_USAGE.md and TWO_PIPELINE_ARCHITECTURE.md:
- Data-testing pipeline is **Ready/Operational**.
- Flow: fetch → analyze → TUI → HTML paste enrichment → actions → logs.
- Logs go to logs/data-testing.jsonl.

Observed workflow (source of truth):
db input → TUI shows metadata → actions [p]/[n]/[s] → parser enrichment → action log → loop.

### Commands
- Fetch: `FETCH_LIMIT=10 npm run fetch:raw-emails`
- Analyze: `DATE=2026-01-28 npm run analyze:raw-emails`
- TUI: `npm run data-testing`

---

## Next Actions
1) Keep lint scope on src/ + tests/ only (avoid subprojects).
2) Apply import-order autofix and remove unused vars in core scripts.
3) Phase 2 modularization: split services into smaller modules.
4) Phase 3: add typed test factories and reduce conditional expectations.

Progress:
- Phase 1 done (lint scoped to src/tests; bored-cv-refinement ignored; types/tests cleaned).
- Phase 2 started (storage services refactored to classes; parsers moved to services/parsers; logger applied in html-parser/email-parser).
- Phase 2 update: moved storage to services/storage and generators to services/generators; imports updated.
- Phase 3 started (test factories added; htmlEnricher tests updated).
- UI/TUI refactor started (JobPopup/EnrichedJobPopup logs via logger).

