# Clean Architecture: Jobs Watcher

## Overview

Jobs Watcher follows a **Clean Architecture** pattern with strict separation of concerns across five layers. This design enables independent testing, easy feature addition, and seamless substitution of implementations.

```
┌─────────────────────────────────────────────────────────┐
│         UI Layer (TUI, CLI, Future: Web)               │
├─────────────────────────────────────────────────────────┤
│         Application Layer (Orchestration)              │
│  - JobProcessor<TAction, TPayload> (Generic)           │
│  - JobPresenter interface (abstraction)                │
│  - JobActionHandler interface (abstraction)            │
├─────────────────────────────────────────────────────────┤
│      Services Layer (Business Logic)                   │
│  - Parsers (EmailParser, HTML parser)                  │
│  - Gmail API (fetch, watch, labels)                    │
│  - SmartGenerator (CV/cover letter generation)         │
│  - Storage (MongoDB adapter for audit trail)           │
├─────────────────────────────────────────────────────────┤
│      Drivers (Input Adapters)                          │
│  - GmailEmailSourceAdapter (Pub/Sub webhook)           │
│  - DataTestingAdapter (fixture-based testing)          │
│  - FixtureAdapter (JSON-based regression)              │
└─────────────────────────────────────────────────────────┘
```

---

## Layer Descriptions

### 1. Drivers (Entry Points)

**Responsibility:** Receive events and invoke application logic

**Components:**
- **`GmailEmailSourceAdapter`** (`src/cli/email-source-adapter.ts`)
  - Listens for Pub/Sub messages from Gmail
  - Binds to `127.0.0.1:3000/webhook/gmail` (loopback only for security)
  - Delegates to `EventDrivenWebhook` for processing
  - ACKs fast (HTTP 200) and processes in background

- **`simulate-webhook.ts`** (Testing helper)
  - Simulates Pub/Sub messages to test webhook locally
  - Can send real emails via Gmail API or use demo payloads
  - Passes messageId directly to webhook

### 2. Application Layer (Orchestration)

**Responsibility:** Coordinate between UI and Services without business logic

**Key Classes:**

#### `JobProcessor<TAction, TPayload>`
Generic orchestrator for presenting jobs and handling actions:

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

**Type Parameters:**
- `TAction`: Union of possible user actions (e.g., `ActionType = 'apply' | 'queue'`)
- `TPayload`: Associated data from presentation (e.g., `EnrichedJobData`)

**Benefits:**
- Same orchestration logic works for TUI, CLI, headless, web
- Easy to test by mocking presenter/handler
- No knowledge of UI details

#### `JobPresenter<TAction, TPayload>` Interface
Abstraction for presenting a job to user:

```typescript
interface JobPresenter<TAction, TPayload> {
  present(job: Job): Promise<JobPresentationResult<TAction, TPayload>>;
}
```

**Implementations:**
- `TuiJobPresenter`: Ink-based TUI popup (production data-listening)
- `DataTestingJobPresenter`: CLI-based presenter (development data-testing)
- Future: `WebPresenter`, `HeadlessPresenter`

#### `JobActionHandler<TAction, TPayload>` Interface
Abstraction for handling presented actions:

```typescript
interface JobActionHandler<TAction, TPayload> {
  handle(job: Job, action: TAction, payload?: TPayload): Promise<void>;
}
```

**Implementations:**
- `DefaultActionHandler`: Generates CV/cover letter, queues applications
- `DataTestingActionHandler`: Saves enriched jobs to file system
- Future: `DatabaseActionHandler`, `WebhookActionHandler`

---

### 3. Services Layer (Business Logic)

**Responsibility:** Core business rules, external API integration, data persistence

**Major Services:**

#### Parsers
- **`EmailParser`** (`src/services/parsers/email-parser.ts`)
  - Extracts job metadata from email subject/body
  - Current flow logs **METADATA** stage only
  - Two-stage approach (planned):
    - **METADATA**: Extract company, title, salary, location
    - **JOB_DETAIL**: Extract URL, description, requirements

- **`HtmlParser`** (`src/services/parsers/html-parser.ts`)
  - Parses job listings from pasted HTML
  - Same two-stage approach as EmailParser

#### Gmail Service
- **`GmailService`** (`src/services/gmail.ts`)
  - Fetch emails by label, messageId, threadId
  - Create/manage labels
  - Extract headers and body from MIME structure
  - Watch API for real-time push notifications

#### Constraints
- **`validateJobConstraints()`** (`src/services/constraints.ts`)
  - Business rule validation (min salary, location filter, etc.)
  - Configurable per user profile

#### Smart Generator
- **`SmartGenerator`** (`src/services/generators/smart-generator.ts`)
  - Generates personalized CV and cover letters
  - Uses user profile to tailor content
  - Outputs to `generated/` directory

#### Storage Layer (MongoDB)
- **`MongoDBStorageAdapter`** (`src/services/storage/mongodb-storage-adapter.ts`)
  - Immutable storage of raw emails/HTML (collection: `raw_ingest`)
  - Append-only parse attempt logs (collection: `parse_log`)
  - Query methods for analytics and regression testing

---

### 4. Data Layer (Storage)

**Two-Collection Immutable Design:**

#### `raw_ingest` Collection
Authoritative input records (never updated):

```typescript
interface RawIngestDocument {
  _id?: string | { toString(): string };
  source: 'GMAIL_WEBHOOK' | 'GMAIL_MANUAL' | 'HTML_ONLY';
  mode?: 'production' | 'testing' | 'manual';
  rawContent: string;  // Original email body or HTML
  gmailMeta?: { messageId, threadId, from, subject, ... };
  htmlMeta?: { url, title, description };
  ingestedAt: Date;
  createdAt: Date;
  parseLogIds?: string[];  // References to parse_log (optional)
}
```

#### `parse_log` Collection
Append-only audit trail of parse attempts:

```typescript
interface ParseLogDocument {
  _id?: string | { toString(): string };
  rawIngestId: string;  // FK to raw_ingest
  stage: 'METADATA' | 'JOB_DETAIL';
  success: boolean;
  extracted?: { company, title, salary, location, ... };
  error?: { code, message, context };
  executionMs: number;
  timestamp: Date;
  parserVersion?: string;
}
```

**Benefits:**
- Complete audit trail: who fetched what, when, how
- Idempotent inserts (no duplicate processing)
- Analytics: success rate by source/stage
- Regression testing: failed parses are fixtures

---

### 5. UI Layer

**Responsibility:** Present information and capture user actions

**Components:**

#### TUI (Ink-based)
- **`JobPopup.tsx`** (`src/ui/JobPopup.tsx`)
  - React/Ink TUI component for interactive job display
  - Shows: company, title, salary, location, match score
  - User selects: apply, apply-edit, apply-custom, queue, skip, quit

- **`TuiJobPresenter`** (`src/ui/TuiJobPresenter.ts`)
  - Adapts JobPopup to JobPresenter interface
  - Wraps `showJobPopup()` for clean integration

#### CLI (Data Testing)
- **`EnrichedJobHandler.ts`** (`src/ui/EnrichedJobHandler.ts`)
  - CLI-based handler for enriching job data
  - Shows parsed fields, allows correction/paste

- **`DataTestingJobPresenter`** (`src/cli/presenters/DataTestingJobPresenter.ts`)
  - Adapts EnrichedJobHandler to JobPresenter interface
  - Maps CLI actions to ActionType

- **`DataTestingActionHandler`** (`src/cli/handlers/DataTestingActionHandler.ts`)
  - Handles paste action: saves enriched job to `db/enriched/`
  - Prepares data for SmartGenerator

---

## Data Flow Diagrams

### Production: Data-Listening Flow

```
Gmail Inbox
    ↓
Pub/Sub Push Notification
    ↓
webhook /jobs (127.0.0.1:3000)
    ↓
EventDrivenWebhook.handleJobNotification()
    ↓
GmailService.getMessage(messageId)
    ↓
MongoDBStorageAdapter.saveRawIngest()  ← Save raw email
    ↓
EmailParser.parse() (METADATA stage)
    ↓
MongoDBStorageAdapter.logParseAttempt()  ← Log METADATA result
    ↓
EmailParser.parse() (JOB_DETAIL stage)
    ↓
MongoDBStorageAdapter.logParseAttempt()  ← Log JOB_DETAIL result
    ↓
constraints.validateJobConstraints()
    ↓
JobProcessor.process(job)
    ├→ TuiJobPresenter.present(job)  ← Show TUI popup
    ├→ User selects action
    └→ DefaultActionHandler.handle()  ← Execute action
         ├→ SmartGenerator.generateForJob()  → /generated folder
         └→ notifyUser()
```

### Development: Data-Testing Flow (Fixture-based)

```
Parser Regression Test
    ↓
Load fixture from tests/__fixtures__/failed-parses.json
    ↓
EmailParser.parse()  (against fixture.rawContent)
    ↓
Assert: extracted === expected
    ↓
Report success rate, improvements
```

### Testing: Simulate-Webhook Flow

```
npm run simulate-webhook [--send-real-email]
    ↓
Option A: Send real email
    ├→ GmailService.listLabels()
    ├→ Create "Job-Alerts" label if missing
    ├→ GmailService.sendEmail()
    ├→ Capture messageId
    └→ POST to webhook with messageId
    
Option B: Demo payload
    └→ POST pre-defined payload to webhook
        (simulates Pub/Sub message)
```

---

## Configuration & Environment

**Key Config Files:**
- `src/config.ts`: Central configuration
  - `webhook.port`: Server port (default 3000)
  - `webhook.path`: Pub/Sub endpoint (default /jobs)
  - `webhook.host`: Bind address (default 127.0.0.1)
  - `gmail.labelName`: Watch label (default "Job-Alerts")
  - `features`: Enable/disable logging, notifications, etc.

**Environment Variables:**
- `MONGODB_URI`: MongoDB connection string
- `MONGODB_DB_NAME`: Database name (default "jobs_watcher")
- `GMAIL_SERVICE_ACCOUNT_KEY`: Path to service account JSON
- `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`: OAuth credentials
- `SEND_REAL_EMAIL`: Set to "true" in simulate-webhook for real Gmail send

---

## Testing Strategy

### Unit Tests
- **Parser tests**: `tests/unit/parsers/`
  - Test EmailParser.parse() and HtmlParser.parse()
  - Use fixtures from tests/__fixtures__/

- **Constraints tests**: `tests/unit/services/`
  - Test validateJobConstraints() with various profiles

- **Storage tests**: `tests/unit/storage/`
  - Mock MongoDB, test adapter methods

### Integration Tests
- **End-to-end webhook**: `tests/e2e/webhook.test.ts`
  - Spin up test webhook
  - Send Pub/Sub payload
  - Verify parsing, storage, notification

- **Gmail API tests**: `tests/integration/gmail.test.ts`
  - Requires test Gmail account
  - Verify message fetch, label management

### Regression Tests (Fixture-based)
- **Parser regression**: `tests/parser-regression.test.ts`
  - Load failed-parses.json from export-fixtures
  - Re-run parser, compare results
  - Track improvement over time

---

## Dependency Injection Pattern

All major classes accept dependencies in constructor:

```typescript
// Good: Dependencies injected
const parser = new EmailParser();
const presenter = new TuiJobPresenter();
const handler = new DefaultActionHandler(smartGenerator, notifyUser, features);
const processor = new JobProcessor(presenter, handler);

// Can swap implementations:
const presenter2 = new DataTestingJobPresenter();
const processor2 = new JobProcessor(presenter2, handler);
```

**Benefits:**
- Easy to mock in tests
- Flexible for headless/web modes
- No global state dependencies

---

## Extension Points

### Add a New Presenter
1. Implement `JobPresenter<TAction, TPayload>` interface
2. Implement `present(job: Job)` method
3. Inject into JobProcessor

Example: WebPresenter
```typescript
class WebPresenter implements JobPresenter<ActionType, EnrichedJobData> {
  async present(job: Job): Promise<JobPresentationResult<ActionType, EnrichedJobData>> {
    return {
      action: 'apply',
      payload: { /* enriched data */ }
    };
  }
}
```

### Add a New Action Handler
1. Implement `JobActionHandler<TAction, TPayload>` interface
2. Implement `handle(job, action, payload)` method
3. Inject into JobProcessor

Example: DatabaseActionHandler
```typescript
class DatabaseActionHandler implements JobActionHandler<ActionType, EnrichedJobData> {
  async handle(job: Job, action: ActionType, payload?: EnrichedJobData): Promise<void> {
    if (action === 'apply') {
      await db.applications.insertOne({ jobId: job.id, status: 'applied' });
    }
  }
}
```

### Add a New Parser
1. Extend from `Parser` base class
2. Implement two-stage parse: `parseMetadata()` and `parseJobDetail()`
3. Return `ParseResult` with extracted fields
4. Store in MongoDB via `MongoDBStorageAdapter.logParseAttempt()`

---

## Summary

This architecture achieves:

| Goal | Mechanism |
|------|-----------|
| **Testability** | Dependency injection + interfaces for all behavior |
| **Extensibility** | Clean extension points for new presenters/handlers/parsers |
| **Separation of Concerns** | Five distinct layers with single responsibility |
| **Type Safety** | Generics for flexible yet type-checked workflows |
| **Auditability** | MongoDB immutable collections track every parse attempt |
| **Flexibility** | Same JobProcessor works for TUI, CLI, web, headless |
| **Resilience** | Circuit breakers, timeouts, retry logic in webhook |

