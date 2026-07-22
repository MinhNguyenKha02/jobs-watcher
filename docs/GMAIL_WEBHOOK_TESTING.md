# Gmail Fetch & Webhook Testing Guide

## Problem Statement

The `eval-fetch-and-trigger.sh` script fails because:
1. Gmail OAuth token (`token.json`) doesn't exist - authentication fails
2. Gmail credentials may be expired (from 2023)
3. Environment variables not properly passed to inline node scripts
4. Incorrect WEBHOOK_URL default (`http://127.0.0.1:PORT/webhook` is malformed)

## Solution Overview

Two approaches available:

### **Approach A: Real Gmail (If Credentials Valid)**
- Fix the shell script to properly pass environment variables ✅ **FIXED**
- Run `npm run auth` to generate `token.json` via OAuth
- Then use `eval-fetch-and-trigger.sh`

### **Approach B: Mock Data Generator (Recommended for Testing)**
- No Gmail authentication required
- Uses synthetic job postings with realistic HTML
- POSTs directly to webhook endpoint
- ✅ **Implemented and ready**

## Prerequisites

### For Both Approaches
1. **MongoDB running** at `MONGODB_URI` (default: `mongodb://127.0.0.1:27017`)
2. **Webhook server running** (via `npm start` or similar)
   - Listens on `WEBHOOK_PORT` (default: 3000)
   - Expects POST to `WEBHOOK_PATH` (default: `/webhook/gmail`)
3. **Node.js 18+** with npm/pnpm

---

## Approach A: Real Gmail Authentication

### Step 1: Get Gmail Credentials

If not already done:
1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a new project or select existing
3. Enable Gmail API
4. Create OAuth 2.0 credentials (Desktop app)
5. Download as `credentials.json`
6. Place at project root: `/home/minh-nguyen/node_projects/jobs-watcher/credentials.json`

### Step 2: Authenticate

```bash
cd /home/minh-nguyen/node_projects/jobs-watcher

# Generate OAuth token (opens browser for approval)
npm run auth

# This creates: token.json
# Verify it exists:
ls -la token.json
```

### Step 3: Start Webhook Server

```bash
npm start  # Default: listens on port 3000
```

### Step 4: Run Fixed Script

```bash
# Export config first (optional - defaults are in script)
export WEBHOOK_PORT=3000
export WEBHOOK_PATH=/webhook/gmail
export LABEL_NAME="Job-Alerts"  # Must exist in Gmail

# Run the fixed script
bash scripts/eval-fetch-and-trigger.sh 10  # Fetch 10 recent messages
```

**Expected Output:**
```
[eval-fetch-and-trigger] Config:
  FETCH_LIMIT=10
  WEBHOOK_URL=http://127.0.0.1:3000/webhook/gmail
  LABEL_NAME=Job-Alerts
  TMP_MSGIDS=logs/eval-messageids.json

[eval-fetch-and-trigger] Authenticating with Gmail API...
[eval-fetch-and-trigger] Fetching from label: "Job-Alerts"
[eval-fetch-and-trigger] ✅ Saved 3 messageId(s) to logs/eval-messageids.json
[eval-fetch-and-trigger] POSTing messages to webhook...
[eval-fetch-and-trigger] ✅ POST <msgid1> status=200
[eval-fetch-and-trigger] ✅ POST <msgid2> status=200
[eval-fetch-and-trigger] ✅ POST <msgid3> status=200
[eval-fetch-and-trigger] Posted 3/3 messages
```

---

## Approach B: Mock Data Generator (Recommended ⭐)

### Why Use This?
- ✅ No Gmail credentials needed
- ✅ Works immediately
- ✅ Generates 3 realistic job postings with full HTML
- ✅ Perfect for testing webhook ingestion
- ✅ Tests complete flow: webhook → ingestion → MongoDB

### Step 1: Build Project

```bash
npm run build
# OR if using TypeScript:
npx tsc
```

### Step 2: Start Webhook Server

In terminal 1:
```bash
npm start  # Listens on http://localhost:3000
```

Monitor logs to verify server is ready:
```
[job-watcher] Starting application...
[job-watcher] Webhook server running on http://127.0.0.1:3000/webhook/gmail
```

### Step 3: Run Mock Data Generator

In terminal 2:
```bash
cd /home/minh-nguyen/node_projects/jobs-watcher

# Basic usage (posts 3 synthetic jobs)
npx ts-node scripts/mock-data-generator.ts

# Custom webhook URL
npx ts-node scripts/mock-data-generator.ts --webhook-url http://localhost:4000/webhook/gmail

# Custom number of jobs (max 3)
npx ts-node scripts/mock-data-generator.ts --count 1
```

**Expected Output:**
```
🔄 Mock Data Generator
Webhook URL: http://localhost:3000/webhook/gmail
Generating and POSTing 3 synthetic job(s)...

✅ Posted job synthetic-job-1708123456789-1 - status 200
✅ Posted job synthetic-job-1708123456789-2 - status 200
✅ Posted job synthetic-job-1708123456789-3 - status 200

📊 Results: 3/3 jobs posted successfully

✅ All jobs posted! Webhook should have created job_queue entries.
📝 Check MongoDB:
   db.job_queue.find().pretty()
```

### Step 4: Verify Jobs Ingested

```bash
# In MongoDB client/shell:
mongo mongodb://127.0.0.1:27017/jobs_watcher

> db.job_queue.find().pretty()
{
  "_id": ObjectId(...),
  "messageId": "synthetic-job-1708123456789-1",
  "title": "Senior Backend Engineer",
  "company": "TechCorp Inc.",
  "location": "San Francisco, CA",
  "salary": "$120,000 - $150,000 per year",
  "platform": "webhook-ingress",
  "generated": ISODate("2025-04-08T..."),
  ...
}
```

---

## Synthetic Jobs Included

The mock generator creates 3 diverse jobs:

### 1. **Senior Backend Engineer @ TechCorp Inc.**
- Location: San Francisco, CA (Remote)
- Salary: $120k-$150k
- Tech stack: TypeScript, Node.js, PostgreSQL, Redis
- Level: Senior (5+ years)

### 2. **Full Stack Developer @ StartupAI Inc.**
- Location: New York, NY (Hybrid)
- Salary: $100k-$130k + equity
- Tech stack: React, Flask, Python, Data pipeline
- Level: Mid-level (3+ years)
- Series A startup (just raised $5M)

### 3. **DevOps Engineer @ ScaleCorp Systems**
- Location: Austin, TX (Remote-first)
- Salary: $140k-$180k
- Tech stack: Kubernetes, Terraform, AWS/GCP/Azure
- Level: Senior (6+ years)

Each includes realistic HTML with full job description, requirements, benefits, etc.

---

## Webhook Endpoint Details

### Expected Format

The webhook accepts multiple payload formats:

### **Format 1: Direct with messageId** (Used by Mock Generator)
```json
{
  "messageId": "synthetic-job-...",
  "threadId": "thread-...",
  "subject": "Job Title @ Company",
  "from": "jobs@company.com",
  "snippet": "Brief description",
  "body": "<html>...full job posting HTML...</html>"
}
```

### **Format 2: Pub/Sub Envelope** (Used by Real Gmail)
```json
{
  "message": {
    "data": "base64-encoded-json"
  }
}
```

### **Response**
- **Success**: Status 200 with `OK`
- **Error**: Status 400-500 with error JSON

---

## Troubleshooting

### Issue: "Cannot find module 'dist/src/services/gmail.js'"
**Solution:** Build the project first
```bash
npm run build
```

### Issue: "Gmail API Error: Label not found"
**Solution for Real Gmail:**
- The label `GMAIL_LABEL_NAME` must exist in Gmail account
- Create manually in Gmail or change to existing label
- Check `.env` for correct label name

### Issue: "ECONNREFUSED 127.0.0.1:3000"
**Solution:** Start webhook server first
```bash
npm start  # Terminal 1
npx ts-node scripts/mock-data-generator.ts  # Terminal 2 (after server ready)
```

### Issue: "MongoDB connection timeout"
**Solution:** Start MongoDB
```bash
# System MongoDB
sudo systemctl start mongod

# OR Docker (if preferred)
docker run -d -p 27017:27017 mongo
```

### Issue: Jobs appear in queue but don't parse
**Solution:** Check webhook logs
```bash
tail -f logs/*.log | grep -i "parse\|error\|webhook"
```

---

## Part 1 Manual Testing Checklist

Use either Approach A or B to complete:

- [ ] **Mock Data Posted**
  - [ ] 3 synthetic jobs POSTed to webhook
  - [ ] Received 200 OK responses

- [ ] **Jobs in MongoDB**
  ```bash
  mongo mongodb://127.0.0.1:27017/jobs_watcher
  > db.job_queue.find().count()  # Should be ≥ 3
  ```

- [ ] **Webhook Ingestion Verified**
  - [ ] Check webhook server logs: no errors
  - [ ] `logs/webhook-messageids.jsonl` contains entries
  - [ ] Each job has `generated` timestamp

- [ ] **TUI Display** (if running enhanced-tui)
  - [ ] Jobs appear in TUI job queue
  - [ ] Titles and companies match synthetic data
  - [ ] Can navigate with arrow keys

- [ ] **Action Test** (optional)
  - [ ] Press `q` to queue a job
  - [ ] Verify `job_queue` → `queued` state in MongoDB
  - [ ] Check `action_snapshots` for 'queue' action

---

## Configuration Reference

**Environment Variables:**

| Variable | Default | Description |
|----------|---------|-------------|
| `WEBHOOK_PORT` | `3000` | Port webhook server listens on |
| `WEBHOOK_PATH` | `/webhook/gmail` | POST endpoint path |
| `GMAIL_LABEL_NAME` | `Job-Alerts` | Gmail label to fetch from |
| `MONGODB_URI` | `mongodb://127.0.0.1:27017` | MongoDB connection |
| `MONGODB_DB_NAME` | `jobs_watcher` | Database name |
| `GMAIL_CLIENT_ID` | From .env | OAuth client ID |
| `GMAIL_CLIENT_SECRET` | From .env | OAuth client secret |

**Override in shell:**
```bash
export WEBHOOK_PORT=4000
export WEBHOOK_PATH=/api/jobs/webhook
npx ts-node scripts/mock-data-generator.ts --webhook-url http://localhost:4000/api/jobs/webhook
```

---

## Summary

| Aspect | Approach A (Real Gmail) | Approach B (Mock) |
|--------|------------------------|-------------------|
| **Setup Time** | ~5 minutes (OAuth) | < 1 minute |
| **Credentials** | Required (OAuth) | None |
| **Email Fetch** | Real Gmail API | Synthetic sample data |
| **Use Case** | Production testing | Development/testing |
| **Reliability** | Depends on Gmail API | 100% deterministic |
| **Recommended** | Production validation | Part 1 testing ⭐ |

---

## Next Steps

After successful webhook ingestion:

1. **Test TUI Integration** (Phase 2)
   - Run TUI with SSE connection
   - Verify job.generated events received
   - Test operator actions (queue, route, etc.)

2. **E2E Action Flow** (Phase 3)
   - Queue job via TUI
   - Verify POST to `/internal/action`
   - Check MongoDB action_snapshots

3. **Production Deployment** (Phase 4)
   - Switch to real Gmail via eval-fetch-and-trigger.sh
   - Deploy to systemd service
   - Monitor with data-listening cli

---

**Last Updated:** April 8, 2025
**Status:** ✅ Both approaches ready for testing
