# Evaluation Stage (Eval Stage)

## Purpose
The eval stage allows you to simulate incoming Gmail job emails and validate the end-to-end ingestion pipeline while the main background service is running. This enables robust, isolated testing and monitoring without disrupting production operations.

## Prerequisites
- Core background service (`npm run serve:hybrid`) is running in audit/debug mode (always-on, non-negotiable). All logs must include urgency symbols ([!], [*], [✓]), origin, and be traceable for audit.
- Terminal A: TUI/manual enrichment is active.
- Terminal B: Infra/core monitor/log tail is active (merged monitoring: see below).
- Terminal C: Reserved for eval stage (fetch/analyze/testing).

## Eval Stage Flow

1. **Eval Fetch & Trigger (MANDATORY, at least once per shift):**
   - Run `npm run eval:fetch-and-trigger` in Terminal C.
   - This fetches Gmail messageIds (default: since 7 days ago, adjustable via env), and POSTs them to the webhook for ingestion.
   - All config (webhook URL, label, fetch limit, since date) is controlled via env vars or codebase config.
   - Outputs messageIds to logs/eval-messageids.json for audit.
   - All outputs use urgency symbols, origin, and are traceable in logs.

2. **Analyze (optional):**
   - Run `npm run analyze:raw-emails` in Terminal C if you want to extract/filter jobs from fetched emails.

3. **Ingest:**
   - The always-on core background service (`npm run serve:hybrid`) detects new jobs and ingests them into the main pipeline/job queue.
   - Jobs from eval-fetch-and-trigger will appear in needs_enrichment for manual processing in Terminal A.

- **Terminal A:** Human actions/manual enrichment.
- **Terminal B:** Infra monitor/log tail (watch for ingestion, incidents, and urgency symbols).
- **Terminal C:** Eval stage logs, fetch/analyze output, and any test artifacts. Use `npm run eval:fetch-and-trigger` for isolated eval.
- All outputs, incidents, and notifications must use urgency symbols ([!], [*], [✓]) and be traceable in logs.
 
## Monitoring & Outputs

- **Terminal A:** Human actions/manual enrichment (needs_enrichment only).
- **Terminal B:** Merged infra/core monitor/log tail. Run `npm run ll:infra:monitor` and `tail -f logs/infra-supervisor.log logs/infra-monitor.log` for unified monitoring of all background services, incidents, and eval/test flows.
- **Terminal C:** Eval stage logs, fetch/analyze output, and any test artifacts. Use `npm run eval:fetch-and-trigger` for isolated eval (MANDATORY per shift).
- All outputs, incidents, and notifications must use urgency symbols ([!], [*], [✓]), include origin, and be traceable in logs.
- **Terminal A:** Human actions/manual enrichment.
- **Terminal B:** Infra monitor/log tail (watch for ingestion, incidents, and urgency symbols).
- **Terminal C:** Eval stage logs, fetch/analyze output, and any test artifacts. Use `npm run eval:fetch-and-trigger` for isolated eval.
- All outputs, incidents, and notifications must use urgency symbols ([!], [*], [✓]) and be traceable in logs.

- The eval stage is isolated: it does not disrupt main ops, but exercises the full pipeline.
- Artifacts and shift evidence are handled as per the main runbook (`ll-shift-aggregate.sh`).
- Use this stage to validate new data, test pipeline changes, or simulate production-like ingestion.
- The core service (`npm run serve:hybrid`) should be running with debug/eval flags as needed for audit and monitoring. Terminal C is dedicated to eval/test flows.
 
## Notes

- The eval stage is isolated: it does not disrupt main ops, but exercises the full pipeline.
- Artifacts and shift evidence are handled as per the main runbook (`ll-shift-aggregate.sh`).
- Use this stage to validate new data, test pipeline changes, or simulate production-like ingestion.
- The core service (`npm run serve:hybrid`) must always run in audit/debug mode: all logs must include urgency symbols, origin, and be traceable for audit. Terminal C is dedicated to eval/test flows.
- The eval stage is isolated: it does not disrupt main ops, but exercises the full pipeline.
- Artifacts and shift evidence are handled as per the main runbook (`ll-shift-aggregate.sh`).
- Use this stage to validate new data, test pipeline changes, or simulate production-like ingestion.
- The core service (`npm run serve:hybrid`) should be running with debug/eval flags as needed for audit and monitoring. Terminal C is dedicated to eval/test flows.
