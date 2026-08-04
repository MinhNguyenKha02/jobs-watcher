import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createTestStorage } from '../../../helpers/create-test-storage.js';
import { createRealDipBus, type RealDipBus } from '../../../helpers/real-dip-bus.js';
import { MongoJobLifecycleAdapter } from '../../../../src/infrastructure/outbound/persistence/mongo-job-lifecycle-adapter.js' ;
import { MongoInitializer } from '../../../../src/infrastructure/outbound/persistence/mongo-init.js';
import { getLogger } from '../../../../src/infrastructure/outbound/logging/logger.js' ;
import { JobStage, JobSource, JobStatus } from '../../../../src/domain/types/job-lifecycle.js' ;
import { ActionEvent } from '../../../../src/domain/types/action-event.js';

const logger = getLogger();
const { JobIngestor } = await import('../../../../src/application/ingestor.js');

function htmlFor(role: string, company: string): string {
  return '<div class="job-detail__info--title"><h1>' + role + '</h1></div>'
    + '<div class="company-name-label"><a class="name">' + company + '</a></div>'
    + '<div>topcv</div>'
    + '<p>TypeScript</p>'
    + '<div class="job-description__item"><h3>Mô tả công việc</h3>'
    + '<div class="job-description__item--content">We need a TypeScript developer with JavaScript skills</div>'
    + '</div>';
}

function makeNonJobHtml(): string {
  return '<html><body><div>no job data here at all</div></body></html>';
}

function makeStage1Partial(overrides: any = {}): any {
  return {
    _id: overrides._id || 'test-id',
    raw: '<html><body>partial</body></html>',
    stage: JobStage.PARTIAL_PARSED,
    status: JobStatus.ENRICHING,
    source: JobSource.BROWSER_AUTO,
    company: overrides.company || 'TestCo',
    role: overrides.role || 'Software Engineer',
    url: overrides.url || 'https://test.com/job',
    createdAt: new Date(),
    updatedAt: new Date(),
    stageTimestamp: new Date(),
    ...overrides,
  };
}

describe('Clipboard ingest signal flow with real storage', () => {
  let storage: any;
  let adapter: MongoJobLifecycleAdapter;
  let colection: any;
  let parseEvents: any[];
  let routingEvents: any[];
  let realBus: RealDipBus;

  beforeAll(async () => {
    storage = await createTestStorage();
    const initializer = new MongoInitializer(storage.client, storage.dbName);
    await initializer.init();
    adapter = new MongoJobLifecycleAdapter(storage.client.db(storage.dbName));
    colection = storage.client.db(storage.dbName).collection('job_lifecycle');
    realBus = await createRealDipBus('jobs.events.int.c1.clipboard');

    parseEvents = [];
    routingEvents = [];
  }, 120000);

  afterAll(async () => {
    await realBus.teardown();
    await storage.stop();
  });

  async function clearCollections() {
    const db = storage.client.db(storage.dbName);
    const cols = await db.listCollections().toArray();
    for (const col of cols) {
      await db.collection(col.name).deleteMany({});
    }
  }

  // parts-integ: mock event ports for deterministic guard/no-emit/failure-injection assertions.
  function mockIngestor(): JobIngestor {
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
    return new JobIngestor(adapter, parseEventPort, routingPort);
  }

  // real-DIP: real RabbitMQ Parse/Route adapters wired over the application ports.
  function realIngestor(): JobIngestor {
    return new JobIngestor(adapter, realBus.parsePort, realBus.routePort);
  }

  describe('signal2aManual (simulates [c] in Case 1)', () => {
    beforeEach(async () => {
      await clearCollections();
      parseEvents.length = 0;
      routingEvents.length = 0;
    });

    it('upgrades PARTIAL_PARSED to FULL_PARSED with merged fields from clipboard HTML — real-DIP', async () => {
      const ingestor = realIngestor();
      const jobLifecycleId = 'int-2a-valid';
      const partialDoc = makeStage1Partial({ _id: jobLifecycleId, company: 'OldCo', role: 'Software Engineer' });
      await adapter.upsert(partialDoc);

      const comp = await realBus.setup([ActionEvent.PARSE_COMPLETED]);
      await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, htmlFor('Software Engineer', 'NewCo'), jobLifecycleId);

      const compMsg = await comp.msg();
      expect(compMsg.job).toBeDefined();
      expect(compMsg.job._id).toBe(jobLifecycleId);

      const doc = await adapter.findById(jobLifecycleId);
      expect(doc).not.toBeNull();
      expect(doc!.stage).toBe(JobStage.FULL_PARSED);
      expect(doc!.status).toBe(JobStatus.ENRICHED);
      expect(doc!.company).toBe('NewCo');
      expect(doc!.role).toBe('Software Engineer');
    });

    it('emits parse.failed on empty clipboard HTML (S4 path)', async () => {
      const ingestor = mockIngestor();
      const jobLifecycleId = 'int-2a-empty';
      const partialDoc = makeStage1Partial({ _id: jobLifecycleId });
      await adapter.upsert(partialDoc);

      await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, '   ', jobLifecycleId);

      const failedEvents = parseEvents.filter(([t]) => t === 'failed');
      expect(failedEvents.length).toBe(1);
      expect(failedEvents[0][2]).toEqual(expect.objectContaining({ error: 'Empty HTML payload' }));
    });

    it('emits parse.failed on unparsable clipboard HTML', async () => {
      const ingestor = mockIngestor();
      const jobLifecycleId = 'int-2a-noparse';
      const partialDoc = makeStage1Partial({ _id: jobLifecycleId });
      await adapter.upsert(partialDoc);

      await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, makeNonJobHtml(), jobLifecycleId);

      const failedEvents = parseEvents.filter(([t]) => t === 'failed');
      expect(failedEvents.length).toBe(1);
      expect(failedEvents[0][2]).toEqual(expect.objectContaining({ error: 'HTML parse failed' }));
    });

    it('recovers from missing stage1Partial (builds stage2 from parsed HTML alone) — real-DIP', async () => {
      const ingestor = realIngestor();

      const comp = await realBus.setup([ActionEvent.PARSE_COMPLETED]);
      await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, htmlFor('Software Engineer', 'NoPartialCo'), 'missing-partial');

      const compMsg = await comp.msg();
      expect(compMsg.job).toBeDefined();
      expect(compMsg.job._id).toBe('missing-partial');

      const doc = await adapter.findById('missing-partial');
      expect(doc).not.toBeNull();
      expect(doc!.company).toBe('NoPartialCo');
      expect(doc!.role).toBe('Software Engineer');
      expect(doc!.stage).toBe(JobStage.FULL_PARSED);
    });
  });

  describe('signal2bManual (simulates [i] in Case 4)', () => {
    beforeEach(async () => {
      await clearCollections();
      parseEvents.length = 0;
      routingEvents.length = 0;
    });

    it('creates new clip-* doc with FULL_PARSED from clipboard HTML — real-DIP', async () => {
      const ingestor = realIngestor();
      const docsBefore = await colection.countDocuments({});

      const comp = await realBus.setup([ActionEvent.PARSE_COMPLETED]);
      await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, htmlFor('Software Engineer', 'ClipCo'));

      const compMsg = await comp.msg();
      expect(compMsg.job).toBeDefined();
      const clipId = compMsg.job._id;
      expect(clipId).toMatch(/^clip-/);

      const docsAfter = await colection.countDocuments({});
      expect(docsAfter).toBe(docsBefore + 1);

      const doc = await adapter.findById(clipId);
      expect(doc).not.toBeNull();
      expect(doc!.stage).toBe(JobStage.FULL_PARSED);
      expect(doc!.status).toBe(JobStatus.ENRICHED);
      expect(doc!.company).toBe('ClipCo');
      expect(doc!.role).toBe('Software Engineer');
    });

    it('emits parse.failed on unparsable clipboard HTML', async () => {
      const ingestor = mockIngestor();
      const docsBefore = await colection.countDocuments({});

      await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, makeNonJobHtml());

      const docsAfter = await colection.countDocuments({});
      expect(docsAfter).toBe(docsBefore);

      const failedEvents = parseEvents.filter(([t]) => t === 'failed');
      expect(failedEvents.length).toBe(1);
      expect(failedEvents[0][2]).toEqual(expect.objectContaining({ error: 'HTML parse failed' }));
    });

    it('silently skips duplicate role+company (MongoDB 11000)', async () => {
      const ingestor = mockIngestor();
      await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, htmlFor('Unique Role', 'DedupCorp'));

      const docsBefore = await colection.countDocuments({});
      const completedBefore = parseEvents.filter(([t]) => t === 'completed').length;

      await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, htmlFor('Unique Role', 'DedupCorp'));

      const docsAfter = await colection.countDocuments({});
      expect(docsAfter).toBe(docsBefore);

      const completedEvents = parseEvents.filter(([t]) => t === 'completed');
      expect(completedEvents.length).toBe(completedBefore);
    });

    it('passed through filter and creates clip-* doc — real-DIP', async () => {
      const ingestor = realIngestor();

      const comp = await realBus.setup([ActionEvent.PARSE_COMPLETED]);
      await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, htmlFor('Software Engineer', 'FilterPassCo'));

      const compMsg = await comp.msg();
      expect(compMsg.job).toBeDefined();
      expect(compMsg.job._id).toMatch(/^clip-/);

      const doc = await colection.findOne({ company: 'FilterPassCo' });
      expect(doc).not.toBeNull();
      expect(doc!._id).toMatch(/^clip-/);
    });
  });

  describe('signal2aManual → resolution (Case 1 completion: [c]→[j]/[d])', () => {
    beforeEach(async () => {
      await clearCollections();
      parseEvents.length = 0;
      routingEvents.length = 0;
    });

    it('[c] then [j]: signal2aManual upgrades partial, then queue resolution succeeds — real-DIP', async () => {
      const ingestor = realIngestor();
      const jobLifecycleId = 'int-2a-queue';
      await adapter.upsert(makeStage1Partial({ _id: jobLifecycleId }));

      const comp = await realBus.setup([ActionEvent.PARSE_COMPLETED]);
      await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, htmlFor('Software Engineer', 'QueueTestCo'), jobLifecycleId);
      await comp.msg();

      const queue = await realBus.setup([ActionEvent.QUEUED, ActionEvent.TRASHED, ActionEvent.ROUTE_FAILED]);
      await ingestor.processResolution(jobLifecycleId, 'queue');

      const queueMsg = await queue.msg();
      expect(queueMsg.jobLifecycleId).toBe(jobLifecycleId);

      const doc = await adapter.findById(jobLifecycleId);
      expect(doc).not.toBeNull();
      expect(doc!.status).toBe(JobStatus.QUEUED);
    });

    it('[c] then [d]: signal2aManual upgrades partial, then trash resolution succeeds — real-DIP', async () => {
      const ingestor = realIngestor();
      const jobLifecycleId = 'int-2a-trash';
      await adapter.upsert(makeStage1Partial({ _id: jobLifecycleId }));

      const comp = await realBus.setup([ActionEvent.PARSE_COMPLETED]);
      await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, htmlFor('Software Engineer', 'TrashTestCo'), jobLifecycleId);
      await comp.msg();

      const trash = await realBus.setup([ActionEvent.TRASHED, ActionEvent.ROUTE_FAILED, ActionEvent.PARSE_FAILED]);
      await ingestor.processResolution(jobLifecycleId, 'trash');

      const trashMsg = await trash.msg();
      expect(trashMsg.jobLifecycleId).toBe(jobLifecycleId);
      expect(trashMsg.reason).toBe('operator:trash');

      const doc = await adapter.findById(jobLifecycleId);
      expect(doc).not.toBeNull();
      expect(doc!.status).toBe(JobStatus.TRASHED);
    });

    it('S2 failure (S4) → next S1 still processes — real-DIP', async () => {
      const ingestor = realIngestor();
      const failedId = 'int-s4-fail';
      await adapter.upsert(makeStage1Partial({ _id: failedId }));

      const fail = await realBus.setup([ActionEvent.PARSE_FAILED]);
      await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, '   ', failedId);
      const failMsg = await fail.msg();
      expect(failMsg.jobLifecycleId).toBe(failedId);

      const comp = await realBus.setup([ActionEvent.PARSE_COMPLETED]);
      await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, htmlFor('Software Engineer', 'RecoveryCo'));

      const compMsg = await comp.msg();
      expect(compMsg.job).toBeDefined();
      expect(compMsg.job.company).toBe('RecoveryCo');

      const recoveryDoc = await colection.findOne({ company: 'RecoveryCo' });
      expect(recoveryDoc).not.toBeNull();
      expect(recoveryDoc!.status).toBe(JobStatus.ENRICHED);
    });
  });

  describe('signal2bManual → resolution (Case 4 completion: [i]→[j]/[d])', () => {
    beforeEach(async () => {
      await clearCollections();
      parseEvents.length = 0;
      routingEvents.length = 0;
    });

    it('[i] then [j]: signal2bManual creates clip-*, then queue resolution succeeds — real-DIP', async () => {
      const ingestor = realIngestor();

      const comp = await realBus.setup([ActionEvent.PARSE_COMPLETED]);
      await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, htmlFor('Software Engineer', 'ClipQueueCo'));

      const compMsg = await comp.msg();
      const clipId = compMsg.job._id;
      expect(clipId).toMatch(/^clip-/);

      const queue = await realBus.setup([ActionEvent.QUEUED, ActionEvent.TRASHED, ActionEvent.ROUTE_FAILED]);
      await ingestor.processResolution(clipId, 'queue');

      const queueMsg = await queue.msg();
      expect(queueMsg.jobLifecycleId).toBe(clipId);

      const doc = await adapter.findById(clipId);
      expect(doc).not.toBeNull();
      expect(doc!.status).toBe(JobStatus.QUEUED);
    });

    it('[i] then [d]: signal2bManual creates clip-*, then trash resolution succeeds — real-DIP', async () => {
      const ingestor = realIngestor();

      const comp = await realBus.setup([ActionEvent.PARSE_COMPLETED]);
      await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, htmlFor('Software Engineer', 'ClipTrashCo'));

      const compMsg = await comp.msg();
      const clipId = compMsg.job._id;
      expect(clipId).toMatch(/^clip-/);

      const trash = await realBus.setup([ActionEvent.TRASHED, ActionEvent.ROUTE_FAILED, ActionEvent.PARSE_FAILED]);
      await ingestor.processResolution(clipId, 'trash');

      const trashMsg = await trash.msg();
      expect(trashMsg.jobLifecycleId).toBe(clipId);
      expect(trashMsg.reason).toBe('operator:trash');

      const doc = await adapter.findById(clipId);
      expect(doc).not.toBeNull();
      expect(doc!.status).toBe(JobStatus.TRASHED);
    });

    it('resolution failure on clip-* doc emits route.failed', async () => {
      const ingestor = mockIngestor();
      await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, htmlFor('Software Engineer', 'FailResolutionCo'));

      const completedEvents = parseEvents.filter(([t]) => t === 'completed');
      expect(completedEvents.length).toBe(1);

      const col = colection;
      const docs = await col.find({}).sort({ createdAt: -1 }).limit(1).toArray();
      const clipId = docs[0]._id;

      vi.spyOn(adapter, 'updateStage').mockRejectedValueOnce(new Error('DB timeout'));

      await ingestor.processResolution(clipId, 'queue');

      const routeFailedEvents = routingEvents.filter(([t]) => t === 'failed');
      expect(routeFailedEvents.length).toBe(1);
      expect(routeFailedEvents[0][2]).toBe('DB timeout');

      vi.restoreAllMocks();
    });
  });
});
