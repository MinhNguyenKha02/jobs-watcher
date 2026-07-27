## Logical System

require: running @src/index.ts as daemon systemd at @scripts/deploy-ci-systemd-manual-test.sh called at systemd service and called for incomes @scripts/eval-fetch-and-trigger.sh over express server, and @scripts/tmux-tui-setup.sh as tui 

the system constraint: @src/application/ingestor.ts orchestrate and adapters like mongo (job_lifecycle, extraction_queue) and rabbitmq, tui, uds, prometheus, webhook, browser playwright adapter with extraction_scheduler orchestration, asset-builder adapter playwright pdf handlebars template rendering and ports @src/domain/application/ports.ts and ioc bootstrap @src/index.ts and uds adapters  

the system overview:

@src/application/ingestor.ts as orchestration for given adapters over ports via ioc at di adapters constructor ensure dip
orchestration use saga pattern for state machine (signal-based is 4 digits)

many s1: gmail body data has many job metadata record
s2: job payload data required job fully data record
s3: job fully data record considered is no trash
s4: failure at s1, s2, s3

s1 and s2 define job fully record, s2 required s1 as pre-req and 2 incomes concern down there
s1 always a pre-req for later s2, s3, s4 at gmail incomes concern, and manual concern tui is not s1 required: s2 standalone, s3, s4
s3, s4 is completion state and s3 define job fully record meaningful for asset-builder adapter input over profile info retriever domain module

@src/application/extraction_scheduler.ts as browser 3 workers orchestration, take extraction_queue call idle worker once a 3 job record until empty, workers become idle waiting for extraction_queue at enqueue op per each waiter as idle worker. If s1 is not indeed url deferred will do enqueue on extraction_queue

each browser adapter take job metadata.url, call playwright for goto url, do clipboardy page html, return for successful. Exception will become s1 indeed url deferred case for tui operator manual

both do communicate via ports ensure dip

adapters:

mongo per doc per adapter (job_lifecycle (partial index role+company -> dedupe) and extraction_queue)
rabbitmq 1 topic, 3 queue durable: s1 channel, s2 channel, s3+s4 channel, ack per s3 or s4 completion or s2 (direct mode, [i] tui req)
tui 2 proc, 1 ipc, rabbitmq directly consumer for ipc write/read and stdout, stdin use uds req 
tui has [o], [p] for s1 manual browsing as automation fallback for html data for s2, each uds req [c] or [i] required html exist, [j] whenever job fully data as s2 state with guard, [d] can s1 job metadata or s2, [p] to validate html data clipboardy reader and [b] between gmail incomes mode as queue mode (s1 required) or direct mode as manual (no s1) by each distinct [c] xor [i]
uds 2 endpoints internal/ingest?webhook for [i] if !webhook else [c], internal/action for [j], [d] for queue or trash
browser define playwright deps for goto job.metadata.url, clipboardy page html writer, return html, input is job.metadata.url, output is its html and exception is s1 tui operator fallback case caught
asset-builder take profile info retriever resolved output for skills, experiences, projects by profile IR domain module and profile.source.ts for both produce input normalized for templates/pdf/ handlebars, use playwright for pdf renderer
health, prometheus for readiness status, metrics/logs pillars for traces

all is placed at composition root for di

Fully Workflow:
webhook role:

webhook received gmail msgid (google pubsub format or gmail client services do api posts format)
called incomes parsed over @src/application/ingestor.ts forward to tui xor browser working scheduler (s1 is now here)

Application layer:

ingestor orchestration role:

take 2 ones are route command or parse command

with parse command

from webhook adapter provide

1 income gmail body data has many job record (job metadata), body extracted iterating per each job record filter adding required job record pass (rules are for leaned profile data), pass==false then next record
job_lifecycle mongo adapter persist (s1, partial_parsed, enriching, job record) === stage 1
use job metadata.url to expect automate browser playwright capability by pass on indeed job's url format guard expected deferred to fallback path [manual] (working below)
for automate browser [automate_browser] then enqueue at extraction_queue and another extraction_scheduler orchestration take over extraction_queue for browser playwright workers (3)
scheduler now triggered for working to took each extraction_queue as job record id then query from job_lifecycle mongo adapter for job record's url
each idle worker now will take that job record's url for playwright browsing for expected produce html of job description for successful then start to persist (s2 now is here) then publishes rabbitmq s1 (was upsert) and s2 (html browsed parsed and merged) by happy path then filtering expected pass to tui routing decide (expected queue [j] or trash [d] from tui operator), these 3 workers doing until empty extraction_queue then become waiter idle until next enqueue happen on extraction_queue again for each idle worker retriggered. When playwright browsing failed then become fallback path [manual] is s1 (was upsert) rabbitmq publish only on tui for manual operator working on job.metadata.url to get html for s2 produced on stage 2 instead via tui uds req, when uds adapter req parsed and ingestor caller with its job_id, html then query s1 job_lifecycle then parse html and merge with s1 to be s2 (no filtering as [automate_browser] happy path) then rabbit publish on tui routing decide

from tui [i] provide html only payload then parsed then whether filtering passed (s2 is now here) then persist, publish for tui routing decide

with route command from uds adapter req parsed then ingestor caller with action, job_id
query and update job_lifecycle for job s1 or s2, action guarded at queue only accept s2 and trash is both, normal trash then update action payload via job_id queried at job_lifecycle state then s3 publish rabbitmq for tui routing completion (finished)

within failure at s1, s2, s3 will become s4 to still rabbitmq publish for tui consume by completion case

uds adapter role:
take 2 endpoints specific req are internal/ingest?webhook for [c] if webhook===true else [i] or internal/action [j] or [d]

tui role:

tui consume 3 channels: s1channel, s2channel, s3s4channel each role is
s1channel where s1 published, s2, s3s4 are also same idea.
when s1channel consumed (prefetch=5) on message then s1 parsed then place on pending[], dequeue one then write to ipc and read on stdout
when s2channel consumed on message there 2 cases: 
if s2 of job_id matched on s1 job_id in pending[] -> [automate_browser] happy path (2 publishes near-immediate) -> merge in pending[]
else if not in pending[] and job_id === current_job_id [manual] fallback path (from [c]) -> no merge, overwrite ipc and read on stdout as job fully data stage 2
else s2 [direct_mode] [i] manual tui operator case -> write ipc then read on stdout as job fully data stage 2
when s3s4 channel consumed on message:
both expected ack()
message parsed as job_id and guard with current_job ipc
write null ipc
next pending[] dequeue then write ipc and read on stdout -> ack (s1channel, s2channel, s3s4channel of this id tag) -> continue prefetch

with uds req from stdin:
[o], [p], [c] -> indeed job deferred, no [automate_browser] expect tui operator do browsing html data manually. [o] call browser proc for go to current job url ipc written then [p] confirmed html is ready over clipboardy reader then good [c] expected s2 published at ingestor as stage 2
[j] -> expected stage 2, s2, job fully data, full_parsed only, expected routing queue xor trash for profile IR domain downstream consume
[d] -> expected stage 1, stage 2, normal trash
[b] -> 2 mode between [c] (required consumers for s1) and [i] (standalone) for job fully data expected queue or trash 

mongo role:
each stages partial_parsed, full_parsed, route will persist ops
persist each s1, s2 for 2 parse, 2 job state (metadata, metadata+payload), s3 as source of truth as job_lifecycle
persist extraction_queue per each job_id only for extraction_scheduler usage per idle browser worker and query from job_lifecycle doc for url input

asset-builder role:
take resolvedOutput -> toPdf for handlebar template input -> playwright for pdf renderer

rabbitmq role:
1 topic for 5 events along job_lifecycle states/stages, 3 queue durable with prefetch
at each checkpoint s1, s2 will a publish with job payload
consumer will 3 ones per its role distinct

domain layer:
filtering at s1 (required)
filtering at s2 ([browser_automate] and [i] case)

profile IR take only queued job state stage 2 for resolvedOutput

ingestor saga orchestration signal-based state machine is

s3, s4 is completion state
s1 is each gmail incomes's entry for browser auto expected or fallback manual browser op, s1 is job metadata
s2 is s1 payload, s2 required browser worked to html input for parsed and merge existing s1 to be
s3 is queue or trash, queue used for downstream profile IR retriever
s2, s3 failure is s4  

s1 is always s1[], s2, s3, s4 always required s1 existed as pre-req, except s2 [i] by another concern to no s1 at all, 1 parse, 1 fully job (s2)

there 3 s2 cases

[b] direct mode is 1 s2 case
only tui do [i] with html uds req to ingestor for 1 parse -> 1 job fully (s2, stage 2) and 1 publish
[b] queue mode is 2 s2 cases
case for successful browser automated, s1 and s2 near-immediate publish no tui boundary
case for failure browser automated, s1 only published for tui to produce s2 then publish

s3 case is if queue [j] accept only s2 checkpoint was, [d] is both s1, s2, normal trash
s4 is failure and both s3, s4 expected next cycle

the logic is sequence, saga pattern, "lead to", pre-req, signals s1 -> s2 -> s3 or s4

s1 -> s2 -> s3 -> s1
s2, s3 failure -> s4 -> s1
at [b] = direct mode is no s1
s3, s4 is both move on s1
s1 is many, queue control s1, each lifecycle start each pick s1 for s2, s3, s4

scheduler_extraction orchestration browser workers are

3 browser workers by default is in idle waiter state
incomes from extraction_queue adapter mongo trigger each 3 entries per 3 idle workers
when extraction_queue did enqueued, scheduler_extraction triggered onEnqueue to shift each idle waiter is now worker busy, and dequeue extraction_queue for job_id used for query job record's url on job_lifecycle adapter 
each worker take that job record's url and call playwright browser to access url (stealth usage) and clipboard writer on its page html as output. when worker completion browsing did html return then continue until extraction_queue is empty, 3 workers parallel promises, extraction_queue dequeue/!!empty loop/continue pattern per each worker ensure no wasted resources unless onEnqueue take waiter idle for job record's url

the manual test cases r (corpus produced already by passes)

each pending[] s1 dequeue was pick to a cycle initial
case 1: partial job -> [o], [p], [c] at tui over uds -> tui receive sse -> fully job -> [j] or [d] -> next pick
case 2: fully job -> [j] or [d] -> next pick
case 3: failure s2, s3 -> expect to next pick
case 4: copied external html, [b] -> [i] -> tui receive sse -> fully job -> [j] or [d]

case 1 is normal, fallback
case 2 is of case 1 (happy path)
case 4 is familiar case 2

case 1 do s1, s2 sequence (manual)
case 2 do s1, s2 at 1 time (auto)
case 4 do s2 only, no s1 (another concern, no need dequeue)
[b] serve case 1, 2 and case 4 for [d] or [j] by distinct approaches

the case 1, 2 both pick the s1 at partial job and full job, the [o,p,c] case 1 is for partial job parsing to full to next [j] or[d] while case 2 is full job expect to [j] or [d] only the [o, p, c] of this case is fallback intended, while the [b] is define how case 4 [i] and case 1, case 2 [c] both used for parsing and html the clipboard [p] consumer already guarded and [j] only fully job but [d] is partial/fully job no matter

the manual tests was for end-2-end flows already completed since the codebase later had done big changes, refinement (ensure behavior, backward-compat) and the regression risk at these steps is may bugs/wrongs/errors to resolve

constraint:
codebase src/ is hexagon arch and saga app pattern, ensure solid, clean of separation
tests/ is evidence, src/ is refinement, big changes lead to regression risk by tests/ already (unit, integration, regression) but the unused tests, irrelevant tests is intended by phase for deletion and ensure system behaviors is in still unchanged and adding more tests cases by necessary
4 signals ordered state machine, saga pattern by application layer and scheduler orchestration for 3 workers browser  
the manual tests at case 1 and case 2 and case 4 is canonical workflow of and the case 3 required not fail, intended
avoid heruistic, design side-effect, harmless, worst potential