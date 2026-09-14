# TUI clipboard reuse + poll cur IPC + deferred 406 guard + minimal test cascade — 4-phase code-only plan

## Global

**Goal:** Close manual gaps with zero saga change: `case#1 [o]->[p]->[c] Clipboard empty` (hash dedup + double `clipboardGetter()` read), `issue#1 poll cur:…job-0 mixed vs PA cur:…job-3 PARTIAL` (aggregate label on pending-head), `#3 resolve/406` (`evictStaleDeferred` + 30min `S1` ack-timeout crash → `9091 cons:0`, `s1:12/s2:1` backlog). P4 keeps gates green with minimal churn.

**Outcomes:**
- `[p]` peek-only, `[c]/[i]` always read current clipboard; `[c]` single-read pass-through (same copy reusable N times).
- `tui-poll cur:` == PA header `cur:` (IPC `jobLifecycleId + PARTIAL/FULL`); `pend:` keeps heads + `+N more`; no `mixed` on `cur` line when IPC cur present.
- No second `406` from deferred path; `S1` long-hold documented; restart replays backlog in order.
- Gates green: `test:unit + contract + integration`, `build`, `lint`. No new test files; no `[o]->[p]->[c]` chain test.

**Constraints:**
- `system-constraints.md` saga `s1->s2a/s2c->s3/s4`, `ack-on-s34`, `[b]` queue/direct `xor [c]/[i]` unchanged.
- Code-only commit. Never add `daemon_dev_log.text/guide/logs/tui-logs-*.jsonl/backup/.env/token.json`. Never touch `git HEAD` (no reset/amend/rebase); `git stash` out of scope.
- Hex separation: TUI reads IPC + RMQ; daemon owns `ingestor/uds/rmq-pub`.
- Backward compat: `webhookIngest(jobLifecycleId?, html?)` overload (legacy 0/1-arg callers keep working); `syncSnapshot` `curId/curStage` optional (legacy 7-field callers keep working); pane falls back to `peekIds[0]+mixed` when `cur` absent.
- Step-0 truth locked: `mongo 14 partial + 2 full (job-0 FULL + 1a07…-job-3 FULL)`, `IPC job-3 PARTIAL`, `daemon 16/2/11/3`, `broker s1:12/s2:1 cons:0`.

**Phases-ordering prevention (regression-failure, parallelism safety):**
- `First persist → P1 clipboard → P2 cur IPC → P3 deferred guard → P4 test cascade → Verify(unit→build+lint→contract→integration) → Last commit`.
- Prevents: P2 before P1 leaves `[c]` untestable on live job; P3 before P2 mis-attributes `mixed` to deferred; P4 before P1-P3 cascades against stale `src`; verify before commit violates gate; commit before green violates gate.
- P1/P2/P3 touch overlapping TUI seams (`clipboard-getter/UdsActionWriter`, `metrics-registry/RabbitMqJobReader/RmqConsumerPane`) so strictly sequential, no parallel edits.

## First-step: persist plan

Wrote this file to `./plans/2026-09-14-tui-clipboard-cur-deferred-4phase.md`. No code.

## P1 — clipboard reuse `case#1`

**Goal:** `[o]->[p]->[c]` on same copy succeeds.
**Outcomes:** Drop `lastClipboardHash/toHash` dedup in both fixture + real paths; `[p]` non-consuming peek + modal; `handleWebhookStage2Parse` forwards its already-read `htmlPayload` to `webhookIngest(id, html)` (one `clipboardGetter()` per action; legacy no-html callers fall back to single read inside writer).
**Code-steps:**
1. `src/presentation/tui/services/clipboard-getter.ts`: remove `createHash` import, `lastClipboardHash`, `toHash`; `getFixtureClipboard` returns `[__clipboardJob]` every time; `clipboardGetter` returns `[text]` every time (keep `trim + isHtmlLike` guards).
2. `src/presentation/tui/ports/action-writer.port.ts`: `webhookIngest(jobLifecycleId?: string, html?: string): Promise<string>`.
3. `src/presentation/tui/components/UdsActionWriter.ts`: `webhookIngest(jobLifecycleId?, html?)` — use passed `html` when non-empty, else single `clipboardGetter()` fallback; validate `trim()`; POST `{html}[+jobLifecycleId]` to `/internal/ingest?webhook=true`.
4. `src/presentation/tui/tui-stdin-adapter.ts:417-464`: pass `htmlPayload` as second arg; keep `FULL_PARSED` + `queueMode` guards.
5. `tests/helpers/test-container.ts:568-574` facade: accept `(jobLifecycleId?, html?)`, include `html` in POST body when provided.
**Fallback:** headless `clipboardy` empty → existing `Clipboard empty` warn, no retry loop.
**Constraints:** No daemon/`signal2aManual` change; mock `vi.fn<any[]>` needs no edit.

## P2 — poll `cur` = IPC `issue#1`

**Goal:** `cur:` shows displayed job, not pending head.
**Outcomes:** `cur: 1a09…job-3 PARTIAL` == PA; `Q(tui)/pend/def` unchanged; `mixed` retired on `cur` only when IPC cur present.
**Code-steps:**
1. `src/presentation/tui/ports/metrics.port.ts`: `syncSnapshot` += `curId?: string | null; curStage?: string | null` (optional).
2. `src/infrastructure/outbound/monitoring/metrics-registry.ts`: add `rmqCur Gauge{rmq_cur, labels:[id,stage]}`; `syncSnapshot` sets `reset()` + `set({id: trunc11(curId), stage}, 1)` when present, else `reset()`.
3. `src/presentation/tui/components/RabbitMqJobReader.ts:110-136`: `syncMetrics()` reads `getCurrentJob()` (already imported) for `curId/curStage`, threads into `syncSnapshot`.
4. `src/presentation/tui/components/RmqConsumerPane.ts`: `RmqMetricsSnapshot += curId/curStage`; `toRmqSnapshot` reads `metrics.rmqCur[0].labels`; `renderRmqConsumerPane:75-81` prefers IPC `cur` when present, else legacy `peekIds[0]+mixed` fallback.
**Fallback:** IPC `null` or metric absent → `cur: —` / legacy peek path (existing tests stay green).
**Constraints:** Render-only; `peekIds` truncation path untouched.

## P3 — deferred `406` guard `#3 resolve`

**Goal:** No double-resolve `nack`; clarify `S1` 30min kill.
**Outcomes:** `evictStaleDeferred` nacks only when tag still tracked; `s34 ack/autoAdvance/resolve` untouched.
**Code-steps:**
1. `src/presentation/tui/components/RabbitMqJobReader.ts:565-588`: keep `tracked.includes` guard, add explicit early-delete + `tracked` in log context; no `nack` when `false`.
**Fallback:** operator drain note (`[j]/[d]` to ack); restart replays `s1:12/s2:1`.
**Constraints:** No prefetch/TTL/saga change (`PREFETCH 5, DEFERRED_MAX 10/TTL 30s` stay).

## P4 — test-update (cascade only, no chain test)

**Goal:** Existing gates pass unmodified in intent, updated only where `src` changed API/render.
**Outcomes:** No new test files; no `[o]->[p]->[c]` chain test; `rmq-pane.test.ts` +2 its for IPC cur, all prior its untouched.
**Code-steps:**
1. `tests/unit/presentation/tui/rmq-pane.test.ts`: keep all 7 existing its as-is; append `GIVEN curId+PARTIAL with P:3 F:1 WHEN render THEN cur shows IPC PARTIAL (not mixed)` and `GIVEN curId FULL WHEN render THEN cur FULL`.
2. Contract/integration/path suites: verify-only (distinct `clipboardSetter` per step already passes without dedup; `whenS2a/processIngest` never touches `clipboardGetter`; structural `typeof webhookIngest` stays green).
**Fallback:** if any gate asserts old `mixed`/`[]-on-reread`, update that single literal, never add files.
**Constraints:** `unit→contract→integration` counts shift only by +2 unit its.

## Verify (gate)

1. `npm run test:unit` (expect +2 new its green, rest unchanged).
2. `npm run build` + `npm run lint` (0 errors).
3. `npm run test:contract` + `npm run test:integration` unchanged green.
4. Manual: `[p]→[c]` reuse on live job → `FULL`; `curl 9091/observability` `rmqCur.id==IPC`.

## Last-step: git code-only + commit + changelog

Build-mode only, no HEAD moves, no stash:

```bash
git add src/presentation/tui/services/clipboard-getter.ts src/presentation/tui/ports/action-writer.port.ts src/presentation/tui/components/UdsActionWriter.ts src/presentation/tui/tui-stdin-adapter.ts tests/helpers/test-container.ts src/presentation/tui/ports/metrics.port.ts src/infrastructure/outbound/monitoring/metrics-registry.ts src/presentation/tui/components/RabbitMqJobReader.ts src/presentation/tui/components/RmqConsumerPane.ts tests/unit/presentation/tui/rmq-pane.test.ts plans/2026-09-14-tui-clipboard-cur-deferred-4phase.md
git commit -m "fix(tui): clipboard reuse single-read, poll cur IPC stage, deferred nack guard"
```

Append `## Changelog` below with per-phase file lines + gate results. Code-only; no logs/guide/backup.

## Changelog
- 2026-09-14 plan persisted (`./plans/2026-09-14-tui-clipboard-cur-deferred-4phase.md`, 4 phases, code-only).
- 2026-09-14 P1 clipboard reuse: `clipboard-getter.ts` dropped `createHash/toHash/lastClipboardHash` (peek every call, `trim+isHtmlLike` kept); `action-writer.port.ts` → `webhookIngest(jobLifecycleId, html)` both required; `UdsActionWriter` removed `clipboardGetter` import, `ingest` + `webhookIngest` validate `trim()` empty early-throw, no inline read; `tui-stdin-adapter [c]` passes `(id, htmlPayload)`, `[i]` passes `html`, `[p]` getter + id-guard as-is; `test-container.ts` facade posts `{html, jobLifecycleId}`.
- 2026-09-14 P2 poll cur IPC: `metrics.port.ts` `syncSnapshot += curId/curStage?`; `metrics-registry.ts` new `rmqCur{id,stage}` gauge + set/reset; `RabbitMqJobReader.syncMetrics` threads `getCurrentJob()` trunc11 cur; `RmqConsumerPane` snapshot/toSnapshot/render prefers IPC `cur` (`partial_parsed→PARTIAL`, `full_parsed→FULL`), legacy `peekIds[0]+mixed` fallback.
- 2026-09-14 P3 deferred guard: `evictStaleDeferred` explicit tracked-only nack + `tracked` log context + already-resolved debug path; no prefetch/TTL/saga change.
- 2026-09-14 P4 tests: `rmq-pane.test.ts` +2 its (IPC PARTIAL over mixed pend, IPC FULL); contract/integration/path suites verify-only, no chain test, no new files.
- 2026-09-14 verify green: `tsc --noEmit` + `tsc -p tsconfig.test.json` clean; `test:unit` 45/453; `build` clean; `lint` 0 errors (14 pre-existing warnings); `test:contract` 12/111; `test:integration` 10/32+1skipped.
- 2026-09-15 `--purge` IPC reset (amended): `scripts/tmux-tui-setup.sh:35-40` restores `rm -f $TUI_SHARED_STATE_PATH[.lock/.tmp]` + logs on `--purge` with ordering comment (env assert :30 → purge :35 → `new-session` :64 → PA first `send-keys` :70 recreates via `ensureSharedStateFile()`); non-purge reruns preserve/restore. `bash -n` clean.
