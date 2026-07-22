# Phase 4 TUI State Machine Plan

**Purpose**: Define the next refinement stage for the operator TUI after the 3-pane split completed in Phases 1-2. Phase 4 keeps the render path responsive under SSE bursts, makes the operator flow explicit, and prepares the UI for production signal-driven state transitions.

**Context**: The current TUI architecture already separates render and keyboard handling, and the daemon now exposes the three signal points that matter for operator workflow: `job.generated`, `job.parse.completed`, and `job.routed`. Phase 4 turns that event stream into a predictable state machine with buffering, bounded memory usage, and clear action semantics.

## 1. SSE Buffering & LRU Display State

The primary Phase 4 problem is not correctness of the signals themselves; it is what happens when they arrive faster than the display loop can render them. During webhook bursts, multiple `job.generated` and `job.parse.completed` events can land within a short interval, and a naive render path will either drop frames or overwrite the visible job before the operator has time to act. The solution is to decouple the event intake path from the display path.

The SSE subscriber should behave like a bounded collector. Instead of pushing directly into the render loop, it writes incoming events into a ring buffer with a capacity of 100 events. That gives enough headroom for short spikes without allowing unbounded memory growth. A ring buffer is the right fit here because the TUI only needs the most recent events, not a complete historical archive. If the buffer fills, the oldest event is overwritten, which is acceptable because the operator display only needs the current job and the immediate prior context.

Display state should also be bounded. The TUI should maintain an LRU cache of the last five jobs visible to the operator. That cache is not a queue of work to process; it is a navigation aid for recall and quick context recovery. Phase 4 does not need full arrow-key navigation yet, but the cache should be wired in now so Phase 5 can expose it without changing the core state model. The display state includes the current job, the current message ID, and the most recently edited fields, if any.

The render loop should be explicitly throttled to a maximum of 20 FPS. A 50 ms interval is fast enough to feel live while avoiding the CPU churn that comes from redrawing on every SSE event. This also reduces the chance of terminal artifacts during a webhook burst because the render surface is updated at a predictable cadence rather than opportunistically.

The memory target for the buffers, job cache, and per-frame scratch data should stay below 50 MB. That is a practical ceiling for a terminal operator tool and leaves plenty of room for the daemon, MongoDB driver, and any editor subprocesses launched from the TUI.

```typescript
// SSE buffer (circular queue)
private sseBuffer: SseEvent[] = new Array(100);
private sseHead = 0;
private sseTail = 0;

// Display state LRU
private displayLRU: LRUCache<string, CanonicalJob> = new LRUCache({ max: 5 });

// Current job
private currentJob: CanonicalJob | null = null;
private currentMessageId: string | null = null;

// Frame throttling
private lastRenderTime = 0;
private renderInterval = 50; // ms
```

## 2. State Machine

Phase 4 should make the operator flow explicit. The TUI must only permit legal transitions, and the action keys should mean the same thing every time. The state machine is intentionally small: IDLE means nothing is currently shown, DISPLAY means a job is visible and the operator can act, and DISPATCH is a short-lived internal state used when an action is being sent to the daemon.

```text
┌─────────────────────────────────────────────────────────────────┐
│ STATE MACHINE: TUI Action Flow                                  │
└─────────────────────────────────────────────────────────────────┘

IDLE (no job in display)
    │
    [SSE: job.generated or job.parse.completed]
    ↓
DISPLAY (job in view, awaiting operator command)
    │
    ├─ [p] PREVIEW → peek clipboard data → stay in DISPLAY
    ├─ [e] EDIT → open nano/vim → get edits → stay in DISPLAY
    ├─ [j] QUEUE → mark job.routed → IDLE (next job loads)
    ├─ [d] TRASH → mark job.routed → IDLE (next job loads)
    ├─ [s] SKIP → mark job.routed → IDLE (next job loads)
    ├─ [c] STAGE2 (webhook only) → POST /internal/ingest → wait for Signal 2 → DISPLAY refresh
    ├─ [o] OPEN-URL → try open(url) → log on fail → stay in DISPLAY
    └─ [h] HELP → show actions → stay in DISPLAY

Key: Only [j], [d], [s] route jobs and advance to next.
     [e] edits only; [j] applies edits + queues.
```

The important rule is that signal handling and action handling are separate. Signal 1 and Signal 2 are display updates. Signal 3 is the only transition that closes a job. That keeps the operator mental model stable: a job stays visible until they explicitly route it.

## 3. Operator Action Details

The action contract should be narrow and predictable. Every key either gives the operator more information, allows them to modify the current job, or routes the current job. Nothing should implicitly advance the state except routing actions.

`p` - Preview. This action shows clipboard content or the current job payload in a readable format. Because it writes to stdout, it will temporarily interrupt the render surface, but it must not block the event loop. If the clipboard is empty, the TUI should log a concise message such as "Clipboard empty" and remain in DISPLAY.

`e` - Edit. This action opens `$EDITOR` with the current job serialized as YAML or JSON. The operator can edit fields such as title, salary, location, or tags, and the TUI then parses the edited result back into pending changes. Importantly, editing alone does not route the job. The display should show edited fields highlighted, and the prompt should make it obvious that a routing decision is still required: press `[j]` to queue with edits, `[d]` to discard, or `[s]` to skip.

`j` - Queue. This action merges `currentJob` with any `editedKVs` and sends the routing request over UDS with `action: 'queue'`. The TUI should then transition from DISPLAY to IDLE, clear the active job, and wait for the next signal. The success message should include timing so latency regressions are visible, for example `[j] ✓ Job queued (XXXms)`.

`d` - Discard. This action sends `action: 'trash'` over UDS for the current `messageId`. The state should move from DISPLAY to IDLE after the daemon confirms the route. The feedback should be simple and unambiguous: `[d] ✓ Job trashed`.

`s` - Skip. This action sends `action: 'skip'` over UDS. It is a routing decision, but it does not mean the operator accepted or rejected the job; it means the job should be removed from the active workflow without queueing or trashing. The UI should treat it as a completion event and advance to IDLE.
`s` - Skip. This action is removed as per the refined architecture. Jobs are either queued or trashed.

`o` - Open URL. This action should attempt to open the job URL in the browser. If the open succeeds, the operator stays in DISPLAY. If it fails, the TUI should fall back gracefully: log the error, copy the URL to the clipboard if possible, and notify the operator with a message like `[o] ❌ Could not open URL (copied to clipboard)`. A failed browser launch must not change the current state.

`h` - Help. This action prints the key map and state hints to stdout, then returns the operator to DISPLAY. It is a documentation aid, not a workflow state change.

## 4. Message ID Queue Management

Phase 4 should also formalize message tracking. The TUI needs a lightweight list of message IDs for the jobs that have arrived through SSE so that it can recover from bursts, re-renders, or partial updates. The list is append-only for the current session and is keyed by `messageId` so the current position is always unambiguous.

For this phase, only one job should be visible at a time. The queue can grow behind the scenes, but the operator is always focused on the current item. The design should anticipate future arrow-key navigation by keeping the LRU cache and message list separate. The LRU cache is for display recall. The message list is for lifecycle ordering.

That separation matters when the daemon emits Signal 1 followed quickly by Signal 2 for several jobs. The TUI should not drop the later jobs; it should buffer them and present them in a deterministic order while preserving the current focus.

## 5. TUI Lifecycle

The Phase 4 lifecycle is a simple loop, but it must be explicit about where each responsibility lives. The main function should initialize mode context, connect to SSE, attach keyboard handling, and then enter the main loop. The loop polls the SSE buffer, applies signal updates, checks keyboard input in a non-blocking way, and redraws only when the render throttle allows it.

```typescript
main()
  1. initModeContext()
  2. connectSSE()
  3. attachKeyboard()
  4. enterMainLoop()
    4a. Poll SSE buffer (decode events)
    4b. Check for new Signal 1/2 → update currentJob, redraw DISPLAY
    4c. Poll keyboard (non-blocking)
    4d. Throttle render (50ms interval)
    4e. Repeat
  5. onExit() → cleanup TTY, close UDS
```

The exit path matters as much as startup. A TUI that leaves the terminal in a bad state is operationally expensive, especially when operators are switching between render, action, and log panes. Cleanup must restore the TTY, close sockets, and leave the daemon untouched.

## 6. Production Readiness Checklist

Phase 4 is done only when the state machine is boring in the best possible sense: no lost keys, no accidental routing, no runaway redraws, and no memory growth. The checklist below is the acceptance gate for the feature.

- [ ] SSE buffer & LRU implemented
- [ ] State machine enforced (only valid transitions)
- [ ] Render throttling at 20 FPS (50ms min)
- [ ] Error handling for all actions (graceful degradation)
- [ ] Logging for all state changes and UDS sends
- [ ] Memory footprint <50MB
- [ ] No blocking calls in render loop
- [ ] UDS action latency <100ms
- [ ] Tested with 100+ rapid SSE events
- [ ] Phase 4 integration test passed

This checklist should be treated as a production gate, not a nice-to-have. If any item fails under load, the TUI is not ready for the signal-driven state machine that production expects.

## Phase 4 Outcome

If implemented as written, Phase 4 gives the operator a bounded, inspectable, and deterministic interface for the daemon’s signal stream. The TUI will absorb bursty SSE traffic without dropping state, keep the operator focused on one job at a time, and preserve a clear contract between preview, edit, route, and browse actions. That is the right foundation for Phase 5 navigation and the later production multi-operator work.
