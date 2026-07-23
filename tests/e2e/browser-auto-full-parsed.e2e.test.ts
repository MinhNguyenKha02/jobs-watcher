import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createTestStorage } from '../helpers/create-test-storage.js';
import { MongoJobLifecycleAdapter } from '../../src/infrastructure/outbound/persistence/mongo-job-lifecycle-adapter.js' ;
import { getLogger } from '../../src/infrastructure/outbound/logging/logger.js' ;
import { JobStage, JobSource, JobStatus } from '../../src/domain/types/job-lifecycle.js' ;

const logger = getLogger();
const { JobIngestor } = await import('../../src/application/ingestor.js');

const FULL_PARSED_HTML = '<html><body>' +
  '<div class="job-detail__info--title"><h1>Junior Backend Developer</h1></div>' +
  '<div class="company-name-label"><a class="name">FullParsedCo</a></div>' +
  '<div class="job-detail__info--section-content-value">Ho Chi Minh</div>' +
  '<p>TypeScript and Node.js developer</p></body></html>';

describe('E2E: Case 2 full-parsed direct arrival (browser-auto S2 path)', () => {
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
      emitGenerated: vi.fn((...args: any[]) => { parseEvents.push(['generated', ...args]); return Promise.resolve(); }),
      emitCompleted: vi.fn((...args: any[]) => { parseEvents.push(['completed', ...args]); return Promise.resolve(); }),
      emitFailed: vi.fn((...args: any[]) => { parseEvents.push(['failed', ...args]); return Promise.resolve(); }),
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

  it('T2a: S2 via BROWSER_AUTO→[j] queue (no S1 needed, full already)', async () => {
    const jobLifecycleId = 'e2e-c2-full-arrival';

    await ingestor.processIngestCommand({
      source: JobSource.BROWSER_AUTO,
      stage: JobStage.FULL_PARSED,
      rawPayload: FULL_PARSED_HTML,
      jobLifecycleId,
    });

    const genEvents = parseEvents.filter(([t]) => t === 'generated');
    expect(genEvents.length).toBe(1);

    const completedEvents = parseEvents.filter(([t]) => t === 'completed');
    expect(completedEvents.length).toBe(1);

    const doc = await adapter.findById(jobLifecycleId);
    expect(doc).not.toBeNull();
    expect(doc!.stage).toBe(JobStage.FULL_PARSED);
    expect(doc!.status).toBe(JobStatus.ENRICHED);
    expect(doc!.matchScore).toBeGreaterThan(0);
    expect(doc!.matchedSkills).toBeDefined();

    await ingestor.processResolutionCommand({
      jobLifecycleId,
      action: 'queue',
    });

    const queuedDoc = await adapter.findById(jobLifecycleId);
    expect(queuedDoc).not.toBeNull();
    expect(queuedDoc!.status).toBe(JobStatus.QUEUED);

    expect(routingEvents.filter(([t]) => t === 'queued').length).toBe(1);
  });

  it('T2b: S2 via BROWSER_AUTO→[d] trash', async () => {
    const jobLifecycleId = 'e2e-c2-full-trash';

    await ingestor.processIngestCommand({
      source: JobSource.BROWSER_AUTO,
      stage: JobStage.FULL_PARSED,
      rawPayload: FULL_PARSED_HTML,
      jobLifecycleId,
    });

    const completedEvents = parseEvents.filter(([t]) => t === 'completed');
    expect(completedEvents.length).toBe(1);

    await ingestor.processResolutionCommand({
      jobLifecycleId,
      action: 'trash',
    });

    const trashedDoc = await adapter.findById(jobLifecycleId);
    expect(trashedDoc).not.toBeNull();
    expect(trashedDoc!.status).toBe(JobStatus.TRASHED);

    expect(routingEvents.filter(([t]) => t === 'trashed').length).toBe(1);
  });

  it('T2c: S2 without jobLifecycleId creates clip-* doc (browser-auto fallback)', async () => {
    await ingestor.processIngestCommand({
      source: JobSource.BROWSER_AUTO,
      stage: JobStage.FULL_PARSED,
      rawPayload: FULL_PARSED_HTML,
    });

    const completedEvents = parseEvents.filter(([t]) => t === 'completed');
    expect(completedEvents.length).toBe(1);

    const col = (adapter as any).jobLifecycleCollection;
    const docs = await col.find({}).toArray();
    expect(docs.length).toBe(1);
    expect(docs[0].role).toBe('Junior Backend Developer');
    expect(docs[0].matchScore).toBeGreaterThan(0);
  });

  it('T2d: S1→S2 inside same tick (browser-auto merge) then [j]', async () => {
    const messageId = 'e2e-c2-merged';
    const jobLifecycleId = `${messageId}-job-0`;

    await ingestor.processIngestCommand({
      source: JobSource.BROWSER_AUTO,
      stage: JobStage.PARTIAL_PARSED,
      rawPayload: FULL_PARSED_HTML,
      metadata: { messageId, subject: 'Junior Backend Developer' },
    });

    const genEvents = parseEvents.filter(([t]) => t === 'generated');
    expect(genEvents.length).toBe(1);
    expect(genEvents[0][1]._id).toBe(jobLifecycleId);

    await ingestor.processIngestCommand({
      source: JobSource.BROWSER_AUTO,
      stage: JobStage.FULL_PARSED,
      rawPayload: FULL_PARSED_HTML,
      jobLifecycleId,
    });

    const completedEvents = parseEvents.filter(([t]) => t === 'completed');
    expect(completedEvents.length).toBe(1);

    const doc = await adapter.findById(jobLifecycleId);
    expect(doc).not.toBeNull();
    expect(doc!.stage).toBe(JobStage.FULL_PARSED);
    expect(doc!.status).toBe(JobStatus.ENRICHED);

    await ingestor.processResolutionCommand({
      jobLifecycleId,
      action: 'queue',
    });

    expect(routingEvents.filter(([t]) => t === 'queued').length).toBe(1);
  });
});
