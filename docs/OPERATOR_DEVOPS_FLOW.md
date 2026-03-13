## Manual Crash, Restart, and Degrade Handling

If any background service (core pipeline, infra-monitor, etc.) crashes or is unresponsive:

1. **Manual Restart:**
   - Use `npm run ll:infra:stop` then `npm run ll:infra:autostart` in Terminal B.
   - Monitor logs with `tail -f logs/infra-monitor.log`.
2. **Graceful Fallback:**
   - If the supervisor fails to recover, repeat the stop/autostart sequence.
   - If repeated failures occur, switch to manual monitoring (run `npm run ll:infra:monitor` periodically and log incidents; all notifications are TTY/log-only).
3. **Degrade Mode:**
   - If automation is degraded, continue shift operations manually and log all incidents for later review.
   - No auto-escalation: all fallback and degrade actions are local/manual. No GUI notifications are used; all alerts are logged.

**Commit Guidance:**
- Patch and commit each logical change (script, service, doc) separately.
- All patches and restarts are local-only; no remote/CI automation is used.

# Solo DevOps Runbook (Long-Living Phase)

## Index

1. [Terminal Layout](#terminal-layout)
2. [Notification Policy](#notification-policy)
3. [Typical Daily Flow](#typical-daily-flow)
4. [Ownership Model](#ownership-model-devops-only)
5. [Runtime Architecture](#runtime-architecture-always-on)
6. [Shift Schedule Contract](#shift-schedule-contract-0900-2100)
7. [Terminal Contract](#terminal-contract)
8. [Shift Flow](#shift-flow-sequential)
9. [Incident Policy](#incident-policy-fallback--recovery)
10. [Artifact and Validation Boundary](#local-only-artifact-and-validation-boundary)
11. [Issue Escalation Policy](#issue-escalation-policy)
12. [One-Screen Daily Command Set](#one-screen-daily-command-set)

---

## Terminal Layout

1. **Terminal A — Actions Terminal**
   - `npm run ll:human:loop`
   - Use for actions at any time during the 09:00-21:00 shift window.
   - No monitoring or metrics commands here.
2. **Terminal B — Merged Infra/Core Monitor Terminal**
   - Use three dedicated terminals for live monitoring:
     - **B.1:** `tail -f logs/infra-monitor.log` (one-shot status snapshots, cron/manual at checkpoints)
     - **B.2:** `tail -f logs/infra-watchdog.log` (continuous health/incident monitoring)
     - **B.3:** `tail -f src/db/cache/jobs-watcher-$(date +%Y%m%d).log` (Node/TS main logs, daily rotated)
   - Run `bash scripts/infra-monitor.sh >> logs/infra-monitor.log 2>&1` manually or via cron at 09:00 and 21:00 for status snapshots.
   - All monitoring output must use urgency symbols ([!], [*], [✓]), include origin, and be traceable in logs (audit-compliant format).
   - This ensures unified, audit-compliant monitoring of all background services, incidents, and eval/test flows.
3. **Terminal C — Eval/Test Terminal**
   - Reserved for eval stage (fetch/analyze/testing).
   - Run `npm run eval:fetch-and-trigger` (MANDATORY at least once per shift; creates jobs for needs_enrichment in Terminal A).
   - All outputs must use urgency symbols ([!], [*], [✓]), include origin, and be traceable in logs.

## Notification Policy

- All infra, core, and CASE alerts are logged to TTY and log files only.
- Urgency symbols ([!], [*], [✓]) and origin must be shown for every alert and log output, in all scripts and services, with no exceptions. This is enforced for all notification, incident, and eval stage outputs.
- All notifications are traceable and rotated at end of day.

## Typical Daily Flow

1. Open Terminal B with three terminals for live monitoring:
   - B.1: `tail -f logs/infra-monitor.log`
   - B.2: `tail -f logs/infra-watchdog.log`
   - B.3: `tail -f src/db/cache/jobs-watcher-$(date +%Y%m%d).log`
2. Open Terminal A for actions at any time during the shift.
3. Open Terminal C for eval/test flows and job ingestion monitoring (run eval:fetch-and-trigger as required).
4. Respond to terminal/log notifications immediately.
5. At shift checkpoints, run aggregates and rotate infra-monitor logs.
6. For incidents, follow fallback/recovery as described.

 This is the single operational guide for one person owning runtime operations, artifact evidence, and shift governance while keeping TUI decisions manual. All operations are local-only; no GitHub Actions or cloud automation is used for runtime, validation, or artifact aggregation.

## Ownership Model (DevOps-Only)

You are the only owner for three connected scopes:

1. **Runtime Infra**: keep background services healthy and recover from incidents.
2. **TUI Human Routing**: resolve `needs_enrichment` deterministically in a dedicated TUI terminal.
3. **CI Evidence**: ensure commits are promotable and artifacts are reviewable.

Business target for this phase: stable core pipeline + stable delivery pipeline in real daily operation with measurable shift evidence.

## Runtime Architecture (Always-On)

- `infra-supervisor` keeps core pipeline alive (`serve:hybrid`).
- `infra-watchdog` checks state every 20s and auto-remediates pressure/crash states.
- `ll:scheduled:cycle` runs at shift checkpoints and daily feedback produces CASE verdict artifacts.
- TUI stays manual and separate from infra automation.

## Shift Schedule Contract (09:00 / 21:00)

### Weekly Validation and Rotation (Weekend)

Every Sunday at 02:00, run the following to ensure no Gmail messageId is missed and all logs are rotated:

      0 2 * * 0 npm run weekly:messageid-check

This performs:
   - Validation of Gmail/webhook messageId sync
   - Retrigger of webhook for any missing messageIds (idempotent, always POSTs to webhook)
   - Log and email rotation

This guarantees all Gmail messages are processed by the core pipeline, with no data loss, and keeps logs maintainable.


 **Shift checkpoints are fixed and enforced locally:**

- `09:00` local: shift-open checkpoint (health, verify, aggregate report)
- `21:00` local: shift-close checkpoint (health, verify, aggregate report)


Configure local cron (via `ll:cron:install`) to run:

- `0 9 * * * ... npm run ll:scheduled:cycle`
- `0 21 * * * ... npm run ll:scheduled:cycle`

At every shift open/close (09:00/21:00), run `bash scripts/infra-monitor.sh >> logs/infra-monitor.log 2>&1` (manual or via cron) to append a status snapshot. Logs are rotated daily by date.

**No GitHub Actions or remote scheduler is used. All scheduling and aggregation is local.**

## Terminal Contract


Use this layout consistently (local-only):

1. **Terminal A — TUI Decision Terminal (main work)**
   - `npm run ll:human:loop`
   - Do not run infra stop/start/monitor commands in this terminal.

2. **Terminal B — DevOps Control Terminal**
   - `npm run ll:infra:monitor`
   - `tail -f logs/infra-watchdog.log` (continuous incident view)

**All background services and monitoring are run locally. No remote/cloud/CI operations are permitted.**

## Shift Flow (Sequential)

### 1) Shift Start

1. `npm run ll:infra:monitor`
2. `npm run ll:shift:aggregate`
3. Start TUI: `npm run ll:human:loop`

### 2) During Shift

1. Use Terminal A for actions at any time during 09:00-21:00.
2. Use Terminal C to run eval/test flows and monitor job ingestion as needed (MANDATORY: run eval:fetch-and-trigger at least once per shift).
3. Run `npm run clipboard:trigger` only when manual clipboard ingest is needed.
4. On terminal/log alert, respond immediately.

   ### Terminal Notification Policy

   - All infra alerts are output to TTY and log files only.
   - Urgency is shown by symbols ([!], [*], [✓]) and clear text.
   - All notifications are append-only in logs and rotated at end of day.
   - No GUI notifications are used; all alerts are visible in the terminal and logs.

   ## Log and Email Rotation Policy

   - All logs and feedback/email artifacts are rotated and cleaned up by local scripts (see `scripts/daily-feedback.sh`, `scripts/fetch-raw-emails.ts`).
   - Retention: 30 days for logs and emails (old files deleted automatically).
      - No weekly rotation by default; daily cleanup is enforced.
      - To enforce rotation after Gmail fetch, run `bash scripts/cron-log-email-rotation.sh` after `fetch-raw-emails.ts` completes (can be scheduled via cron).
   - If weekly rotation is desired, add a cron job and document it here.

   ## Maintenance and Low-Load Window

   - All cleanup and rotation is performed after Gmail API fetch and validation.
   - No runtime or fixed schedule for maintenance; cleanup is handled by scripts after each fetch/closeout.
   - If a weekly low-load window is needed, schedule a cron job (e.g., Sunday 02:00) and document it here.
   - `npm run ll:infra:monitor`
   - `tail -n 100 logs/infra-monitor.log`
4. Append second-level incident snapshot to monitor log for traceability:
   - `echo "[$(date +%Y-%m-%dT%H:%M:%S%z)] alert-captured" >> logs/infra-monitor.log`
   - `npm run ll:infra:monitor >> logs/infra-monitor.log 2>&1`
5. Keep decisions deterministic:
   - `manual_validate_to_queue`
   - `manual_reject_to_trash`

Recommended cadence during active shift window:

- Every 30-60 minutes: run `npm run ll:infra:monitor` or `bash scripts/infra-monitor.sh >> logs/infra-monitor.log` from Terminal B.1.
- On each terminal/log alert (from B.1, B.2, or B.3): run the alert response block above within 1 minute.

### 3) Shift Close

1. `npm run ll:shift:aggregate`
2. Review generated outputs:
   - `logs/shift-reports/shift-latest.txt`
   - `logs/shift-reports/shift-latest.json`
   - `logs/feedback-reports/daily-cases-latest.json`
3. If verdict is `HOLD` or `NO-GO`, record remediation before next shift.
4. If verdict is `GO`, record one optimization task for next commit cycle (small, safe, measurable).

## Incident Policy (Fallback + Recovery)

`infra-monitor` behavior:

- **[*] warning**: soft throttle (`renice` + `ionice`).
- **[!] critical**: graceful stop -> force-kill fallback -> cooldown sleep -> supervisor restart.

Manual intervention sequence:

1. `npm run ll:infra:monitor`
2. Inspect infra-monitor/supervisor logs
3. If unstable loop persists:
   - `npm run ll:infra:stop`
   - wait 10s
   - `npm run ll:infra:autostart`
4. Re-run `npm run ll:shift:aggregate` to confirm status.

TUI boundary rule in incidents:

- Keep Terminal A focused on pending human decisions.
   - Perform all infra recovery in Terminal B (TTY/log only).

## CI and Artifact Boundary


## Local-Only Artifact and Validation Boundary

 **All artifact aggregation, validation, and promotion is performed locally.**

- Use bash scripts and npm scripts to:


   **MessageId Sync and Data Loss Prevention**

   After each Gmail API fetch, persist all messageIds from the last 7 days. The webhook core pipeline persists all processed messageIds. Daily and weekly, validate that all Gmail messageIds are present in the webhook log. If any are missing, retrigger the webhook for those messageIds (idempotent). Rotate logs after validation. This ensures no data loss and keeps the system maintainable.
 3. `git commit ...` (husky checks run)
 4. Review local artifacts and validation outputs before pushing.


Post-commit quality loop:

- If shift report shows recurring critical CASE, patch before next feature commit.
- Keep commits small and linked to one measurable stability improvement.

 No guaranteed hot-reload for running core process after code updates.
 After pull/merge, restart runtime:
- `npm run ll:infra:stop`
- `npm run ll:infra:autostart`
- `npm run ll:infra:monitor`

## Issue Escalation Policy

Do not auto-open GitHub issues from runtime scripts.

Escalate manually when either condition repeats:

- `NO-GO` verdict across shifts
- recurring critical CASE (same CASE class)

Treat artifact files as source-of-truth for escalation evidence.

## One-Screen Daily Command Set

 Use this exact command set as solo DevOps owner (local-only):

 ```bash
# shift open / close checkpoint
npm run ll:shift:aggregate


# runtime health (one-shot status snapshot)
bash scripts/infra-monitor.sh >> logs/infra-monitor.log

# live monitoring (open three terminals):
# Terminal B.1: tail -f logs/infra-monitor.log
# Terminal B.2: tail -f logs/infra-watchdog.log
# Terminal B.3: tail -f src/db/cache/jobs-watcher-$(date +%Y%m%d).log

# manual clipboard ingest trigger (only when needed)
npm run clipboard:trigger

# human routing terminal (separate)
npm run ll:human:loop
```
