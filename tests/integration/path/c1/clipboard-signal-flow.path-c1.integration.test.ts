/* Path cell (c1): S1 uds+ingestor+job_lifecycle (clipboard signal) (see plans/tests-path-matrix.md) */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createTestContainer, type TestContainer } from '../../../helpers/test-container.js';
import { createParseEventPort, createRoutingPort } from '../../../helpers/mock-ports.js';

import { topcvDetailHtml, nonJobHtml } from '../../../helpers/html-fixtures.js';
import { makeStage1Partial } from '../../../helpers/test-builders.js';
import type { MongoJobLifecycleAdapter } from '../../../../src/infrastructure/outbound/persistence/mongo-job-lifecycle-adapter.js' ;
import { JobStage, JobSource, JobStatus } from '../../../../src/domain/types/job-lifecycle.js' ;
import { ActionEvent } from '../../../../src/domain/types/action-event.js';
import type { RealDipBus } from '../../../helpers/real-dip-bus.js';

const { JobIngestor } = await import('../../../../src/application/ingestor.js');

describe('Clipboard ingest signal flow with real storage', () => {
  let tc: TestContainer;
  let adapter: MongoJobLifecycleAdapter;
  let collection: any;
  let parseEvents: any[];
  let routingEvents: any[];
  let realBus: RealDipBus;

  beforeAll(async () => {
    tc = await createTestContainer({ ns: 'c1-clipboard-signal' });
    await tc.start();
    adapter = tc.mongoJobLifecycleAdapter;
    collection = tc.db.collection('job_lifecycle');
    realBus = tc.bus;

    parseEvents = [];
    routingEvents = [];
  }, 120000);

  afterAll(async () => {
    await tc.stop();
  });

  async function clearCollections() {
    await tc.storage.clearDb();
  }

  // parts-integ: mock event ports for deterministic guard/no-emit/failure-injection assertions.
  function mockIngestor(): JobIngestor {
    const parseEventPort = createParseEventPort((tag, args) => parseEvents.push([tag, ...args]));
    const routingPort = createRoutingPort((tag, args) => routingEvents.push([tag, ...args]));
    return new JobIngestor(adapter, parseEventPort, routingPort);
  }

  // real-DIP: the production composition-root ingestor (real RabbitMQ Parse/Route adapters).
  function realIngestor(): JobIngestor {
    return tc.ingestor;
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
      await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, topcvDetailHtml('Software Engineer', 'NewCo'), jobLifecycleId);

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

      await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, nonJobHtml(), jobLifecycleId);

      const failedEvents = parseEvents.filter(([t]) => t === 'failed');
      expect(failedEvents.length).toBe(1);
      expect(failedEvents[0][2]).toEqual(expect.objectContaining({ error: 'HTML parse failed' }));
    });

    it('recovers from missing stage1Partial (builds stage2 from parsed HTML alone) — real-DIP', async () => {
      const ingestor = realIngestor();

      const comp = await realBus.setup([ActionEvent.PARSE_COMPLETED]);
      await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, topcvDetailHtml('Software Engineer', 'NoPartialCo'), 'missing-partial');

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
      const docsBefore = await collection.countDocuments({});

      const comp = await realBus.setup([ActionEvent.PARSE_COMPLETED]);
      await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, topcvDetailHtml('Software Engineer', 'ClipCo'));

      const compMsg = await comp.msg();
      expect(compMsg.job).toBeDefined();
      const clipId = compMsg.job._id;
      expect(clipId).toMatch(/^clip-/);

      const docsAfter = await collection.countDocuments({});
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
      const docsBefore = await collection.countDocuments({});

      await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, nonJobHtml());

      const docsAfter = await collection.countDocuments({});
      expect(docsAfter).toBe(docsBefore);

      const failedEvents = parseEvents.filter(([t]) => t === 'failed');
      expect(failedEvents.length).toBe(1);
      expect(failedEvents[0][2]).toEqual(expect.objectContaining({ error: 'HTML parse failed' }));
    });

    it('silently skips duplicate role+company (MongoDB 11000)', async () => {
      const ingestor = mockIngestor();
      await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, topcvDetailHtml('Unique Role', 'DedupCorp'));

      const docsBefore = await collection.countDocuments({});
      const completedBefore = parseEvents.filter(([t]) => t === 'completed').length;

      await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, topcvDetailHtml('Unique Role', 'DedupCorp'));

      const docsAfter = await collection.countDocuments({});
      expect(docsAfter).toBe(docsBefore);

      const completedEvents = parseEvents.filter(([t]) => t === 'completed');
      expect(completedEvents.length).toBe(completedBefore);
    });

    it('passed through filter and creates clip-* doc — real-DIP', async () => {
      const ingestor = realIngestor();

      const comp = await realBus.setup([ActionEvent.PARSE_COMPLETED]);
      await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, topcvDetailHtml('Software Engineer', 'FilterPassCo'));

      const compMsg = await comp.msg();
      expect(compMsg.job).toBeDefined();
      expect(compMsg.job._id).toMatch(/^clip-/);

      const doc = await collection.findOne({ company: 'FilterPassCo' });
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
      await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, topcvDetailHtml('Software Engineer', 'QueueTestCo'), jobLifecycleId);
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
      await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, topcvDetailHtml('Software Engineer', 'TrashTestCo'), jobLifecycleId);
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
      await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, topcvDetailHtml('Software Engineer', 'RecoveryCo'));

      const compMsg = await comp.msg();
      expect(compMsg.job).toBeDefined();
      expect(compMsg.job.company).toBe('RecoveryCo');

      const recoveryDoc = await collection.findOne({ company: 'RecoveryCo' });
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
      await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, topcvDetailHtml('Software Engineer', 'ClipQueueCo'));

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
      await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, topcvDetailHtml('Software Engineer', 'ClipTrashCo'));

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
      await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, topcvDetailHtml('Software Engineer', 'FailResolutionCo'));

      const completedEvents = parseEvents.filter(([t]) => t === 'completed');
      expect(completedEvents.length).toBe(1);

      const col = collection;
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
