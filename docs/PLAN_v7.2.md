# v7.2 Aggregated Plan — RMQ Hexagonal Migration

## Exchange & Queue Topology

```
jobs.events (topic, durable)
  ├── tui.s1      ← routing: 'job.generated'                     queue 1, prefetch=5
  ├── tui.s2      ← routing: 'job.parse.completed'               queue 2, prefetch=5
  └── tui.s3s4    ← routing: 'job.queue', 'job.trash',           queue 3, prefetch=5
                             'job.route.failed', 'job.parse.failed'
```

Routing keys use `ActionEvent` enum values.

## 3-Consumer RabbitMqJobReader

### Interfaces

```typescript
interface PendingJob {
  readonly id: string
  readonly job: JobData
  stage: 'PARTIAL' | 'FULL_PARSED'
}

interface S2BufferEntry {
  payload: JobData
  deliveryTag: number
  timestamp: number
}
```

### Properties

| Property | Type | Owner |
|---|---|---|
| `pendingJobs` | `PendingJob[]` | C1 push, C2 merge, C3 remove |
| `currentJobId` | `string \| null` | C1 set, C3 clear |
| `queueMode` | `boolean` | TUI mode |
| `deliveryTagsS1` | `Map<string, number[]>` | C1 store, C3 drain |
| `deliveryTagsS2` | `Map<string, number[]>` | C2 store, C3 drain |
| `deferredS2Buffer` | `Map<string, S2BufferEntry>` | C2 buffer, C1 drain |

### Methods

| Method | Visibility | Responsibility |
|---|---|---|
| `start()` | public | Consume all 3 queues |
| `stop()` | public | Cancel consumers, nack pending |
| `onMessageS1(msg)` | private | `job.generated` handler |
| `onMessageS2(msg)` | private | `job.parse.completed` handler |
| `onMessageS3S4(msg)` | private | S3/S4 handler |
| `ackAllForJob(id)` | private | Ack C1 + C2 delivery tags |
| `autoAdvance()` | private | Dequeue next pending job |
| `removeFromPending(id)` | private | Remove from pendingJobs array |
| `drainDeferredS2(id)` | private | Merge buffered S2 into pending entry |

### Consumer Logic

```
C1 ─ tui.s1 ─ prefetch=5 ─ onMessageS1:
  store deliveryTag
  drainDeferredS2 or push pending
  autoAdvance

C2 ─ tui.s2 ─ prefetch=5 ─ onMessageS2:
  store deliveryTag
  if pending → merge in queue
  elif currentJob → IPC merge
  elif !queueMode → direct: ack orphaned tags, setCurrentJob
  else → deferredS2Buffer

C3 ─ tui.s3s4 ─ prefetch=5 ─ onMessageS3S4:
  ackAllForJob (C1+C2 tags)
  ack own tag
  removeFromPending
  clearCurrentJob if matches
  if queueMode → autoAdvance
```

## Ports

| Port | File | Methods |
|---|---|---|
| `ParsePort` | `parse.port.ts` | `emitGenerated`, `emitCompleted`, `emitFailed` |
| `AssetProducingPort` | `asset-producing.port.ts` | `toAsset(job)` |
| `JobLifecyclePort` | `job-lifecycle.port.ts` | `upsert`, `updateStage`, `findById` |
| `RoutingPort` | `routing.port.ts` | `emitJobQueued`, `emitJobTrashed`, `emitRouteFailed` |

## Health Adapter (port 9090)

| Endpoint | Method | Response |
|---|---|---|
| `/health` | GET | `{status: "ok", uptime}` |
| `/health/live` | GET | 200 |
| `/health/ready` | GET | 200 if deps OK |
| `/metrics` | GET | Prometheus text |
| `/health/observability` | GET | Aggregated 6Q JSON |

### `/health/observability` JSON shape

```json
{
  "live": true,
  "ready": true,
  "uptimeSec": 3600,
  "q1": { "activeJobs": 3, "queueDepth": 2 },
  "q2": { "s1": 45, "s2": 40, "s3": 35, "s4": 3 },
  "q3": { "s1s2_p50": 0.5, "s1s2_p95": 2.1, "s2s3_p50": 1.2 },
  "q4": { "parseFail": 1, "routeFail": 0 },
  "q5": { "hourlyRate": 45 },
  "q6": { "memMb": 128, "lagMs": 2, "cpu": 0.15 }
}
```

## Observability CLI

`src/infrastructure/inbound/cli/observability.ts`

```
setInterval(5000):
  fetch('http://127.0.0.1:9090/health/observability')
  ANSI cursor positioning overwrites each line — no flicker, no SSE
```

Uses `\e[2H\e[2K`, `\e[3H\e[2K` per row. No `\e[2J`.

## Ingestor Guards

| Action | Guard | Behavior |
|---|---|---|
| `[j]` (queue) | `status !== ENRICHED` | Reject, log warning, no-op |
| `[d]` (trash) | None | Pass through |

## gmailMeta Contract

| Source | gmailMeta | Behavior |
|---|---|---|
| `BROWSER_AUTO` | Required | Error if missing |
| `MANUAL` | Optional | Skipped |

## Schema

2 collections: `job_lifecycle` + `extraction_queue`

`job_lifecycle` index: `{role: 1, company: 1}` — unique, no partial filter. Dedup via E11000.

## Adapter File Map

```
src/infrastructure/inbound/web/webhook-adapter.ts
src/infrastructure/inbound/uds/uds-adapter.ts
src/infrastructure/inbound/health/health-adapter.ts
src/infrastructure/inbound/cli/observability.ts
src/infrastructure/outbound/persistence/mongo-job-lifecycle-adapter.ts
src/infrastructure/outbound/persistence/extraction-queue-adapter.ts
src/infrastructure/outbound/rabbitmq/rabbitmq-connection-adapter.ts
src/infrastructure/outbound/rabbitmq/rabbitmq-parse-adapter.ts
src/infrastructure/outbound/rabbitmq/rabbitmq-routing-adapter.ts
src/infrastructure/outbound/asset-builder/asset-producing-adapter.ts
src/presentation/tui/tui-stdout-adapter.ts
src/presentation/tui/tui-stdin-adapter.ts
src/presentation/tui/components/RabbitMqJobReader.ts
```

## Tmux Layout

```
┌──────────────────────────┬─────────────────────────┐
│ tui-stdout (render)      │ observability pane      │
│ 60w × 80h                │ 40w × 40h               │
│                          │ LIVE ✓  up: 1h          │
│  ANSI frames             │ active:3  qDepth:2     │
│                          │ S1→S2 p50:0.5s p95:2.1s│
│                          │ S2→S3 p50:1.2s         │
│                          │ fail P:1 R:0           │
│                          │ thrpt:45/hr            │
│                          │ mem:128mb lag:2ms      │
│                          │ cpu:15%                │
├──────────────────────────┼─────────────────────────┤
│ tui-stdin (actions)      │ stderr (logs tail -f)  │
│ 60w × 20h                │ 40w × 60h               │
└──────────────────────────┴─────────────────────────┘
```

## Commit Plan (atomic, chronological)

```
feat(deps): add pino and prom-client dependencies
feat(monitoring): create trace-context.ts with uuid correlation IDs
feat(monitoring): create metrics-registry.ts with 6Q Prometheus metrics
refactor(monitoring): rename memory-monitor.ts to system-monitor.ts, add CPU and event loop lag
refactor(logging): rewrite logger.ts with pino wrapper, .struct API, recategorize all log calls
feat(domain): create ActionEvent, KeyAction, and OperatorAction enums
chore(domain): delete stale type files (canonical, eventsource, action-snapshot, types.ts)
chore(domain): delete scoring directory and profile-parser.ts
refactor(domain): remove matchScore and matchedSkills from all types and consumers
refactor(domain): move flatten-job.ts to src/domain/services/
refactor(domain): make profile/index.ts a pure domain entry point
feat(ports): create parse.port.ts (renamed from parse-event.port)
feat(ports): create asset-producing.port.ts (renamed from profile-retrieval.port)
feat(ports): create job-lifecycle.port.ts (upsert, updateStage, findById)
refactor(persistence): rewrite schemas.ts for 2 collections with unique role+company index
feat(persistence): create mongo-job-lifecycle-adapter.ts implementing JobLifecyclePort
refactor(persistence): add metrics and TraceContext to extraction-queue-adapter.ts
feat(rabbitmq): create rabbitmq-connection-adapter.ts with exchange and 3 queue declarations
feat(rabbitmq): create rabbitmq-parse-adapter.ts implementing ParsePort with ActionEvent routing
feat(rabbitmq): create rabbitmq-routing-adapter.ts implementing RoutingPort with ActionEvent routing
refactor(ingestor): swap to new ports, remove CanonicalJob/scoring, enforce gmailMeta and [j] guard
feat(asset-builder): create asset-producing-adapter.ts implementing AssetProducingPort
feat(uds): create uds-adapter.ts with DI constructor and x-internal-token auth
feat(health): create health-adapter.ts with /health /metrics /health/observability endpoints
feat(cli): create observability.ts CLI that polls /health/observability every 5s
refactor(webhook): rename event-webhook.ts to webhook-adapter.ts with dual PubSub/simulated income
feat(tui): create RabbitMqJobReader.ts with 3-queue consumer and DeferredS2Buffer
refactor(tui): rename ops-tui-app.ts to tui-stdout-adapter.ts with RabbitMqJobReader
refactor(tui): rename action-controller.ts to tui-stdin-adapter.ts with KeyAction enum
refactor(tui): move clipboard-getter.ts to presentation/tui/services/
refactor(tui): update KeyboardHandler.ts with KeyAction enum and dynamic help
refactor(tui): update JobCardRenderer.ts with dynamic footer from KeyAction enum
refactor(tui): update UdsActionWriter.ts with OperatorAction enum
refactor(tui): update shared-tui-state.ts with JobStage enum, drop CLIPBOARD_SCORED
feat(core): create src/index.ts composition root wiring all adapters
chore: delete 24 stale source files and 11 stale test files
chore(scripts): add tui-stdout/tui-stdin/build:artifacts/test:regression to package.json
chore(scripts): update tmux-tui-setup.sh with new layout and observability pane
chore(scripts): fix eval-fetch-and-trigger.sh stale gmail.js path
test: refactor existing unit tests for port renames and type changes
test: add new unit tests for RabbitMqJobReader, adapters, and guards
test: add integration tests for RMQ signal flow, burst, deferred S2, and crash recovery
chore: update regression tests and run system-constraints.md compliance audit
refactor(src): put to hexagonal arch
```

## Predictive Failures

| # | Failure | Behavior |
|---|---|---|
| F1 | Burst 10+ S1, C1 prefetch=5 | C1 backlogged, C2+C3 flow freely. No deadlock. |
| F2 | Operator [j] before S2 | Ingestor guard rejects: status !== ENRICHED. No S3 published. |
| F3 | S2 before S1 | DeferredS2Buffer holds (max 10, 30s TTL). C1 drains on S1 arrival. |
| F4 | Consumer crash mid-lifecycle | 3 channels reconnect. Unacked S1/S2 requeued. DeferredS2Buffer lost — TTL-safe (30s). |
| F5 | Direct mode rapid [i] x2 | C2 acks previous job deliveryTags on overwrite. Zero leak. |
| F6 | S4 in direct mode | C3 ack + clearCurrentJob. No auto-advance. Operator presses [i] again. |
