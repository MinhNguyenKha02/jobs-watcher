import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { createTestStorage } from '../helpers/create-test-storage.js';
import { MongoJobLifecycleAdapter } from '../../src/infrastructure/outbound/persistence/mongo-job-lifecycle-adapter.js' ;
import { getLogger } from '../../src/infrastructure/outbound/logging/logger.js' ;
import { JobStage, JobSource, JobStatus } from '../../src/domain/types/job-lifecycle.js' ;

const logger = getLogger();
const { JobIngestor } = await import('../../src/application/ingestor.js');

function htmlFor(role: string, company: string): string {
  return '<div class="job-detail__info--title"><h1>' + role + '</h1></div>'
    + '<div class="company-name-label"><a class="name">' + company + '</a></div>'
    + '<div>topcv</div>';
}

describe('Failure recovery: S2→S4→S1 auto-advance cycle', () => {
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

  beforeEach(() => {
    parseEvents.length = 0;
    routingEvents.length = 0;
  });

  it('s2 parse failure (s4a) then next s1 succeeds', async () => {
    const failedJobId = 'cycle-fail-1';
    const nextJobId = 'cycle-next-1';

    const partialDoc = {
      _id: failedJobId,
      raw: '<html>partial</html>',
      stage: JobStage.PARTIAL_PARSED,
      status: JobStatus.ENRICHING,
      source: JobSource.BROWSER_AUTO,
      company: 'FailCorp',
      role: 'Fail Role',
      createdAt: new Date(),
      updatedAt: new Date(),
      stageTimestamp: new Date(),
    };
    await adapter.upsert(partialDoc as any);

    const failedBefore = parseEvents.filter(([t]) => t === 'failed').length;

    await ingestor.processIngestCommand({
      source: JobSource.MANUAL,
      stage: JobStage.FULL_PARSED,
      rawPayload: '',
      jobLifecycleId: failedJobId,
    });

    const failedEvents = parseEvents.filter(([t]) => t === 'failed');
    expect(failedEvents.length).toBe(failedBefore + 1);

    const failedDoc = await adapter.findById(failedJobId);
    expect(failedDoc).not.toBeNull();
    if (failedDoc) {
      expect(failedDoc.status).toBe(JobStatus.ENRICHING);
    }

    const genBefore = parseEvents.filter(([t]) => t === 'generated').length;
    await ingestor.processIngestCommand({
      source: JobSource.MANUAL,
      stage: JobStage.FULL_PARSED,
      rawPayload: htmlFor('Junior Developer', 'NextCorp'),
    });

    const genEvents = parseEvents.filter(([t]) => t === 'generated');
    expect(genEvents.length).toBe(genBefore);
    const completedEvents = parseEvents.filter(([t]) => t === 'completed');
    expect(completedEvents.length).toBeGreaterThanOrEqual(1);

    const col = (adapter as any).jobLifecycleCollection;
    const nextDocs = await col.find({ _id: { $regex: /^clip-/ } }).toArray();
    expect(nextDocs.length).toBeGreaterThanOrEqual(1);
    expect(nextDocs[0].company).toBe('NextCorp');
  });

  it('route failure (s4b) then next s1 succeeds', async () => {
    const routeFailId = 'cycle-route-fail-1';
    const routeNextId = 'cycle-route-next-1';

    const fullDoc = {
      _id: routeFailId,
      raw: htmlFor('Engineer', 'RouteFailCo'),
      stage: JobStage.FULL_PARSED,
      status: JobStatus.ENRICHED,
      source: JobSource.MANUAL,
      company: 'RouteFailCo',
      role: 'Engineer',
      createdAt: new Date(),
      updatedAt: new Date(),
      stageTimestamp: new Date(),
    };
    await adapter.upsert(fullDoc as any);

    const routeFailedBefore = routingEvents.filter(([t]) => t === 'failed').length;

    vi.spyOn(adapter, 'updateStage').mockRejectedValueOnce(new Error('DB write conflict'));

    const command = { jobLifecycleId: routeFailId, action: 'queue' as const, editedKVs: {} };
    await ingestor.processResolutionCommand(command);

    vi.restoreAllMocks();

    const routeFailedEvents = routingEvents.filter(([t]) => t === 'failed');
    expect(routeFailedEvents.length).toBeGreaterThan(routeFailedBefore);

    const genBefore = parseEvents.filter(([t]) => t === 'generated').length;
    await ingestor.processIngestCommand({
      source: JobSource.BROWSER_AUTO,
      stage: JobStage.PARTIAL_PARSED,
      rawPayload: htmlFor('Software Engineer', 'NextAfterRouteFail'),
      metadata: { messageId: 'next-after-route-fail' },
    });

    const genEvents = parseEvents.filter(([t]) => t === 'generated');
    expect(genEvents.length).toBeGreaterThan(genBefore);
  });

  it('s2 enrichment then s3 failure then next s1 dequeues', async () => {
    const enrichJobId = 'cycle-enrich-1';

    await ingestor.processIngestCommand({
      source: JobSource.BROWSER_AUTO,
      stage: JobStage.PARTIAL_PARSED,
      rawPayload: htmlFor('Software Engineer', 'EnrichCo'),
      metadata: { messageId: 'enrich-msg' },
    });

    const genEvents = parseEvents.filter(([t]) => t === 'generated');
    const s1Job = genEvents[genEvents.length - 1];
    const s1JoblifecycleId = s1Job?.[1]?._id;
    expect(s1JoblifecycleId).toBeTruthy();

    await ingestor.processIngestCommand({
      source: JobSource.MANUAL,
      stage: JobStage.FULL_PARSED,
      rawPayload: htmlFor('Software Engineer', 'EnrichCo'),
      jobLifecycleId: s1JoblifecycleId,
    });

    const completedEvents = parseEvents.filter(([t]) => t === 'completed');
    const lastCompleted = completedEvents[completedEvents.length - 1];
    expect(lastCompleted).toBeDefined();
    expect(lastCompleted[1]).toBe(s1JoblifecycleId);

    const nextGenBefore = parseEvents.filter(([t]) => t === 'generated').length;
    await ingestor.processIngestCommand({
      source: JobSource.BROWSER_AUTO,
      stage: JobStage.PARTIAL_PARSED,
      rawPayload: htmlFor('Software Engineer', 'KeepCo'),
      metadata: { messageId: 'keep-msg' },
    });

    const nextGenEvents = parseEvents.filter(([t]) => t === 'generated');
    expect(nextGenEvents.length).toBeGreaterThan(nextGenBefore);
  });

  it('consecutive S2 failures: each emits parse.failed (rate test)', async () => {
    const failedBefore = parseEvents.filter(([t]) => t === 'failed').length;
    const routeFailedBefore = routingEvents.filter(([t]) => t === 'failed').length;
    for (let i = 0; i < 5; i++) {
      await ingestor.processIngestCommand({
        source: JobSource.MANUAL,
        stage: JobStage.FULL_PARSED,
        rawPayload: '',
        jobLifecycleId: `rate-fail-${i}`,
      });
    }

    const failedEvents = parseEvents.filter(([t]) => t === 'failed');
    expect(failedEvents.length).toBe(failedBefore + 5);

    const routeFailedAfter = routingEvents.filter(([t]) => t === 'failed').length;
    expect(routeFailedAfter).toBe(routeFailedBefore);

    await ingestor.processIngestCommand({
      source: JobSource.BROWSER_AUTO,
      stage: JobStage.PARTIAL_PARSED,
      rawPayload: htmlFor('Software Engineer', 'AfterRateCo'),
      metadata: { messageId: 'after-rate' },
    });

    const genEvents = parseEvents.filter(([t]) => t === 'generated');
    expect(genEvents.length).toBeGreaterThan(0);
    expect(genEvents[genEvents.length - 1][1].company).toBe('AfterRateCo');
  });

  it('S2 and S3 failures interleaved: both advance to S4 then next S1 recovers (rate test)', async () => {
    const failedBefore = parseEvents.filter(([t]) => t === 'failed').length;
    const routeFailedBefore = routingEvents.filter(([t]) => t === 'failed').length;

    // Interleave S2 failures (empty HTML) and S3 failures (DB reject)
    for (let i = 0; i < 10; i++) {
      const jobId = `interleave-fail-${i}`;
      await adapter.upsert({
        _id: jobId, raw: '<html>x</html>', stage: JobStage.FULL_PARSED,
        status: JobStatus.ENRICHED, source: JobSource.MANUAL,
        company: `FailCo${i}`, role: 'Engineer',
        createdAt: new Date(), updatedAt: new Date(), stageTimestamp: new Date(),
      } as any);

      if (i % 2 === 0) {
        await ingestor.processIngestCommand({
          source: JobSource.MANUAL, stage: JobStage.FULL_PARSED,
          rawPayload: '', jobLifecycleId: jobId,
        });
      } else {
        vi.spyOn(adapter, 'updateStage').mockRejectedValueOnce(new Error('DB timeout'));
        await ingestor.processResolutionCommand({
          jobLifecycleId: jobId, action: 'queue', editedKVs: {},
        });
      }
    }

    const failedAfter = parseEvents.filter(([t]) => t === 'failed').length;
    expect(failedAfter).toBeGreaterThanOrEqual(failedBefore + 5);

    const routeFailedAfter = routingEvents.filter(([t]) => t === 'failed').length;
    expect(routeFailedAfter).toBeGreaterThanOrEqual(routeFailedBefore + 5);

    // Recovery: next S1 partial processes normally
    await ingestor.processIngestCommand({
      source: JobSource.BROWSER_AUTO, stage: JobStage.PARTIAL_PARSED,
      rawPayload: htmlFor('Software Engineer', 'InterleaveRecoveryCo'),
      metadata: { messageId: 'interleave-recovery' },
    });

    const genEvents = parseEvents.filter(([t]) => t === 'generated');
    expect(genEvents[genEvents.length - 1][1].company).toBe('InterleaveRecoveryCo');
  });

  it('concurrent S1+S2 from different sources does not corrupt job (interleaving)', async () => {
    const messageId = 'concurrent-s1-s2';
    const jobLifecycleId = `${messageId}-job-0`;

    await Promise.all([
      ingestor.processIngestCommand({
        source: JobSource.BROWSER_AUTO, stage: JobStage.PARTIAL_PARSED,
        rawPayload: htmlFor('Software Engineer', 'ConcurrentCo'),
        metadata: { messageId, subject: 'Software Engineer' },
      }),
      ingestor.processIngestCommand({
        source: JobSource.BROWSER_AUTO, stage: JobStage.FULL_PARSED,
        rawPayload: htmlFor('Software Engineer', 'ConcurrentCo'),
        jobLifecycleId,
      }),
    ]);

    // S1 should have emitted job.generated and S2 should have emitted job.parse.completed
    const genEvents = parseEvents.filter(([t]) => t === 'generated');
    expect(genEvents.length).toBeGreaterThanOrEqual(1);

    const completedEvents = parseEvents.filter(([t]) => t === 'completed');
    expect(completedEvents.length).toBeGreaterThanOrEqual(1);

    const doc = await adapter.findById(jobLifecycleId);
    expect(doc).not.toBeNull();
    expect(doc!.stage).toBe(JobStage.FULL_PARSED);

    expect(parseEvents.filter(([t]) => t === 'failed').length).toBe(0);
  });


  it('signal2aManual with jobLifecycleId processes valid HTML successfully', async () => {
    const docId = 'b9-integration-job';
    const partialDoc = {
      _id: docId,
      raw: '<html>dummy</html>',
      stage: JobStage.PARTIAL_PARSED,
      status: JobStatus.ENRICHING,
      source: JobSource.MANUAL,
      company: 'B9IntegCo',
      role: 'B9 Role',
      createdAt: new Date(),
      updatedAt: new Date(),
      stageTimestamp: new Date(),
    };
    await adapter.upsert(partialDoc as any);

    const completedBefore = parseEvents.filter(([t]) => t === 'completed').length;

    await ingestor.processIngestCommand({
      source: JobSource.MANUAL,
      stage: JobStage.FULL_PARSED,
      rawPayload: htmlFor('Junior Engineer', 'B9IntegCo'),
      jobLifecycleId: docId,
    });

    const completedAfter = parseEvents.filter(([t]) => t === 'completed').length;
    expect(completedAfter).toBeGreaterThan(completedBefore);
  });
});
