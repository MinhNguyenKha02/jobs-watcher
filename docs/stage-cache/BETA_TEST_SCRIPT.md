# MongoDB Integration Beta Test Script

This document provides step-by-step instructions to verify the MongoDB storage integration works end-to-end.

## Prerequisites

- ✅ MongoDB running locally on `localhost:27017`
- ✅ `.env` configured with `MONGODB_URI=mongodb://localhost:27017` and `MONGODB_DB_NAME=jobs_watcher`
- ✅ TypeScript compilation complete (no errors)
- ✅ npm dependencies installed

## Test Steps

### 1. Start MongoDB Monitoring (Terminal 1)

```bash
mongosh
use jobs_watcher
# Keep this terminal open to watch data in real-time
```

### 2. Start Data Listening Service (Terminal 2)

```bash
cd /home/minh-nguyen/node_projects/jobs-watcher
npm run data-listening
```

**Expected Output (example):**
```
[jobs-watcher] ℹ️  INFO: 📋 Data Listening Service
[jobs-watcher] ℹ️  INFO: ✅ MongoDB storage connected
[jobs-watcher] ℹ️  INFO: 🚀 Starting Gmail data-listening adapter...
Listening on http://127.0.0.1:3000/webhook/gmail for Gmail webhook events
Listening on stdin for TUI input
```

### 3. Send Test Email (Terminal 3)

```bash
cd /home/minh-nguyen/node_projects/jobs-watcher
SEND_REAL_EMAIL=true npm run simulate-webhook
```

**Expected Behavior:**
- Service sends email via Gmail API
- Webhook listener receives the notification and ACKs fast (200 OK)
- Email parsed to extract job metadata (TUI can wait for input)
- Raw email stored to `raw_ingest` collection
- Parse attempt logged to `parse_log` collection
- TUI popup displays extracted job information

### 4. Verify Data in MongoDB (Terminal 1)

In the mongosh terminal, run:

```javascript
// Check raw_ingest collection
db.raw_ingest.findOne()

// Expected output:
{
  _id: ObjectId("..."),
  source: 'GMAIL_WEBHOOK',
  mode: 'production',
  rawContent: '...',
  gmailMeta: {
    messageId: '...',
    threadId: '...',
    from: '...',
    subject: '...'
  },
  ingestedAt: ISODate("..."),
  createdAt: ISODate("...")
}

// Check parse_log collection
db.parse_log.findOne()

// Expected output (current flow logs both stages):
{
   _id: ObjectId("..."),
   rawIngestId: '...',
   stage: 'METADATA',
   success: true,
   extracted: {
      company: '...',
      title: '...',
      salary: '...',
      location: '...'
   },
   executionMs: 45,
   timestamp: ISODate("...")
}

// Count documents stored
db.raw_ingest.countDocuments()     // Should be >= 1
db.parse_log.countDocuments()      // Should be >= 2
```

### 5. Monitor Logs (Terminal 2)

Look for debug logs showing MongoDB operations:

```
[EventDrivenWebhook] Webhook received: POST /webhook/gmail
[EventDrivenWebhook] Processing Gmail message: msg-123456
[EventDrivenWebhook] 💾 Raw email saved to MongoDB: ObjectId(...)
[EventDrivenWebhook] Parse completed in 45ms
[EventDrivenWebhook] ✅ Logged parse attempt to MongoDB
```

## Validation Checklist

- [ ] MongoDB connects successfully (no connection errors in Terminal 2)
- [ ] Raw email document created in `raw_ingest` collection
- [ ] Two parse log documents created in `parse_log` collection (METADATA + JOB_DETAIL)
- [ ] `rawIngestId` matches between collections (linking works)
- [ ] TUI popup displays job information correctly
- [ ] No TypeScript errors on startup
- [ ] Timestamps are recent (within last minute)

## Troubleshooting

### MongoDB Connection Failed

```bash
# Check if MongoDB is running
mongosh admin --eval "db.adminCommand('ping')"

# Expected output:
{ ok: 1 }
```

If MongoDB isn't running:
```bash
# Start MongoDB (adjust path based on installation)
mongod --dbpath /data/db
```

### Environment Variables Not Loaded

```bash
# Check .env file
cat .env

# Expected:
MONGODB_URI=mongodb://localhost:27017
MONGODB_DB_NAME=jobs_watcher
```

### Collections Not Created

MongoDB creates collections automatically on first insert. If `raw_ingest` or `parse_log` don't exist:
- Check logs in Terminal 2 for storage errors
- Verify `storage` property is not null in EventDrivenWebhook
- Check that `processJob()` reaches the storage logging code

### No Parse Log Records

Check if `rawIngestId` is being captured:
```javascript
db.raw_ingest.find().limit(1).toArray()

// If result has _id, that's the rawIngestId for parse logs
```

## Data Cleanup (Optional)

To reset for another test:

```bash
mongosh
use jobs_watcher
db.raw_ingest.deleteMany({})
db.parse_log.deleteMany({})
```

## Next Steps (After Successful Test)

1. Run parser regression tests:
   ```bash
   npm run export-fixtures
   npm run parser-stats
   ```

2. Document success in [IMPLEMENTATION_ROADMAP.md](IMPLEMENTATION_ROADMAP.md)

3. Run multiple emails through the pipeline to build audit trail

4. Monitor memory usage with large collections

## Architecture Overview

The integration follows this flow:

```
Gmail API
   ↓
Pub/Sub push → Webhook ACK (fast) → Background processing → TUI input
POST /webhook
   ↓
EventDrivenWebhook.processJob()
   ↓
save raw email → raw_ingest collection (immutable)
   ↓
parse metadata → parse_log collection (append-only)
   ↓
TUI popup display
```

Each document is linked via `rawIngestId`, enabling:
- Full audit trail reconstruction
- Failure pattern analysis
- Parser regression detection
- Email-to-job traceability

---

**Status**: Beta Integration Phase 2 - MongoDB Storage Connected
**Last Updated**: After TypeScript error fixes
**Blocked**: None - ready for testing
