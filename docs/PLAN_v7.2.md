# v7.2 Aggregated Plan — RMQ Hexagonal Migration

## Exchange & Queue Topology

```
jobs.events (topic, durable)
  ├── tui.s1      ← routingKey: ActionEvent.GENERATED         queue 1, prefetch=5
  ├── tui.s2      ← routingKey: ActionEvent.PARSE_COMPLETED   queue 2, prefetch=5
  └── tui.s3s4    ← routingKey: ActionEvent.QUEUED,           queue 3, prefetch=5
                                ActionEvent.TRASHED,
                                ActionEvent.ROUTE_FAILED,
                                ActionEvent.PARSE_FAILED
```

All 3 queues: durable, auto-delete=false. Exchange: topic, durable.

Queue 3 binding uses multiple routing keys on a single queue — RMQ topic exchange matches any of them.

---

## ActionEvent Enum

File: `src/domain/types/actions.ts`

```typescript
export enum ActionEvent {
  GENERATED = 'job.generated',
  PARSE_COMPLETED = 'job.parse.completed',
  PARSE_FAILED = 'job.parse.failed',
  QUEUED = 'job.queue',
  TRASHED = 'job.trash',
  ROUTE_FAILED = 'job.route.failed',
}

export enum KeyAction {
  Queue = 'j',
  Trash = 'd',
  Preview = 'p',
  Ingest = 'i',
  WebhookStage2Parse = 'c',
  Open = 'o',
  ToggleQueue = 'b',
  Help = '?',
  Quit = 'q',
}
// Arrows/ESC: descriptive sentinels not in enum, handled separately

export enum OperatorAction {
  QUEUE = 'queue',
  TRASH = 'trash',
}
```

KeyAction uses single-char values so `renderFooter()` and `showHelp()` can dynamically render from the enum — changing a value auto-updates all help text.

---

## 3-Consumer RabbitMqJobReader

File: `src/presentation/tui/components/RabbitMqJobReader.ts`

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

| Property | Type | Owner | Init |
|---|---|---|---|
| `pendingJobs` | `PendingJob[]` | C1 push, C2 merge, C3 remove | `[]` |
| `currentJobId` | `string \| null` | C1 set (autoAdvance), C3 clear | `null` |
| `queueMode` | `boolean` | Read from shared-tui-state | `true` |
| `deliveryTagsS1` | `Map<string, number[]>` | C1 write, C3 drain | `new Map()` |
| `deliveryTagsS2` | `Map<string, number[]>` | C2 write, C3 drain | `new Map()` |
| `deferredS2Buffer` | `Map<string, S2BufferEntry>` | C2 buffer, C1 drain | `new Map()` |
| `channel1` / `channel2` / `channel3` | `Channel` | DI | constructor |
| `consumerTag1` / `2` / `3` | `string \| null` | set on start | `null` |

### Constructor

```typescript
constructor(
  private channel1: Channel,   // for tui.s1
  private channel2: Channel,   // for tui.s2
  private channel3: Channel,   // for tui.s3s4
  private setCurrentJobFn: (id: string, job: JobData, stage: string) => void,
  private clearCurrentJobFn: () => void,
  private getQueueModeFn: () => boolean,
)
```

### Methods

| Method | Visibility | Responsibility |
|---|---|---|
| `start()` | public | `channel1.consume('tui.s1', onMessageS1, {noAck: false})` + prefetch(5) for all 3 channels |
| `stop()` | public | Cancel 3 consumerTags, close channels |
| `onMessageS1(msg)` | private | Handle `job.generated` |
| `onMessageS2(msg)` | private | Handle `job.parse.completed` |
| `onMessageS3S4(msg)` | private | Handle S3/S4 terminal events |
| `ackAllForJob(id)` | private | Ack C1 + C2 delivery tags for this job |
| `autoAdvance()` | private | Dequeue next pending job |
| `removeFromPending(id)` | private | Splice from pendingJobs array |
| `drainDeferredS2(id)` | private | If job in deferredS2Buffer, merge payload, delete entry |
| `evictStaleS2Buffer()` | private | setInterval 5s: remove entries older than 30s, nack their tags |

### C1 — onMessageS1

```
onMessageS1(msg):
  event = parseMsg(msg)
  id = event.jobLifecycleId
  deliveryTagsS1.set(id, (deliveryTagsS1.get(id) || []).concat(msg.fields.deliveryTag))

  // Check if S2 arrived before S1 (DeferredS2Buffer)
  if deferredS2Buffer.has(id):
    entry = deferredS2Buffer.get(id)
    mergedJob = merge(event.job, entry.payload)
    deferredS2Buffer.delete(id)
    pendingJobs.push({ id, job: mergedJob, stage: 'FULL_PARSED' })
  else:
    pendingJobs.push({ id, job: event.job, stage: 'PARTIAL' })

  autoAdvance()
```

### C2 — onMessageS2

```
onMessageS2(msg):
  event = parseMsg(msg)
  id = event.jobLifecycleId
  deliveryTagsS2.set(id, (deliveryTagsS2.get(id) || []).concat(msg.fields.deliveryTag))

  // Case 1 & 2: job still in pendingJobs → merge in queue
  entry = pendingJobs.find(j => j.id === id)
  if entry:
    Object.assign(entry.job, event.job)
    entry.stage = 'FULL_PARSED'
    return

  // Case 2a: job already dequeued as currentJob → IPC merge
  if id === currentJobId:
    currentJob = merge(currentJob, event.job)
    setCurrentJobFn(id, currentJob, 'FULL_PARSED')
    return

  // Case 4: direct mode clipboard → set as currentJob (overwrite)
  if !getQueueModeFn():
    // Ack orphaned tags from previous direct mode job
    if currentJobId !== null:
      ackAllForJob(currentJobId)
    setCurrentJobFn(id, event.job, 'FULL_PARSED')
    currentJobId = id
    return

  // S1 not yet arrived → buffer it
  deferredS2Buffer.set(id, {
    payload: event.job,
    deliveryTag: msg.fields.deliveryTag,
    timestamp: Date.now(),
  })
  // Bounded: if > 10 entries, evict oldest (nack it)
  if deferredS2Buffer.size > 10:
    oldest = [...deferredS2Buffer.entries()].sort((a,b) => a[1].timestamp - b[1].timestamp)[0]
    channel2.nack(oldest[1].deliveryTag, false, false)  // discard, not requeue
    deferredS2Buffer.delete(oldest[0])
```

### C3 — onMessageS3S4

```
onMessageS3S4(msg):
  event = parseMsg(msg)
  id = event.jobLifecycleId

  // Cross-channel ack: ack C1 and C2 delivery tags for this job
  ackAllForJob(id)

  // Own ack: S3/S4 are terminal, ack immediately
  channel3.ack(msg)

  // Cleanup
  removeFromPending(id)
  if id === currentJobId:
    clearCurrentJobFn()
    currentJobId = null

  // Auto-advance (queue mode only)
  if getQueueModeFn():
    autoAdvance()
  // direct mode: stay idle, operator must press [i] for next job
```

### Helper — ackAllForJob

```
ackAllForJob(id):
  tags1 = deliveryTagsS1.get(id) || []
  for tag of tags1:
    try { channel1.ack(tag) } catch {}
  tags2 = deliveryTagsS2.get(id) || []
  for tag of tags2:
    try { channel2.ack(tag) } catch {}
  deliveryTagsS1.delete(id)
  deliveryTagsS2.delete(id)
```

### Helper — autoAdvance

```
autoAdvance():
  if currentJobId !== null:
    return  // already working on a job
  if pendingJobs.length === 0:
    return  // nothing to advance to
  next = pendingJobs.shift()
  currentJobId = next.id
  setCurrentJobFn(next.id, next.job, next.stage)
```

### Helper — removeFromPending

```
removeFromPending(id):
  idx = pendingJobs.findIndex(j => j.id === id)
  if idx !== -1:
    pendingJobs.splice(idx, 1)
```

### Helper — drainDeferredS2

```
drainDeferredS2(id):
  if deferredS2Buffer.has(id):
    entry = deferredS2Buffer.get(id)
    // Entry's payload already merged into the PendingJob by onMessageS1
    // Just clean up buffer entry
    deferredS2Buffer.delete(id)
```

### TTL Runner — evictStaleS2Buffer

```
// Called via setInterval(5000) after start()
evictStaleS2Buffer():
  now = Date.now()
  for [id, entry] of deferredS2Buffer:
    if now - entry.timestamp > 30000:
      channel2.nack(entry.deliveryTag, false, false)  // discard
      deferredS2Buffer.delete(id)
```

### start()

```
async start():
  await channel1.prefetch(5)
  await channel2.prefetch(5)
  await channel3.prefetch(5)

  { consumerTag: ct1 } = await channel1.consume('tui.s1', (msg) => {
    if (msg) onMessageS1(msg)
  }, { noAck: false })
  consumerTag1 = ct1

  { consumerTag: ct2 } = await channel2.consume('tui.s2', (msg) => {
    if (msg) onMessageS2(msg)
  }, { noAck: false })
  consumerTag2 = ct2

  { consumerTag: ct3 } = await channel3.consume('tui.s3s4', (msg) => {
    if (msg) onMessageS3S4(msg)
  }, { noAck: false })
  consumerTag3 = ct3

  staleTimer = setInterval(() => evictStaleS2Buffer(), 5000)
```

### stop()

```
async stop():
  clearInterval(staleTimer)
  if consumerTag1: await channel1.cancel(consumerTag1)
  if consumerTag2: await channel2.cancel(consumerTag2)
  if consumerTag3: await channel3.cancel(consumerTag3)
  // Nack any remaining unprocessed delivery tags
  // (channels will be closed; RMQ requeues unacked messages)
  await channel1.close()
  await channel2.close()
  await channel3.close()
```

---

## Ports

### ParsePort

File: `src/application/ports/parse.port.ts`

```typescript
import { ActionEvent } from '../../domain/types/actions.js'

export interface ParsePort {
  emitGenerated(
    job: Partial<JobLifecycleDocument>,
    context: { source: JobSource }
  ): Promise<void>   // publishes ActionEvent.GENERATED

  emitCompleted(
    jobLifecycleId: string,
    job: Partial<JobLifecycleDocument>,
    context: { source: JobSource }
  ): Promise<void>   // publishes ActionEvent.PARSE_COMPLETED

  emitFailed(
    jobLifecycleId: string,
    context: { source: JobSource; error: string }
  ): Promise<void>   // publishes ActionEvent.PARSE_FAILED
}
```

### AssetProducingPort

File: `src/application/ports/asset-producing.port.ts`

```typescript
export interface AssetProducingPort {
  toAsset(job: Partial<JobLifecycleDocument>): Promise<ApplicationAsset>
}
```

Note: renamed from `ProfileRetrievalPort`. Single method `toAsset`. The implementing adapter (`asset-producing-adapter.ts`) calls `toAsset()` helper + any renderer (pdf-renderer, etc.). The pdf-renderer stays pluggable in `src/infrastructure/outbound/asset-builder/`.

### JobLifecyclePort

File: `src/application/ports/job-lifecycle.port.ts`

```typescript
export interface JobLifecyclePort {
  upsert(doc: Partial<JobLifecycleDocument>): Promise<void>
  updateStage(id: string, stage: JobStage, status: JobStatus, extra?: Partial<JobLifecycleDocument>): Promise<void>
  findById(id: string): Promise<JobLifecycleDocument | null>
}
```

### RoutingPort

File: `src/application/ports/routing.port.ts`

```typescript
export interface RoutingPort {
  emitJobQueued(
    job: Partial<JobLifecycleDocument>,
    context?: { source: JobSource }
  ): Promise<void>   // publishes ActionEvent.QUEUED

  emitJobTrashed(
    jobLifecycleId: string,
    reason: string,
    context?: { operatorEdits?: Record<string, unknown> }
  ): Promise<void>   // publishes ActionEvent.TRASHED

  emitRouteFailed(
    jobLifecycleId: string,
    reason: string,
    context?: { operatorEdits?: Record<string, unknown> }
  ): Promise<void>   // publishes ActionEvent.ROUTE_FAILED
}
```

---

## RMQ Infrastructure Adapters

### rabbitmq-connection-adapter.ts

```
Connects to AMQP URL from config
Creates confirm channel for publishing
Creates 3 consumer channels (channel1, channel2, channel3)
Declares:
  - exchange 'jobs.events' (topic, durable)
  - queue 'tui.s1' (durable) → bind to exchange with routingKey 'job.generated'
  - queue 'tui.s2' (durable) → bind to exchange with routingKey 'job.parse.completed'
  - queue 'tui.s3s4' (durable) → bind to exchange with routingKeys:
      'job.queue', 'job.trash', 'job.route.failed', 'job.parse.failed'
```

### rabbitmq-parse-adapter.ts

Implements `ParsePort`. Each method publishes to `jobs.events` exchange via the confirm channel with the appropriate `ActionEvent` routing key. Attaches `correlationId` from TraceContext in message headers.

```typescript
publish(routingKey: string, payload: object):
  await channel.publish('jobs.events', routingKey, Buffer.from(JSON.stringify({
    ...payload,
    timestamp: new Date().toISOString(),
  })), {
    headers: { correlationId: traceContext.getId() },
    persistent: true,  // durable delivery
    contentType: 'application/json',
  })
```

### rabbitmq-routing-adapter.ts

Implements `RoutingPort`. Same publish pattern as parse adapter, using `ActionEvent.QUEUED`, `ActionEvent.TRASHED`, `ActionEvent.ROUTE_FAILED`.

---

## Health Adapter (port 9090)

File: `src/infrastructure/inbound/health/health-adapter.ts`

| Endpoint | Method | Response | Notes |
|---|---|---|---|
| `/health` | GET | `{ status: "ok", uptime: 3600 }` | Overall health |
| `/health/live` | GET | 200 `{ status: "alive" }` | Liveness probe |
| `/health/ready` | GET | 200 `{ status: "ready" }` or 503 `{ status: "not ready", reason: "..." }` | Checks RMQ + MongoDB connectivity |
| `/metrics` | GET | Prometheus text/plain | prom-client register.metrics() |
| `/health/observability` | GET | Aggregated 6Q JSON (see below) | Polled by observability CLI |

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

Generated by reading prom-client metrics and aggregating into the 6-question structure:

- q1: `jobs_lifecycle_active` gauge, `tui_queue_depth` gauge
- q2: `jobs_s1_total`, `jobs_s2_total`, `jobs_s3_total`, `jobs_s4_total` counters
- q3: `job_s1_to_s2_seconds` histogram (p50/p95), `job_s2_to_s3_seconds` histogram (p50)
- q4: `parse_failures_total`, `route_failures_total` counters
- q5: `jobs_processed_total` counter / uptime
- q6: `event_loop_lag_seconds` gauge, `memory_heap_bytes` gauge converted to MB, `cpu_usage` gauge

---

## Observability CLI

File: `src/infrastructure/inbound/cli/observability.ts`

```typescript
const OBSERVABILITY_URL = 'http://127.0.0.1:9090/health/observability'

function renderSnapshot(data: ObservabilitySnapshot): void {
  // ANSI in-place overwrite — no clear, no flicker
  // Row 2: live status
  process.stdout.write(`\x1b[2H\x1b[2K${data.live ? 'LIVE' : 'DEAD'} ${data.ready ? 'READY' : 'NOT READY'}  up:${formatUptime(data.uptimeSec)}`)
  // Row 3: Q1
  process.stdout.write(`\x1b[3H\x1b[2Kactive:${data.q1.activeJobs}  qDepth:${data.q1.queueDepth}`)
  // Row 4: Q3 latencies
  process.stdout.write(`\x1b[4H\x1b[2KS1→S2 p50:${data.q3.s1s2_p50}s p95:${data.q3.s1s2_p95}s`)
  // Row 5: Q3 S2→S3
  process.stdout.write(`\x1b[5H\x1b[2KS2→S3 p50:${data.q3.s2s3_p50}s`)
  // Row 6: Q4 failures
  process.stdout.write(`\x1b[6H\x1b[2Kfail P:${data.q4.parseFail} R:${data.q4.routeFail}`)
  // Row 7: Q5 throughput
  process.stdout.write(`\x1b[7H\x1b[2Kthrpt:${data.q5.hourlyRate}/hr`)
  // Row 8: Q6 resources
  process.stdout.write(`\x1b[8H\x1b[2Kmem:${data.q6.memMb}mb lag:${data.q6.lagMs}ms cpu:${Math.round(data.q6.cpu * 100)}%`)
}

async function poll(): Promise<void> {
  while (true) {
    try {
      const res = await fetch(OBSERVABILITY_URL)
      if (res.ok) renderSnapshot(await res.json())
    } catch {
      process.stdout.write('\x1b[2H\x1b[2K⚠ disconnected')
    }
    await new Promise(r => setTimeout(r, 5000))
  }
}

poll().catch(() => process.exit(1))
```

No SSE. No `\e[2J`. Pure in-place overwrite via ANSI cursor positioning.

---

## Ingestor Refactor

File: `src/application/ingestor.ts`

### Constructor DI

```typescript
constructor(
  private jobLifecyclePort: JobLifecyclePort,
  private extractionQueuePort: ExtractionQueuePort,
  private parsePort: ParsePort,
  private routingPort: RoutingPort,
  private assetProducingPort?: AssetProducingPort,
)
```

### Guards

| Action | Guard | Behavior |
|---|---|---|
| `[j]` (queue) | `job.status !== JobStatus.ENRICHED` | Log warning, return early (no S3 published) |
| `[d]` (trash) | None | Always passes through |

```typescript
async processResolutionCommand(command: ProcessResolutionCommand): Promise<void> {
  const { jobLifecycleId, action, editedKVs } = command
  if (!jobLifecycleId || !action) return

  const job = await this.jobLifecyclePort.findById(jobLifecycleId)
  if (!job) return

  if (action === OperatorAction.QUEUE) {
    // Guard: [j] only allowed on fully parsed jobs
    if (job.status !== JobStatus.ENRICHED) {
      logger.warn('Rejecting queue on non-enriched job', { jobLifecycleId, status: job.status })
      return  // no S3 published
    }
    await this.jobLifecyclePort.updateStage(jobLifecycleId, job.stage, JobStatus.QUEUED)
    await this.routingPort.emitJobQueued(job)
    // Fire-and-forget asset generation (non-blocking)
    if (this.assetProducingPort) {
      this.assetProducingPort.toAsset(job).catch(err =>
        logger.error('Asset generation failed', { jobLifecycleId, error: String(err) })
      )
    }
  } else if (action === OperatorAction.TRASH) {
    await this.jobLifecyclePort.updateStage(jobLifecycleId, job.stage, JobStatus.TRASHED, { trashReason: 'operator:trash' })
    await this.routingPort.emitJobTrashed(jobLifecycleId, 'operator:trash')
  }
}
```

### gmailMeta Contract

```typescript
private enforceGmailMeta(source: JobSource, gmailMeta?: GmailMeta): void {
  if (source === JobSource.BROWSER_AUTO && !gmailMeta) {
    logger.error('BROWSER_AUTO ingest missing gmailMeta — data loss risk', {})
    throw new Error('gmailMeta required for BROWSER_AUTO source')
  }
  // MANUAL source: gmailMeta may be absent (clipboard), skip check
}
```

Called at the top of each ingest path (`signal1BrowserAutoXorManual`, `signal2cBrowserAuto`, `signal2aManual`, `signal2bManual`) before upsert.

### Removed

- `CanonicalJob` type — ports pass `Partial<JobLifecycleDocument>` directly
- `calculateJobScore()` — no scoring in new architecture
- `matchScore`, `matchedSkills` — deleted from all types
- `ProfileParser` — replaced by domain profile module + AssetProducingPort
- `StorageAdapter` interface — replaced by separate `JobLifecyclePort` + `ExtractionQueuePort`

---

## Persistence

### schemas.ts

File: `src/infrastructure/outbound/persistence/schemas.ts`

```typescript
// job_lifecycle collection
const jobLifecycleSchema = new Schema({
  _id: String,
  raw: String,
  gmailMeta: {
    messageId: String,
    body: String,
    threadId: String,
    from: String,
    to: String,
    subject: String,
  },
  company: String,
  role: String,
  description: String,
  salary: String,
  location: String,
  url: String,
  details: Schema.Types.Mixed,
  deadline: Schema.Types.Mixed,
  easyApply: Schema.Types.Mixed,
  stage: { type: String, enum: ['partial_parsed', 'full_parsed'] },
  status: { type: String, enum: ['enriching', 'enriched', 'queued', 'trashed', 'failed'] },
  source: { type: String, enum: ['browser-auto', 'manual'] },
  trashReason: String,
  createdAt: Date,
  updatedAt: Date,
  stageTimestamp: Date,
  routedAt: Date,
}, { collection: 'job_lifecycle', _id: false })

jobLifecycleSchema.index({ role: 1, company: 1 }, { unique: true })
// No partial filter — simple unique index. E11000 error caught by ingestor for dedup.

// extraction_queue collection
const extractionQueueSchema = new Schema({
  jobLifecycleId: { type: String, required: true },
  status: { type: String, enum: ['pending', 'processing', 'done', 'failed'], default: 'pending' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
}, { collection: 'extraction_queue' })
```

### mongo-job-lifecycle-adapter.ts

Implements `JobLifecyclePort` with:

- `upsert(doc)`: `findOneAndUpdate({ _id: doc._id }, { $set: doc }, { upsert: true })` — handles both insert and update.
- `updateStage(id, stage, status, extra)`: `findOneAndUpdate({ _id: id }, { $set: { stage, status, ...extra, updatedAt: new Date() } })`
- `findById(id)`: `findOne({ _id: id })`

### extraction-queue-adapter.ts

Existing file, add:
- Metrics: `extraction_queue_depth` gauge updated on enqueue/dequeue
- TraceContext propagation via logger child

---

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

One `*-adapter.ts` per infra concern. Internal helpers in the same directory are NOT named as adapters (e.g., `pdf-renderer.ts`, `toAsset.ts`).

---

## UDS Adapter

File: `src/infrastructure/inbound/uds/uds-adapter.ts`

```typescript
class UdsAdapter {
  constructor(
    private socketPath: string,
    private token: string,
    private ingestor: JobIngestor,
  ) {}

  async start(): Promise<void>  // create unix socket, listen
  async stop(): Promise<void>   // close socket
}
```

Socket path: `/run/jobs-watcher/ingest.sock`

### Routes

| UDS Path | Method | Handler |
|---|---|---|
| `/internal/action` | POST | `ingestor.processResolutionCommand(JSON.parse(body))` |
| `/internal/ingest` | POST | `ingestor.processIngestCommand(JSON.parse(body))` |

### Auth

Every request must include `x-internal-token` header matching constructor `token`. If mismatch: 403 `{ error: 'unauthorized' }`.

### HTTP-style framing

Uses same `uds-http.ts` utility — JSON body, status codes, headers.

---

## Webhook Adapter

File: `src/infrastructure/inbound/web/webhook-adapter.ts`

### Dual Income

1. **Real PubSub push**: `POST /webhook` receives Google PubSub push envelope `{ message: { data: base64, ... }, subscription: "..." }`. Decode `data` → JSON → extract `messageId`. Call Gmail API via `GmailService.getEmail(messageId)` → delegates to `ingestor.processIngestCommand({source: BROWSER_AUTO, stage: PARTIAL_PARSED, rawPayload: emailBody, metadata: gmailMeta})`.

2. **Simulated via eval script**: `POST /webhook` with direct `{ messageId: "..." }`. Same path — Gmail API fetch + ingest.

Router inspects incoming body shape to determine source:
- Has `message.data` → PubSub push
- Has `messageId` directly → simulated

### Endpoint

```typescript
router.post('/webhook', async (req, res) => {
  const body = req.body
  const messageId = body?.message?.data
    ? JSON.parse(Buffer.from(body.message.data, 'base64').toString()).messageId
    : body?.messageId

  if (!messageId) { res.status(400).json({ error: 'missing messageId' }); return }

  const email = await gmailService.getEmail(messageId)
  // ... extract metadata and body ...
  await ingestor.processIngestCommand({
    source: JobSource.BROWSER_AUTO,
    stage: JobStage.PARTIAL_PARSED,
    rawPayload: email.body,
    metadata: { messageId, threadId: email.threadId, from: email.from, subject: email.subject },
  })

  res.status(202).json({ accepted: true })
})
```

---

## Asset Producer Adapter

File: `src/infrastructure/outbound/asset-builder/asset-producing-adapter.ts`

```typescript
class AssetProducingAdapter implements AssetProducingPort {
  constructor(
    private toAssetFn: (job: Partial<JobLifecycleDocument>) => Promise<ApplicationAsset>,
    private pdfRendererFn: (asset: ApplicationAsset) => Promise<Buffer>,
  ) {}

  async toAsset(job: Partial<JobLifecycleDocument>): Promise<ApplicationAsset> {
    const asset = await this.toAssetFn(job)
    await this.pdfRendererFn(asset)  // side effect: writes PDF to disk or push queue
    return asset
  }
}
```

Keeps `toAsset()` helper and `pdf-renderer.ts` in the same `asset-builder/` directory as internal helpers, not named as adapters.

---

## TUI Adapters

### tui-stdout-adapter.ts (renamed from ops-tui-app.ts)

- Replaces `SseJobReader` with `RabbitMqJobReader`
- No SSE connection logic
- Main loop: reads IPC state file, renders via ANSI
- Uses `JobStage` enum from `job-lifecycle.ts` instead of string literals
- `watchStateFile()` for IPC changes triggers re-render

### tui-stdin-adapter.ts (renamed from action-controller.ts)

- Uses `KeyAction` enum instead of string unions
- No `as string` casts in switch statements
- `showHelp()` renders dynamic keybindings from enum values
- Still uses `UdsActionWriter` but with `OperatorAction` enum

---

## Composition Root

File: `src/index.ts`

```typescript
// 1. Connections
const mongoConnection = await mongoose.connect(config.mongo.uri)
const rmqConnection = await RabbitMqConnectionAdapter.connect(config.rabbitmq.url)
const { channel1, channel2, channel3, publishChannel } = rmqConnection

// 2. Ports
const jobLifecyclePort = new MongoJobLifecycleAdapter(mongoConnection)
const extractionQueuePort = new ExtractionQueueAdapter(mongoConnection)
const parsePort = new RabbitMqParseAdapter(publishChannel)
const routingPort = new RabbitMqRoutingAdapter(publishChannel)
const assetProducingPort = new AssetProducingAdapter(toAsset, renderPdf)

// 3. Core
const ingestor = new JobIngestor(jobLifecyclePort, extractionQueuePort, parsePort, routingPort, assetProducingPort)

// 4. Inbound
const udsAdapter = new UdsAdapter('/run/jobs-watcher/ingest.sock', process.env.INTERNAL_AUTH_TOKEN!, ingestor)
const healthAdapter = new HealthAdapter(9090)
const webhookAdapter = new WebhookAdapter(ingestor, gmailService)

// 5. Start
await udsAdapter.start()
await healthAdapter.start()
await webhookAdapter.start()
```

Also handles:
- `ExtractionScheduler` setup with its own DI
- Graceful shutdown (SIGTERM/SIGINT) — stop all adapters, close connections
- Log level configuration from env

---

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

Pane order: 0=stdout, 1=observability, 2=stdin, 3=stderr.

Observability pane is read-only — keyboard passthrough to stdin pane underneath.

---

## Scripts

### package.json

```json
{
  "scripts": {
    "tui-stdout": "node dist/presentation/tui/tui-stdout-adapter.js",
    "tui-stdin": "node dist/presentation/tui/tui-stdin-adapter.js",
    "build:artifacts": "...",
    "test:regression": "vitest run tests/regression"
  }
}
```

Remove: `render-server`, `action-controller` scripts.

### tmux-tui-setup.sh

- Script names: `render-server` → `tui-stdout`, `action-controller` → `tui-stdin`
- Layout: 4 panes with new dimensions
- Add pane for `observability.ts`: `node dist/infrastructure/inbound/cli/observability.js`
- Check script name references in validation

### eval-fetch-and-trigger.sh

Fix: `require('../src/services/gmail.js')` → `require('../src/infrastructure/outbound/gmail.js')`

---

## Metrics Registry

File: `src/infrastructure/outbound/monitoring/metrics-registry.ts`

### 6-Question Mapping

| Question | Metric Name | Type | Labels |
|---|---|---|---|
| Q1 Liveness | `jobs_lifecycle_active` | Gauge | — |
| | `tui_queue_depth` | Gauge | — |
| Q2 Workflow | `jobs_s1_total` | Counter | `source` |
| | `jobs_s2_total` | Counter | `source` |
| | `jobs_s3_total` | Counter | `action` (queue/trash) |
| | `jobs_s4_total` | Counter | `reason` (parse_fail/route_fail) |
| Q3 Latency | `job_s1_to_s2_seconds` | Histogram | buckets: 0.1, 0.5, 1, 5, 15, 30 |
| | `job_s2_to_s3_seconds` | Histogram | buckets: 0.1, 0.5, 1, 5, 15, 30 |
| Q4 Failures | `parse_failures_total` | Counter | `source` |
| | `route_failures_total` | Counter | `action` |
| Q5 Throughput | `jobs_processed_total` | Counter | — |
| Q6 Resources | `event_loop_lag_seconds` | Gauge | — |
| | `memory_heap_bytes` | Gauge | — |
| | `cpu_usage` | Gauge | — |

Helper functions: `incS1(source)`, `incS2(source)`, `observeS1toS2(seconds)`, `incS3(action)`, `incS4(reason)`, `setActiveJobs(n)`, etc.

---

## Observability Foundation

### trace-context.ts

File: `src/infrastructure/outbound/monitoring/trace-context.ts`

```typescript
export interface TraceContext {
  getId(): string
}

export function createTraceContext(): TraceContext {
  const id = crypto.randomUUID()
  return { getId: () => id }
}
```

Correlation ID propagated:
- RMQ message headers: `msg.properties.headers.correlationId`
- Pino logger: `child({ correlationId })`
- HTTP responses: `X-Correlation-Id` header

### system-monitor.ts (renamed from memory-monitor.ts)

- Memory: `process.memoryUsage().heapUsed` → gauge
- CPU: `process.cpuUsage()` diff → gauge
- Event loop lag: `setInterval` vs actual time delta → gauge
- No `notifyUser` calls (removed)

### logger.ts

Pino wrapper:

```typescript
import pino from 'pino'

const rootLogger = pino({
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'development' ? 'debug' : 'info'),
  transport: process.env.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
})

// Backward-compatible ILogger interface
export interface ILogger {
  info(msg: string, ...args: any[]): void
  warn(msg: string, ...args: any[]): void
  error(msg: string, ...args: any[]): void
  debug(msg: string, ...args: any[]): void
}

// New structured API
export class StructuredLogger {
  constructor(private base: pino.Logger) {}
  info(msg: string, data?: Record<string, unknown>): void { this.base.info(data, msg) }
  debug(msg: string, data?: Record<string, unknown>): void { this.base.debug(data, msg) }
  warn(msg: string, data?: Record<string, unknown>): void { this.base.warn(data, msg) }
  error(msg: string, data?: Record<string, unknown>): void { this.base.error(data, msg) }
  child(fields: Record<string, unknown>): StructuredLogger {
    return new StructuredLogger(this.base.child(fields))
  }
}
```

### Log Level Framework

| Level | Category | Examples |
|---|---|---|
| `info` | Business | Job received, job queued, extraction started |
| `debug` | Operation | SSE connected, action dispatched, state written |
| `warn` | Diagnostic | Parse failure, retry attempt, orphan event |
| `error` | Diagnostic | Data loss prevented, connection lost, crash |
| `trace` | Infrastructure | AMQP frame, event loop tick (OFF by default) |

Recategorize ~185 existing log calls. Remove emoji prefixes and bracket labels (e.g. `[Ingestor]` → component determined by logger child).

---

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

---

## Predictive Failures

| # | Failure | Behavior |
|---|---|---|
| F1 | Burst 10+ S1, C1 prefetch=5 | C1 holds 5, C2+C3 have independent prefetch. No deadlock. S2/S3/S4 flow freely on their queues. |
| F2 | Operator [j] before S2 arrives | Ingestor guard: `status !== ENRICHED` → reject. No S3 published. Operator sees job still displayed, retries after S2. |
| F3 | S2 arrives before S1 | DeferredS2Buffer holds (max 10 entries, 30s TTL). C1 on S1 arrival drains buffer, merges S2 data into pending entry. TTL runner discards orphans after 30s. |
| F4 | Consumer crash mid-lifecycle (SIGKILL) | 3 channels reconnect. Unacked S1/S2 requeued by RMQ. DeferredS2Buffer in-memory lost — TTL-safe (entries expire 30s after original timestamp). |
| F5 | Direct mode rapid [i] x2 | C2 on second [i] acks previous job's deliveryTags via `ackAllForJob(oldId)`. Zero prefetch slot leak. |
| F6 | S4 in direct mode | C3 acks + clearCurrentJob. No autoAdvance (queueMode=false). Operator presses [i] for next clipboard job. |
| F7 | DeferredS2Buffer full (11th entry) | Oldest entry evicted, `channel2.nack(tag, false, false)` discards it (not requeued). Only 10 in-flight orphan S2s allowed. |
| F8 | S3 arrives for job already acked (duplicate) | `deliveryTagsS1/S2` deleted after first ack. `channel.ack()` on already-acked tag is idempotent. No-op. |
| F9 | observability CLI crashes | Independent process — no effect on TUI or daemon. Systemd restarts if configured. |
