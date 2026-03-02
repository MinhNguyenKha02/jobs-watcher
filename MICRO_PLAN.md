
# CI Micro-Plan: Beta Metrics Aggregation, Self-Feedback, and Documentation

## Input Contexts and CI Coverage


Jobs Watcher supports three input adapters, all included in CI validation, metrics, and documentation updates:

- **Gmail Watcher (Pub/Sub Webhook):** Real-time, event-driven ingestion. Loopback only. ACK fast, process in background.
- **Pub/Sub Fallback:** Retry on webhook failure. All failures logged and retried deterministically. No silent drops.
- **Manual Clipboard Importer:** Manual or clipboard-based job entry for platforms not directly integrated or for fallback/manual validation.


All input types are processed through a unified queue, deduplication, and idempotency logic. Deterministic engineering rules ensure:

- No silent failures: All errors are logged and traceable.
- Fallbacks are explicit, non-negotiable, and self-assigned.
- Schedule configuration and constraints are enforced for every release.


## Improved CI Flow (2026-02-20)

- CI now includes an explicit fallback fetch step: before analyzing raw emails, the workflow checks if the input directory exists and is non-empty. If not, it fetches raw emails from Gmail via API, using configurable FETCH_LIMIT and FETCH_SINCE (default: last 24h).
- If fallback fetch fails or input is still missing, CI fails with a clear error.
- A new scheduled workflow (`beta-schedule.yml`) runs daily to ensure metrics aggregation and fallback fetch are performed even if not triggered by code changes.
- All fallback and aggregation steps are logged and self-evaluating, with errors surfaced in CI logs and artifacts.
- Artifacts are uploaded for easy review and checklist-based self-evaluation.
- Documentation and automation plans in `beta/docs/` have been updated to reflect this logic.
- For pre-prod and pre-end-beta, queue persistence (e.g., Redis) is recommended to ensure Pub/Sub events are not lost between days/cycles and to meet 98%+ exit criteria.

Reference: docs/ARCHITECTURE.md, docs/JOB_PROCESSING_QUEUE.md, .github/.agent-custome-rules.instructions.md

## 1. CI Job Flow

- **Trigger:** On each commit, nightly schedule, and manual beta cycle start.
- **Steps:**
  1. Run job processing queue and deduplication logic (see JOB_PROCESSING_QUEUE.md).
  2. Aggregate metrics: success/error rates, job counts, deduplication stats.
  3. Review logs for anomalies and errors.
  4. Collect user feedback (if available).
  5. Update beta cycle documentation:
     - beta-automation-plan.md
     - beta-monitoring-feedback.md
     - beta-exit-criteria.md
  6. Generate daily summary report and append to release notes.
  7. Tag release and update versioning.

## Concrete npm scripts (for CI and local feedback-loop)

- `npm run export:e2e` - Export sanitized E2E collections to `src/db/e2e-output/`.
- `npm run export:all` - Run `export:e2e` and `export-fixtures` together.
- `npm run inspect:db` - Produce human-readable DB inspection summary (collections, counts, exit criteria).
- `npm run inspect:logs` - Inspect recent logs from `action_log`, `parse_log`, and `raw_ingest` collections.
- `npm run feedback-loop` - Run `test:e2e`, `export:all`, and `inspect:db` in sequence.
- `npm run release:patch|minor|major` - Invoke `scripts/release.sh` to create timestamped release artifacts and tag.

Ensure CI runs `export:all` and `inspect:db` to generate reproducible artifacts and human-readable summaries for each cycle.

## 2. Tagging & Versioning

- Use semantic versioning with beta suffix: `v1.x.x-beta-<cycle>.<A|B|C|patch|minor>` (e.g., `v1.0.0-beta-1.A` for cycle 1, patch A)
- Tag each beta cycle after CI jobs complete and documentation is updated.
- Include summary of changes and metrics in tag message.

## 3. Self-Feedback & Manual Validation

- CI checks exit criteria (beta-exit-criteria.md):
  - Success rate ≥ 95%
  - Error frequency < 5%
  - User feedback ≥ 4/5 (see below for self-feedback process)
  - No critical bugs open
  - Monitoring/alerting in place
  - Documentation complete
  - Automated log review
  - Event-driven concurrency validated
- Mark criteria met in documentation and release notes.


### Self-Feedback Process (User/Manual)

- Remove interactive/manual feedback loops in code; instead, use tempo files for user feedback and validation.
- For each cycle, create a tempo file (e.g., `beta/prep/self-feedback-cycle-1.tmp`) with:
  - User feedback summary (score, comments)
  - Manual validation notes (criteria met, issues found)
  - Timestamp and reviewer initials
- After review, mark the file as complete and reference in release notes and exit criteria.
- To abort or skip, simply remove the tempo file or mark as ^C (cancelled).
- Example: See `beta/prep/self-feedback-cycle-1.tmp` for a sample entry.

## 4. Documentation Process

- CI jobs update:
  - beta-automation-plan.md: cycle goals, automation steps, references.
  - beta-monitoring-feedback.md: daily checklist, feedback loop, automation.
  - beta-exit-criteria.md: criteria status, cycle results.
  - JOB_PROCESSING_QUEUE.md: improvements for deduplication, concurrency, and idempotency.

## 5. Actionable Steps

- [ ] Implement CI job for metrics/log aggregation.
- [ ] Automate documentation updates for each beta cycle.
- [ ] Tag and version each beta release (e.g., `git tag v1.x.x-beta.1.a`).
- [ ] Integrate self-feedback and exit criteria checks using tempo files.
- [ ] Improve JOB_PROCESSING_QUEUE.md for this version.

---

**Summary of git log (oneline):**

- Recent commits show consolidation of beta prep, staging plan, metrics logging, and documentation updates.
- Key features: metrics recorder, analytics queries, email sender, delivery log, PDF/DOCX generators, snapshot tests, and CI workflow for validation.
- Documentation reorganized and updated for beta cycles, acceptance criteria, and implementation roadmap.
- Versioning now follows `v1.x.x-beta-<cycle>.<A|B|C|patch|minor>` (e.g., `v1.0.0-beta-1.A`) for clarity and consistency.
- Self-feedback and manual validation are now handled via tempo files in `beta/prep/`, removing the need for interactive/manual code loops.
- Sample self-feedback file: `beta/prep/self-feedback-cycle-1.tmp`.
