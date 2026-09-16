# B1 Card-Scroll + P3 Resize

## Global

- Goal: `↑/↓` scroll the PA job card by default (modal-first when `[p]` open); plus case#2 resize — no parser widening, no mouse enable, keyboard-only. (P1 docs + P2 block-guard reverted out of scope; see Changelog.)
- Outcomes:
  - B1: `cardScroll` offset in IPC state, renderer windowing + `↕ n/m`, PB dispatch retarget, footer hints; scroll traffic at debug level (PE clean).
  - P3: bottom `-p 25→-p 17` (PC/PD h12→h8, PA h28→h32, PE h36→h40).
- Constraints: code-only commit (stage only files below); never add logs/guide/backups/`.env`/tokens; read-only bash + `npm run test:unit|integration|contract|build|lint`, `bash -n` allowed.
- Phases-ordering (regression-failure, parallelism safety): state → renderer → PB dispatch → PA feed → footer → P3 → unit tests → gates (`tsc`, unit, contract, integration, lint, `bash -n`) → commit. No phase reorders IPC shape after renderer lands.

## Phase B1-1 — cardScroll state (`shared-tui-state.ts`)

- Goal: per-mode scroll offset in IPC, reset on job change.
- Outcomes: `ModeSubState.cardScroll`, `CurrentJobState.cardScroll`, `updateCardScroll()` (clamp ≥0, locked persist), `getCardScroll()`, reset in `setCurrentJob`; defaults in `createDefaultModeSubState` + `parseModeSubState`.
- Code-steps: extend interfaces → defaults/parse → `setCurrentJob` patch `cardScroll: 0` → add `updateCardScroll`/`getCardScroll`. Fallback: offset top-level if mode-merge conflicts (not expected — additive only).
- Constraints: additive fields only; lock discipline (`withExclusiveLock`) unchanged.

## Phase B1-2 — renderer windowing (`JobCardRenderer.ts`)

- Goal: fixed head/foot, scrollable body, `↕` indicator; byte-identical output when content fits.
- Outcomes: `renderCard(job, status, actionInProgress?, cardScroll = 0)`; body slice clamped to `terminalHeight - reserved`; `╟─ ↕ a–b/total (↑/↓ scroll)` indicator only when overflowing.
- Code-steps: split frame into head/body/foot line arrays → clamp + slice → indicator. Fallback: drop indicator line, keep slice (never break frame).
- Constraints: no logging in renderer; existing callers/tests unaffected (optional 4th param).

## Phase B1-3 — PB dispatch (`tui-stdin-adapter.ts`)

- Goal: `MODAL_SCROLL_*` with no modal scrolls card instead of warn-flooding PE.
- Outcomes: new `handleCardScroll()` → `updateCardScroll()` + debug log; `MODAL_DISCARD`-only keeps warn branch.
- Code-steps: retarget switch cases `:193-198` → add `handleCardScroll` (dynamic import mirrors preview handlers). Fallback: keep warn branch untouched if import fails (try/catch already).
- Constraints: `mainLoop` info line untouched; keyboard-only byte table unchanged.

## Phase B1-4 — PA feed + footer (`tui-stdout-adapter.ts`, `StdinStatusPane.ts`)

- Goal: scroll offset reaches PA render; PB footer advertises card scroll.
- Outcomes: `renderFrame` passes `state.cardScroll` (watch-triggered repaint covers offset writes); footer `card: ↑/↓` when no modal + keys line `↑/↓ scroll`.
- Code-steps: one-arg change in `renderFrame` → footer strings. Fallback: none needed (display-only).
- Constraints: no new watchers/timers; 100 ms debounce unchanged.

## Phase P3 — resize

- Goal: close case#2 line item (PA overflow room).
- Outcomes: tmux bottom `-p 17` + layout comments.
- Code-steps: script value + comments.
- Constraints: P3 value-only (no pane reorder).

## Phase Verify + Commit

- Goal: green gates, code-only commit, changelog here.
- Outcomes: `build`, `test:unit|contract|integration`, `lint` (0 err), `bash -n` clean; commit `fix(tui): …` + Changelog section appended below.
- Code-steps: gates in order → `git add` (files below only) → commit → changelog. Fallback: fix-forward, never amend/reset.
- Constraints: stage list = `shared-tui-state.ts`, `JobCardRenderer.ts`, `tui-stdin-adapter.ts`, `tui-stdout-adapter.ts`, `StdinStatusPane.ts`, `tmux-tui-setup.sh`, `card-scroll.test.ts`, this plan. Pre-existing worktree mods (eval scripts, profile.source, webhook-adapter, gmail, uds-probe) stay unstaged.

## Phase B1-5 — overflow gate (refinement)

- Goal: `↑/↓` writes IPC only when the card overflows; fitting card → no-op + info log (no IPC write).
- Outcomes: `ModeSubState.cardScrollMax` published by PA (change-only write, loop-safe), `updateCardScroll` top-clamped to max, PB no-op path logs info per press (`card_scroll_noop`); `cardBodyStats()` extracted from `renderCard`.
- Code-steps: state fields/setter/getter → renderer extract → PA publish in `renderFrame` → PB gate → tests → gates → amend.
- Constraints: additive only; PA write only on change (no watch loop); modal path untouched.

## Changelog

- B1: `cardScroll` IPC offset (`shared-tui-state.ts`: `updateCardScroll`/`getCardScroll`, reset on `setCurrentJob`); `JobCardRenderer.renderCard(job, status, action?, scroll=0)` windows body to pane height with `↕ a–b/total` indicator (byte-identical when fitting); PB `MODAL_SCROLL_*` with no modal → `handleCardScroll` at debug level (warn branch kept for `MODAL_DISCARD` only); PA feeds `state.cardScroll`; PB footer `card: ↑/↓`.
- B1-5 overflow gate: `cardScrollMax` published by PA per render via `cardBodyStats()` (change-only write, no watch loop); `updateCardScroll` top-clamped to max; fitting card → no-op, no IPC write, info `card_scroll_noop` per press in PE.
- P3: bottom `-p 25→-p 17` (PC/PD h12→h8, PA h28→h32, PE h36→h40) + layout comments.
- Reverted out of scope: P1 `poll-rmq-pane.ts` header + P2 `isBlockedPage()` guards (both `signal2aManual`/`signal2cBrowserAuto`) + `signal2-block-page.test.ts` — files verified byte-identical to `814508d` (`git diff 814508d` clean).
- Tests: `card-scroll.test.ts` (12: state round-trip/clamp/reset/legacy-parse + top-clamp/shrink-clamp/change-only-write + renderer identity/window/clamp/stats).
- Gates (B1-5): `tsc --noEmit` clean; unit 46 files / 465 tests pass; lint 0 err (14 pre-existing warn, none new); `build` clean; `tui-x-daemon` contract file 10/10 in isolation.
- Note: staged `shared-tui-state.ts` / `tui-stdout-adapter.ts` also carry the prior uncommitted `ensureSharedStateFile()` hunk (single recreate side for `--purge`); reviewed, required, bundled deliberately.
