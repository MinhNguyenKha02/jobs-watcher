# Pipeline 1: Data-Testing with TUI Enrichment

## Overview
Interactive TUI for job filtering and HTML enrichment from database emails.

```
Raw Emails (DB) → Parse & Filter → TUI Display → HTML Paste → Enrich → Actions → Log
```

## Setup

### 1. Fetch Raw Emails to Database
```bash
FETCH_LIMIT=10 npm run fetch:raw-emails
```

**Output:** Raw emails saved to `src/db/emails/YYYY-MM/DD/`
- `raw-emails.jsonl` - Email metadata
- `{messageId}.body.txt` - Email HTML body

### 2. Analyze & Filter Jobs
```bash
DATE=2026-01-28 npm run analyze:raw-emails
```

**Output:** `src/db/emails/2026-01/28/filtered-jobs.json`
- Total parsed: 100 jobs
- Passed: 93 jobs (93%)
- Filtered: 7 jobs (7%)

### 3. Run TUI with Interactive Mode
```bash
npm run data-testing
```

This starts the **interactive TUI** that:
- Loads jobs from database
- Shows job details (title, company, salary, location)
- Displays match score
- **Allows HTML paste mode [p]** to enrich job details
- Accepts actions: apply-generate, apply-custom, apply-edit, mail, queue, skip

---

## TUI Controls

### Main Menu
```
[←/→] or [h/l]  - Navigate actions
[a]              - Apply submenu (choose: generate, custom, edit)
[u]              - Update URL
[n]              - Add notes
[t]              - Add tags
[p]              - **PASTE HTML** ← Main enrichment trigger
[Enter]          - Confirm action
[q/Esc]          - Skip & queue
```

### HTML Paste Mode [p]
When you press `[p]`:

1. **Input HTML content** (paste from website)
   - Parser extracts: title, company, location, salary, url
   - Auto-detects platform (TopCV, Indeed, LinkedIn)

2. **Automatic re-parsing**
   - Updates job details from pasted HTML
   - Recalculates match score against profile
   - Shows matched skills

3. **Enriched data saved**
   - htmlContent: Original HTML
   - enrichedUrl: Updated URL
   - reparsedJob: Parsed job details
   - matchedSkills: Recalculated skills

Note: HTML paste currently uses terminal input. A clipboard-only mode can be added as an alternative later.

### Actions After Enrichment
- **apply-generate**: Auto-generate CV + cover letter
- **apply-custom**: Use custom template
- **apply-edit**: Manual edit before submission
- **mail**: Send job to email
- **queue**: Queue for later review
- **skip**: Discard job

---

## Data Flow

### Input Data Structure
```javascript
// src/db/emails/2026-01/28/raw-emails.jsonl
{
  "timestamp": "2026-01-28T15:18:37.690Z",
  "messageId": "19c0366ab511e4eb",
  "from": "TopCV <toppyai@topcv.vn>",
  "subject": "\"full stack developer\": 10 việc làm mới nhất phù hợp với bạn"
}

// src/db/emails/2026-01/28/{messageId}.body.txt
// Raw HTML email body with job listings
```

### Processed Output
```javascript
// src/db/emails/2026-01/28/filtered-jobs.json
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
      "subject": "\"full stack developer\": 10 việc làm mới nhất phù hợp với bạn",
      "platform": "topcv",
      "title": "Software Developer For Broadband Devices",
      "company": "MARUSYS VINA CO.,LTD",
      "location": "Hà Nội",
      "salary": "Từ 8 triệu",
      "url": "https://...",
      "filtered": false,
      "matchedSkills": []
    }
    // ... 92 more jobs
  ]
}
```

### Action Log
```javascript
// logs/data-testing.jsonl (created after TUI actions)
{
  "timestamp": "2026-02-04T14:30:00.000Z",
  "mode": "data-testing",
  "messageId": "19c0366ab511e4eb",
  "action": "apply-generate",
  "company": "MARUSYS VINA CO.,LTD",
  "position": "Software Developer For Broadband Devices",
  "url": "https://...",
  "enrichedUrl": "https://direct-url-from-paste",  // From HTML paste
  "notes": "Good fit for stack",                    // User notes
  "tags": ["backend", "junior"],                    // User tags
  "matchScore": 3
}
```

---

## Features

✅ **Database-Driven**: All jobs pre-fetched and cached locally
✅ **Offline Mode**: Works without Gmail API during testing
✅ **HTML Enrichment**: Paste website HTML to extract job details
✅ **Auto-Scoring**: Match score recalculated on enrichment
✅ **Action Logging**: All decisions saved to `logs/data-testing.jsonl`
✅ **Constraint Filtering**: Junior-level, skill, salary filtering
✅ **Multi-Platform**: TopCV, Indeed, LinkedIn parsing

---

## Example Workflow

```bash
# Step 1: Check database
ls -la src/db/emails/2026-01/28/

# Step 2: Start TUI
npm run data-testing

# Step 3: For each job shown:
#   1. Press [p] to paste HTML from job website
#   2. Paste HTML content, press [Enter]
#   3. TUI shows updated job details + new match score
#   4. Press [a] to choose apply method, or [m] for mail
#   5. Press [Enter] to confirm
#   6. Next job appears automatically

# Step 4: Review actions
cat logs/data-testing.jsonl | head -20
```

---

## Configuration

### Environment Variables
```bash
# Enable/disable TUI
FEATURE_TUI=true

# Data source (for data-testing mode)
DATA_SOURCE_TYPE=db
DATA_SOURCE_DB_PATH=src/db/emails
DATA_SOURCE_BATCH_SIZE=10

# Operational mode
OPERATIONAL_MODE=data-testing
```

### Default Batch Size
`DATA_SOURCE_BATCH_SIZE=10` processes first 10 emails per date

### Disable TUI (headless mode)
```bash
FEATURE_TUI=false npm run data-testing
```

---

## Next Steps

After testing with data-testing pipeline:

1. **Move to Pipeline 2** (Gmail webhook + live data)
   ```bash
   npm run data-listening
   ```

2. **Deploy to production**
   - Set `OPERATIONAL_MODE=data-listening`
   - Configure Gmail Pub/Sub webhook
   - Jobs arrive in real-time with TUI enrichment

---

## Troubleshooting

**❌ No TUI window appears**
- Check: `FEATURE_TUI=true` in config
- Check: stdin/stdout are not redirected
- Logs will show which jobs were processed

**❌ "No jobs to display"**
- Run: `DATE=2026-01-28 npm run analyze:raw-emails`
- Check: `src/db/emails/2026-01/28/filtered-jobs.json` exists
- Check: Profile constraints are not too strict

**❌ HTML paste not working**
- Paste full HTML from browser (right-click → "View Page Source")
- Platform must be detected: TopCV, Indeed, or LinkedIn
- If parsing fails, show logs: `npm run analyze:raw-emails`

---

## Code Reference

- TUI Component: [src/ui/JobPopup.tsx](src/ui/JobPopup.tsx)
- CLI: [src/cli/data-testing.ts](src/cli/data-testing.ts)
- Parser: [src/services/html-parser.ts](src/services/html-parser.ts)
- Constraints: [src/services/constraints.ts](src/services/constraints.ts)
- Config: [src/config.ts](src/config.ts)
