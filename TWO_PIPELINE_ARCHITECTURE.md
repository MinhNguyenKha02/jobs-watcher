# Two-Pipeline Architecture: Data-Testing + Data-Listening

## Quick Start

### Pipeline 1: Data-Testing (DB-Based) ✅ READY
```bash
# 1. Populate database with raw emails
FETCH_LIMIT=10 npm run fetch:raw-emails

# 2. Analyze and filter jobs
DATE=2026-01-28 npm run analyze:raw-emails

# 3. Start interactive TUI with database jobs
npm run data-testing

# Then for each job:
# - Press [p] to paste HTML from job website
# - TUI re-parses and recalculates match score
# - Choose action: apply-generate, apply-custom, apply-edit, mail, queue, skip
# - Results logged to logs/data-testing.jsonl
```

**Status**: ✅ **FULLY OPERATIONAL**
- 23 raw emails in DB
- 100 jobs parsed
- 93 jobs passed filtering (93%)
- TUI ready for interactive HTML enrichment
- All tests passing (52/52)

---

### Pipeline 2: Data-Listening (Gmail Webhook) 🔄 CONFIGURED
```bash
# Start webhook server for real-time Gmail notifications
npm run data-listening

# Receives job email notifications from Gmail
# Each job: metadata → TUI → HTML paste enrichment → actions
# Results logged to src/db/emails/filtered-jobs.json
```

**Status**: 🔄 **Ready to deploy** (awaiting production Gmail setup)

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                     TWO PARALLEL PIPELINES                       │
└─────────────────────────────────────────────────────────────────┘

PIPELINE 1: DATA-TESTING (Database-Driven)
═══════════════════════════════════════════════════════════════════

  [Raw Emails in DB]
         ↓
  src/db/emails/2026-01/28/
    ├── raw-emails.jsonl (23 emails)
    └── {messageId}.body.txt × 23 (HTML content)
         ↓
  [Step 1: Fetch] npm run fetch:raw-emails
    └── Gmail API → Download to DB
         ↓
  [Step 2: Analyze] npm run analyze:raw-emails
    ├── Parse HTML (TopCV multi-job format)
    ├── Extract: title, company, location, salary, url
    ├── Apply constraints: junior-level, skills, years
    └── Output: filtered-jobs.json (100 parsed → 93 passed)
         ↓
  [Step 3: TUI Interactive] npm run data-testing
    ├── Load jobs from DB
    ├── Display: Job details + match score
    ├── User action: Press [p] to PASTE HTML
    │   ├── Input: Website HTML (job details page)
    │   ├── Parser: Re-extract all job fields
    │   ├── Score: Recalculate match score
    │   └── Enriched: htmlContent, reparsedJob, matchedSkills
    ├── User action: Choose [a]pply/[m]ail/[q]ueue/[s]kip
    └── Output: logs/data-testing.jsonl
         ↓
  [Action Logged] Enriched job data saved
    {
      timestamp, mode, messageId, action,
      company, position, url, enrichedUrl,
      notes, tags, matchScore
    }


PIPELINE 2: DATA-LISTENING (Gmail Webhook)
═══════════════════════════════════════════════════════════════════

  [Gmail Pub/Sub Notification]
         ↓
  [Webhook Received] event-webhook.ts
    ├── Decode Pub/Sub message
    ├── Get label ID
    ├── Fetch messages since history ID
    ├── For each message:
    │   ├── Persist raw email (no parsing yet)
    │   ├── Extract metadata: messageId, subject, from
    │   └── Pass to TUI (READ-ONLY)
         ↓
  [TUI Interactive] showJobPopup()
    ├── Display: Email metadata only
    ├── No initial parsing (READ-ONLY constraint)
    ├── User action: Press [p] to PASTE HTML
    │   ├── Input: Website HTML (job details page)
    │   ├── Parser: HtmlJobParser.parseJobFromHtml()
    │   ├── Filter: Apply constraints
    │   ├── Score: Calculate match score
    │   └── Enriched: htmlContent, reparsedJob, matchedSkills
    ├── User action: [n] notes, [s] skip, [a] apply
    └── Output: DefaultActionHandler logs to filtered-jobs.json
         ↓
  [Action Logged] Enriched data saved
    {
      messageId, action, enrichedData:
      {
        enrichedUrl, notes, tags,
        htmlContent, reparsedJob, matchedSkills
      }
    }
```

---

## Data Flow Comparison

### Pipeline 1: Data-Testing
```
Time: T0 → T+1min (all emails pre-fetched)

T0:   npm run fetch:raw-emails
      └── Gmail API: Fetch 10 recent emails → DB

T0+30s: DATE=2026-01-28 npm run analyze:raw-emails
        ├── Load raw emails from DB
        ├── Parse HTML
        ├── Filter constraints
        └── Save filtered-jobs.json

T0+1min: npm run data-testing
         ├── Load all filtered jobs
         ├── Show TUI for each job
         ├── User: [p] paste → re-parse → enrich
         └── Log actions to data-testing.jsonl
```

### Pipeline 2: Data-Listening
```
Time: Real-time (jobs arrive continuously)

T0:   npm run data-listening
      └── Start webhook server on port 3000

T+2min: Gmail sends notification (new job email)
        ├── Webhook receives Pub/Sub message
        ├── Decode + extract metadata
        ├── Show TUI (metadata-only)
        ├── User: [p] paste HTML → enrich
        └── Log action to filtered-jobs.json

T+5min: Another job email arrives (repeat)
```

---

## TUI Modes & Features

### JobPopup.tsx: Interactive Menu
```
┌─────────────────────────────────────────┐
│     Software Developer @ MARUSYS        │
│     Full-Stack (Gin/React) - Hà Nội     │
│                                         │
│     Match Score: ⭐⭐⭐ (3 skills)        │
│                                         │
│  [apply-gen]  [skip]  [queue]  [mail]   │  ← Navigate: ←→ / h/l
│                                         │
│  [a] Apply  [u] URL  [n] Notes          │
│  [t] Tags   [p] Paste HTML  [q] Quit    │
│                                         │
│  Press [p] to PASTE HTML from website   │
│  Press [a] to choose apply method       │
│  Press [Enter] to confirm action        │
└─────────────────────────────────────────┘
```

### When [p] is Pressed: HTML Paste Mode
```
Input buffer opens:
┌─────────────────────────────────────────┐
│  Paste HTML content here:               │
│  (Right-click in browser → View Source) │
│                                         │
│  <!DOCTYPE html>...                     │
│  <div class="job-details">              │
│    <h1>Senior Backend Engineer</h1>    │
│    ...                                  │
│  </div>                                 │
│                                         │
│  Press [Enter] to parse                 │
│  Press [Esc] to cancel                  │
└─────────────────────────────────────────┘

After parsing:
┌─────────────────────────────────────────┐
│     Senior Backend Engineer             │
│     TechCorp (Gin/Java) - HCMC           │
│                                         │
│  ✓ Match Score: ⭐⭐⭐⭐⭐ (5 skills!)   │
│                                         │
│  HTML Content: ✓ Stored                 │
│  Reparsed Job: ✓ Extracted              │
│  Matched Skills: gin, go, java          │
│                                         │
│  Ready to apply? [y/n]                  │
└─────────────────────────────────────────┘

Note: HTML paste currently expects terminal input. A clipboard-only mode can be added later as an alternative flow.
```

---

## Database Schema

### Raw Email Storage
```
src/db/emails/
└── 2026-01/28/
    ├── raw-emails.jsonl          ← Metadata index
    │   {timestamp, messageId, from, subject}
    │   {timestamp, messageId, from, subject}
    │   ...
    │
    ├── 19c0366ab511e4eb.body.txt  ← Email HTML #1
    ├── 19c0366a0f840a29.body.txt  ← Email HTML #2
    ├── 19c03f23f8d02417.body.txt  ← Email HTML #3
    └── ...
```

### Filtered Jobs Output
```
src/db/emails/2026-01/28/filtered-jobs.json
{
  "dateProcessed": "2026-02-04T07:24:52.289Z",
  "totalEmails": 23,
  "totalJobsParsed": 100,
  "passedJobs": 93,
  "filteredJobs": 7,
  "jobs": [
    {
      "messageId": "19c0366ab511e4eb",
      "from": "TopCV <toppyai@topcv.vn>",
      "subject": "full stack developer: 10 việc làm mới nhất",
      "platform": "topcv",
      "title": "Software Developer For Broadband Devices",
      "company": "MARUSYS VINA CO.,LTD",
      "location": "Hà Nội",
      "salary": "Từ 8 triệu",
      "url": "https://topcv.vn/viec-lam/...",
      "filtered": false,
      "matchedSkills": []
    },
    // ... 92 more
  ]
}
```

### Action Log
```
logs/data-testing.jsonl
{
  "timestamp": "2026-02-04T14:30:00.000Z",
  "mode": "data-testing",
  "messageId": "19c0366ab511e4eb",
  "action": "apply-generate",
  "company": "MARUSYS VINA CO.,LTD",
  "position": "Software Developer For Broadband Devices",
  "url": "https://topcv.vn/viec-lam/...",
  "enrichedUrl": "https://direct-job-url-from-html-paste",
  "notes": "Good fit for backend stack",
  "tags": ["backend", "junior", "gin"],
  "matchScore": 3
}

{
  "timestamp": "2026-02-04T14:31:15.000Z",
  "mode": "data-testing",
  "messageId": "19c0366a0f840a29",
  "action": "mail",
  "company": "TEQNOLOGICAL ASIA Co., Ltd",
  "position": "Front-End Developer",
  "matchScore": 2
}
```

---

## Services Integration

### 1. HtmlJobParser
```typescript
// Parse HTML from website or email
parseJobFromHtml(html: string): ParsedJobData
```

**Used by:**
- data-testing.ts: Initial HTML parsing from email body
- JobPopup.tsx [p] mode: Re-parse pasted HTML
- event-webhook.ts: Parse Gmail email bodies

**Detects Platforms:**
- TopCV (multi-job format with `.job-item-link`)
- Indeed (single job with structured HTML)
- LinkedIn (job postings with specific CSS classes)

---

### 2. EmailParser
```typescript
// Parse email metadata and subject
parse(input: ParsedEmail): Job[]
```

**Used by:**
- event-webhook.ts: Extract messageId, subject, from
- data-testing.ts: Fallback parsing for non-standard emails

---

### 3. filterJobCompatibility
```typescript
// Apply constraints: junior-level, skills, years
filterJobCompatibility(email: ParsedEmail, profile: Profile): FilterResult
```

**Constraints Applied:**
- Junior-level only (filters "Senior", "Middle", "Lead")
- Skill matching (profile skills must appear in job description)
- Year of experience (filters 3+ years requirement)
- Non-software roles excluded (e.g., HR, Customer Service)

**Returns:**
- `passed`: boolean
- `matchedSkills`: string[] (skills that matched)
- `reasons`: string[] (filter reason if rejected)

---

### 4. JobPopup (React/Ink TUI)
```typescript
// Interactive TUI for job presentation
showJobPopup(job: Job): Promise<{
  action: ActionType,
  enrichedData?: EnrichedJobData
}>
```

**Input:**
- Job object with all parsed fields

**Output:**
- action: 'apply-custom' | 'apply-generate' | 'apply-edit' | 'mail' | 'queue' | 'skip'
- enrichedData: {enrichedUrl, notes, tags, htmlContent, reparsedJob, matchedSkills}

**Modes:**
- menu: Select action
- apply-submenu: Choose apply method
- url: Update job URL
- notes: Add notes
- tags: Add tags
- html: **Paste HTML** ← Main enrichment

---

## Test Coverage

### Unit Tests (47 tests)
```
✓ constraints-filter.test.ts      (19 tests)
✓ parser.test.ts                  (7 tests)
✓ generator.test.ts               (8 tests)
✓ notifications.test.ts           (4 tests)
✓ smart-generator.test.ts         (4 tests)
```

### Integration Tests (5 tests)
```
✓ webhook-real.test.ts            (2 tests - real email parsing)
✓ gmail.test.ts                   (3 tests - real Gmail API)
```

### E2E Tests (2 tests)
```
✓ webhook-flow.test.ts            (2 tests - full pipeline)
```

**Total: 52 tests passing ✅**

---

## Configuration Summary

### Environment Variables

**Operational Mode:**
```bash
OPERATIONAL_MODE=data-testing    # Use database
OPERATIONAL_MODE=data-listening  # Use Gmail webhook
```

**Data Source (data-testing):**
```bash
DATA_SOURCE_TYPE=db
DATA_SOURCE_DB_PATH=src/db/emails
DATA_SOURCE_BATCH_SIZE=10
```

**TUI Control:**
```bash
FEATURE_TUI=true                 # Enable TUI (default)
FEATURE_TUI=false                # Disable TUI (headless)
```

**Gmail Integration:**
```bash
GMAIL_CLIENT_ID=...
GMAIL_CLIENT_SECRET=...
GMAIL_LABEL_NAME=Job Alerts
```

**Webhook:**
```bash
WEBHOOK_PORT=3000
WEBHOOK_PATH=/webhook/gmail
```

---

## Status Summary

| Component | Status | Notes |
|-----------|--------|-------|
| **Pipeline 1: Data-Testing** | ✅ Ready | 23 emails in DB, 93 jobs available, TUI interactive |
| **Pipeline 2: Data-Listening** | 🔄 Ready | Configured, awaiting production Gmail setup |
| **TUI Integration** | ✅ Ready | JobPopup.tsx fully functional with HTML paste |
| **HTML Parser** | ✅ Ready | TopCV, Indeed, LinkedIn support |
| **Constraint Filter** | ✅ Ready | Junior-level, skill, year filters working |
| **Email Storage** | ✅ Ready | 23 raw emails cached locally |
| **Tests** | ✅ Ready | 52/52 passing, real Gmail API tests enabled |
| **Email Analyzer** | ✅ Ready | 93 jobs passed, 7 filtered |
| **Action Logging** | ✅ Ready | data-testing.jsonl logs all user actions |

---

## Next Steps

### For Testing
1. ✅ Database is populated (23 emails)
2. ✅ Jobs are analyzed (93 passed)
3. ✅ Run: `npm run data-testing`
4. ⏳ Test HTML paste enrichment with real website content
5. ⏳ Verify action logging in `logs/data-testing.jsonl`

### For Production
1. Set `OPERATIONAL_MODE=data-listening`
2. Configure Gmail Pub/Sub credentials
3. Run: `npm run data-listening`
4. Jobs arrive in real-time with TUI
5. All enriched data logged to database

---

## File Reference

- **TUI**: [src/ui/JobPopup.tsx](src/ui/JobPopup.tsx)
- **Data-Testing CLI**: [src/cli/data-testing.ts](src/cli/data-testing.ts)
- **Webhook Server**: [src/services/event-webhook.ts](src/services/event-webhook.ts)
- **Parser**: [src/services/html-parser.ts](src/services/html-parser.ts)
- **Constraints**: [src/services/constraints.ts](src/services/constraints.ts)
- **Config**: [src/config.ts](src/config.ts)
- **Fetch Script**: [scripts/fetch-raw-emails.ts](scripts/fetch-raw-emails.ts)
- **Analyze Script**: [scripts/analyze-raw-emails.ts](scripts/analyze-raw-emails.ts)
- **Usage Guide**: [PIPELINE1_USAGE.md](PIPELINE1_USAGE.md)
