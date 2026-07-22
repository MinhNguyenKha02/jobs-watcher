# Gmail PubSub & Webhook Integration: Key Questions Answered

## Q1: Is the daemon subscribed to Gmail Cloud PubSub?

### Answer: **Conditionally Yes — Environment Dependent**

#### Current Status (Dev)
```bash
# As deployed on 2026-04-13 21:51
Status: NOT using active PubSub subscription
Reason: Environment variables PUBSUB_PROJECT_ID and PUBSUB_SUBSCRIPTION are not set

# Verify:
echo $PUBSUB_PROJECT_ID          # (empty)
echo $PUBSUB_SUBSCRIPTION         # (empty)
```

#### Architecture Capability
```typescript
// From event-webhook.ts initialization logic:

if (env.PUBSUB_PROJECT_ID && env.PUBSUB_SUBSCRIPTION) {
  // Production mode: Subscribe to Cloud PubSub topic
  const subscriber = new PubSub({
    projectId: env.PUBSUB_PROJECT_ID
  }).subscription(env.PUBSUB_SUBSCRIPTION);
  
  subscriber.on('message', (message) => {
    const base64MessageId = Buffer.from(message.data).toString();
    webhook.handleGmailWebhook({ messageId: base64MessageId });
    message.ack();  // Acknowledge to Cloud PubSub
  });
} else {
  // Dev/Testing mode: Use HTTP webhook only
  // Messages received via POST /webhook/gmail (from scripts/eval-fetch-and-trigger.sh)
}
```

#### To Enable PubSub Subscription (Production)

```bash
# 1. Create Google Cloud project
export GOOGLE_PROJECT_ID="jobs-watcher-prod"
gcloud projects create $GOOGLE_PROJECT_ID

# 2. Enable PubSub API
gcloud services enable pubsub.googleapis.com

# 3. Create topic and subscription
gcloud pubsub topics create jobs-watcher-alerts --project=$GOOGLE_PROJECT_ID
gcloud pubsub subscriptions create jobs-watcher-sub \
  --topic=jobs-watcher-alerts \
  --ack-deadline=60 \
  --project=$GOOGLE_PROJECT_ID

# 4. Create service account for daemon
gcloud iam service-accounts create jobs-watcher-daemon \
  --display-name="Jobs Watcher Daemon" \
  --project=$GOOGLE_PROJECT_ID

gcloud projects add-iam-policy-binding $GOOGLE_PROJECT_ID \
  --member=serviceAccount:jobs-watcher-daemon@$GOOGLE_PROJECT_ID.iam.gserviceaccount.com \
  --role=roles/pubsub.subscriber

# 5. Generate key
gcloud iam service-accounts keys create /home/minh-nguyen/.config/jobs-watcher/gcp-key.json \
  --iam-account=jobs-watcher-daemon@$GOOGLE_PROJECT_ID.iam.gserviceaccount.com

# 6. Update daemon environment
echo "PUBSUB_PROJECT_ID=$GOOGLE_PROJECT_ID" >> /etc/jobs-watcher/env
echo "PUBSUB_SUBSCRIPTION=jobs-watcher-sub" >> /etc/jobs-watcher/env
export GOOGLE_APPLICATION_CREDENTIALS="/home/minh-nguyen/.config/jobs-watcher/gcp-key.json"

# 7. Restart daemon
sudo systemctl restart jobs-watcher
```

#### Verification

```bash
# Check if PubSub listener is active
sudo journalctl -u jobs-watcher | grep -i "pubsub\|subscription\|listening"

# Expected output if enabled:
# [INFO] Subscribing to PubSub topic: jobs-watcher-alerts
# [INFO] PubSub subscription listener started
```

---

## Q2: What does eval-fetch-and-trigger.sh actually do?

### Answer: **Manually Fetches & Routes Gmail Messages (Testing Only)**

#### Purpose
Simulate Gmail→PubSub flow without requiring Cloud PubSub infrastructure. Used for local development and CI/E2E testing.

#### Process Flow

```
Step 1: Authenticate to Gmail API
  └─ Reads credentials from dist/src/stored/gmail-credentials.json
     (OAuth2 token + refresh token obtained from initial login)

Step 2: Fetch Message IDs
  └─ Query Gmail API: GET https://gmail.googleapis.com/gmail/v1/users/me/messages
     Filter: label:Job-Alerts (configurable)
     Limit: $1 argument or fetch all new messages
  
  └─ Example response:
     {
       "messages": [
         { "id": "1a2b3c4d...", "threadId": "5e6f7g8h..." },
         { "id": "9i0j1k2l...", "threadId": "3m4n5o6p..." }
       ]
     }

Step 3: Route to Daemon (Loop)
  └─ For each messageId:
     POST http://localhost:3000/webhook/gmail
     Headers: Content-Type: application/json
     Payload: { "messageId": "1a2b3c4d..." }
     
  └─ Retry logic: 3 attempts with exponential backoff (1s → 2s → 4s)

Step 4: Wait for Processing
  └─ Check job_queue MongoDB collection for new entry
     Timeout: 10 seconds per message
     Verification: count(job_queue) should increase
```

#### Script Location & Usage

```bash
# Location
cat scripts/eval-fetch-and-trigger.sh

# Usage patterns
bash scripts/eval-fetch-and-trigger.sh              # Fetch all new messages
bash scripts/eval-fetch-and-trigger.sh 1            # Fetch 1 message
bash scripts/eval-fetch-and-trigger.sh 10           # Fetch 10 messages

# Example with error handling
set -e  # Exit on error
bash scripts/eval-fetch-and-trigger.sh 3
echo "✓ Triggered 3 test emails"

# In CI/E2E pipeline
bash scripts/eval-fetch-and-trigger.sh 5 \
  && sleep 2 \
  && mongosh jobs_watcher --eval "db.job_queue.find().count()"
```

#### Real-World Example

```bash
# Terminal 1: Start daemon
sudo systemctl start jobs-watcher
journalctl -u jobs-watcher -f

# Terminal 2: Start TUI in tmux
bash scripts/tmux-tui-setup.sh

# Terminal 3: Trigger test emails
bash scripts/eval-fetch-and-trigger.sh 3

# Expected sequence (in daemon logs):
# 2026-04-13 14:50:30 POST /webhook/gmail received, messageId=gmail-1a2b3c4d
# 2026-04-13 14:50:31 Fetching message content from Gmail API
# 2026-04-13 14:50:32 Parsing HTML job listing (3 jobs detected)
# 2026-04-13 14:50:33 Signal 1 emitted: job_generated (messageId=gmail-1a2b3c4d, score=87)
# 2026-04-13 14:50:33 Storing action snapshot: Signal 1
# 2026-04-13 14:50:34 (TUI receives signal → renders job in queue)

# Additional 2 messages follow same flow
```

#### Key Differences from Cloud PubSub

| Aspect | Cloud PubSub | eval-fetch-and-trigger.sh |
|--------|--------------|---------------------------|
| **Trigger** | Automatic (Gmail pushes notification) | Manual script execution |
| **Latency** | Near-real-time (seconds) | Depends on script schedule |
| **Infrastructure** | Google Cloud PubSub topic + subscription | Local HTTP calls |
| **Scalability** | Production-grade (millions/month) | Single machine testing |
| **Cost** | PubSub pricing ($0.05/million ops) | Free (Gmail API quota) |
| **Typical Use** | Production 24/7 | Dev/CI testing |
| **Reliability** | Message ACK/NACK handling | No durability guarantees |

#### Credentials & Setup

```bash
# First-time setup: Authenticate to Gmail
node scripts/setup-gmail-auth.js
# Opens browser → OAuth2 consent → Stores token in dist/src/stored/gmail-credentials.json

# Verify credentials
cat dist/src/stored/gmail-credentials.json | jq '.access_token' | head -c 20

# Refresh token (automatic if expired)
# The script handles refresh automatically if token is >1 hour old
```

---

## Q3: What's the message format?

### Answer: **format depends on source and processing stage**

#### Format 1: eval-fetch-and-trigger.sh → Webhook Endpoint

```json
{
  "messageId": "1a2b3c4d..."
}
```

**Processing:**
```
POST /webhook/gmail
Headers: { "Content-Type": "application/json" }

Daemon reads messageId → Fetches full Gmail message via Gmail API
→ Extracts HTML body → Continues to Format 2 (below)
```

**Example:**
```bash
curl -X POST http://localhost:3000/webhook/gmail \
  -H 'Content-Type: application/json' \
  -d '{"messageId": "1a2b3c4d..."}' -v
```

---

#### Format 2: Cloud PubSub Topic → Daemon Subscription

```json
{
  "message": {
    "data": "base64-encoded-messageId-here",
    "attributes": {
      "timestamp": "2026-04-13T14:50:30Z"
    }
  },
  "subscription": "projects/jobs-watcher/subscriptions/jobs-watcher-sub"
}
```

**Decoding:**
```javascript
// Daemon PubSub listener
const base64Data = message.data;
const messageId = Buffer.from(base64Data, 'base64').toString('utf-8');
// messageId = "1a2b3c4d..."
// Then same as Format 1: Fetch from Gmail API
```

**Example in code (src/services/event-webhook.ts):**
```typescript
subscriber.on('message', (message) => {
  try {
    const decodedData = Buffer.from(message.data, 'base64').toString('utf-8');
    const { messageId } = JSON.parse(decodedData);
    
    handleGmailWebhook({ messageId });
    message.ack();  // Tell PubSub: "processed successfully"
  } catch (error) {
    message.nack();  // Tell PubSub: "requeue this message"
  }
});
```

---

#### Format 3: /internal/ingest Endpoint (Operator Actions)

**From TUI operator pressing [c] (webhook stage 2 parse):**

```json
{
  "webhook": true,
  "htmlPayload": "<html><body>Email body...</body></html>",
  "messageId": "existing-gmail-id-or-new"
}
```

**From operator pressing [i] (direct clipboard ingest):**

```json
{
  "webhook": false,
  "htmlPayload": "<html><body>Clipboard HTML...</body></html>"
}
```

**Response (daemon generates):**

```json
{
  "messageId": "clip-a1b2c3d4-e5f6g7h8",
  "status": "processing",
  "signalEmitted": 1
}
```

**Code reference (src/ui/action-controller.ts):**

```typescript
// Press [c] for webhook stage 2
const payload = {
  webhook: true,
  messageId: this.state.currentJob.messageId,
  htmlPayload: clipboardContent
};
const response = await this.udsWriter.post('/internal/ingest', payload);

// Press [i] for direct ingest
const payload = {
  webhook: false,
  htmlPayload: clipboardContent
  // daemon auto-generates messageId: clip-XXXXX
};
const response = await this.udsWriter.post('/internal/ingest', payload);
```

---

#### Format 4: Signal 1 (Job Generated Event)

```json
{
  "messageId": "1a2b3c4d...",
  "source": "GMAIL_WEBHOOK",
  "createdAt": "2026-04-13T14:50:30Z",
  "updatedAt": "2026-04-13T14:50:32Z",
  "currentScore": 87,
  "stage": "PARTIAL",
  "job": {
    "company": "Acme Corp",
    "position": "Senior DevOps Engineer",
    "salary": "$150k-180k",
    "location": "San Francisco, CA",
    "url": "https://careers.acme.com/jobs/xxx",
    "skills": ["Kubernetes", "CI/CD", "AWS"],
    "description": "We're looking for an experienced DevOps engineer..."
  },
  "signals": {
    "1_job_generated": {
      "timestamp": "2026-04-13T14:50:32Z",
      "triggered": true
    }
  }
}
```

**Emitted by:** EmailParser.parse() → JobScorer.score()
**Stored in:** MongoDB `job_queue` collection
**Visible in:** TUI (first render of job)

---

#### Format 5: Signal 2 (Job Parsed Event)

```json
{
  "...": "... all from Signal 1",
  "stage": "FULL_PARSED",
  "job": {
    "...": "... Signal 1 fields plus enrichment",
    "requirements": "5+ years production Kubernetes experience...",
    "benefits": "Health insurance, 401k, stock options...",
    "jobType": "Full-time",
    "experienceLevel": "Senior",
    "additionalSkills": ["Terraform", "ArgoCD", "Prometheus"]
  },
  "signals": {
    "1_job_generated": { "timestamp": "...", "triggered": true },
    "2_job_parsed": {
      "timestamp": "2026-04-13T14:50:35Z",
      "triggered": true,
      "score": 87,
      "enrichedFields": 4
    }
  }
}
```

**Triggered by:** Operator pressing [c] → Stage 2 enrichment → SmartGenerator
**Stored in:** MongoDB `action_snapshots` collection
**Updates TUI:** Scrollable preview with full job details

---

#### Format 6: Signal 3 (Job Routed Event)

```json
{
  "...": "... all from Signal 2",
  "decision": "queue",  // or "trash", "skip"
  "decisionTime": "2026-04-13T14:50:40Z",
  "operatorNotes": "Good match for Q2 hiring sprint",
  "editedKVs": {
    "company": "Acme Corp (ACQUIRED)",
    "salary": "$150k-180k (negotiable)"
  },
  "signals": {
    "1_job_generated": { "triggered": true },
    "2_job_parsed": { "triggered": true },
    "3_job_routed": {
      "timestamp": "2026-04-13T14:50:40Z",
      "triggered": true,
      "decision": "queue",
      "editedFieldCount": 2
    }
  }
}
```

**Triggered by:** Operator pressing [j] (queue), [d] (discard), [s] (skip), or [e] → edits → [j]
**Stored in:** 
- MongoDB `job_queue` (if decision=queue)
- MongoDB `job_trash` (if decision=trash or skip)
- MongoDB `action_snapshots` (immutable audit trail)

---

## Message Flow Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│ Input Source                                                      │
├──────────────────────────────────────────────────────────────────┤
│ Option A: eval-fetch-and-trigger.sh  │  Option B: Cloud PubSub  │
│            ↓                          │            ↓              │
│      { messageId }                   │  {message: {data:b64}}   │
└────┬─────────────────────────────────────┬───────────────────────┘
     │ POST /webhook/gmail                │ Subscriber.on('message')
     │ Payload: Format 1                  │ Payload: Format 2
     └────────────┬────────────────────────┘
                  ▼
         ┌────────────────────┐
         │ EventWebhook       │
         │ Validate + Decode  │
         └────────┬───────────┘
                  │ messageId: string
                  ▼
         ┌────────────────────┐
         │ Gmail API Client   │
         │ Fetch message      │
         │ Extract HTML body  │
         └────────┬───────────┘
                  │ htmlBody: string
                  ▼
         ┌────────────────────┐
         │ EmailParser        │
         │ Parse email        │
         │ Extract job data   │
         └────────┬───────────┘
                  │ job: CanonicalJob
                  ▼
         ┌────────────────────┐
         │ JobScorer          │
         │ Calculate score    │
         │ Check filters      │
         └────────┬───────────┘
                  │ score: number
                  ▼
    ┌─────────────────────────────────┐
    │ Signal 1: job_generated          │ ← TUI renders first time
    │ Format 4: PARTIAL stage          │
    │ Stored: signal_snapshots         │
    └─────────────────────────────────┘

    (Operator presses [c] for Stage 2, or [j/d/s/i])
                  │
                ┌─┴─┐
        [c]    ─┘   └─ [j/d/s/i/o/p/e/...]
        │                    │
        ▼                    ▼
    ┌────────────┐      ┌──────────────┐
    │ Signal 2:  │      │ Signal 3:    │
    │ job_parsed │      │ job_routed   │
    │ FULL_PARSE │      │ decision set │
    │ (5-10s)    │      │ job moved    │
    └────────────┘      └──────────────┘
```

---

## Summary Table

| Aspect | Format 1 | Format 2 | Format 3 | Signal 1 | Signal 2 | Signal 3 |
|--------|----------|----------|----------|----------|----------|----------|
| **Source** | eval-fetch | Cloud PubSub | Operator | Daemon | Daemon | Daemon |
| **Minimum Fields** | messageId | message.data (b64) | htmlPayload (webhook flag) | messageId, job, score | + enrichment | + decision |
| **Stage** | Input | Input | Input | PARTIAL | FULL_PARSED | ROUTED |
| **Example** | `{"messageId":"1a2b"}` | `{"message":{"data":"..."}}` | `{"webhook":true, "htmlPayload":"..."}` | [See Format 4] | [See Format 5] | [See Format 6] |
| **Endpoint** | POST /webhook/gmail | PubSub subscription | POST /internal/ingest | MongoDB | MongoDB | MongoDB |
| **Human Visible** | No | No | [i/c keys] | TUI renders | TUI preview | TUI updates |
| **Async** | Yes (10s) | Yes (PubSub) | Yes (5-10s) | Event stream | Event stream | Event stream |

