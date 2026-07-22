import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createTestStorage } from '../helpers/create-test-storage.js';
import { MongoJobLifecycleAdapter } from '../../src/infrastructure/outbound/persistence/mongo-job-lifecycle-adapter.js' ;
import { getLogger } from '../../src/infrastructure/outbound/logging/logger.js' ;
import { JobStage, JobSource, JobStatus } from '../../src/domain/types/job-lifecycle.js' ;

const logger = getLogger();
const { JobIngestor } = await import('../../src/application/ingestor.js');

const TOPCV_HTML = '<div class="job-detail__info--title"><h1>Junior Engineer</h1></div>' +
  '<div class="company-name-label"><a class="name">Case1Co</a></div><div>topcv</div>';

const CLIPBOARD_HTML = '<html><body>' +
  '<div class="job-detail__info--title"><h1>Junior Engineer</h1></div>' +
  '<div class="company-name-label"><a class="name">Case1Co</a></div>' +
  '<div class="job-detail__info--section-content-value">15,000,000 VNĐ</div>' +
  '<div class="job-detail__info--section-content-value">Ho Chi Minh</div>' +
  '<p>TypeScript and Node.js developer</p></body></html>';

function makeStage1Partial(overrides: any = {}): any {
  return {
    _id: overrides._id || 'e2e-case1-partial',
    raw: '<html><body>partial</body></html>',
    stage: JobStage.PARTIAL_PARSED,
    status: JobStatus.ENRICHING,
    source: JobSource.BROWSER_AUTO,
    company: overrides.company || 'Case1Co',
    role: overrides.role || 'Junior Engineer',
    url: overrides.url || 'https://test.com/job',
    createdAt: new Date(),
    updatedAt: new Date(),
    stageTimestamp: new Date(),
  };
}

describe('E2E: Case 1 partial→[o][p][c]→full→[j][d]→next', () => {
  let storage: any;
  let adapter: MongoJobLifecycleAdapter;
  let parseEvents: any[];
  let routingEvents: any[];
  let ingestor: JobIngestor;

  beforeAll(async () => {
    storage = await createTestStorage();
    adapter = new MongoJobLifecycleAdapter(
      storage.uri,
      storage.dbName,
    );
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

    ingestor = new JobIngestor(adapter, parseEventPort, routingPort);
  }, 120000);

  afterAll(async () => {
    await adapter.disconnect();
    await storage.stop();
  });

  beforeEach(async () => {
    parseEvents.length = 0;
    routingEvents.length = 0;
    const db = (adapter as any).db;
    const cols = await db.listCollections().toArray();
    for (const col of cols) {
      await db.collection(col.name).deleteMany({});
    }
  });

  it('T1a: S1 partial→S2 enrichment→[j] queue (canonical Case 1)', async () => {
    const messageId = 'e2e-case1-msg-1';

    await ingestor.processIngestCommand({
      source: JobSource.BROWSER_AUTO,
      stage: JobStage.PARTIAL_PARSED,
      rawPayload: TOPCV_HTML,
      metadata: { messageId, subject: 'Junior Engineer' },
    });

    const genEvents = parseEvents.filter(([t]) => t === 'generated');
    expect(genEvents.length).toBe(1);
    const joblifecycleId = genEvents[0][1]._id;
    expect(joblifecycleId).toMatch(/-job-0$/);

    const partialDoc = await adapter.findById(joblifecycleId);
    expect(partialDoc).not.toBeNull();
    expect(partialDoc!.stage).toBe(JobStage.PARTIAL_PARSED);
    expect(partialDoc!.status).toBe(JobStatus.ENRICHING);

    await ingestor.processIngestCommand({
      source: JobSource.MANUAL,
      stage: JobStage.FULL_PARSED,
      rawPayload: CLIPBOARD_HTML,
      joblifecycleId,
    });

    const completedEvents = parseEvents.filter(([t]) => t === 'completed');
    expect(completedEvents.length).toBe(1);
    expect(completedEvents[0][1]).toBe(joblifecycleId);

    const enrichedDoc = await adapter.findById(joblifecycleId);
    expect(enrichedDoc).not.toBeNull();
    expect(enrichedDoc!.stage).toBe(JobStage.FULL_PARSED);
    expect(enrichedDoc!.status).toBe(JobStatus.ENRICHED);
    expect(enrichedDoc!.matchScore).toBeGreaterThan(0);

    await ingestor.processResolutionCommand({
      joblifecycleId,
      action: 'queue',
    });

    const routedDoc = await adapter.findById(joblifecycleId);
    expect(routedDoc).not.toBeNull();
    expect(routedDoc!.status).toBe(JobStatus.QUEUED);
    expect(routedDoc!.routedAt).toBeInstanceOf(Date);

    const queuedEvents = routingEvents.filter(([t]) => t === 'queued');
    expect(queuedEvents.length).toBe(1);
  });

  it('T1b: S1 partial→[j] queue before S2 arrives (deferred enrichment guard)', async () => {
    const messageId = 'e2e-case1-msg-defer';

    await ingestor.processIngestCommand({
      source: JobSource.BROWSER_AUTO,
      stage: JobStage.PARTIAL_PARSED,
      rawPayload: TOPCV_HTML,
      metadata: { messageId, subject: 'Junior Engineer' },
    });

    const genEvents = parseEvents.filter(([t]) => t === 'generated');
    expect(genEvents.length).toBe(1);
    const joblifecycleId = genEvents[0][1]._id;

    await ingestor.processResolutionCommand({
      joblifecycleId,
      action: 'queue',
    });

    const routedDoc = await adapter.findById(joblifecycleId);
    expect(routedDoc).not.toBeNull();
    expect(routedDoc!.status).toBe(JobStatus.QUEUED);

    const queuedEvents = routingEvents.filter(([t]) => t === 'queued');
    expect(queuedEvents.length).toBe(1);

    await ingestor.processIngestCommand({
      source: JobSource.MANUAL,
      stage: JobStage.FULL_PARSED,
      rawPayload: CLIPBOARD_HTML,
      joblifecycleId,
    });

    const enrichedDoc = await adapter.findById(joblifecycleId);
    expect(enrichedDoc).not.toBeNull();
    expect(enrichedDoc!.stage).toBe(JobStage.FULL_PARSED);
    expect(enrichedDoc!.matchScore).toBeGreaterThan(0);
  });

  it('T1c: S1→S2→[d] trash (Case 1 trash path)', async () => {
    const messageId = 'e2e-case1-trash';

    await ingestor.processIngestCommand({
      source: JobSource.BROWSER_AUTO,
      stage: JobStage.PARTIAL_PARSED,
      rawPayload: TOPCV_HTML,
      metadata: { messageId, subject: 'Junior Engineer' },
    });

    const genEvents = parseEvents.filter(([t]) => t === 'generated');
    expect(genEvents.length).toBe(1);
    const joblifecycleId = genEvents[0][1]._id;

    await ingestor.processIngestCommand({
      source: JobSource.MANUAL,
      stage: JobStage.FULL_PARSED,
      rawPayload: CLIPBOARD_HTML,
      joblifecycleId,
    });

    const completedEvents = parseEvents.filter(([t]) => t === 'completed');
    expect(completedEvents.length).toBe(1);

    await ingestor.processResolutionCommand({
      joblifecycleId,
      action: 'trash',
    });

    const trashedDoc = await adapter.findById(joblifecycleId);
    expect(trashedDoc).not.toBeNull();
    expect(trashedDoc!.status).toBe(JobStatus.TRASHED);

    const trashEvents = routingEvents.filter(([t]) => t === 'trashed');
    expect(trashEvents.length).toBe(1);
  });

  it('T1d: [c] on already FULL_PARSED job is no-op (B2 guard)', async () => {
    const joblifecycleId = 'e2e-case1-already-full';
    const partialDoc = makeStage1Partial({ _id: joblifecycleId, company: 'AlreadyCo', role: 'Junior Dev' });
    await adapter.upsert(partialDoc);

    await ingestor.processIngestCommand({
      source: JobSource.MANUAL,
      stage: JobStage.FULL_PARSED,
      rawPayload: CLIPBOARD_HTML,
      joblifecycleId,
    });

    const completedBefore = parseEvents.filter(([t]) => t === 'completed').length;
    expect(completedBefore).toBe(1);

    await ingestor.processIngestCommand({
      source: JobSource.MANUAL,
      stage: JobStage.FULL_PARSED,
      rawPayload: CLIPBOARD_HTML,
      joblifecycleId,
    });

    const completedAfter = parseEvents.filter(([t]) => t === 'completed').length;
    expect(completedAfter).toBe(completedBefore + 1);

    const failedEvents = parseEvents.filter(([t]) => t === 'failed');
    expect(failedEvents.length).toBe(0);
  });

  it('T1e: [c] with empty clipboard emits parse.failed (S4 via B1 path)', async () => {
    const joblifecycleId = 'e2e-case1-empty-clip';
    const partialDoc = makeStage1Partial({ _id: joblifecycleId, company: 'EmptyCo', role: 'Junior Dev' });
    await adapter.upsert(partialDoc);

    await ingestor.processIngestCommand({
      source: JobSource.MANUAL,
      stage: JobStage.FULL_PARSED,
      rawPayload: '',
      joblifecycleId,
    });

    const failedEvents = parseEvents.filter(([t]) => t === 'failed');
    expect(failedEvents.length).toBe(1);

    const failedDoc = await adapter.findById(joblifecycleId);
    expect(failedDoc).not.toBeNull();
    expect(failedDoc!.status).toBe(JobStatus.FAILED);
  });
});
