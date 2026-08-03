import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createTestStorage } from '../../../helpers/create-test-storage.js';
import { MongoJobLifecycleAdapter } from '../../../../src/infrastructure/outbound/persistence/mongo-job-lifecycle-adapter.js' ;
import { MongoInitializer } from '../../../../src/infrastructure/outbound/persistence/mongo-init.js';
import { getLogger } from '../../../../src/infrastructure/outbound/logging/logger.js' ;
import { JobStage, JobSource, JobStatus } from '../../../../src/domain/types/job-lifecycle.js' ;

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
  let ingestor: JobIngestor;

  beforeAll(async () => {
    storage = await createTestStorage();
    const initializer = new MongoInitializer(storage.client, storage.dbName);
    await initializer.init();
    adapter = new MongoJobLifecycleAdapter(storage.client.db(storage.dbName));
    colection = storage.client.db(storage.dbName).collection('job_lifecycle');

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
    await storage.stop();
  });

  async function clearCollections() {
    const db = storage.client.db(storage.dbName);
    const cols = await db.listCollections().toArray();
    for (const col of cols) {
      await db.collection(col.name).deleteMany({});
    }
  }

  describe('signal2aManual (simulates [c] in Case 1)', () => {
    beforeEach(async () => {
      await clearCollections();
      parseEvents.length = 0;
      routingEvents.length = 0;
    });

    it('upgrades PARTIAL_PARSED to FULL_PARSED with merged fields from clipboard HTML', async () => {
      const jobLifecycleId = 'int-2a-valid';
      const partialDoc = makeStage1Partial({ _id: jobLifecycleId, company: 'OldCo', role: 'Software Engineer' });
      await adapter.upsert(partialDoc);

      await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, htmlFor('Software Engineer', 'NewCo'), jobLifecycleId);

      const completedEvents = parseEvents.filter(([t]) => t === 'completed');
      expect(completedEvents.length).toBe(1);

      const doc = await adapter.findById(jobLifecycleId);
      expect(doc).not.toBeNull();
      expect(doc!.stage).toBe(JobStage.FULL_PARSED);
      expect(doc!.status).toBe(JobStatus.ENRICHED);
      expect(doc!.company).toBe('NewCo');
      expect(doc!.role).toBe('Software Engineer');
    });

    it('emits parse.failed on empty clipboard HTML (S4 path)', async () => {
      const jobLifecycleId = 'int-2a-empty';
      const partialDoc = makeStage1Partial({ _id: jobLifecycleId });
      await adapter.upsert(partialDoc);

      await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, '   ', jobLifecycleId);

      const failedEvents = parseEvents.filter(([t]) => t === 'failed');
      expect(failedEvents.length).toBe(1);
      expect(failedEvents[0][2]).toEqual(expect.objectContaining({ error: 'Empty HTML payload' }));
    });

    it('emits parse.failed on unparsable clipboard HTML', async () => {
      const jobLifecycleId = 'int-2a-noparse';
      const partialDoc = makeStage1Partial({ _id: jobLifecycleId });
      await adapter.upsert(partialDoc);

      await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, makeNonJobHtml(), jobLifecycleId);

      const failedEvents = parseEvents.filter(([t]) => t === 'failed');
      expect(failedEvents.length).toBe(1);
      expect(failedEvents[0][2]).toEqual(expect.objectContaining({ error: 'HTML parse failed' }));
    });

    it('recovers from missing stage1Partial (builds stage2 from parsed HTML alone)', async () => {
      await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, htmlFor('Software Engineer', 'NoPartialCo'), 'missing-partial');

      const completedEvents = parseEvents.filter(([t]) => t === 'completed');
      expect(completedEvents.length).toBe(1);

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

    it('creates new clip-* doc with FULL_PARSED from clipboard HTML', async () => {
      const docsBefore = await colection.countDocuments({});

      await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, htmlFor('Software Engineer', 'ClipCo'));

      const docsAfter = await colection.countDocuments({});
      expect(docsAfter).toBe(docsBefore + 1);

      const col = colection;
      const docs = await col.find({}).sort({ createdAt: -1 }).limit(1).toArray();
      const newDoc = docs[0];
      expect(newDoc._id).toMatch(/^clip-/);
      expect(newDoc.stage).toBe(JobStage.FULL_PARSED);
      expect(newDoc.status).toBe(JobStatus.ENRICHED);
      expect(newDoc.company).toBe('ClipCo');
      expect(newDoc.role).toBe('Software Engineer');

      const completedEvents = parseEvents.filter(([t]) => t === 'completed');
      expect(completedEvents.length).toBe(1);
    });

    it('emits parse.failed on unparsable clipboard HTML', async () => {
      const docsBefore = await colection.countDocuments({});

      await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, makeNonJobHtml());

      const docsAfter = await colection.countDocuments({});
      expect(docsAfter).toBe(docsBefore);

      const failedEvents = parseEvents.filter(([t]) => t === 'failed');
      expect(failedEvents.length).toBe(1);
      expect(failedEvents[0][2]).toEqual(expect.objectContaining({ error: 'HTML parse failed' }));
    });

    it('silently skips duplicate role+company (MongoDB 11000)', async () => {
      await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, htmlFor('Unique Role', 'DedupCorp'));

      const docsBefore = await colection.countDocuments({});
      const completedBefore = parseEvents.filter(([t]) => t === 'completed').length;

      await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, htmlFor('Unique Role', 'DedupCorp'));

      const docsAfter = await colection.countDocuments({});
      expect(docsAfter).toBe(docsBefore);

      const completedEvents = parseEvents.filter(([t]) => t === 'completed');
      expect(completedEvents.length).toBe(completedBefore);
    });

    it('passed through filter and creates clip-* doc', async () => {
      await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, htmlFor('Software Engineer', 'FilterPassCo'));

      const col = colection;
      const doc = await col.findOne({ company: 'FilterPassCo' });
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

    it('[c] then [j]: signal2aManual upgrades partial, then queue resolution succeeds', async () => {
      const jobLifecycleId = 'int-2a-queue';
      await adapter.upsert(makeStage1Partial({ _id: jobLifecycleId }));

      await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, htmlFor('Software Engineer', 'QueueTestCo'), jobLifecycleId);

      const completedEvents = parseEvents.filter(([t]) => t === 'completed');
      expect(completedEvents.length).toBe(1);

      await ingestor.processResolution(jobLifecycleId, 'queue');

      const queuedEvents = routingEvents.filter(([t]) => t === 'queued');
      expect(queuedEvents.length).toBe(1);

      const doc = await adapter.findById(jobLifecycleId);
      expect(doc).not.toBeNull();
      expect(doc!.status).toBe(JobStatus.QUEUED);
    });

    it('[c] then [d]: signal2aManual upgrades partial, then trash resolution succeeds', async () => {
      const jobLifecycleId = 'int-2a-trash';
      await adapter.upsert(makeStage1Partial({ _id: jobLifecycleId }));

      await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, htmlFor('Software Engineer', 'TrashTestCo'), jobLifecycleId);

      const completedEvents = parseEvents.filter(([t]) => t === 'completed');
      expect(completedEvents.length).toBe(1);

      await ingestor.processResolution(jobLifecycleId, 'trash');

      const trashedEvents = routingEvents.filter(([t]) => t === 'trashed');
      expect(trashedEvents.length).toBe(1);

      const doc = await adapter.findById(jobLifecycleId);
      expect(doc).not.toBeNull();
      expect(doc!.status).toBe(JobStatus.TRASHED);
    });

    it('S2 failure (S4) → next S1 still processes', async () => {
      const failedId = 'int-s4-fail';
      await adapter.upsert(makeStage1Partial({ _id: failedId }));

      await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, '   ', failedId);

      const failedEvents = parseEvents.filter(([t]) => t === 'failed');
      expect(failedEvents.length).toBe(1);

      await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, htmlFor('Software Engineer', 'RecoveryCo'));

      const completedAfter = parseEvents.filter(([t]) => t === 'completed');
      expect(completedAfter.length).toBeGreaterThanOrEqual(1);

      const col = colection;
      const recoveryDoc = await col.findOne({ company: 'RecoveryCo' });
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

    it('[i] then [j]: signal2bManual creates clip-*, then queue resolution succeeds', async () => {
      await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, htmlFor('Software Engineer', 'ClipQueueCo'));

      const completedEvents = parseEvents.filter(([t]) => t === 'completed');
      expect(completedEvents.length).toBe(1);
      const clipId = completedEvents[0][1]._id;
      expect(clipId).toMatch(/^clip-/);

      await ingestor.processResolution(clipId, 'queue');

      const queuedEvents = routingEvents.filter(([t]) => t === 'queued');
      expect(queuedEvents.length).toBe(1);

      const doc = await adapter.findById(clipId);
      expect(doc).not.toBeNull();
      expect(doc!.status).toBe(JobStatus.QUEUED);
    });

    it('[i] then [d]: signal2bManual creates clip-*, then trash resolution succeeds', async () => {
      await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, htmlFor('Software Engineer', 'ClipTrashCo'));

      const completedEvents = parseEvents.filter(([t]) => t === 'completed');
      expect(completedEvents.length).toBe(1);

      const col = colection;
      const docs = await col.find({}).sort({ createdAt: -1 }).limit(1).toArray();
      const lastClipId = docs[0]._id;

      await ingestor.processResolution(lastClipId, 'trash');

      const trashedEvents = routingEvents.filter(([t]) => t === 'trashed');
      expect(trashedEvents.length).toBe(1);

      const doc = await adapter.findById(lastClipId);
      expect(doc).not.toBeNull();
      expect(doc!.status).toBe(JobStatus.TRASHED);
    });

    it('resolution failure on clip-* doc emits route.failed', async () => {
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
