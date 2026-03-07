## Gmail MessageId Sync and Data Loss Prevention

   - If any messageIds are missing from the webhook, they are written to `logs/webhook-missing-messageids.json`.
   - To reprocess missing messageIds, run `scripts/trigger-webhook-missing.sh` (requires webhook endpoint to be accessible on localhost).
 After each Gmail API fetch, persist all messageIds (with timestamp) from the last 7 days using `scripts/persist-gmail-messageids.sh`.
 Webhook-processed messageIds are also persisted to `logs/webhook-messageids-latest.json` by the core pipeline.

 **All validation, aggregation, retrigger, and log rotation are performed locally via bash scripts. No GitHub Actions or cloud automation is used for messageId sync or artifact aggregation.**


**Weekly and daily aggregation, validation, and retrigger:**

- Run `scripts/validate-webhook-sync.sh` to compare Gmail and webhook messageId lists (weekly or as needed):
   - If any messageIds are missing from the webhook, they are written to `logs/webhook-missing-messageids.json`.
   - To reprocess missing messageIds, run `scripts/trigger-webhook-missing.sh` (requires webhook endpoint to be accessible on localhost).
- After validation/retrigger, run log/email rotation scripts to maintain compliance and retention.


**Artifacts:**

- Daily and weekly aggregates are produced by local scripts (see below for schedule and commands).
- Artifacts are rotated and aggregated locally; reviewable bundles are available in `logs/shift-reports/`, `logs/feedback-reports/`, and `e2e-output/`.

# Solo DevOps Runbook (Long-Living Phase)

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

1. Process `needs_enrichment` queue in TUI.
2. Run `npm run clipboard:trigger` only when manual clipboard ingest is needed.
3. On desktop alert (see below for notification details), immediately run:

   ### Desktop Notification Policy

   - All infra alerts use `notify-send` with a 6-second timeout (`-t 6000`).
   - Only one notification is sent per second at most (rate-limited in script).
   - Notifications disappear from the screen after timeout, but remain in the GNOME notification queue until cleared.
   - **Manual clear:** At the end of each shift or day, use the GNOME notification UI to clear all queued notifications (no auto-clear script; this is a GNOME feature).
   - Notifications are append-only: all alerts are queued and visible in the notification center until manually cleared.

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
   - `tail -n 100 logs/infra-watchdog.log`
4. Append second-level incident snapshot to monitor log for traceability:
   - `echo "[$(date +%Y-%m-%dT%H:%M:%S%z)] alert-captured" >> logs/infra-watchdog.log`
   - `npm run ll:infra:monitor >> logs/infra-watchdog.log 2>&1`
5. Keep decisions deterministic:
   - `manual_validate_to_queue`
   - `manual_reject_to_trash`

Recommended cadence during active shift window:

- Every 30-60 minutes: run `npm run ll:infra:monitor` from Terminal B.
- On each desktop alert: run the alert response block above within 1 minute.

### 3) Shift Close

1. `npm run ll:shift:aggregate`
2. Review generated outputs:
   - `logs/shift-reports/shift-latest.txt`
   - `logs/shift-reports/shift-latest.json`
   - `logs/feedback-reports/daily-cases-latest.json`
3. If verdict is `HOLD` or `NO-GO`, record remediation before next shift.
4. If verdict is `GO`, record one optimization task for next commit cycle (small, safe, measurable).

## Incident Policy (Fallback + Recovery)

`infra-watchdog` behavior:

- **warning**: soft throttle (`renice` + `ionice`).
- **critical**: graceful stop -> force-kill fallback -> cooldown sleep -> supervisor restart.

Manual intervention sequence:

1. `npm run ll:infra:monitor`
2. Inspect watchdog/supervisor logs
3. If unstable loop persists:
   - `npm run ll:infra:stop`
   - wait 10s
   - `npm run ll:infra:autostart`
4. Re-run `npm run ll:shift:aggregate` to confirm status.

TUI boundary rule in incidents:

- Keep Terminal A focused on pending human decisions.
- Perform all infra recovery in Terminal B.

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

# runtime health
npm run ll:infra:monitor

# manual clipboard ingest trigger (only when needed)
npm run clipboard:trigger

# human routing terminal (separate)
npm run ll:human:loop
```
