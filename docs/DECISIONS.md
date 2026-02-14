# Architectural Decisions & Tradeoffs

This document records key decisions made during the redesign of Jobs Watcher, including rationale, tradeoffs, and alternatives considered.

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

### Decision Outcome
✅ **Adopted.** Enables:
- Multiple UIs simultaneously (TUI for prod, CLI for testing)
- Easy headless mode (no presenter = just action handler)
- Web UI implementation (REST presenter, database handler)
- Clean testing via mocks

---

## Decision 2: Two-Collection Immutable MongoDB Schema

**Status:** ✅ ADOPTED

### Problem
Original approach used only file-based storage (JSON files in `db/enriched/`):
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
  "ingestedAt": "2026-02-13T...",
  "createdAt": "2026-02-13T..."
}
```

**`parse_log`** (Append-only)
```json
{
  "_id": "logId",
  "rawIngestId": "FK to raw_ingest",
  "stage": "METADATA | JOB_DETAIL",
  "success": true|false,
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

## Decision 3: Two-Stage Parser (METADATA vs JOB_DETAIL)

**Status:** 🔄 PLANNED (current flow logs METADATA stage only)

### Problem
Parser sometimes fails mid-extraction:
- Extracts company/title successfully
- Then fails to extract URL (dead link, etc.)
- User gets partial data, unclear what failed
- No way to retry just the failed stage

### Decision
Split parsing into two independent stages:

**Stage 1: METADATA** (Fast, reliable)
- Extract: company, title, salary, location
- Minimal regex/string parsing
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
  timestamp: new Date()
});

await storage.logParseAttempt({
  rawIngestId: raw._id,
  stage: 'JOB_DETAIL',
  success: true,
  extracted: { url: '...', description: '...' },
  timestamp: new Date()
});
```

### Tradeoffs

| Aspect | Benefit | Cost |
|--------|---------|------|
| **Staged approach** | Can proceed with partial data (app title/salary) | User sees incomplete job (missing URL) |
| **Stage-specific metrics** | Identify which stage needs improvement | More complex logging |
| **Retry capability** | Could retry just stage 2 if URL fetch updated | Not implemented yet (future feature) |

### Alternatives Considered
1. **Single monolithic parse**: Simpler code, all-or-nothing result → user gets no data if any step fails
2. **Three+ stages**: Could add CONSTRAINTS stage → over-engineered for current needs
3. **Optional fields (permissive parser)**: Less strict validation → confuses user with garbage data

### Decision Outcome
✅ **Will implement.** Benefits:
- Granular failure diagnostics
- Stage-specific success rates for targeting improvements
- Foundation for smart retry logic
- Clearer feedback to user (e.g., "Got title, but URL fetch failed")

---

## Decision 4: Fixture-Based Parser Regression Testing

**Status:** ✅ ADOPTED (replaces interactive data-testing loop)

### Problem
Previous approach:
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
Separate validation at service layer via `validateJobConstraints()`:
```typescript
// In EventDrivenWebhook.processJob()
const job = parser.parse(...);
const isValid = validateJobConstraints(job, this.profile);

if (!isValid) {
  logger.info(`⏭️  Skipped (constraints): ${job.company}`);
  return; // Don't present to user
}

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

## Summary of Decisions

| Decision | Status | Impact |
|----------|--------|--------|
| 1. Generic JobProcessor | ✅ Implemented | Enables multi-UI support |
| 2. Two-Collection MongoDB | ✅ Implemented | Enables audit trail & analytics |
| 3. Two-Stage Parser | ✅ Designed | Better diagnostics, future retry capability |
| 4. Fixture-Based Testing | ✅ Adopted | Automated regression detection |
| 5. Loopback-Only Webhook | ✅ Implemented | Secure by default |
| 6. Constraints at Service | ✅ Implemented | Reusable business logic |
| 7. Session-Local Dedup | ✅ Implemented | Fast, simple deduplication |
| 8. Constructor Injection | ✅ Implemented | Testable, flexible |
| 9. MongoDB + Files | ✅ Implemented | Scalable + user-friendly |

---

## Roadmap & Future Decisions

**Beta Phase (Next):**
- Implement two-stage parser refactor
- Wire MongoDB into data-listening
- Export and test fixtures

**Staging Phase (After Beta):**
- Add Web UI presenter (ExpressJS template or React SPA)
- Add email template versioning
- Analytics dashboard (parse success trends)

**Production (Post-Staging):**
- Add Redis for cross-session dedup if needed
- Add email provider support (Outlook, etc.)
- Team collaboration mode (shared profile, applications tracking)

