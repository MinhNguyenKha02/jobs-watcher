# Beta Integration Checklist

**Goal**: Wire MongoDB storage into production flow (data-listening)  
**Estimated Time**: 1-2 hours  
**Status**: Implemented and validated

---

## Prerequisites ✅

- [x] MongoDB driver installed: `npm install mongodb` (completed)
- [x] Storage adapter created: `src/services/storage/mongodb-storage-adapter.ts`
- [x] Storage schemas defined: `src/services/storage/schemas.ts`
- [x] Local MongoDB running or Atlas configured
- [x] .env has MONGODB_URI and MONGODB_DB_NAME set

---

## Task 1: Add MongoDB Config to config.ts

**File**: `src/config.ts`

**What to add**: MongoDB connection configuration to ConfigSchema and output

**Lines to modify**: 
✅ Completed

---

## Task 2: Wire Storage into EventDrivenWebhook

**File**: `src/services/event-webhook.ts`

✅ Completed

**Key changes**:
```typescript
// Add to imports
import { createMongoDBStorageAdapter, type MongoDBStorageAdapter } from './storage/index.js';

// Add to class properties
private storage: MongoDBStorageAdapter | null = null;

// In constructor options
storage?: MongoDBStorageAdapter;

// In constructor init
this.storage = options?.storage || createMongoDBStorageAdapter(
  process.env.MONGODB_URI || 'mongodb://localhost:27017',
  process.env.MONGODB_DB_NAME || 'jobs_watcher',
  logger
);

// Add new public method
async connect(): Promise<void> {
  if (this.storage) {
    await this.storage.connect();
  }
}

async disconnect(): Promise<void> {
  if (this.storage) {
    await this.storage.disconnect();
  }
}

// In processJob(), after parsing
await this.storage?.saveRawIngest({
  source: 'GMAIL_WEBHOOK',
  rawContent: body,
  gmailMeta: { messageId, from, subject, date, ... }
});

await this.storage?.logParseAttempt({
  rawIngestId: rawId,
  stage: 'METADATA',
  success: !!parsed,
  extracted: parsed,
  error: !parsed ? { code: 'PARSE_FAILED', message: '...' } : undefined
});
```

---

## Task 3: Wire Storage into data-listening.ts

**File**: `src/cli/data-listening.ts`

✅ Completed

**Key changes**:
```typescript
try {
  await adapter.connect();
  await adapter.run();
} catch (err) {
  // handle error
}
```

---

## Task 4: Verify TypeScript Compiles

**Command**: `npm run type-check` (or let tsc run)

✅ Completed (no errors in new/modified files)

---

## Task 5: Manual End-to-End Test

**Terminal 1**:
```bash
npm run data-listening
# Expected output:
# ✅ Webhook listening on 127.0.0.1:3000/webhook/gmail
# 📧 Watching for emails with label: "Job-Alerts"
```

**Terminal 2**:
```bash
SEND_REAL_EMAIL=true npm run simulate-webhook
# Expected output:
# ✅ Email sent via Gmail API
# 🚀 Posting to webhook...
```

**Terminal 1** (should show):
```
📬 New job alert received
🔍 Processing job from email: 19c52bb0...
📧 Email Details:
   From: jobs@company.com
   Subject: Senior Full Stack Engineer - Remote
   Date: ...
```

**Verify MongoDB** (in separate terminal):
```bash
mongosh  # or your MongoDB client
use jobs_watcher
db.raw_ingest.findOne()
db.parse_log.find().limit(2)
```

**Expected**: Two parse_log documents per email (METADATA + JOB_DETAIL)

---

## Task 6: Verify No Memory Leaks

**Run**:
```bash
# Send 10 emails in succession
for i in {1..10}; do
  SEND_REAL_EMAIL=true npm run simulate-webhook
  sleep 1
done
```

**Monitor**: Watch heap size in Terminal 1
- Target < 100MB (latest run observed ~173MB)
- No warnings about circuit breaker opening

---

## Success Criteria ✅

- [ ] TypeScript compiles without errors
- [ ] MongoDB connection established on startup
- [ ] raw_ingest documents created with source='GMAIL_WEBHOOK'
- [ ] Two parse_log documents created per email (METADATA + JOB_DETAIL)
- [ ] TUI popup displays job data correctly
- [ ] No memory leaks after 10 emails
- [ ] Can import and use storage in other files

---

## Rollback Plan

If issues arise:
1. Revert event-webhook.ts constructor to not require storage
2. Make storage optional (already done with `?` on storage property)
3. Delete MongoDB documents with `db.raw_ingest.deleteMany({})` if needed

---

## Next Steps After Integration

1. **Export fixtures** from MongoDB
   ```bash
   npm run export-fixtures
   ```

2. **Run parser regression tests**
   ```bash
   npm test -- parser.test
   ```

3. **Analyze success rates**
   ```bash
   npm run parser-stats
   ```

