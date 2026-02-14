# Jobs Watcher 📧🎯

Intelligent job alert processor with clean architecture, MongoDB audit trail, and multi-mode testing.

Transform raw job alert emails from Gmail into enriched job records with personalized CV & cover letter generation.

---

## ✨ Features

- **Real-time Gmail Integration**: Pub/Sub notifications for instant processing
- **Clean Architecture**: Layered design with pluggable presenters (TUI, CLI, web-ready)
- **MongoDB Audit Trail**: Immutable storage with complete parse history
- **Two-Stage Parsing**: Separate metadata extraction from job detail parsing
- **Smart Generation**: Personalized CV and cover letters per job application
- **Fixture-Based Testing**: Automated regression testing against failed parses
- **Type-Safe Abstractions**: Generics for flexible yet type-checked workflows

---

## 📋 Quick Start

### Prerequisites
- Node.js 18+
- MongoDB 5.0+ (local or Atlas)
- Gmail account with service account credentials
- Google Cloud project with Gmail & Pub/Sub APIs enabled

### Installation

```bash
# Clone and install
git clone https://github.com/MinhNguyenKha02/jobs-watcher.git
cd jobs-watcher
npm install

# Copy environment template
cp .env.example .env
# Edit .env with your credentials:
#   MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/jobs_watcher
#   GMAIL_SERVICE_ACCOUNT_KEY=/path/to/service-account-key.json
#   GMAIL_CLIENT_ID=xxx.apps.googleusercontent.com
```

### Setup Gmail Watch

```bash
# Authenticate with Gmail and set up label watching
npm run setup
# Follows: Authorize → Create "Job-Alerts" label → Set up Pub/Sub watch
```

### Run Production (Data-Listening)

```bash
# Start webhook server (listens on 127.0.0.1:3000 for Pub/Sub)
npm run data-listening
# Output:
#   ✅ Webhook listening on 127.0.0.1:3000
#   📧 Watching for emails with label: "Job-Alerts"
#   💡 Tip: Use "npm run simulate-webhook" to test
```

When an email arrives in the "Job-Alerts" label:
1. Pub/Sub sends notification to webhook
2. Webhook fetches email via Gmail API
3. Parser extracts: company, title, salary, location, URL, description
4. Stores raw content + parse attempts in MongoDB
5. Shows TUI popup with extracted data
6. User selects action: apply, apply-edit, apply-custom, queue, or skip
7. SmartGenerator creates personalized CV & cover letter
8. Files saved to `generated/` directory

---

## 🧪 Testing & Development

### Two Pipeline Modes

**Pipeline 1: Data-Testing (Database-Driven)**
Interactive TUI for job filtering and HTML enrichment from stored emails.

```bash
# 1. Fetch raw emails to database
FETCH_LIMIT=10 npm run fetch:raw-emails

# 2. Analyze & filter jobs
DATE=2026-01-28 npm run analyze:raw-emails

# 3. Run interactive TUI
npm run data-testing
```

**Features:**
- Load jobs from database (pre-fetched)
- Show job details with match scores
- Press `[p]` to paste HTML from job website for enrichment
- Auto-recalculate match scores with enriched data
- Save enriched job metadata to `src/db/emails/YYYY-MM/DD/enriched/jobs.jsonl`
- Choose actions: apply-generate, apply-custom, apply-edit, queue, skip

**HTML Paste Mode:**
1. Press `[p]` in TUI
2. Copy HTML from job website
3. Paste into terminal
4. Parser auto-extracts: title, company, location, salary, URL
5. Match score recalculated
6. Job enriched and saved to database

See [flows/ENRICHMENT_FLOW.md](flows/ENRICHMENT_FLOW.md) for detailed enrichment workflow.

---

**Pipeline 2: Data-Listening (Gmail Webhook - Production)**
Real-time Pub/Sub notifications from Gmail to webhook.

```bash
# 1. Authenticate with Gmail
npm run auth

# 2. Setup Pub/Sub subscription
npm run setup
npm run pubsub-subscribe

# 3. Start webhook listener
npm run data-listening
# Listens on 127.0.0.1:3000/webhook/gmail
# Receives Pub/Sub notifications in background
```

**Features:**
- Webhook ACKs fast (200 OK) to Google Pub/Sub
- Processes emails asynchronously in background
- Extracts metadata: company, title, salary, location
- Shows TUI popup with extracted data
- Press `[p]` to paste HTML for enrichment (optional)
- Save enriched records to MongoDB (`raw_ingest` + `parse_log` collections)
- Choose actions: apply, apply-edit, apply-custom, queue, skip

**Testing Pipeline 2 Locally:**

```bash
# Test with demo payload (no real email)
npm run simulate-webhook
# → POST to http://127.0.0.1:3000/webhook/gmail
# → Shows TUI with sample job

# Send real Gmail email and trigger webhook
SEND_REAL_EMAIL=true npm run simulate-webhook
# → Sends test email via Gmail API
# → Automatically posts messageId to webhook
# → Tests full end-to-end flow
# → Verifies MongoDB persistence
```

**Production Readiness:**
- Webhook reachability: port + path configured
- Pub/Sub delivery: test email → notification → webhook
- Gmail History pull: fetch message details via API
- Parser safety: graceful failure handling
- Action logging: append to MongoDB collections
- Fallback mode: manual HTML paste if parsing fails

---

### Parser Regression Testing

```bash
# Export failed parses from MongoDB to fixtures
npm run export-fixtures
# → Reads parse_log collection (failures only)
# → Joins with raw_ingest for raw content
# → Exports to tests/__fixtures__/failed-parses.json

# Run parser against fixtures
npm test -- parser.test
# → Tests EmailParser.parse() against fixtures
# → Reports: success rate, improvements, regressions

# Compare parser versions
npm run parser-stats
# → Analyzes v1 vs v2 success rates
# → Breaks down by: stage (METADATA/JOB_DETAIL), source (GMAIL/HTML)
# → Shows improvements per stage
```

### Parser Regression Testing

```bash
# Export failed parses from MongoDB to fixtures
npm run export-fixtures
# → Reads parse_log collection (failures only)
# → Joins with raw_ingest for raw content
# → Exports to tests/__fixtures__/failed-parses.json

# Run parser against fixtures
npm test -- parser.test
# → Tests EmailParser.parse() against fixtures
# → Reports: success rate, improvements, regressions

# Compare parser versions
npm run parser-stats
# → Analyzes v1 vs v2 success rates
# → Breaks down by: stage (METADATA/JOB_DETAIL), source (GMAIL/HTML)
# → Shows improvements per stage
```

### Manual Data Testing (Development)

```bash
npm run data-testing
# Interactive CLI mode for parser development:
# 1. Paste email body (or HTML)
# 2. See parsed fields: company, title, salary, etc.
# 3. Correct fields manually if needed
# 4. Save enriched job to db/enriched/
```

---

## 🏗️ Architecture

Jobs Watcher follows **Clean Architecture** with five layers:

```
UI Layer (TUI, CLI, Web)
    ↓
Application Layer (JobProcessor orchestration)
    ↓
Services Layer (Parsers, Gmail API, Storage, SmartGenerator)
    ↓
Drivers (Pub/Sub webhook, fixtures adapter)
```

**Key Design Patterns:**
- **Generic JobProcessor**: Pluggable presenters & action handlers
- **Dependency Injection**: All major components injectable for testing
- **Immutable Storage**: MongoDB collections (raw_ingest, parse_log) for audit trail
- **Two-Stage Parser**: Separate METADATA extraction from JOB_DETAIL parsing

**For detailed architecture overview, see [ARCHITECTURE.md](ARCHITECTURE.md)**

**For design decisions & tradeoffs, see [DECISIONS.md](DECISIONS.md)**

---

## 📁 Project Structure

```
jobs-watcher/
├── src/
│   ├── application/
│   │   └── job-processor.ts          # Generic orchestrator
│   ├── services/
│   │   ├── parsers/
│   │   │   ├── email-parser.ts       # Extract from email
│   │   │   └── html-parser.ts        # Extract from HTML
│   │   ├── generators/
│   │   │   └── smart-generator.ts    # CV/cover letter generation
│   │   ├── storage/
│   │   │   ├── schemas.ts            # MongoDB type definitions
│   │   │   ├── mongodb-storage-adapter.ts
│   │   │   └── index.ts
│   │   ├── gmail.ts                  # Gmail API wrapper
│   │   ├── constraints.ts            # User profile validation
│   │   ├── event-webhook.ts          # Pub/Sub webhook server
│   │   └── logger.ts
│   ├── ui/
│   │   ├── JobPopup.tsx              # Ink-based TUI
│   │   ├── TuiJobPresenter.ts        # TUI adapter
│   │   ├── EnrichedJobHandler.ts     # CLI enrichment
│   │   └── services/
│   ├── cli/
│   │   ├── data-listening.ts         # Production webhook runner
│   │   ├── data-testing.ts           # CLI interactive mode
│   │   ├── presenters/
│   │   │   └── DataTestingJobPresenter.ts
│   │   ├── handlers/
│   │   │   └── DataTestingActionHandler.ts
│   │   └── email-source-adapter.ts
│   ├── db/
│   │   └── emails/
│   │       └── enriched/             # Enriched job records
│   ├── config.ts
│   ├── constants.ts
│   ├── types.ts
│   └── index.ts
├── scripts/
│   ├── export-fixtures.ts            # MongoDB → JSON fixtures
│   ├── simulate-webhook.ts           # Local webhook testing
│   ├── parser-stats.ts               # Success rate analytics
│   └── [other scripts]
├── tests/
│   ├── __fixtures__/
│   │   ├── failed-parses.json        # Regression test data
│   │   ├── parse-samples.json        # Sample for debugging
│   │   └── export-stats.json         # Export metadata
│   ├── unit/
│   ├── integration/
│   └── parser.test.ts
├── generated/                        # Output: CV, cover letters
├── logs/                             # Application logs
├── ARCHITECTURE.md                   # Architecture guide
├── DECISIONS.md                      # Design decisions
├── README.md                         # This file
├── package.json
├── tsconfig.json
└── .env.example
```

---

## 🔄 Data Flow

### Production Flow (data-listening)

```
Gmail Inbox → Pub/Sub → Webhook (127.0.0.1:3000)
  ↓
EventDrivenWebhook.handleJobNotification()
  ↓
1. Save raw email → MongoDB (raw_ingest collection)
2. EmailParser.parse() METADATA stage → log attempt
3. EmailParser.parse() JOB_DETAIL stage → log attempt
4. validateJobConstraints() → check profile filters
5. JobProcessor.process()
   ├→ TuiJobPresenter.present() → show TUI popup
   ├→ User selects action
   └→ DefaultActionHandler.handle() → execute action
       ├→ SmartGenerator.generateForJob() → /generated
       └→ Notifications.notify() → system notification
```

### Testing Flow (fixture-based regression)

```
MongoDB (production data)
  ↓
npm run export-fixtures
  ↓
tests/__fixtures__/failed-parses.json
  ↓
npm test -- parser.test
  ↓
EmailParser.parse(fixture.rawContent)
  ↓
Assert: extracted === expected
  ↓
Report: success rate by stage/source
```

---

## 🛠️ API Reference

### JobProcessor

Generic orchestrator for presenting jobs and handling actions:

```typescript
const processor = new JobProcessor<ActionType, EnrichedJobData>(
  presenter,   // JobPresenter implementation
  handler      // JobActionHandler implementation
);

const result = await processor.process(job);
// result.action: user's selected action
// result.payload: enriched data (if any)
```

### MongoDBStorageAdapter

Immutable/append-only storage for audit trail:

```typescript
const storage = new MongoDBStorageAdapter({ mongoUri, dbName, logger });
await storage.connect();

// Save raw email/HTML
await storage.saveRawIngest({
  source: 'GMAIL_WEBHOOK',
  rawContent: emailBody,
  gmailMeta: { messageId, from, subject, ... }
});

// Log parse attempt
await storage.logParseAttempt({
  rawIngestId: raw._id,
  stage: 'METADATA',
  success: true,
  extracted: { company: '...', title: '...' }
});

// Query for analytics
const failedParses = await storage.getFailedParsesByStage('METADATA', 100);
const successRate = await storage.getSuccessRateBySource('GMAIL_WEBHOOK', 'METADATA');
```

### EmailParser

Two-stage parser for job alert emails:

```typescript
const parser = new EmailParser();

const result = parser.parse({
  emailId: messageId,
  subject: 'Senior Full Stack Engineer - Remote',
  from: 'jobs@company.com',
  body: 'We have an exciting opportunity...',
  receivedAt: new Date()
});

// result.company: 'Company Inc'
// result.title: 'Senior Full Stack Engineer'
// result.salary: '$180k-220k'
// result.location: 'Remote'
// result.url: 'https://...'
// result.description: '...'
```

### GmailService

Gmail API integration:

```typescript
const gmail = new GmailService(serviceAccountKey, profile);

// Fetch message
const message = await gmail.getMessage(messageId);
const body = gmail.extractBody(message);
const subject = gmail.extractHeader(message, 'Subject');

// Label management
const labelId = await gmail.getLabelId('Job-Alerts');
const messages = await gmail.listMessagesByLabel(labelId, limit);

// Sending (for simulate-webhook)
await gmail.sendEmail({
  to: userEmail,
  subject: 'Test Job Alert',
  body: 'Test message body'
});
```

### validateJobConstraints

Filter jobs based on user profile:

```typescript
import { validateJobConstraints } from './services/constraints.js';

const isValid = validateJobConstraints(job, profile);
// Returns: true if job matches all constraints
// Constraints checked:
//   - salary: min/max range
//   - location: allowlist
//   - company: blocklist
//   - tech stack: required/excluded tags
```

---

## 🚀 Deployment

### Local Development
```bash
npm run data-listening
# Runs on 127.0.0.1:3000
```

### Staging/Beta
```bash
# Set WEBHOOK_HOST to your staging domain
export WEBHOOK_HOST=beta.example.com

# Set MongoDB to staging instance
export MONGODB_URI=mongodb+srv://...staging...

npm run build
npm run data-listening
```

### Production
```bash
# Behind reverse proxy (Nginx, Cloud Load Balancer)
export WEBHOOK_HOST=jobs.example.com
export MONGODB_URI=mongodb+srv://...production...

npm run build
npm run data-listening

# Proxy config example (Nginx):
# location /jobs {
#   proxy_pass http://127.0.0.1:3000/jobs;
# }
```

---

## 📊 Monitoring

### Health Check Endpoint
```bash
curl http://127.0.0.1:3000/health
# {
#   "status": "ok",
#   "uptime": 3600,
#   "memory_mb": 156,
#   "webhook_path": "/jobs"
# }
```

### MongoDB Analytics
```bash
npm run export-fixtures     # Export stats
# Outputs: tests/__fixtures__/export-stats.json
# Shows: total failures, by stage, by source
```

### Parser Metrics
```bash
npm run parser-stats
# Compares current vs baseline parser success rates
# Breaks down improvements by stage
```

---

## 🧩 Extension Points

### Add New Presenter (e.g., Web UI)
1. Implement `JobPresenter<ActionType, EnrichedJobData>`
2. Inject into `JobProcessor`

```typescript
class WebPresenter implements JobPresenter<ActionType, EnrichedJobData> {
  async present(job: Job): Promise<JobPresentationResult<ActionType, EnrichedJobData>> {
    // HTTP POST to frontend, wait for response
    return { action: 'apply', payload: { /* enriched data */ } };
  }
}
```

### Add New Action Handler
1. Implement `JobActionHandler<ActionType, EnrichedJobData>`
2. Inject into `JobProcessor`

```typescript
class WebhookActionHandler implements JobActionHandler<ActionType, EnrichedJobData> {
  async handle(job: Job, action: ActionType, payload?: EnrichedJobData): Promise<void> {
    // Send webhook to external service (ATS, Slack, etc.)
  }
}
```

### Add New Parser
1. Extend parsing logic in `EmailParser` or create `CustomParser`
2. Integrate with MongoDB logging via `MongoDBStorageAdapter`

---

## 🐛 Troubleshooting

### "Cannot connect to MongoDB"
```bash
# Check connection string in .env
# Verify MongoDB is running:
mongosh "mongodb+srv://user:pass@cluster.mongodb.net/jobs_watcher"
```

### "Gmail API returned 404"
```bash
# Ensure service account has Gmail API access
# In Google Cloud Console:
#   - Enable Gmail API
#   - Add service account to target Gmail account (via domain admin or manual share)
```

### "Webhook not receiving Pub/Sub messages"
```bash
# Verify label name matches config
npm run list-labels  # Check actual Gmail labels

# Test webhook manually:
SEND_REAL_EMAIL=true npm run simulate-webhook
```

### "Parser missing fields"
```bash
# Export failed parses to analyze
npm run export-fixtures

# Check MongoDB parse_log collection
mongosh "..." --eval "db.parse_log.find({stage: 'METADATA', success: false}).limit(5)"
```

---

## 📝 License

MIT

---

## 🤝 Contributing

1. Read [ARCHITECTURE.md](ARCHITECTURE.md) for design patterns
2. Read [DECISIONS.md](DECISIONS.md) for rationale
3. Write tests for new features (fixtures-based for parsers)
4. Ensure no TypeScript errors: `npm run type-check`
5. Run tests: `npm test`

---

## 📚 Further Reading

- **[ARCHITECTURE.md](ARCHITECTURE.md)**: Deep dive into clean architecture, layers, data flow
- **[DECISIONS.md](DECISIONS.md)**: Design rationale, tradeoffs, alternatives considered
- **[ENRICHMENT_FLOW.md](flows/ENRICHMENT_FLOW.md)**: Job enrichment and user workflow
- **[STAGING_GUIDE.md](staging/STAGING_GUIDE.md)**: Staging and validation guide

---

## Support

For questions or issues:
1. Check [Troubleshooting](#-troubleshooting) section
2. Review relevant .md guide (ARCHITECTURE, DECISIONS, etc.)
3. Check GitHub issues: https://github.com/MinhNguyenKha02/jobs-watcher/issues

