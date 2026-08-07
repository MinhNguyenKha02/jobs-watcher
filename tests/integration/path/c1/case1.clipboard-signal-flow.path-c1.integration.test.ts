/* Path cell (c1): S1 uds+ingestor+job_lifecycle (clipboard + direct Signal 2a) (see plans/tests-path-matrix.md) */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContainer, type TestContainer } from '../../../helpers/test-container.js';
import { createParseEventPort, createRoutingPort } from '../../../helpers/mock-ports.js';

import { topcvDetailHtml, nonJobHtml, linkedinSduiDetailHtml } from '../../../helpers/html-fixtures.js';
import { makeStage1Partial } from '../../../helpers/test-builders.js';
import type { MongoJobLifecycleAdapter } from '../../../../src/infrastructure/outbound/persistence/mongo-job-lifecycle-adapter.js' ;
import { JobStage, JobSource, JobStatus } from '../../../../src/domain/types/job-lifecycle.js' ;
import { ActionEvent } from '../../../../src/domain/types/action-event.js';
import type { RealDipBus } from '../../../helpers/real-dip-bus.js';

const { JobIngestor } = await import('../../../../src/application/ingestor.js');

const DM_HTML = linkedinSduiDetailHtml('Backend Developer', 'ClipJuniorCorp');
const DM_EMPTY = '';

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

  describe('Direct signal2a (simulates [c] in direct mode — merged-DM)', () => {
    it('Signal 2a upgrades PARTIAL_PARSED to FULL_PARSED with merged fields — real-DIP', async () => {
      const ingestor = realIngestor();
      const jobLifecycleId = 'e2e-2a-1';
      const partialDoc = {
        _id: jobLifecycleId,
        raw: '<html><body>partial</body></html>',
        stage: JobStage.PARTIAL_PARSED,
        status: JobStatus.ENRICHING,
        source: JobSource.BROWSER_AUTO,
        company: 'OldCorp',
        role: 'Backend Developer',
        url: 'https://example.com/job',
        createdAt: new Date(),
        updatedAt: new Date(),
        stageTimestamp: new Date(),
      };
      await adapter.upsert(partialDoc as any);

      const comp = await realBus.setup([ActionEvent.PARSE_COMPLETED]);
      await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, DM_HTML, jobLifecycleId, undefined, new Date());
      const compMsg = await comp.msg();
      expect(compMsg.job).toBeDefined();
      expect(compMsg.job._id).toBe(jobLifecycleId);

      const fullDoc = await adapter.findById(jobLifecycleId);
      expect(fullDoc).not.toBeNull();
      expect(fullDoc!.stage).toBe(JobStage.FULL_PARSED);
      expect(fullDoc!.status).toBe(JobStatus.ENRICHED);
      expect(fullDoc!.company).toBe('ClipJuniorCorp');
      expect(fullDoc!.role).toBe('Backend Developer');
      expect(fullDoc!.location).toBe('Ho Chi Minh City, Vietnam');
    });

    it('Signal 2a with empty payload fails gracefully — real-DIP', async () => {
      const ingestor = realIngestor();
      const jobLifecycleId = 'e2e-2a-empty';
      const partialDoc = {
        _id: jobLifecycleId,
        raw: '<html><body>partial</body></html>',
        stage: JobStage.PARTIAL_PARSED,
        status: JobStatus.ENRICHING,
        source: JobSource.BROWSER_AUTO,
        company: 'FailCorp',
        role: 'Backend Developer',
        createdAt: new Date(),
        updatedAt: new Date(),
        stageTimestamp: new Date(),
      };
      await adapter.upsert(partialDoc as any);

      const fail = await realBus.setup([ActionEvent.PARSE_FAILED]);
      await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, DM_EMPTY, jobLifecycleId, undefined, new Date());
      const failMsg = await fail.msg();
      expect(failMsg.jobLifecycleId).toBe(jobLifecycleId);

      const doc = await adapter.findById(jobLifecycleId);
      expect(doc).not.toBeNull();
      expect(doc!.stage).toBe(JobStage.PARTIAL_PARSED);
    });
  });
});
