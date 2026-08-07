/* Path cell (c4): S1→S2→S3→S4 direct + clipboard Signal 2b, asset-builder (see plans/tests-path-matrix.md) */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createTestContainer, type TestContainer } from '../../../helpers/test-container.js';
import type { RealDipBus } from '../../../helpers/real-dip-bus.js';
import { createParseEventPort, createRoutingPort } from '../../../helpers/mock-ports.js';
import { linkedinSduiDetailHtml, topcvDetailHtml, nonJobHtml } from '../../../helpers/html-fixtures.js';
import type { MongoJobLifecycleAdapter } from '../../../../src/infrastructure/outbound/persistence/mongo-job-lifecycle-adapter.js';
import { JobStage, JobSource, JobStatus } from '../../../../src/domain/types/job-lifecycle.js';
import { ActionEvent } from '../../../../src/domain/types/action-event.js';

const { JobIngestor } = await import('../../../../src/application/ingestor.js');

const DM_HTML_2B = linkedinSduiDetailHtml('Backend Developer', 'CopyJuniorCorp');

const DML_HTML = linkedinSduiDetailHtml('Junior Backend Developer', 'ClipDirectCorp');

function mockPorts() {
  const parseEvents: any[] = [];
  const routingEvents: any[] = [];
  const parseEventPort = createParseEventPort((tag, args) => parseEvents.push([tag, ...args]));
  const routingPort = createRoutingPort((tag, args) => routingEvents.push([tag, ...args]));
  return { parseEvents, routingEvents, parseEventPort, routingPort };
}

describe('Direct Mode — Signal 2b clipboard', () => {
  let tc: TestContainer;
  let adapter: MongoJobLifecycleAdapter;
  let realBus: RealDipBus;

  function realIngestor(): JobIngestor {
    return tc.ingestor;
  }

  beforeAll(async () => {
    tc = await createTestContainer({ ns: 'c4-direct-mode' });
    await tc.start();
    adapter = tc.mongoJobLifecycleAdapter;
    realBus = tc.bus;
  }, 120000);

  afterAll(async () => {
    await tc.stop();
  });

  it('Signal 2b creates new FULL_PARSED job with clip-* ID — real-DIP', async () => {
    const ingestor = realIngestor();
    const col = tc.db.collection("job_lifecycle");
    const docsBefore = await col.countDocuments({});

    const comp = await realBus.setup([ActionEvent.PARSE_COMPLETED]);
    await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, DM_HTML_2B, undefined, undefined, new Date());
    const compMsg = await comp.msg();
    expect(compMsg.job).toBeDefined();
    const clipId = compMsg.job._id;
    expect(clipId).toMatch(/^clip-/);

    const docsAfter = await col.countDocuments({});
    expect(docsAfter).toBe(docsBefore + 1);

    const newDoc = await adapter.findById(clipId);
    expect(newDoc).not.toBeNull();
    expect(newDoc!.stage).toBe(JobStage.FULL_PARSED);
    expect(newDoc!.status).toBe(JobStatus.ENRICHED);
    expect(newDoc!.company).toBe('CopyJuniorCorp');
    expect(newDoc!.role).toBe('Backend Developer');
  });

  it('Signal 2b duplicate role+company silently skips', async () => {
    const { parseEvents, parseEventPort } = mockPorts();
    const ingestor = new JobIngestor(adapter, parseEventPort as any, { emitJobQueued: vi.fn(), emitJobTrashed: vi.fn(), emitRouteFailed: vi.fn() } as any);
    const col = tc.db.collection("job_lifecycle");
    await tc.storage.clearDb();

    await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, DM_HTML_2B, undefined, undefined, new Date());

    const docsBefore = await col.countDocuments({});
    const completedBefore = parseEvents.filter(([t]) => t === 'completed').length;

    await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, DM_HTML_2B, undefined, undefined, new Date());

    const docsAfter = await col.countDocuments({});
    expect(docsAfter).toBe(docsBefore);

    const completedEvents = parseEvents.filter(([t]) => t === 'completed');
    expect(completedEvents.length).toBe(completedBefore);
  });
});

describe('Merged direct-lifecycle — Direct mode [b]→[i]→S2→[j]/[d] lifecycle (Case 4)', () => {
  let tc: TestContainer;
  let dbCollection: any;
  let adapter: MongoJobLifecycleAdapter;
  let realBus: RealDipBus;

  function realIngestor(): JobIngestor {
    return tc.ingestor;
  }

  beforeAll(async () => {
    tc = await createTestContainer({ ns: 'c4-direct-lifecycle' });
    await tc.start();
    adapter = tc.mongoJobLifecycleAdapter;
    dbCollection = tc.db.collection('job_lifecycle');
    realBus = tc.bus;
  }, 120000);

  afterAll(async () => {
    await tc.stop();
  });

  it('signal2bManual creates clip-* doc and emits parse.completed (simulates [i] in direct mode) — real-DIP', async () => {
    const ingestor = realIngestor();
    const docsBefore = await dbCollection.countDocuments({});

    const comp = await realBus.setup([ActionEvent.PARSE_COMPLETED]);
    await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, DML_HTML);
    const compMsg = await comp.msg();
    expect(compMsg.job).toBeDefined();
    const clipId = compMsg.job._id;
    expect(clipId).toMatch(/^clip-/);

    const docsAfter = await dbCollection.countDocuments({});
    expect(docsAfter).toBe(docsBefore + 1);

    const newDoc = await adapter.findById(clipId);
    expect(newDoc).not.toBeNull();
    expect(newDoc!.stage).toBe(JobStage.FULL_PARSED);
    expect(newDoc!.status).toBe(JobStatus.ENRICHED);
    expect(newDoc!.company).toBe('ClipDirectCorp');
    expect(newDoc!.role).toBe('Junior Backend Developer');
  });

  it('signal2bManual → queue resolution: full clipboard-to-queued flow — real-DIP', async () => {
    const ingestor = realIngestor();
    const docsBefore = await dbCollection.countDocuments({});

    const comp = await realBus.setup([ActionEvent.PARSE_COMPLETED]);
    await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, DML_HTML.replace(/ClipDirectCorp/g, 'ClipQueueCorp'));
    const compMsg = await comp.msg();
    const clipId = compMsg.job._id;
    expect(clipId).toMatch(/^clip-/);

    const queue = await realBus.setup([ActionEvent.QUEUED, ActionEvent.TRASHED, ActionEvent.ROUTE_FAILED]);
    await ingestor.processResolution(clipId, 'queue');
    const queueMsg = await queue.msg();
    expect(queueMsg.jobLifecycleId).toBe(clipId);

    const routedDoc = await adapter.findById(clipId);
    expect(routedDoc).not.toBeNull();
    expect(routedDoc!.status).toBe(JobStatus.QUEUED);

    const docsAfter = await dbCollection.countDocuments({});
    expect(docsAfter).toBe(docsBefore + 1);
  });

  it('signal2bManual → trash resolution: full clipboard-to-trashed flow — real-DIP', async () => {
    const ingestor = realIngestor();

    const comp = await realBus.setup([ActionEvent.PARSE_COMPLETED]);
    await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, DML_HTML.replace(/ClipDirectCorp/g, 'ClipTrashCorp'));
    const compMsg = await comp.msg();
    const clipId = compMsg.job._id;
    expect(clipId).toMatch(/^clip-/);

    const trash = await realBus.setup([ActionEvent.TRASHED, ActionEvent.ROUTE_FAILED, ActionEvent.PARSE_FAILED]);
    await ingestor.processResolution(clipId, 'trash');
    const trashMsg = await trash.msg();
    expect(trashMsg.jobLifecycleId).toBe(clipId);
    expect(trashMsg.reason).toBe('operator:trash');

    const routedDoc = await adapter.findById(clipId);
    expect(routedDoc!.status).toBe(JobStatus.TRASHED);
  });

  it('signal2bManual duplicate role+company silently skips (no duplicate doc)', async () => {
    const { parseEvents, parseEventPort } = mockPorts();
    const ingestor = new JobIngestor(adapter, parseEventPort as any, { emitJobQueued: vi.fn(), emitJobTrashed: vi.fn(), emitRouteFailed: vi.fn() } as any);

    await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, DML_HTML.replace(/ClipDirectCorp/g, 'DedupCorp'));

    const docsBefore = await dbCollection.countDocuments({});
    const completedBefore = parseEvents.filter(([t]) => t === 'completed').length;

    await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, DML_HTML.replace(/ClipDirectCorp/g, 'DedupCorp'));

    const docsAfter = await dbCollection.countDocuments({});
    expect(docsAfter).toBe(docsBefore);

    const completedEvents = parseEvents.filter(([t]) => t === 'completed');
    expect(completedEvents.length).toBe(completedBefore);
  });

  it('signal2bManual latest-wins in direct mode (B17 fix — overwrites on second call) — real-DIP', async () => {
    const ingestor = realIngestor();

    const comp1 = await realBus.setup([ActionEvent.PARSE_COMPLETED]);
    await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, DML_HTML.replace(/ClipDirectCorp/g, 'FirstCo'));
    const comp1Msg = await comp1.msg();
    const firstId = comp1Msg.job._id;
    expect(firstId).toMatch(/^clip-/);

    const firstDoc = await dbCollection.findOne({ _id: firstId });
    expect(firstDoc.company).toBe('FirstCo');

    const comp2 = await realBus.setup([ActionEvent.PARSE_COMPLETED]);
    await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, DML_HTML.replace(/ClipDirectCorp/g, 'SecondCo'));
    const comp2Msg = await comp2.msg();
    const secondId = comp2Msg.job._id;
    expect(secondId).toMatch(/^clip-/);

    const secondDoc = await dbCollection.findOne({ _id: secondId });
    expect(secondDoc.company).toBe('SecondCo');
    expect(secondId).not.toBe(firstId);
  });
});

describe('Clipboard Signal 2b (Case 4) — real storage', () => {
  let tc: TestContainer;
  let adapter: MongoJobLifecycleAdapter;
  let realBus: RealDipBus;
  let collection: any;
  let parseEvents: any[];
  let routingEvents: any[];

  beforeAll(async () => {
    tc = await createTestContainer({ ns: 'c4-clipboard-2b' });
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

  // clipboard-2b: mock event ports for deterministic guard/no-emit/failure-injection assertions.
  function mockIngestor(): JobIngestor {
    const parseEventPort = createParseEventPort((tag, args) => parseEvents.push([tag, ...args]));
    const routingPort = createRoutingPort((tag, args) => routingEvents.push([tag, ...args]));
    return new JobIngestor(adapter, parseEventPort, routingPort);
  }

  // real-DIP: the production composition-root ingestor (real RabbitMQ Parse/Route adapters).
  function realIngestor(): JobIngestor {
    return tc.ingestor;
  }

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
