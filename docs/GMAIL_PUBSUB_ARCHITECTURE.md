# Gmail PubSub & Webhook Architecture

## Overview

The jobs-watcher daemon supports two modes of receiving Gmail job alerts:

1. **Cloud PubSub Mode** (Recommended for production) - Real-time via Google Cloud PubSub subscription
2. **Webhook Mode** (Manual testing) - Direct HTTP webhook from daemon to Gmail API

Both modes converge on the same internal processing pipeline.

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                         EMAIL SOURCES                               │
└─────────────────────────────────────────────────────────────────────┘
                                 │
                    ┌────────────┼────────────┐
                    │            │            │
                    ▼            ▼            ▼
        ┌──────────────────┐ ┌──────────────┐ ┌─────────────┐
        │ Gmail Mailbox    │ │ Cloud PubSub │ │ Manual CLI  │
        │ (Job-Alerts)     │ │ Topic        │ │ (Testing)   │
        └──────────────────┘ └──────────────┘ └─────────────┘
                    │                 │               │
                    └────────────┬────┴───────┬───────┘
                                 │            │
                        ┌────────▼───────────▼─────────┐
                        │  Daemon Webhook Server       │
                        │  (Event-driven-webhook.ts)   │
                        │  POST /webhook/gmail         │
                        │  POST /internal/ingest       │
                        └────────┬────────────┬────────┘
                                 │            │
                        ┌────────▼───────────▼─────────┐
                        │  GmailWebhookAdapter         │
                        │  - Validate message          │
                        │  - Extract messageId         │
                        │  - Fetch Gmail content       │
                        │  - Parse HTML job listing    │
                        └────────┬────────────┬────────┘
                                 │            │
                        ┌────────▼───────────▼─────────┐
                        │  EmailParser                 │
                        │  - Extract job fields        │
                        │  - Validate schema           │
                        │  - Generate messageId        │
                        └────────┬────────────┬────────┘
                                 │            │
                        ┌────────▼───────────▼─────────┐
                        │  JobScorer                   │
                        │  - Calculate match score     │
                        │  - Filter if enabled         │
                        │  - Emit Signal 1             │
                        └────────┬────────────┬────────┘
                                 │            │
                        ┌────────▼───────────▼─────────┐
                        │  Stage 2: Enrichment (Opt)   │
                        │  - SmartGenerator            │
                        │  - Additional parsing        │
                        │  - Emit Signal 2             │
                        └────────┬────────────┬────────┘
                                 │            │
        ┌────────────────────────┴───────────┴──────────────────────┐
        │                  Action Router (Operator Decision)        │
        │  Signal 3: [j]ueue [d]iscard [s]kip [e]dit [p]review   │
        └────────────────────────┬───────────┬──────────────────────┘
                                 │           │
                    ┌────────────┴─┐   ┌─────┴───────────┐
                    ▼              ▼   ▼                 ▼
            ┌────────────────┐ ┌─────────────┐ ┌──────────────┐
            │  job_queue     │ │  job_trash  │ │  (operator   │
            │  (MongoDB)     │ │  (MongoDB)  │ │   can refine)│
            └────────────────┘ └─────────────┘ └──────────────┘
```

---

## Production Flow: Cloud PubSub

```
Gmail Account
  ├─ Email arrives with label "Job-Alerts"
  │
  └─ Cloud PubSub Topic notifies
     └─ Daemon subscribed to PubSub topic receives message
        └─ Message format: 
           {
             "message": {
               "data": "base64-encoded-messageId",
               "publishTime": "2026-04-13T...",
               "messageId": "12345..."
             }
           }
        
        └─ GmailWebhookAdapter.handlePubSubMessage()
           ├─ Decode base64 messageId
           ├─ Call Gmail API to fetch message
           ├─ Extract HTML body
           └─ EmailParser processes → Signal 1 emitted
              └─ Job appears in TUI
```

### Deployment Steps (Production)

```bash
# 1. Set up Google Cloud project
gcloud projects create jobs-watcher --name "Jobs Watcher"

# 2. Enable APIs
gcloud services enable gmail.googleapis.com
gcloud services enable pubsub.googleapis.com

# 3. Create PubSub topic & subscription
gcloud pubsub topics create jobs-watcher-alerts
gcloud pubsub subscriptions create jobs-watcher-sub \
  --topic=jobs-watcher-alerts \
  --ack-deadline=60

# 4. Configure Gmail to forward to PubSub (via Cloud Workflows or webhook)
# This typically involves a Cloud Function that receives Gmail push notifications

# 5. Set environment variables
export PUBSUB_PROJECT_ID="jobs-watcher"
export PUBSUB_SUBSCRIPTION="jobs-watcher-sub"
export GMAIL_CLIENT_ID="xxx.apps.googleusercontent.com"
export GMAIL_CLIENT_SECRET="xxx"
export INTERNAL_AUTH_TOKEN="temp-dev-token"  # Change in prod!

# 6. Start daemon
systemctl start jobs-watcher
```

---

## Manual Testing Flow: eval-fetch-and-trigger.sh

**For testing without PubSub setup:**

```bash
# Script location: scripts/eval-fetch-and-trigger.sh

# Process:
# 1. Uses Gmail API (via OAuth2 credentials) to fetch messageIds
#    from the "Job-Alerts" label
# 2. For each messageId:
#    POST http://localhost:3000/webhook/gmail
#    Payload: { "messageId": "1a2b3c4d..." }
# 3. Daemon receives webhook
# 4. GmailWebhookAdapter validates + processes
# 5. Signal 1 emitted → Job appears in TUI

# Usage:
bash scripts/eval-fetch-and-trigger.sh 1      # Fetch 1 message
bash scripts/eval-fetch-and-trigger.sh 5      # Fetch 5 messages
bash scripts/eval-fetch-and-trigger.sh         # Fetch all new messages
```

### Example Command Flow

```bash
# Terminal 1: Start TUI
bash scripts/tmux-tui-setup.sh

# Terminal 2: Trigger 3 test emails
bash scripts/eval-fetch-and-trigger.sh 3

# Expected:
# - 3 jobs appear in TUI sequentially
# - Each triggers Signal 1
# - Operator can route via [j/d/s/e/p/o/c/i]
```

---

## Internal Message Format

### Signal 1: Job Generated (PARTIAL)

```json
{
  "messageId": "gmail-msg-1a2b3c4d",
  "source": "GMAIL_WEBHOOK",
  "job": {
    "company": "Acme Corp",
    "position": "Senior DevOps Engineer",
    "salary": "$150k-180k",
    "location": "San Francisco, CA",
    "url": "https://careers.acme.com/jobs/xxx",
    "skills": ["Kubernetes", "CI/CD", "AWS"],
    "description": "We're looking for..."
  },
  "currentScore": 87,
  "stage": "PARTIAL",
  "signals": {
    "1_job_generated": {
      "timestamp": "2026-04-13T14:50:32Z",
      "triggered": true
    }
  },
  "createdAt": "2026-04-13T14:50:30Z",
  "updatedAt": "2026-04-13T14:50:32Z"
}
```

### Signal 2: Job Parsed (FULL_PARSED)

```json
{
  "messageId": "gmail-msg-1a2b3c4d",
  "...": "... (inherited from Signal 1)",
  "job": {
    "...": "... (all from Signal 1, plus enrichment)",
    "requirements": "5+ years...",
    "benefits": "Health insurance...",
    "jobType": "Full-time",
    "experienceLevel": "Senior"
  },
  "stage": "FULL_PARSED",
  "signals": {
    "1_job_generated": { "timestamp": "...", "triggered": true },
    "2_job_parsed": {
      "timestamp": "2026-04-13T14:50:35Z",
      "triggered": true,
      "score": 87
    }
  }
}
```

### Signal 3: Job Routed (Decision)

```json
{
  "messageId": "gmail-msg-1a2b3c4d",
  "...": "... (inherited)",
  "decision": "queue",           // or "trash", "skip"
  "decisionTime": "2026-04-13T14:50:40Z",
  "operatorNotes": "Good match for Q2 hiring",
  "editedKVs": {
    "company": "Acme Corp (Re-branded)",
    "skills": ["Kubernetes", "CI/CD", "AWS", "Terraform"]
  },
  "stage": "ROUTED",
  "signals": {
    "1_job_generated": { "triggered": true },
    "2_job_parsed": { "triggered": true },
    "3_job_routed": {
      "timestamp": "2026-04-13T14:50:40Z",
      "triggered": true,
      "decision": "queue"
    }
  }
}
```

---

## File References

### Core Implementations

| File | Purpose |
|------|---------|
| [src/services/event-webhook.ts](../../src/services/event-webhook.ts) | HTTP server for /webhook/gmail endpoint |
| [src/cli/email-source-adapter.ts](../../src/cli/email-source-adapter.ts) | GmailWebhookAdapter: webhook message handler |
| [src/services/gmail.ts](../../src/services/gmail.js) | Gmail API client (authentication, message fetch) |
| [src/services/job-extraction.ts](../../src/services/job-extraction.js) | JobExtractionService: HTML → CanonicalJob |
| [src/services/scoring/score-matcher.ts](../../src/services/scoring/score-matcher.ts) | JobScorer: calculate match score |
| [src/cli/parsers/email-parser.ts](../../src/cli/parsers/email-parser.js) | EmailParser: parse email headers & body |

### TUI Integration

| File | Purpose |
|------|---------|
| [src/ui/action-controller.ts](../../src/ui/action-controller.ts) | Keyboard handler for TUI operator actions |
| [scripts/tmux-tui-setup.sh](../../scripts/tmux-tui-setup.sh) | Launch TUI with tmux panes |
| [scripts/eval-fetch-and-trigger.sh](../../scripts/eval-fetch-and-trigger.sh) | Manual webhook trigger for testing |

### MongoDB Schema

| Collection | Purpose |
|------------|---------|
| `jobs` | Current job data (stages 1→3) |
| `job_queue` | Jobs queued by operator |
| `job_trash` | Jobs discarded by operator |
| `action_snapshots` | Immutable record of operator actions |
| `raw_ingests` | Raw email/HTML source documents |

---

## Configuration

### Environment Variables

```bash
# Gmail API
GMAIL_CLIENT_ID="xxx.apps.googleusercontent.com"
GMAIL_CLIENT_SECRET="xxx"
GMAIL_REDIRECT_URI="http://localhost:8000/auth/callback"
GMAIL_LABEL_FILTER="Job-Alerts"

# Cloud PubSub (optional)
PUBSUB_PROJECT_ID="jobs-watcher"
PUBSUB_SUBSCRIPTION="jobs-watcher-sub"
PUBSUB_EMULATOR_HOST="localhost:8085"  # For local testing

# MongoDB
MONGODB_URI="mongodb://127.0.0.1:27017"
MONGODB_DB="jobs_watcher"

# Security
INTERNAL_AUTH_TOKEN="temp-dev-token"
UDS_SOCKET_PATH="/run/jobs-watcher/ingest.sock"

# Webhook Server
WEBHOOK_PORT=3000
WEBHOOK_HOST="localhost"

# TUI
PREFERRED_EDITOR="nano"  # or nvim, vim
UDS_TOKEN="temp-dev-token"
```

### Daemon Service File

```ini
# /etc/systemd/system/jobs-watcher.service

[Unit]
Description=Jobs Watcher webhook + worker
After=network.target mongodb.service

[Service]
Type=simple
User=minh-nguyen
WorkingDirectory=/home/minh-nguyen/node_projects/jobs-watcher
Environment="NODE_ENV=production"
Environment="INTERNAL_AUTH_TOKEN=temp-dev-token"
ExecStart=/home/minh-nguyen/.nvm/versions/node/v22.12.0/bin/node /home/minh-nguyen/node_projects/jobs-watcher/dist/src/index.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

---

## Troubleshooting

### Webhook Not Receiving Requests

**Symptom:** scripts/eval-fetch-and-trigger.sh runs but nothing appears in TUI

**Debug:**
```bash
# 1. Check daemon is listening
curl -X POST http://localhost:3000/webhook/gmail \
  -H 'Content-Type: application/json' \
  -d '{"messageId": "test-123"}' \
  -v

# 2. Check daemon logs
sudo journalctl -u jobs-watcher -n 50 --follow

# 3. Check Gmail credentials
cat ~/.config/jobs-watcher/gmail-credentials.json | jq .

# 4. Test Gmail API directly
node -e "
  const gmail = require('./dist/src/services/gmail.js');
  gmail.GmailService.getInstance().listMessages('label:Job-Alerts', 5)
    .then(r => console.log(r))
    .catch(e => console.error(e))
"
```

### Signal 2 Not Emitted After [c]

**Symptom:** Pressing [c] in TUI but job doesn't reach FULL_PARSED stage

**Debug:**
```bash
# 1. Check UDS socket
ls -la /run/jobs-watcher/ingest.sock

# 2. Check for parse errors
sudo journalctl -u jobs-watcher | grep -i "parse\|error\|fail"

# 3. Test ingest endpoint manually
curl -X POST http://localhost:3000/internal/ingest \
  -H 'Content-Type: application/json' \
  -H 'x-internal-token: temp-dev-token' \
  -d '{"htmlPayload": "<html>Job HTML</html>"}' \
  -v

# 4. Check clipboard manually
xclip -o -selection clipboard | head -100
```

### PubSub Subscription Not Receiving

**Symptom:** Cloud PubSub configured but daemon not receiving messages

**Debug:**
```bash
# 1. Check subscription exists
gcloud pubsub subscriptions list

# 2. Check subscription has messages
gcloud pubsub subscriptions pull \
  projects/jobs-watcher/subscriptions/jobs-watcher-sub \
  --limit=10 \
  --auto-ack

# 3. Check daemon PubSub listener
sudo journalctl -u jobs-watcher | grep -i "pubsub\|subscription"

# 4. Create test message manually
gcloud pubsub topics publish jobs-watcher-alerts \
  --message="base64-encoded-messageId-here"
```

---

## Production Checklist

- [ ] Gmail API credentials securely stored (not in git)
- [ ] PubSub topic and subscription created
- [ ] Cloud Function or webhook pipeline configured for Gmail→PubSub
- [ ] INTERNAL_AUTH_TOKEN changed from default
- [ ] MongoDB replica set configured for transactions
- [ ] SSL/TLS certificates for webhook endpoint (if external)
- [ ] Monitoring/alerting set up for service health
- [ ] Backup strategy for MongoDB jobs_watcher database
- [ ] Log aggregation configured (e.g., Stackdriver, ELK)
- [ ] Rate limiting configured for webhook endpoint
- [ ] CORS headers configured if needed
