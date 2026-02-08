# Data Testing Enrichment Flow

## Overview
The `npm run data-testing` script provides an interactive loop for testing job parsing, enrichment, and TUI integration with real database emails.

## Features
- **Auto-open browser**: Automatically opens job URLs in browser (default: enabled)
- **Manual HTML enrichment**: Paste HTML from browser to enrich job metadata
- **Match score recalculation**: Shows before/after match scores based on enriched data
- **Database storage**: Saves enriched jobs to `src/db/emails/YYYY-MM/DD/enriched-jobs.jsonl`

## Workflow

### 1. Start Script
```bash
npm run data-testing                    # Auto-open browser
npm run data-testing:no-browser         # Disable auto-open
```

### 2. Job Processing Loop
For each job in the database:
1. **Display job metadata** from email alert
2. **Auto-open browser** (if enabled) to job URL
3. **TUI interaction** - Choose action:
   - `(o)` Open URL in browser
   - `(p)` Paste HTML for enrichment
   - `(a)` Apply to job
   - `(q)` Queue for later
   - `[Enter]` Confirm current action

### 3. Enrichment Flow
After TUI action, you'll see:
```
   ────────────────────────────────────────────────────────────────────────────
   Next: (p) Paste HTML to enrich | (n) Next job | (s) Skip
   > 
```

**Options:**
- **`p`** - Paste HTML for enrichment:
  1. Copy HTML from browser (Ctrl+A, Ctrl+C)
  2. Paste in terminal (Ctrl+V or right-click)
  3. Press Enter twice when done
  4. View enrichment comparison and match score changes
  5. Job saved to database

- **`n`** - Move to next job without enrichment
- **`s`** - Skip to next job without enrichment
- **`q`** - Queue and move to next job

### 4. Enrichment Output
When you paste HTML, you'll see:
```
   ═══════════════════════════════════════════════════════════════════════════
   ✨ ENRICHMENT PROCESSING
   ═══════════════════════════════════════════════════════════════════════════

   🔍 PARSED FROM BROWSER HTML:
   ────────────────────────────────────────────────────────────────────────────
      Title:        Senior Frontend Developer
      Company:      Zalo
      Location:     Ho Chi Minh City
      Description:  2500 chars

   ✅ FIELD CHANGES:
   ────────────────────────────────────────────────────────────────────────────
      Position:  "Frontend Dev" → "Senior Frontend Developer"
      Description: Added 2500 characters

   📊 MATCH SCORE RECALCULATION:
   ────────────────────────────────────────────────────────────────────────────
      Profile Skills: 25
      Matched Skills: 8
      Found:          react, typescript, javascript, html, css, node.js
      Score Change:   0 → 8

   💾 ENRICHED JOB METADATA:
   ═══════════════════════════════════════════════════════════════════════════
      Position:        Senior Frontend Developer
      Company:         Zalo
      Location:        Ho Chi Minh City
      Platform:        Indeed
      Match Score:     8
      Fields Changed:  2
      Changed Fields:  position, description
   ═══════════════════════════════════════════════════════════════════════════
```

## Database Storage

### Directory Structure
```
src/db/emails/
├── 2026-01/
│   └── 28/
│       ├── 19bf779c30db82c1.body.txt       # Raw email body
│       ├── 19bf7fa0ca23773c.body.txt
│       ├── raw-emails.jsonl                # Email metadata
│       ├── filtered-jobs.json              # Initial parsed jobs
│       └── enriched/                       # Enriched jobs (created on first enrichment)
│           └── jobs.jsonl                  # One enriched job per line
├── 2026-02/
│   └── 04/
│       └── enriched/
│           └── jobs.jsonl
└── ...
```

### Enriched Jobs File
**Location:** `src/db/emails/YYYY-MM/DD/enriched/jobs.jsonl`

Each line is one complete JSON record (JSONL format):
```json
{
  "messageId": "19bf779c30db82c1",
  "timestamp": "2026-02-04T10:30:00.000Z",
  "original": {
    "position": "Frontend Developer",
    "company": "Tech Company",
    "location": "Ho Chi Minh",
    "platform": "Indeed",
    "matchScore": 0
  },
  "enrichedHtml": "<html>...full HTML content from browser...</html>",
  "enriched": {
    "position": "Senior Frontend Developer",
    "company": "Tech Company",
    "location": "District 7, Ho Chi Minh City",
    "description": "Full job description extracted from HTML...",
    "matchScore": 8,
    "fieldsChanged": ["position", "location", "description"]
  },
  "action": "queue"
}

### Review Enriched Jobs
```bash
# View all enriched jobs with pretty formatting
cat src/db/emails/2026-02/04/enriched/jobs.jsonl | jq .

# Count enriched jobs
wc -l src/db/emails/2026-02/04/enriched/jobs.jsonl

# View specific fields (position and match score)
cat src/db/emails/2026-02/04/enriched/jobs.jsonl | jq '{position: .enriched.position, matchScore: .enriched.matchScore}'

# View jobs with field changes
cat src/db/emails/2026-02/04/enriched/jobs.jsonl | jq '{position: .enriched.position, fieldsChanged: .enriched.fieldsChanged}'

# View original vs enriched comparison
cat src/db/emails/2026-02/04/enriched/jobs.jsonl | jq '{original: .original, enriched: .enriched}'

# Filter jobs by action
cat src/db/emails/2026-02/04/enriched/jobs.jsonl | jq 'select(.action == "queue")'

# Filter jobs with score improvement
cat src/db/emails/2026-02/04/enriched/jobs.jsonl | jq 'select(.enriched.matchScore > .original.matchScore)'
```

## Summary Report
At the end of processing:
```
📊 Data Testing Summary:
   Emails processed: 23
   Jobs passed: 15
   Emails filtered: 8
   Jobs enriched: 5

💾 Review enriched jobs at:
   /path/to/src/db/emails/2026-02/04/enriched-jobs.jsonl
```

## Environment Variables
- `AUTO_OPEN_BROWSER` - Auto-open URLs in browser (default: `true`)
- `OPERATIONAL_MODE` - Must be `data-testing`
- `DATA_SOURCE_TYPE` - Must be `db`

## Use Cases

### 1. Quick Testing (No Enrichment)
```bash
npm run data-testing
# For each job: press 'n' to skip enrichment and move to next
```

### 2. Full Enrichment Testing
```bash
npm run data-testing
# For each job: 
# 1. Review job in TUI
# 2. Press 'p' to paste HTML
# 3. Copy HTML from browser
# 4. Paste in terminal
# 5. Press Enter twice
# 6. Review enrichment comparison
```

### 3. Selective Enrichment
```bash
npm run data-testing
# For interesting jobs: press 'p' to enrich
# For others: press 'n' to skip
```

## Tips
- Keep browser and terminal side-by-side for easy copy/paste
- Use Ctrl+C to exit at any time
- Enriched records persist across runs (appends to JSONL file)
- Use `jq` for JSON parsing and filtering enriched records
- Set `AUTO_OPEN_BROWSER=false` if you prefer manual URL opening
