## User

require: running @src/index.ts as daemon systemd at @scripts/deploy-ci-systemd-manual-test.sh called at systemd service and called for incomes @scripts/eval-fetch-and-trigger.sh over express server, and @scripts/tmux-tui-setup.sh as tui

the system constraint: @src/application/ingestor.ts orchestrate and adapters like @src/infrastructure/outbound/persistence/mongo-job-lifecycle-adapter.ts and @src/presentation/tui/ and ports @src/domain/ports/ and bootstrap @src/index.ts and uds adapter @src/infrastructure/inbound/uds/uds-adapter.ts and @src/infrastructure/outbound/rabbitmq/

the system workflow:
called incomes over @src/application/ingestor.ts forward to tui via RabbitMQ jobs.events exchange (topic, durable)
3 queues: tui.s1 ← job.generated, tui.s2 ← job.parse.completed, tui.s3s4 ← job.queue/job.trash/job.route.failed/job.parse.failed
each cycle is dequeue each s1 -> tui uds -> s2 -> tui uds -> s3 -> next dequeue
the daemon uds received and heading to @src/application/ingestor.ts for s2, s3
while the called incomes become s1 paths -> @src/application/extraction-scheduler.ts or directly tui as fallback meant both produced s1 partial (directly, deferred, exception extractor failure) and s1 fully at queueing to each tui cycle
there s s2 and s3 failure events to directly call next dequeue op

the logic is sequentially, "lead to", pre-req, signals 1->4

s1 -> s2 -> s3 -> s1
s2, s3 failure -> s4 -> s1
at [b] = direct mode is no s1
s3, s4 is both move on s1
s1 is many, queue control s1, each lifecycle start each pick s1 for s2, s3, s4

and

queue tui can enqueue s1 partial job and s2 full job at browser auto source at given manual tests cases [b]=queue mode, [j], [d] only and [b]=direct mode, [i], [j], [d]

there s 2 s2 cases at tui: queued job as partial s1, then s2 arrive and merge at queue (s1,s2 chaining of browser-auto happy path), and dequeued job already then s2 arrive and merge at currentjob ipc file (from neither [c] or s1,s2 chaining of browser-auto happy path)
lead to neither s2 in queue and merged nor s2 enriched at dequeued, s2 deferred and its s1 become the case 1 [o], [p], [c] manual tests steps giving
or bugs found
the test cases r

each s1 dequeue was pick to a cycle initial
case 1: partial job -> [o], [p], [c] at tui over uds -> tui receive s2 via rmq -> fully job -> [j] or [d] -> next pick
case 2: fully job -> [j] or [d] -> next pick
case 3: failure s2, s3 -> expect to next pick -> incompleted, rate
case 4: copied external html, [b] -> [i] -> tui receive s2 via rmq -> fully job -> [j] or [d]

case 1 is normal, fallback
case 2 is of case 1 (happy path)
case 4 is familiar case 2

case 1 do s1, s2 sequence (manual)
case 2 do s1, s2 at 1 time (auto)
case 4 do s2 only, no s1 (another concern, no need dequeue)
[b] serve case 1, 2 and case 4 for [d] or [j] approach

the case 1, 2 both pick the s1 at partial job and full job the [o,p,c] is for partial job parsing to full to next [j] or[d] while case 2 is full job expect to [j] or [d] only the [o, p, c] of this case is unexpected, while the [b] is also the [c] and the [i] both used for parsing and html the clipboard [p] consumer already guarded and the propose the guard of [j], [d] and [p] is ensure no clipboard data loss and [p] spam is acceptable

@src/application/extraction-scheduler.ts use no cb (catched was proceed at @src/application/ingestor.ts by design), do

-the manual tests was for end-2-end flows already completed since the codebase later changed and the regression risk at these steps is may bugs/wrongs/errors to resolve

constraint:
@src/application/ingestor.ts is orchestration and hexagonal arch over adapters and ports
@src/presentation/tui/ is tui for the job_lifecycle workflow for operator over uds/rmq
4 signals along the job_lifecycle ops
the manual tests at case 1 and case 2 and case 4 is canonical workflow of and the case 3 required not fail
avoid heuristic, design side-effect, harmless, worst potential
path:
for sre principles use codebase and tests and measures of

Signal transport: RabbitMQ jobs.events exchange (topic, durable) → 3 queues: tui.s1 (C1, prefetch=5), tui.s2 (C2, prefetch=5), tui.s3s4 (C3, prefetch=5)
C1/C2 defer ack until ackAllForJob from C3; C3 acks own immediately + triggers cross-channel ack
DeferredS2Buffer: max 10 entries, 30s TTL, setInterval 5s evictor — C2 buffers S2 when S1 hasn't arrived yet, C1 drains on S1 arrival
[j] guard: ingestor rejects if job status !== ENRICHED
gmailMeta contract: BROWSER_AUTO upsert must have gmailMeta; MANUAL source can omit
Observability: HTTP polling every 5s to /health/observability — single JSON endpoint, ANSI in-place overwrite
Health: port 9090, endpoints /health /live /ready /metrics /health/observability
Adapters: ParsePort → rabbitmq-parse-adapter, RoutingPort → rabbitmq-routing-adapter, JobLifecyclePort → mongo-job-lifecycle-adapter, AssetProducingPort → asset-producing-adapter
