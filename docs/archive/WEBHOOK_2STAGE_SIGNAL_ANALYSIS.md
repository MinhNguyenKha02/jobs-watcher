# Webhook 2-Stage Parsing Architecture Analysis: Signal 1/2 State Update Flow

**Date**: April 22, 2026  
**Status**: ⚠️ **BROKEN - Critical Issues Found**  
**Analysis Level**: Architecture + Implementation Verification

---

## EXECUTIVE SUMMARY

The current Signal 1/2 state update flow is **PARTIALLY BROKEN**:

| Component | Status | Issue |
|-----------|--------|-------|
| **Signal 1 removal** | ✅ CORRECT | Prevent 22-event race condition |
| **Signal 2 removal** | ❌ WRONG | Should call `setCurrentJob()` to persist enriched data |
| **Render loop stage** | ❌ WRONG | Sets `'FULL_PARSED'` but should set `'PARTIAL'` |
| **Webhook Stage 2 Signal 2** | ❌ NOT IMPLEMENTED | Never emitted in ingestor for webhook path |
| **State file progression** | ❌ BROKEN | Stays `'FULL_PARSED'` always instead of `PARTIAL → FULL_PARSED` |

**Root Cause**: The documented fix (session memory April 21) was NOT fully implemented. Signal 2 listener should have been enhanced to call `setCurrentJob()`, not removed entirely.

---

## 1. DAEMON SIDE: Signal 1 & 2 Emission

### Signal 1 Payload (job.generated - WEBHOOK STAGE 1)

**Location**: `src/application/ingestor.ts` lines 176-217

**What triggers it**:
- Gmail webhook arrives with PARTIAL data (company, position, url only)
- `Ingestor.ingest()` detects `isWebhook = true`

**What's emitted**:
```typescript
// Line 205-210
await this.parseEventPort.emitJobGenerated(job, {
  stage: 'PARTIAL',
  source: 'webhook',
});
```

**Payload structure**:
```typescript
// job object at this point contains:
{
  messageId: 'msg-123',
  company: 'Acme Corp',           // ✓ Extracted from email
  position: 'Senior Engineer',    // ✓ Extracted from email
  url: 'https://...',             // ✓ Extracted from email
  // ❌ NO: scores, matchedSkills, matchedDescription
  // ❌ NO: candidateCount, detailedMatching
}
```

**Stage annotation**: `'PARTIAL'` ✓ Correct

---

### Signal 2 Payload (job.parse.completed - WEBHOOK STAGE 2)

**Current Status**: ❌ **NOT IMPLEMENTED FOR WEBHOOK**

**Location where it SHOULD be**: `src/application/ingestor.ts` after webhook clipboard re-ingest

**What SHOULD trigger it**:
1. User presses [c] action
2. Action controller sends clipboard to `/internal/ingest?webhook=true`
3. Ingestor receives job with FULL parsed data (from clipboard HTML parse)
4. Should emit Signal 2 but **DOESN'T**

**Current code flow** (WRONG):
```typescript
// Line 178: Detects webhook
const isWebhook = (job as any).platform === 'gmail-webhook' || !!(job as any).gmailMeta;

if (isWebhook) {
  // Line 196-210: Emits Signal 1 (PARTIAL)
  await this.signalNeedEnrichment(job, { stage: 'PARTIAL', ... });
  await this.parseEventPort.emitJobGenerated(job, { stage: 'PARTIAL', ... });
  
  // ❌ MISSING: Should emit Signal 2 here!
  // await this.parseEventPort.emitParseCompleted(...);
  
  logger.info('[Ingestor] Job routed to needs_enrichment (WEBHOOK STAGE 1)');
}
```

**What DOES get emitted** (for clipboard, not webhook):
```typescript
// Line 244-254: Only for non-webhook (clipboard)
if (this.parseEventPort) {
  await this.parseEventPort.emitParseCompleted(ingestId, {
    stage: 'STAGE_2_CLIPBOARD',
    candidateCount: 1,
  });
}
```

**Missing webhook Stage 2 emission**:
```typescript
// MISSING IN INGESTOR - SHOULD BE ADDED:
// if (isWebhook && jobHasFullParsedData) {
//   await this.parseEventPort.emitParseCompleted(ingestId, {
//     stage: 'STAGE_2_WEBHOOK',
//     candidateCount: candidateCount,
//   });
// }
```

**Expected Payload for Signal 2**:
```typescript
{
  messageId: 'msg-123',
  company: 'Acme Corp',
  position: 'Senior Engineer',
  url: 'https://...',
  // ✅ NOW INCLUDED (from clipboard parse):
  matchScore: 0.92,
  matchedSkills: ['Python', 'TypeScript', 'Node.js'],
  matchedDescription: 'Excellent match for your profile',
  candidateCount: 1,
  description: '... full job description parsed from clipboard ...',
}
```

**Stage annotation**: `'FULL_PARSED'` ✓ (would be correct if implemented)

---

## 2. UI SIDE: Current State Update Flow (BROKEN)

### Signal 1 Listener (job.generated)

**Location**: `src/ui/ops-tui-app.ts` lines 98-161

**Current Implementation**:
```typescript
this.sseReader.addEventListener('job.generated', (event: any) => {
  // ... parse payload ...
  
  // CRITICAL FIX: Don't call setCurrentJob() here!
  // This is where the race condition happened:
  // - 22 Signal 1 events → 22 setCurrentJob() calls
  // - Last one (job-21) overwrites all others
  // - Result: state file has job-21 while render shows job-0
  //
  // Solution: Let render loop handle state updates when it has actual job object
  // Signal 1 is just notification that job was buffered to queue
  
  logger.info('[SIGNAL-1] Job received and queued', {
    messageId,
    company,
    position,
  });
  
  // ✅ (Removed all setCurrentJob calls from Signal 1 listener)
});
```

**Assessment**: ✅ **CORRECT** - Do NOT call `setCurrentJob()` here

**Reasoning**:
- At Signal 1 time, 22 jobs in envelope simultaneously emit 22 Signal 1 events
- If each calls `setCurrentJob()`, last one overwrites state file
- Result: state file has job-21 but render loop shows job-0 → mismatch

---

### Signal 2 Listener (job.parse.completed)

**Location**: `src/ui/ops-tui-app.ts` lines 163-219

**Current Implementation**:
```typescript
this.sseReader.addEventListener('job.parse.completed', (event: any) => {
  const payload = event.data || event.payload;
  const messageId = payload?.messageId;
  
  const currentState = this.currentJob;
  const enrichedJob = currentState ? { ...currentState, ...payload } : payload;
  
  // CRITICAL FIX: Do NOT call setCurrentJob() here!
  // Signal 2 fires 22 times → 22 writes → state file has job-21 (last one)
  // Instead: only update in-memory state, let render loop update shared state file
  
  // Update in-memory reference ONLY
  if (this.currentJob && this.currentJob.messageId === messageId) {
    this.currentJob = enrichedJob;
    logger.info('[SIGNAL-2] Updated in-memory job only', { messageId });
  }
  
  // Re-render with enriched data
  if (this.state === 'DISPLAY') {
    this.renderFrame(enrichedJob);
  }
  
  // ❌ NO setCurrentJob() - enriched data NOT persisted to state file!
});
```

**Assessment**: ❌ **WRONG** - SHOULD call `setCurrentJob()` with guard condition

**The Problem**:
- Signal 2 fires with enriched job data (scores, matched skills)
- In-memory job is updated but state file is NOT
- State file still has stage='FULL_PARSED' from render loop (which set it initially)
- Enriched data (scores) never persists to shared state file
- Next time TUI starts, it loses the enriched data

**What the documented fix intended** (April 21 session memory):
```typescript
// Signal 2 SHOULD do this:
if (this.currentJob && this.currentJob.messageId === messageId) {
  // ✓ Only update if this is the CURRENTLY DISPLAYED job
  const enrichedJob = { ...this.currentJob, ...payload };
  setCurrentJob(messageId, enrichedJob, 'FULL_PARSED');  // ← MISSING!
  this.currentJob = enrichedJob;
  logger.info('[SIGNAL-2] Persisted enriched data to state file', {
    messageId,
    score: payload?.matchScore,
  });
}
```

---

### Render Loop (IDLE → DISPLAY)

**Location**: `src/ui/ops-tui-app.ts` line 388

**Current Implementation**:
```typescript
if (messageId !== lastRenderedMessageId) {
  setCurrentJob(messageId, this.currentJob, 'FULL_PARSED');  // ← WRONG STAGE!
  this.state = 'DISPLAY';
  
  if (lastRenderedState !== 'DISPLAY') {
    this.renderFrame(this.currentJob);
    lastRenderedState = 'DISPLAY';
    lastRenderedMessageId = messageId;
  }
}
```

**Assessment**: ❌ **WRONG** - Stage should be `'PARTIAL'`, not `'FULL_PARSED'`

**The Problem**:
- Job dequeued at T+34 (when job object first available to render loop)
- Job at this point is PARTIAL (only company, position, url)
- Render loop should set `setCurrentJob(messageId, job, 'PARTIAL')`
- But it sets `'FULL_PARSED'` immediately
- Signal 2 never fires (webhook Stage 2 not emitted), so stage never updates
- Result: state file always shows 'FULL_PARSED' regardless of actual stage

**Correct implementation**:
```typescript
if (messageId !== lastRenderedMessageId) {
  // ✓ Job just dequeued is PARTIAL (not yet enriched)
  setCurrentJob(messageId, this.currentJob, 'PARTIAL');  // ← FIX
  this.state = 'DISPLAY';
  
  if (lastRenderedState !== 'DISPLAY') {
    this.renderFrame(this.currentJob);
    // Signal 2 will later update to FULL_PARSED when enrichment arrives
  }
}
```

---

## 3. STATE FILE STAGE PROGRESSION (CURRENT vs. CORRECT)

### Current Flow (BROKEN)

```
T+0   ┌─ Gmail Webhook arrives (PARTIAL: company, position, url)
      └─ Signal 1 emitted
      
T+5   ┌─ TUI receives Signal 1
      ├─ (No state update - Signal 1 doesn't call setCurrentJob)
      └─ Queue building (22 jobs arriving)
      
T+30  ┌─ All jobs in queue
      └─ RenderLoop peeks queue[0]
      
T+34  ┌─ RenderLoop dequeues job-0
      ├─ Calls: setCurrentJob(job-0, 'FULL_PARSED')  ❌ WRONG STAGE!
      └─ State file: {messageId: msg-123, stage: 'FULL_PARSED', job: {...PARTIAL...}}
      
T+50  ┌─ User presses [c] (clipboard Stage 2)
      ├─ Clipboard HTML sent to /internal/ingest?webhook=true
      ├─ Ingestor parses clipboard → enriches job
      ├─ ❌ Signal 2 NOT EMITTED (webhook Stage 2 not implemented)
      └─ State file: {stage: 'FULL_PARSED'}  ← Unchanged, no enriched data!
      
T+60  ┌─ User presses [q] to queue
      ├─ Job enqueued with only PARTIAL data
      └─ Database: job has NO scores, NO matched skills
```

### Correct Flow (DESIRED)

```
T+0   ┌─ Gmail Webhook arrives (PARTIAL: company, position, url)
      └─ Signal 1 emitted: {stage: 'PARTIAL', company, position, url}
      
T+5   ┌─ TUI receives Signal 1
      ├─ (No state update - informational only)
      └─ Queue building
      
T+30  ┌─ All jobs in queue
      └─ RenderLoop peeks queue[0]
      
T+34  ┌─ RenderLoop dequeues job-0
      ├─ Calls: setCurrentJob(job-0, 'PARTIAL')  ✓ CORRECT
      └─ State file: {messageId: msg-123, stage: 'PARTIAL', job: {...PARTIAL...}}
      
T+50  ┌─ User presses [c] (clipboard Stage 2)
      ├─ Clipboard HTML sent to /internal/ingest?webhook=true
      ├─ Ingestor parses clipboard → enriches job with scores
      ├─ ✓ Signal 2 EMITTED: {stage: 'STAGE_2_WEBHOOK', scores, matched...}
      ├─ TUI receives Signal 2
      ├─ Signal 2 listener: enrichedJob = merge(current, payload)
      ├─ Calls: setCurrentJob(msg-123, enrichedJob, 'FULL_PARSED')  ✓ CORRECT
      └─ State file: {stage: 'FULL_PARSED', scores, matchedSkills, ...}
      
T+60  ┌─ User presses [q] to queue
      ├─ Job enqueued with FULL enriched data
      └─ Database: job has scores, matched skills, description
```

---

## 4. ACTION CONTROLLER [c] FLOW (WEBHOOK STAGE 2)

**Location**: `src/ui/action-controller.ts` lines 594-650

**What happens**:
```typescript
private async handleWebhookStage2Parse(): Promise<void> {
  const current = getCurrentJob();  // Get currently displayed job
  
  // Get clipboard HTML
  const clipboardArr = await clipboardGetter();
  const htmlPayload = clipboardArr?.[0];
  
  // Send to /internal/ingest with webhook=true flag
  const ingestOpts = {
    socketPath: this.config.socketPath,
    path: '/internal/ingest',
    method: 'POST',
    // ... add current job data + clipboard HTML to body
  };
  
  // Send request
  // → Goes to index.ts /internal/ingest handler
  // → Calls jobIngestor.ingest(job)
  // → Ingestor.ingest() processes it
}
```

**Flow through /internal/ingest** (index.ts):
```typescript
if (req.method === 'POST' && req.url?.startsWith('/internal/ingest')) {
  const isWebhook = url.searchParams.get('webhook') === 'true';  // ✓ true
  const job = JSON.parse(body);
  
  if (isWebhook && !job.platform) {
    job.platform = 'gmail-webhook';  // ✓ Marks as webhook
  }
  
  await jobIngestor.ingest(job);  // Sends to Ingestor
}
```

**Flow through Ingestor** (BROKEN PATH):
```typescript
const isWebhook = job.platform === 'gmail-webhook';  // ✓ true

if (isWebhook) {
  // ✓ Emits Signal 1 (PARTIAL) — but job now has enriched data!
  await this.parseEventPort.emitJobGenerated(job, {
    stage: 'PARTIAL',  // ❌ WRONG! Should be 'FULL_PARSED'
    source: 'webhook',
  });
  
  // ❌ MISSING: Does NOT emit Signal 2
  // Should emit: emitParseCompleted('STAGE_2_WEBHOOK', ...)
  
  // Routes to needs_enrichment again (not job_queue!)
  await this.signalNeedEnrichment(job);
  logger.info('[Ingestor] Job routed to needs_enrichment');
}
```

**The Bug**: When [c] sends clipboard HTML:
1. Ingestor sees `platform='gmail-webhook'` again
2. Treats it as Stage 1 (PARTIAL), not Stage 2 (FULL_PARSED)
3. Routes to needs_enrichment instead of emitting Signal 2
4. Enriched data never sent to TUI

---

## 5. CORRECT SIGNAL 1/2 IMPLEMENTATION

### Fix 1: Signal 2 Listener Should Call setCurrentJob()

**File**: `src/ui/ops-tui-app.ts` lines 163-219

**Change**:
```typescript
this.sseReader.addEventListener('job.parse.completed', (event: any) => {
  try {
    const payload = event.data || event.payload;
    const messageId = payload?.messageId;
    
    if (!messageId) {
      logger.warn('[SIGNAL-2] No messageId in payload');
      return;
    }
    
    // ✓ GUARD: Only update if this is currently displayed job
    if (!this.currentJob || this.currentJob.messageId !== messageId) {
      logger.info('[SIGNAL-2] Signal 2 for different job, skipping state update', {
        displayedMessageId: this.currentJob?.messageId,
        signalMessageId: messageId,
      });
      return;
    }
    
    // ✓ Merge enriched data
    const enrichedJob = { ...this.currentJob, ...payload };
    
    // ✓ CRITICAL: Persist enriched data to state file
    setCurrentJob(messageId, enrichedJob, 'FULL_PARSED');
    
    // ✓ Update in-memory reference
    this.currentJob = enrichedJob;
    
    logger.info('[SIGNAL-2] ✅ Persisted enriched data to state file', {
      messageId,
      score: payload?.matchScore,
    });
    
    // ✓ Re-render with enriched data visible
    if (this.state === 'DISPLAY') {
      this.renderFrame(enrichedJob);
    }
  } catch (err) {
    logger.error('[SIGNAL-2] ❌ Error processing job.parse.completed', {
      error: String(err),
    });
  }
});
```

### Fix 2: Render Loop Should Set PARTIAL Stage

**File**: `src/ui/ops-tui-app.ts` line 388

**Change**:
```typescript
// ✓ BEFORE
setCurrentJob(messageId, this.currentJob, 'FULL_PARSED');

// ✓ AFTER
setCurrentJob(messageId, this.currentJob, 'PARTIAL');
```

### Fix 3: Webhook Stage 2 Must Emit Signal 2

**File**: `src/application/ingestor.ts` lines 176-217

**Change**: Distinguish PARTIAL webhook (Stage 1) from FULL_PARSED webhook (Stage 2)

```typescript
const isWebhook = (job as any).platform === 'gmail-webhook' || !!(job as any).gmailMeta;
const ingestId = (job as any).messageId || (job as any).id || `ingest-${Date.now()}`;

if (isWebhook) {
  // ✓ Detect if this is Stage 2 (enriched with scores/matched)
  const hasEnrichedData = !!(
    (job as any).matchScore !== undefined || 
    (job as any).matchedSkills || 
    (job as any).description
  );
  
  if (hasEnrichedData) {
    // ✓ WEBHOOK STAGE 2: Job re-ingested with enriched data from clipboard
    
    // Emit Signal 2
    await this.parseEventPort.emitJobGenerated(job, {
      stage: 'FULL_PARSED',  // ✓ CORRECT: Job is now fully parsed
      source: 'webhook',
    });
    
    if (this.parseEventPort) {
      await this.parseEventPort.emitParseCompleted(ingestId, {
        stage: 'STAGE_2_WEBHOOK',
        candidateCount: 1,
      });
    }
    
    logger.info('[Ingestor] Job enriched (WEBHOOK STAGE 2 - clipboard parsed)', {
      jobId: ingestId,
      scores: (job as any).matchScore,
    });
  } else {
    // ✓ WEBHOOK STAGE 1: Initial webhook with PARTIAL data
    
    // Emit Signal 1
    await this.parseEventPort.emitJobGenerated(job, {
      stage: 'PARTIAL',  // ✓ CORRECT: Only basic metadata
      source: 'webhook',
    });
    
    logger.info('[Ingestor] Job routed to needs_enrichment (WEBHOOK STAGE 1)', {
      jobId: ingestId,
    });
  }
  
  // Both stages: route to needs_enrichment for operator review
  await this.signalNeedEnrichment(job, {
    stage: hasEnrichedData ? 'FULL_PARSED' : 'PARTIAL',
    source: 'webhook',
    signal: 'job.generated',
  });
}
```

---

## 6. CORRECTED TIMING DIAGRAM

### Current (BROKEN) - T+0 to T+60

```
T+0ms   Gmail webhook arrives
        Signal 1 emitted (PARTIAL)
        
T+5ms   Signal 1 received by TUI
        No state update (correct)
        
T+30ms  All 22 jobs in queue
        
T+34ms  Render loop dequeues job-0
        State file: {stage: 'FULL_PARSED'} ❌ WRONG
        
T+50ms  User presses [c]
        Clipboard HTML sent
        Signal 2 NOT EMITTED ❌
        State file: unchanged ❌
        
T+60ms  User presses [q]
        Database: job saved with PARTIAL data only ❌
```

### Corrected (DESIRED) - T+0 to T+60

```
T+0ms   Gmail webhook arrives with company, position, url
        Signal 1 emitted (stage='PARTIAL')
        
T+5ms   Signal 1 received by TUI
        No state update (informational)
        
T+30ms  All 22 jobs in queue (each: company, position, url)
        
T+34ms  Render loop dequeues job-0
        State file: {stage: 'PARTIAL', company, position, url} ✓
        
T+50ms  User presses [c]
        Clipboard HTML parsed (company match, scores, skills)
        Signal 1 emitted again? NO - Signal 2 emitted instead ✓
        Signal 2: {stage='STAGE_2_WEBHOOK', matchScore, matched...}
        
T+55ms  Signal 2 received by TUI
        Signal 2 listener validates messageId matches
        State file: {stage: 'FULL_PARSED', matchScore, matchedSkills...} ✓
        
T+60ms  User presses [q]
        Database: job saved with FULL enriched data ✓
```

---

## 7. ANSWERS TO USER QUESTIONS

### Q1: Is current Signal 1/2 removal correct or broken?

**Answer**: ⚠️ **PARTIALLY BROKEN**
- ✅ Signal 1 removal: CORRECT (prevents 22-event race)
- ❌ Signal 2 removal: WRONG (should call `setCurrentJob()` with guard)
- ❌ Render loop: WRONG (sets `'FULL_PARSED'` instead of `'PARTIAL'`)
- ❌ Webhook Stage 2: NOT IMPLEMENTED (doesn't emit Signal 2)

### Q2: Should we check queue[0] before calling setCurrentJob in Signal listeners?

**Answer**: YES - For Signal 2 only

```typescript
// ✓ CORRECT Guard for Signal 2:
if (this.currentJob && this.currentJob.messageId === messageId) {
  setCurrentJob(messageId, enrichedJob, 'FULL_PARSED');
}

// ✓ This prevents job-21's Signal 2 from overwriting job-0's state file
```

**Why queue[0] check is NOT needed**:
- If messageId matches `this.currentJob.messageId`, we're already sure it's front of queue
- No need to peek queue[0] (slower operation)
- Simple messageId string comparison is sufficient

### Q3: What is the CORRECT state file flow?

**Answer**:
```
PARTIAL → FULL_PARSED → (null on clearCurrentJob)
```

Not:
```
FULL_PARSED always  ❌ (current)
```

**Implementation**:
- **T+34**: Render loop dequeues → `setCurrentJob(job, 'PARTIAL')`
- **T+55**: Signal 2 enriches → `setCurrentJob(enrichedJob, 'FULL_PARSED')`
- **T+60**: Signal 3 routes → `clearCurrentJob()` → null

### Q4: Does render loop need to update state AFTER Signal 2 enrichment?

**Answer**: NO - Signal 2 listener handles it

**Ownership**:
- **Render loop**: Sets stage when job dequeues (PARTIAL)
- **Signal 2 listener**: Updates stage when enrichment arrives (FULL_PARSED)
- **Signal 3 listener**: Clears when routed

This is correct "write once per stage" pattern.

### Q5: Should we keep single-writer or add gated Signal writes?

**Answer**: **KEEP GATED SIGNAL WRITES** (with messageId validation)

**Rationale**:
- Single writer pattern breaks for Signal 2 (needs to persist enrichment)
- messageId validation is lightweight guard (O(1) string compare)
- Prevents job-21's Signal 2 from overwriting job-0

```typescript
// ✓ CORRECT: Gated write
if (this.currentJob?.messageId === messageId) {
  setCurrentJob(messageId, enrichedJob, 'FULL_PARSED');
}
```

---

## 8. IMPLEMENTATION CHECKLIST

- [ ] **Render Loop Fix**: Change stage from `'FULL_PARSED'` to `'PARTIAL'` (line 388)
- [ ] **Signal 2 Fix**: Add `setCurrentJob()` call with messageId validation (lines 163-219)
- [ ] **Webhook Stage 2 Detection**: Add logic to distinguish Stage 1 (PARTIAL) from Stage 2 (FULL_PARSED)
- [ ] **Webhook Stage 2 Signal 2**: Emit `emitParseCompleted('STAGE_2_WEBHOOK')` when enriched
- [ ] **E2E Test**: Verify state file flow PARTIAL → FULL_PARSED
- [ ] **E2E Test**: Verify 22-job envelope doesn't corrupt state file
- [ ] **E2E Test**: Verify [c] clipboard parse triggers Signal 2

---

## 9. FILES TO MODIFY

1. **src/ui/ops-tui-app.ts**
   - Line 388: Change `'FULL_PARSED'` to `'PARTIAL'`
   - Lines 163-219: Add `setCurrentJob()` call with messageId guard in Signal 2 listener

2. **src/application/ingestor.ts**
   - Lines 176-217: Add webhook Stage 2 detection logic
   - Add `emitParseCompleted()` call for webhook Stage 2

---

