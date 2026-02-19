# Architectural Decisions & Tradeoffs

## Input Contexts & Platform Support

| Input Context              | Description                                              | Architectural Support         |
|----------------------------|----------------------------------------------------------|-------------------------------|
| Watcher (Gmail Webhook)    | Real-time event-driven job ingestion from Gmail          | EventDrivenWebhook, JobQueue  |
| Clipboard/Manual Platform  | Manual entry or clipboard paste from job boards/platforms| CLI/TUI, JobQueue             |
| Fixture/Manual Ingestion   | Regression testing, data import via JSON/CLI             | DataTestingAdapter, JobQueue  |

All input contexts are normalized and processed through the same queue, deduplication, and CI feedback/metrics logic. See [ARCHITECTURE.md](ARCHITECTURE.md#supported-input-contexts) and [JOB_PROCESSING_QUEUE.md](JOB_PROCESSING_QUEUE.md#supported-input-contexts).

This document records key decisions made during the redesign of Jobs Watcher, including rationale, tradeoffs, and alternatives considered.

**Last Updated**: February 15, 2026  
**Status**: Staging Phase (Decisions 1-10 implemented, 11+ planned)  
**Scope**: Architecture, data layer, integration patterns, testing strategy

---

## Decision 1: Generic JobProcessor with Type-Safe Abstraction

**Status:** ✅ ADOPTED

### Problem
Original code tightly coupled:
- UI presentation (TUI popup) directly in event-webhook.ts
- Action handling (saving enriched jobs) in CLI handlers
- No way to add web UI or headless mode without major refactoring

### Decision
Introduce `JobProcessor<TAction, TPayload>` with two interfaces:
- `JobPresenter<TAction, TPayload>`: Encapsulate presentation logic
- `JobActionHandler<TAction, TPayload>`: Encapsulate action handling

### Implementation
```typescript
class JobProcessor<TAction, TPayload> {
  constructor(
    private presenter: JobPresenter<TAction, TPayload>,
    private actionHandler: JobActionHandler<TAction, TPayload>
  ) {}

  async process(job: Job): Promise<JobPresentationResult<TAction, TPayload>> {
    const result = await this.presenter.present(job);
    await this.actionHandler.handle(job, result.action, result.payload);
    return result;
  }
}
```

### Tradeoffs

| Tradeoff | Benefit | Cost |
|----------|---------|------|
| Generic types | Works for any presenter/handler combo | Added 6 new files instead of 1 monolithic |
| Interface abstraction | Easy to test, swap implementations | Boilerplate for simple use cases |
| Dependency injection | Decoupled from UI framework | Must pass dependencies explicitly |

### Alternatives Considered
1. **Inheritance-based hierarchy**: Would require new base class for each presenter type → harder to extend
2. **Strategy pattern with conditional logic**: Would keep single class → tight coupling, harder to test
3. **Event-based (pub/sub)**: Would add event bus complexity → overkill for current scope

✅ **Adopted.** Enables:
- Multiple UIs simultaneously (TUI for prod, CLI for testing)
- Easy headless mode (no presenter = just action handler)
- Web UI implementation (REST presenter, database handler)
- Clean testing via mocks

---
**Status:** ✅ ADOPTED

- No audit trail of parsing attempts
- No way to analyze failure patterns
- Difficult to export fixtures for regression testing
- No production analytics (success rate by source/stage)

### Decision
Use two immutable/append-only MongoDB collections:
**`raw_ingest`** (Insert-only)
```json
{
  "_id": "ObjectId",
  "source": "GMAIL_WEBHOOK | GMAIL_MANUAL | HTML_ONLY",
  "rawContent": "...",
  "gmailMeta": { "messageId", "from", "subject", ... },

**`parse_log`** (Append-only)
```json
{
  "_id": "logId",
  "extracted": { "company", "title", ... },
  "error": { "code", "message" },
  "timestamp": "2026-02-13T..."
}
```

### Tradeoffs

| Aspect | Benefit | Cost |
|--------|---------|------|
| **Immutability** | Complete audit trail, idempotent processing | Cannot correct bad data (must export/reimport) |
| **Two collections** | Clear separation: input vs attempts | Requires JOIN queries for full context |
| **Append-only parse_log** | Tracks all retry attempts | Requires cleanup script for very high volumes |
| **MongoDB instead of files** | Production-grade storage, analytics queries | Requires MongoDB setup, connection management |

### Alternatives Considered
1. **Single `parsed_jobs` collection with overwrites**: Would lose retry history → can't analyze failure patterns
2. **Keep file-based, add JSON audit log**: Would be slow for analytics → still need migration to DB eventually
3. **Normalized schema with mutable records**: Would violate audit trail principle → risk of data loss

### Decision Outcome
✅ **Adopted.** Enables:
- Complete parse history per job
- Export failed parses as regression fixtures
- Analytics: success rate by source/stage/date
- Root cause analysis (error codes, execution time)
- Compliance/auditability requirements

---

### Problem

### Decision
Split parsing into two independent stages:
- ~95% success rate expected

**Stage 2: JOB_DETAIL** (Complex, lower reliability)
- Extract: URL, description, requirements
- May require HTML parsing if URL provided
- ~70-80% success rate expected

Each stage tracked separately in parse_log:
```typescript
await storage.logParseAttempt({
  rawIngestId: raw._id,
  stage: 'METADATA',
  success: true,
  extracted: { company: '...', title: '...' },

await storage.logParseAttempt({
  rawIngestId: raw._id,
  success: true,
  extracted: { url: '...', description: '...' },
  timestamp: new Date()
});
| **Staged approach** | Can proceed with partial data (app title/salary) | User sees incomplete job (missing URL) |
2. **Three+ stages**: Could add CONSTRAINTS stage → over-engineered for current needs

---

### Problem

## Decision 11: Queue-Based Job Processing with Deduplication

**Status:** ✅ ADOPTED (Feb 18, 2026)

### Problem
Incoming jobs (emails, webhook events) can arrive in bursts, out of order, or with duplicates (e.g., Pub/Sub retries, manual triggers). Processing must be reliable, idempotent, and scalable.

### Decision
Adopt a queue-based architecture for job processing, with explicit deduplication:
- All incoming jobs are enqueued for processing (decouples ingestion from processing)
- Each job is assigned a unique identifier (e.g., messageId, hash)
- Deduplication is performed before processing (in-memory for session-local, persistent for cross-session)
- Job handlers are idempotent (safe to retry)
- Failed jobs are retried with exponential backoff

#### Example Implementation
```typescript
async function handleIncomingJob(job) {
  if (await isDuplicate(job.id)) {
    log('Duplicate job, skipping:', job.id);
    return;
  }
  await markInProgress(job.id);
  try {
    await processJob(job);
    await markProcessed(job.id);
  } catch (err) {
    await markFailed(job.id, err);
    throw err;
  }
}
```

### Tradeoffs
| Aspect | Benefit | Cost |
|--------|---------|------|
| **Queue-based** | Handles bursty/concurrent loads, enables retries | Adds queue management complexity |
| **Deduplication** | Prevents duplicate processing | In-memory dedup lost on restart (unless persistent) |
| **Idempotency** | Safe to retry jobs | Requires careful handler design |
| **Extensible** | Can swap in distributed queue/dedup store | More moving parts at scale |

### Alternatives Considered
1. **No deduplication**: Simpler, but risks duplicate side effects
2. **Persistent dedup only**: Always correct, but slower and more resource-intensive
3. **Event-based (pub/sub) only**: Decouples further, but adds complexity for current needs

### Implementation Details
- **Queue**: In-memory for dev/small scale; Redis/BullMQ/RabbitMQ for production
- **Deduplication**: In-memory Set for session-local; Redis/MongoDB for cross-session
- **Retries**: Exponential backoff for failed jobs
- **Monitoring**: Metrics and alerting for stuck/failed jobs (future)

### Decision Outcome
✅ **Adopted.** Enables reliable, scalable, and observable job processing. Sufficient for current scale; extensible for future needs.

---
```bash
npm run data-testing
# Interactive loop: paste email → show TUI → choose action
# If unhappy, repeat manually
# Time-consuming, hard to automate, no metrics
```

New approach:
```bash
npm run export-fixtures  # Export failed parses from MongoDB
npm test -- parser.test  # Run regression suite against fixtures
npm run parser-stats     # Compare v1 vs v2 parser success rates
```

### Decision
Remove interactive data-testing loop. Instead:
1. **Export failed parses** from MongoDB to JSON (`tests/__fixtures__/failed-parses.json`)
2. **Run parser tests** against fixtures (no TUI, no MongoDB, just parse())
3. **Track metrics** (success rate improvements per stage/source)
4. **Use email simulator** for manual testing (SEND_REAL_EMAIL=true)

### Tradeoffs

| Aspect | Benefit | Cost |
|--------|---------|------|
| **Fixture-based** | Automated, reproducible, CI/CD ready | Requires exporting fixtures from prod |
| **No TUI in testing** | Faster test execution, easier to parallelize | Can't manually enrich in testing mode |
| **JSON fixtures** | Version-controlled, shareable, durable | Storage of raw email content (sanitize?) |
| **Removed data-testing loop** | Simpler codebase, focused testing | Can't use TUI for development iteration |

### Alternatives Considered
1. **Keep interactive loop, add fixture export**: Better for development UX → doesn't scale to team, duplicates testing paths
2. **Use real MongoDB in tests**: Would test adapter layer → slower, environment-dependent, not pure unit tests
3. **Require manual email for each test**: Would be exhausting → defeats automation purpose

### Decision Outcome
✅ **Adopted.** Benefits:
- Automated regression detection (success rate < target % = test failure)
- Fast feedback loop for parser improvements
- CI/CD integration (run on each commit)
- Fixture sharing across team (in Git)
- Clear metrics (v1 vs v2 comparison)

---

## Decision 5: Loopback-Only Webhook Binding (127.0.0.1)

**Status:** ✅ ADOPTED

### Problem
Original webhook could be exposed on all interfaces (0.0.0.0):
- Vulnerable to network access from untrusted machines
- No validation of Pub/Sub message authenticity
- Potential for fake job alert injection

### Decision
Bind webhook server to `127.0.0.1:3000` only:
```typescript
this.server = this.app.listen(config.webhook.port, '127.0.0.1', () => {
  logger.info(`✅ Webhook listening on 127.0.0.1:${config.webhook.port}`);
});
```

Pub/Sub is expected to push from Google's infrastructure:
- Webhook must be exposed to public internet in production
- Use environment variable: `WEBHOOK_HOST` defaults to '127.0.0.1'
- Cloud NAT or reverse proxy (Nginx) handles external requests

### Tradeoffs

| Aspect | Benefit | Cost |
|--------|---------|------|
| **Loopback only** | Simple, secure-by-default | Cannot test directly from other machines |
| **Use simulate-webhook** | Safe, offline testing | Adds extra step vs curl |
| **Public exposure via proxy** | Works with prod Pub/Sub | Requires Cloud NAT/Nginx setup |

### Alternatives Considered
1. **Open 0.0.0.0 for convenience**: Simpler local dev → risky in production if misconfigured
2. **Authenticate requests**: Would require secret management → over-complicated for Pub/Sub
3. **Use reverse proxy always**: Would require Docker/K8s in dev → higher barrier to entry

### Decision Outcome
✅ **Adopted.** Benefits:
- Secure by default (can't accidentally expose)
- Clear separation: local testing (127.0.0.1) vs production (Pub/Sub via proxy)
- Encourages use of simulate-webhook (safer than curl)
- No authentication needed for loopback

---

## Decision 6: Constraints Validation at Service Level

**Status:** ✅ ADOPTED

### Problem
Filter job alerts based on user preferences:
- Min/max salary range
- Allowed locations
- Excluded companies
- Tech stack requirements

Should this happen in:
- Parser (as part of METADATA stage)? → Mixes parsing with business rules
- Presenter (TUI decides to show)? → Business rule leak into UI
- Service layer? → Isolated, testable, reusable

### Decision
Separate validation at service layer via `filterJobCompatibility()`:
```typescript
// In EventDrivenWebhook.processJob()
const job = parser.parse(...);
const compatibility = filterJobCompatibility(job, profile);

if (!compatibility.isCompatible) {
  logger.info(`⏭️  Skipped (constraints): ${job.company}`);
  return; // Don't present to user
}

// Update job with match score and matched skills
job.matchScore = compatibility.matchedSkills?.length || 0;
await this.jobProcessor.process(job);
```

### Tradeoffs

| Aspect | Benefit | Cost |
|--------|---------|------|
| **Separate validation** | Reusable across UI modes, testable | Extra function call per job |
| **Profile-based** | Different filters per user | Requires profile loading |
| **Early termination** | Skip TUI if constraints fail | User doesn't see why job filtered |

### Alternatives Considered
1. **Filter in parser**: Would couple business rules to parsing → hard to update rules, untestable
2. **Filter in TUI presenter**: Would require presenter to know constraints → same presenter can't be used for web UI
3. **Filter in MongoDB (pre-fetch)**: Would require storing rules in DB → add layer of indirection

### Decision Outcome
✅ **Adopted.** Benefits:
- Pure business logic (no UI coupling)
- Testable with mock profiles
- Reusable across presenters (TUI, web, CLI)
- Clear logging (user knows why job was skipped)
- Integrated with scoring engine for match transparency

---

## Decision 7: Session-Local Deduplication in-Memory

**Status:** ✅ ADOPTED

### Problem
Gmail Pub/Sub can send duplicate messages:
- Network hiccups causing retries
- Process restarts losing state
- User manually triggering webhook multiple times

Need deduplication, but:
- Don't want false positives (skip legitimate retries)
- Don't want persistent DB hit on every message

### Decision
Keep in-memory Set of processed messageIds in webhook session:
```typescript
class EventDrivenWebhook {
  private processedJobs = new Set<string>();

  async _processNotificationWithCircuitBreaker(message: any) {
    const messageId = data.messageId;
    if (this.processedJobs.has(messageId)) {
      logger.info(`Already processed: ${messageId}`);
      return;
    }
    // ... process job ...
    this.processedJobs.add(messageId);
  }
}
```

Cleanup strategy: Keep only last 100 in memory (cycling).

### Tradeoffs

| Aspect | Benefit | Cost |
|--------|---------|------|
| **In-memory only** | Fast, no DB hit | Lost on process restart (duplicates reprocessed) |
| **Session-local** | Handles transient duplicates (99% case) | Persistent duplicates slip through |
| **100-entry limit** | Memory bounded | Very old messages (hours) can be reprocessed |

### Alternatives Considered
1. **MongoDB dedup**: Would track all processed IDs permanently → slower, requires Mongo just for this
2. **Redis cache**: Would work but over-engineered for current scale
3. **No dedup**: Would reprocess some jobs → acceptable for now given low email volume

### Decision Outcome
✅ **Adopted.** Sufficient for current scale (single user, ~20 emails/day). If scale increases:
- Upgrade to Redis for cross-session dedup
- Add MongoDB dedup with TTL (30 days)

---

## Decision 8: Dependency Injection via Constructor

**Status:** ✅ ADOPTED

### Problem
Tight coupling makes testing and extension hard:
```typescript
// Bad: Global dependencies
const parser = new EmailParser();
class EventDrivenWebhook {
  async processJob() {
    const parsed = parser.parse(...);  // Hard to mock
  }
}
```

### Decision
Pass all major dependencies to constructors:
```typescript
// Good: Constructor injection
class EventDrivenWebhook {
  constructor(
    gmailService: GmailService,
    options?: {
      parser?: EmailParser,
      presenter?: JobPresenter,
      actionHandler?: ActionHandler,
    }
  ) {
    this.parser = options?.parser || new EmailParser();
    this.jobProcessor = new JobProcessor(presenter, actionHandler);
  }
}
```

### Tradeoffs

| Aspect | Benefit | Cost |
|--------|---------|------|
| **Constructor injection** | Easy to mock in tests, swap implementations | Verbose constructor params |
| **Optional overrides** | Good defaults, but can customize | Need to know all override points |
| **Factory functions** | Hide complexity of construction | Extra indirection |

### Alternatives Considered
1. **Global singletons**: Simpler API → hard to test, can't run tests in parallel
2. **Service locator pattern**: Flexible but magic → runtime errors, hard to trace dependencies
3. **Reflection/auto-injection (like Spring)**: Would require framework → adds complexity

### Decision Outcome
✅ **Adopted.** Enables:
- Easy mocking in unit tests
- Multiple instances with different configs
- Clear dependency graph (visible in constructor)
- Zero magic (easy to understand)

---

## Decision 9: MongoDB as Primary Storage, Files for Distribution

**Status:** ✅ ADOPTED

### Storage Strategy
- **MongoDB**: Authoritative source (raw_ingest, parse_log)
  - Persist all raw content
  - Track all parse attempts
  - Analytics/query capabilities
  
- **File System**: User-facing enriched jobs
  - `db/enriched/`: Enriched job records (JSON)
  - `generated/`: CV/cover letter outputs
  - `logs/`: Application logs, statistics

- **No double-write**: Don't sync between MongoDB and files
  - MongoDB is source of truth
  - Files are read-only exports for user viewing

### Tradeoffs

| Aspect | Benefit | Cost |
|--------|---------|------|
| **MongoDB as primary** | Scalable, queryable, audit trail | Requires Mongo setup/management |
| **Files for user export** | Simple viewing, version control | Need sync scripts if Mongo fails |
| **No dual-write** | Avoids consistency issues | If file is lost, can't rebuild from DB easily |

### Alternatives Considered
1. **Files as primary, MongoDB as cache**: Would be data loss risk on Mongo reset
2. **Full sync (dual-write)**: Would add complexity, potential inconsistency
3. **Serverless (DynamoDB/Firestore)**: Would add vendor lock-in, less queryable

### Decision Outcome
✅ **Adopted.** Benefits:
- MongoDB handles scale and analytics
- Files provide user-friendly export
- Clear responsibility separation

---

## Decision 10: Weighted Score Matcher Engine (v0.5)

**Status:** ✅ IMPLEMENTED (Feb 15, 2026)

### Problem
Previous job matching too simplistic:
- Only counted skill overlap (raw count)
- Ignored salary fit
- Ignored location preferences
- No transparency into scoring decision

### Decision
Implement `scoreMatcherEngine` with three weighted dimensions:

```typescript
export interface ScoringConfig {
  weights: {
    skillsMatch: number;     // 0.5 (50%)
    salaryMatch: number;     // 0.3 (30%)
    locationMatch: number;   // 0.2 (20%)
  };
  skillMatchThreshold: number; // 0.3 (30%)
}

export interface ScoreBreakdown {
  skillsScore: number;         // 0-100
  salaryScore: number;         // 0-100
  locationScore: number;       // 0-100
  finalScore: number;          // 0-100 (weighted)
  reasoning: string;
  details: {...};              // Full transparency
}
```

**Scoring Algorithms:**

1. **Skills Score** (0-100)
   - Count matched skills from job description
   - Apply threshold: < 30% matched → penalize 20% → score capped at 80
   - Linear scale: 30% matched → 50, 100% matched → 100

2. **Salary Score** (0-100)
   - In range: 100
   - Below range: scale 0-50 (0 at user.min - 50k, 50 at user.min)
   - Above range: scale 20-50 (50 at user.max, 20 at user.max + 50k)
   - No data: 50 (neutral)

3. **Location Score** (0-100)
   - Exact match or "Remote": 100
   - City match (fuzzy substring): 80
   - Unmatched but preferred: 40
   - Excluded locations: 0
   - No data: 50 (neutral)

### Tradeoffs

| Aspect | Benefit | Cost |
|--------|---------|------|
| **Weighted design** | Configurable priorities (skills > salary > location) | Must tune weights per user profile |
| **Multiple dimensions** | Holistic matching beyond skills | Slower than simple count (negligible at scale) |
| **Transparent scoring** | User understands why score is X | More data to store/log |
| **Configurable threshold** | Can require minimum skill match | False negatives for partial matches |

### Alternatives Considered
1. **Simple skill count only**: Faster, simpler → ignores salary/location, poor UX
2. **Machine learning model**: More sophisticated → requires training data, black box
3. **User-defined rules (DSL)**: Maximum flexibility → higher barrier to entry, maintenance burden

### Implementation Details

- **File**: `src/services/scoring/score-matcher.ts`
- **Entry point**: `calculateJobScore(job: Job, profile: Profile, config?: ScoringConfig): ScoreBreakdown`
- **Profile extraction**: Pulls from profile.skills[], profile.minSalary, profile.maxSalary, profile.location[]
- **Job extraction**: Parses from job.position, job.description, job.salary, job.location
- **Test coverage**: 20+ unit tests covering edge cases (missing data, extreme values, etc.)
- **Logging**: DEBUG level logs with score breakdown for transparency

### Decision Outcome
✅ **Implemented.** Verified with unit tests:
- ✅ Skills matching with case-insensitive word boundaries
- ✅ Salary range probability scoring
- ✅ Location fuzzy matching + exclusion lists
- ✅ Weighted sum calculation
- ✅ Fallbacks for missing data (neutral 50)
- ✅ Full transparency in scoring breakdown
- ✅ Integration with constraints layer for filtering

Benefits:
- TUI now displays match score (0-100) for each job
- Helps users prioritize applications
- Data-driven insights (which jobs match best)
- Foundation for future ML improvements

---

## Summary of Decisions

| Decision | Status | Implemented | Impact | Verified |
|----------|--------|-------------|--------|----------|
| 1. Generic JobProcessor | ✅ Adopted | Q1 2026 | Enables multi-UI support | ✅ Production |
| 2. Two-Collection MongoDB | ✅ Adopted | Q1 2026 | Enables audit trail & analytics | ✅ E2E tested |
| 3. Two-Stage Parser | ✅ Implemented | Feb 14, 2026 | Better diagnostics, stage metrics | ✅ E2E tested |
| 4. Fixture-Based Testing | ✅ Adopted | Q1 2026 | Automated regression detection | ✅ CI/CD ready |
| 5. Loopback-Only Webhook | ✅ Adopted | Q1 2026 | Secure by default | ✅ Security audit |
| 6. Constraints at Service | ✅ Adopted | Q1 2026 | Reusable business logic | ✅ Unit tested |
| 7. Session-Local Dedup | ✅ Adopted | Q1 2026 | Fast deduplication | ✅ Verified |
| 8. Constructor Injection | ✅ Adopted | Q1 2026 | Testable, flexible | ✅ Code review |
| 9. MongoDB + Files | ✅ Adopted | Q1 2026 | Scalable + user-friendly | ✅ E2E tested |
| 10. Score Matcher v0.5 | ✅ Implemented | Feb 15, 2026 | Transparent multi-dimensional scoring | ✅ 20+ unit tests |

**Input Contexts:** All input types (watcher, clipboard/manual, fixture/manual) are supported and validated in CI, metrics, and feedback loops.

---

## Roadmap & Future Decisions

**Current Phase (Staging - Feb 15-Mar 5, 2026):**
- ✅ Score matcher engine v0.5 integrated (Feb 15)
- ⏳ Sprint 1: Score validation & tuning (Feb 15-19)
- ⏳ Sprint 2: Action logging & analytics (Feb 16-21)
- ⏳ Sprint 3: Material generation (CV/cover letter) (Feb 22-Mar 3)
- ⏳ Staging gate: Performance & feature validation (Mar 3-5)

**Planned Next Decisions (Post-Staging - Phase 4):**
- **Decision 11**: Web UI Architecture (React SPA vs Server-rendered)
- **Decision 12**: Email Provider Support Strategy (Outlook, Yahoo, etc.)
- **Decision 13**: Team Collaboration Mode (shared profiles, application tracking)
- **Decision 14**: Machine Learning for Job Matching (classifier architecture)
- **Decision 15**: Redis for Production Scaling (if memory/dedup needs grow)

**Out-of-Scope (Defer to Phase 5+):**
- Internationalization (i18n) support
- Multi-account management
- Integration with job boards (LinkedIn, Indeed scrapers)
- AI-powered application essays

---

## References

- [ARCHITECTURE.md](ARCHITECTURE.md)
- [IMPLEMENTATION_ROADMAP.md](IMPLEMENTATION_ROADMAP.md)
- [src/services/scoring/score-matcher.ts](../src/services/scoring/score-matcher.ts)
- [src/services/constraints.ts](../src/services/constraints.ts)
- [tests/unit/scoring.test.ts](../tests/unit/scoring.test.ts)

