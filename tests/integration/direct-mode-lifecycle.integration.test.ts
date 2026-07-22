import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createTestStorage } from '../helpers/create-test-storage.js';
import { MongoDBStorageAdapter } from '../../src/infrastructure/outbound/persistence/mongodb-storage-adapter.js' ;
import { getLogger } from '../../src/infrastructure/outbound/logging/logger.js' ;
import { JobStage, JobSource, JobStatus } from '../../src/domain/types/job-lifecycle.js' ;

const logger = getLogger();
const { default: JobIngestor } = await import('../../src/application/ingestor.js');

const CLIPBOARD_HTML = `<html><body>
<div class="job-detail">
  <div class="job-detail__header">
    <h1 class="job-detail__info--title">Junior Backend Developer</h1>
    <div class="job-detail__info--company">
      <span class="company-name">ClipDirectCorp</span>
    </div>
  </div>
  <div class="job-detail__meta">
    <div class="meta-item section-salary">
      <span class="label">Salary:</span>
      <span class="job-detail__info--section-content-value">12,000,000 VNĐ</span>
    </div>
    <div class="meta-item section-location">
      <span class="label">Location:</span>
      <span class="job-detail__info--section-content-value">Ho Chi Minh City</span>
    </div>
  </div>
  <div class="section section-description">
    <div class="job-description__item--content">
      <p>We are looking for a Junior Backend Developer with TypeScript experience.</p>
      <ul><li>TypeScript and Node.js</li><li>Database knowledge</li></ul>
    </div>
  </div>
  <div class="section section-company">
    <h2>About Company</h2>
    <div class="company-info">
      <p><strong>Company Name:</strong> ClipDirectCorp</p>
    </div>
  </div>
</div>
</body></html>`;

describe('T2: Direct mode [b]→[i]→S2→[j]/[d] lifecycle (Case 4)', () => {
  let storage: any;
  let adapter: MongoDBStorageAdapter;
  let parseEvents: any[];
  let routingEvents: any[];
  let ingestor: JobIngestor;

  beforeAll(async () => {
    storage = await createTestStorage();
    adapter = new MongoDBStorageAdapter({
      mongoUri: storage.uri,
      dbName: storage.dbName,
      logger,
    });
    await adapter.connect();

    parseEvents = [];
    routingEvents = [];

    const parseEventPort = {
      emitJobGenerated: vi.fn((...args: any[]) => { parseEvents.push(['generated', ...args]); return Promise.resolve(); }),
      emitJobGeneratedFailed: vi.fn((...args: any[]) => { parseEvents.push(['generatedFailed', ...args]); return Promise.resolve(); }),
      emitParseCompleted: vi.fn((...args: any[]) => { parseEvents.push(['completed', ...args]); return Promise.resolve(); }),
      emitParseFailed: vi.fn((...args: any[]) => { parseEvents.push(['failed', ...args]); return Promise.resolve(); }),
    };

    const routingPort = {
      emitJobQueued: vi.fn((...args: any[]) => { routingEvents.push(['queued', ...args]); return Promise.resolve(); }),
      emitJobTrashed: vi.fn((...args: any[]) => { routingEvents.push(['trashed', ...args]); return Promise.resolve(); }),
      emitRouteFailed: vi.fn((...args: any[]) => { routingEvents.push(['failed', ...args]); return Promise.resolve(); }),
    };

    ingestor = new JobIngestor(adapter, { parseEventPort, routingPort });
  }, 120000);

  afterAll(async () => {
    await adapter.disconnect();
    await storage.stop();
  });

  it('signal2bManual creates clip-* doc and emits parse.completed (simulates [i] in direct mode)', async () => {
    const completedBefore = parseEvents.filter(([t]) => t === 'completed').length;
    const docsBefore = await (adapter as any).jobLifecycleCollection.countDocuments({});

    await ingestor.processIngestCommand({
      source: JobSource.MANUAL,
      stage: JobStage.FULL_PARSED,
      rawPayload: CLIPBOARD_HTML,
    });

    const docsAfter = await (adapter as any).jobLifecycleCollection.countDocuments({});
    expect(docsAfter).toBe(docsBefore + 1);

    const col = (adapter as any).jobLifecycleCollection;
    const docs = await col.find({}).sort({ createdAt: -1 }).limit(1).toArray();
    const newDoc = docs[0];
    expect(newDoc._id).toMatch(/^clip-/);
    expect(newDoc.stage).toBe(JobStage.FULL_PARSED);
    expect(newDoc.status).toBe(JobStatus.ENRICHED);
    expect(newDoc.company).toBe('ClipDirectCorp');
    expect(newDoc.role).toBe('Junior Backend Developer');
    expect(newDoc.matchScore).toBeGreaterThan(0);

    const completedEvents = parseEvents.filter(([t]) => t === 'completed');
    expect(completedEvents.length).toBe(completedBefore + 1);
  });

  it('signal2bManual → queue resolution: full clipboard-to-queued flow', async () => {
    const docsBefore = await (adapter as any).jobLifecycleCollection.countDocuments({});

    await ingestor.processIngestCommand({
      source: JobSource.MANUAL,
      stage: JobStage.FULL_PARSED,
      rawPayload: CLIPBOARD_HTML.replace(/ClipDirectCorp/g, 'ClipQueueCorp'),
    });

    const col = (adapter as any).jobLifecycleCollection;
    const docs = await col.find({}).sort({ createdAt: -1 }).limit(1).toArray();
    const clipDoc = docs[0];
    expect(clipDoc._id).toMatch(/^clip-/);

    routingEvents.length = 0;

    await ingestor.processResolutionCommand({
      joblifecycleId: clipDoc._id,
      action: 'queue',
      editedKVs: {},
    });

    const queuedEvents = routingEvents.filter(([t]) => t === 'queued');
    expect(queuedEvents.length).toBe(1);

    const routedDoc = await adapter.findJobLifecycleById(clipDoc._id);
    expect(routedDoc).not.toBeNull();
    expect(routedDoc!.status).toBe(JobStatus.QUEUED);

    const docsAfter = await (adapter as any).jobLifecycleCollection.countDocuments({});
    expect(docsAfter).toBe(docsBefore + 1);
  });

  it('signal2bManual → trash resolution: full clipboard-to-trashed flow', async () => {
    await ingestor.processIngestCommand({
      source: JobSource.MANUAL,
      stage: JobStage.FULL_PARSED,
      rawPayload: CLIPBOARD_HTML.replace(/ClipDirectCorp/g, 'ClipTrashCorp'),
    });

    const col = (adapter as any).jobLifecycleCollection;
    const docs = await col.find({}).sort({ createdAt: -1 }).limit(1).toArray();
    const clipDoc = docs[0];

    routingEvents.length = 0;

    await ingestor.processResolutionCommand({
      joblifecycleId: clipDoc._id,
      action: 'trash',
      editedKVs: { reason: 'not matching' },
    });

    const trashedEvents = routingEvents.filter(([t]) => t === 'trashed');
    expect(trashedEvents.length).toBe(1);

    const routedDoc = await adapter.findJobLifecycleById(clipDoc._id);
    expect(routedDoc!.status).toBe(JobStatus.TRASHED);
  });

  it('signal2bManual duplicate role+company silently skips (no duplicate doc)', async () => {
    await ingestor.processIngestCommand({
      source: JobSource.MANUAL,
      stage: JobStage.FULL_PARSED,
      rawPayload: CLIPBOARD_HTML.replace(/ClipDirectCorp/g, 'DedupCorp'),
    });

    const docsBefore = await (adapter as any).jobLifecycleCollection.countDocuments({});
    const completedBefore = parseEvents.filter(([t]) => t === 'completed').length;

    await ingestor.processIngestCommand({
      source: JobSource.MANUAL,
      stage: JobStage.FULL_PARSED,
      rawPayload: CLIPBOARD_HTML.replace(/ClipDirectCorp/g, 'DedupCorp'),
    });

    const docsAfter = await (adapter as any).jobLifecycleCollection.countDocuments({});
    expect(docsAfter).toBe(docsBefore);

    const completedEvents = parseEvents.filter(([t]) => t === 'completed');
    expect(completedEvents.length).toBe(completedBefore);
  });

  it('signal2bManual latest-wins in direct mode (B17 fix — overwrites on second call)', async () => {
    await ingestor.processIngestCommand({
      source: JobSource.MANUAL,
      stage: JobStage.FULL_PARSED,
      rawPayload: CLIPBOARD_HTML.replace(/ClipDirectCorp/g, 'FirstCo'),
    });

    const col = (adapter as any).jobLifecycleCollection;
    const docs1 = await col.find({}).sort({ createdAt: -1 }).limit(1).toArray();
    const firstDoc = docs1[0];
    expect(firstDoc.company).toBe('FirstCo');

    parseEvents.length = 0;
    routingEvents.length = 0;

    await ingestor.processIngestCommand({
      source: JobSource.MANUAL,
      stage: JobStage.FULL_PARSED,
      rawPayload: CLIPBOARD_HTML.replace(/ClipDirectCorp/g, 'SecondCo'),
    });

    const docs2 = await col.find({}).sort({ createdAt: -1 }).limit(1).toArray();
    const secondDoc = docs2[0];
    expect(secondDoc.company).toBe('SecondCo');
    expect(secondDoc._id).not.toBe(firstDoc._id);

    const completedEvents = parseEvents.filter(([t]) => t === 'completed');
    expect(completedEvents.length).toBe(1);
  });
});
