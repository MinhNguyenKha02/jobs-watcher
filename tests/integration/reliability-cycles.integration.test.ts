import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createTestStorage } from '../helpers/create-test-storage.js';
import { MongoDBStorageAdapter } from '../../src/infrastructure/outbound/persistence/mongodb-storage-adapter.js' ;
import { getLogger } from '../../src/infrastructure/outbound/logging/logger.js' ;
import { JobStage, JobSource, JobStatus } from '../../src/domain/types/job-lifecycle.js' ;

const logger = getLogger();
const { default: JobIngestor } = await import('../../src/application/ingestor.js');

function makeTopCvHtml(company = 'TestCo'): string {
  return '<div class="job-detail__info--title"><h1>Junior Engineer</h1></div>'
    + '<div class="company-name-label"><a class="name">' + company + '</a></div>'
    + '<div>topcv</div>';
}

describe('Reliability cycles (S2→S4→S1 failure auto-advance)', () => {
  let storage: any;
  let adapter: MongoDBStorageAdapter;
  let parseEvents: any[];
  let routingEvents: any[];
  let ingestor: any;

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
      emitJobGenerated: vi.fn((...args: any[]) => { parseEvents.push(['generated', ...args]); }),
      emitJobGeneratedFailed: vi.fn((...args: any[]) => { parseEvents.push(['generatedFailed', ...args]); }),
      emitParseCompleted: vi.fn((...args: any[]) => { parseEvents.push(['completed', ...args]); }),
      emitParseFailed: vi.fn((...args: any[]) => { parseEvents.push(['failed', ...args]); }),
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

  beforeEach(() => {
    parseEvents.length = 0;
    routingEvents.length = 0;
  });

  it('S2 parse.failed → S1 next job: emits s4a then s1 for new job', async () => {
    await ingestor.processIngestCommand({
      source: JobSource.MANUAL,
      stage: JobStage.FULL_PARSED,
      rawPayload: '',
      joblifecycleId: 'job-fail-s4a',
    });

    const failedEvents = parseEvents.filter(([t]) => t === 'failed');
    expect(failedEvents.length).toBe(1);

    await ingestor.processIngestCommand({
      source: JobSource.BROWSER_AUTO,
      stage: JobStage.PARTIAL_PARSED,
      rawPayload: makeTopCvHtml('AlphaCo'),
      metadata: { messageId: 'job-after-s4a' },
    });

    const generatedEvents = parseEvents.filter(([t]) => t === 'generated');
    expect(generatedEvents.length).toBe(1);
    const doc = await adapter.findJobLifecycleById('job-after-s4a-job-0');
    expect(doc).not.toBeNull();
    expect(doc!.stage).toBe(JobStage.PARTIAL_PARSED);
  });

  it('S3 route.failed → S1 next job: emits s4b then s1 for new job', async () => {
    const doc = {
      _id: 'job-fail-s4b',
      raw: '<html>test</html>',
      stage: JobStage.FULL_PARSED,
      status: JobStatus.ENRICHED,
      source: JobSource.MANUAL,
      company: 'FailCo',
      role: 'Engineer',
      createdAt: new Date(),
      updatedAt: new Date(),
      stageTimestamp: new Date(),
    };
    await adapter.upsertJobLifecycle(doc);
    vi.spyOn(adapter, 'updateJobStatus').mockRejectedValueOnce(new Error('DB write timeout'));

    await ingestor.processResolutionCommand({
      joblifecycleId: 'job-fail-s4b',
      action: 'queue',
      editedKVs: {},
    });

    const failedRoutingEvents = routingEvents.filter(([t]) => t === 'failed');
    expect(failedRoutingEvents.length).toBe(1);

    vi.restoreAllMocks();

    await ingestor.processIngestCommand({
      source: JobSource.BROWSER_AUTO,
      stage: JobStage.PARTIAL_PARSED,
      rawPayload: makeTopCvHtml('BetaCo'),
      metadata: { messageId: 'job-after-s4b' },
    });

    const generatedEvents = parseEvents.filter(([t]) => t === 'generated');
    expect(generatedEvents.length).toBe(1);
  });

  it('S2 parse.failed (empty html) then S2a manual succeeds for different job', async () => {
    await ingestor.processIngestCommand({
      source: JobSource.MANUAL,
      stage: JobStage.FULL_PARSED,
      rawPayload: '',
      joblifecycleId: 'job-s4-empty',
    });

    const failBefore = parseEvents.filter(([t]) => t === 'failed').length;
    expect(failBefore).toBe(1);

    const partialDoc = {
      _id: 'job-s4-recover',
      raw: '<html><body>partial</body></html>',
      stage: JobStage.PARTIAL_PARSED,
      status: JobStatus.ENRICHING,
      source: JobSource.BROWSER_AUTO,
      company: 'RecoveryCo',
      role: 'Junior Engineer',
      url: 'https://recovery.com/job',
      createdAt: new Date(),
      updatedAt: new Date(),
      stageTimestamp: new Date(),
    };
    await adapter.upsertJobLifecycle(partialDoc);

    await ingestor.processIngestCommand({
      source: JobSource.MANUAL,
      stage: JobStage.FULL_PARSED,
      rawPayload: makeTopCvHtml('RecoveryCo'),
      joblifecycleId: 'job-s4-recover',
    });

    const completedEvents = parseEvents.filter(([t]) => t === 'completed');
    expect(completedEvents.length).toBe(1);

    const fullDoc = await adapter.findJobLifecycleById('job-s4-recover');
    expect(fullDoc).not.toBeNull();
    expect(fullDoc!.stage).toBe(JobStage.FULL_PARSED);
    expect(fullDoc!.status).toBe(JobStatus.ENRICHED);
  });
});
