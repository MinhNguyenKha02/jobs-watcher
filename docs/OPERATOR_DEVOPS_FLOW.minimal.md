# Operator DevOps Flow — Minimal (canonical)

Purpose: Minimal, prescriptive checklist for daily/weekly operator duties and quick recovery. This file is the REQUIRED checklist operators follow during a shift; see `OPERATOR_DEVOPS_FLOW.md` for policy and rationale.

## Shift Start (Acceptance)

- Ensure services are running:
  - `npm run start:all-prod` (if not running)
  - Verify process is running (use `pgrep` if supervisor owns PIDs):
    ```bash
    pgrep -fl 'index.js|dist/src/index.js' || echo "webhook process not found"
    pgrep -fl 'data-listening' || echo "data-listening process not found"
    ```
  - Note: the long-running worker can be started from the main entrypoint by setting `START_DATA_LISTENING=1` before launching `dist/src/index.js`. This lets a single `node dist/src/index.js` process host both the webhook and the optional data-listening worker under supervisor control.
  - Optional HTTP probe (if `/health` exists):
    ```bash
    curl -fsS http://127.0.0.1:PORT/health || echo "health probe failed"
    ```

- Run daily artifact and validate pass criteria:
  - `node scripts/daily-report.js` (writes `logs/daily-report-YYYY-MM-DD.json`)
  - Pass criteria:
    - `logs/daily-report-YYYY-MM-DD.json` exists
    - `jq '.evalFetched' logs/daily-report-*.json | tail -n1` >= expected baseline
    - `jq '.missingEvalIdsCount' logs/daily-report-*.json | tail -n1` == 0

## During Shift (ops obligations)

- Run `npm run eval:fetch-and-trigger` at least once per shift to exercise the pipeline.
- Monitor key logs (Terminal B layout recommended):
  - `tail -f logs/infra-monitor.log`
  - `tail -f logs/infra-watchdog.log`
  - `tail -f logs/webhook.log`
  - `tail -f logs/data-listening.log`

- Use the human-in-loop TUI for `needs_enrichment` routing and clipboard ingress:
 - Use the human-in-loop TUI for `needs_enrichment` routing and clipboard ingress:
  - Start the canonical TUI/human loop: `npm run ll:human:loop` (alias to `npm run manual-enrichment -- --poll-ms=5000`) or run the interactive TUI with `npm run tui`.
  - In the TUI use `p` to paste/import job HTML from the system clipboard. For fixture/testing, enable `CLIPBOARD_FIXTURE_MODE=1` or run the legacy fixture helper (fixture-only) `npm run clipboard:trigger`.
  - Note: the internal HTTP clipboard endpoint (`/internal/clipboard`) was intentionally removed. Operators must use the TUI (`npm run tui` or `npm run manual-enrichment` / `npm run ll:human:loop`) and press `p` to paste. The TUI provides a `d` dashboard command; the runtime monitoring helper exposes `getRuntimeStats(storage)` in `src/cli/monitoring.ts` for programmatic stats. Prefer these over HTTP clipboard POSTs in production.
  - Action snapshots created by the TUI are persisted to `logs/action-snapshots.jsonl` and `logs/action-snapshots/` (HTML). Attach these to the shift evidence bundle.

- Real-time dashboard (SSE) for ingestion/metrics:
  - Start a lightweight SSE dashboard: `node scripts/dashboard-sse.js` (serves `/metrics/stream` and `/metrics.json` on `127.0.0.1:${DASHBOARD_PORT:-4001}`).
  - Quick test: `curl -sS http://127.0.0.1:4001/metrics.json` or open `/metrics/stream` in a browser/clients that support Server-Sent Events.
  - Use the dashboard to monitor ingestion state, recent telemetry snapshots, and queue depths while routing jobs in the TUI.
  - Note: the SSE dashboard can be run with `tsx scripts/dashboard-sse.js` and now queries Mongo directly (it no longer relies on an internal clipboard HTTP proxy).

- Evidence and routing:
  - When validating/queueing/skipping a job in the TUI, ensure the action shows in `src/db/output` (after export) and `logs/action-snapshots.jsonl`.
  - Capture small evidentiary notes in TUI (enrichmentNotes) and persist via `attachActionSnapshot()` for auditability.

- On alerts or CPU/memory warnings: capture evidence and run incident sequence:
  ```bash
  echo "[$(date -u +%FT%TZ)] alert-captured" >> logs/infra-monitor.log
  npm run ll:infra:monitor >> logs/infra-monitor.log 2>&1
  npm run ll:infra:monitor
  # if unstable:
  npm run ll:infra:stop && npm run ll:infra:autostart
  ```

## Weekly missing-trigger (cron-friendly)

- Purpose: detect and re-trigger missed Gmail `messageId`s.
- Manual or cron: `bash scripts/weekly-missing-trigger.sh` (also exposed via `npm run weekly:messageid-check`).
- Recommended weekly cron (Sunday 02:00):
  ```cron
  0 2 * * 0 cd /path/to/jobs-watcher && bash scripts/weekly-missing-trigger.sh >> logs/weekly-missing-trigger.cron.log 2>&1
  ```

## Restart / Recovery (minimal)

1. Stop long-running adapters to reduce load: `npm run ll:infra:stop`.
2. Ensure MongoDB is reachable (check `MONGODB_URI` or `node -e '...'`).
3. Restart in order:
  - `npm run start:webhook-prod` (webhook only)
  - `npm run start:hybrid-prod` (webhook + data-listening; this sets `START_DATA_LISTENING=1` so the worker is started from `index.js`)
4. Re-run verification:
   - `npm run eval:fetch-and-trigger` (run twice if needed)
   - `npm run validate:webhook-sync`

## Evidence & artifacts (operator source-of-truth)

- `logs/daily-report-YYYY-MM-DD.json` (single daily artifact)
- `logs/missing-eval-ids-YYYY-MM-DD.txt`
- `src/db/output/*.json` (runtime artifacts)
- `logs/webhook.log`, `logs/data-listening.log`
- `logs/infra-monitor.log`, `logs/infra-watchdog.log`
 - Process state: rely on supervisor (`systemctl status ...`) or `pgrep` rather than logs/*.pid files.

## Systemd unit example

Create a simple `systemd` service to run both the webhook and the optional worker (the worker is enabled by `START_DATA_LISTENING=1`):

```ini
[Unit]
Description=Jobs Watcher (webhook + data-listening)
After=network.target mongodb.service

[Service]
Type=simple
WorkingDirectory=/path/to/jobs-watcher
Environment=NODE_ENV=production
Environment=START_DATA_LISTENING=1
ExecStart=/usr/bin/node /path/to/jobs-watcher/dist/src/index.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

For periodic backfill/cron-like oneshots use a `systemd` timer or a separate `OnCalendar` unit that calls `bash /path/to/jobs-watcher/scripts/weekly-missing-trigger.sh`.

## Quick checks

- Verify latest daily report missing count:
  ```bash
  REPORT=$(ls -1 logs/daily-report-*.json | tail -n1)
  jq '.missingEvalIdsCount' "$REPORT"
  ```
- If missing > 0, run the weekly-missing-trigger flow immediately.

## Notes

- This minimal runbook is prescriptive and intended to be run by the on-shift operator. For policy, escalation, terminal layout, and CASE details see `OPERATOR_DEVOPS_FLOW.md` (full runbook).
