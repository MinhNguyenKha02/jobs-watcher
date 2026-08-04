import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createTestStorage } from '../../../helpers/create-test-storage.js';
import { createRealDipBus, type RealDipBus } from '../../../helpers/real-dip-bus.js';
import { MongoJobLifecycleAdapter } from '../../../../src/infrastructure/outbound/persistence/mongo-job-lifecycle-adapter.js';
import { MongoInitializer } from '../../../../src/infrastructure/outbound/persistence/mongo-init.js';
import { JobStage, JobSource, JobStatus } from '../../../../src/domain/types/job-lifecycle.js';
import { ActionEvent } from '../../../../src/domain/types/action-event.js';

const { JobIngestor } = await import('../../../../src/application/ingestor.js');

const DM_HTML = `<html><body>
<div class="job-detail">
  <div class="job-detail__header">
    <h1 class="job-detail__info--title">Backend Developer</h1>
    <div class="job-detail__info--company">
      <span class="company-name">ClipJuniorCorp</span>
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
    <h3>Mô tả công việc</h3>
    <div class="job-description__item--content">
      <p>We are looking for a Backend Developer with TypeScript experience.</p>
      <strong>Requirements:</strong>
      <ul>
        <li>TypeScript and Node.js</li>
      </ul>
    </div>
  </div>
</div>
</body></html>`;

const DM_HTML_2B = DM_HTML.replace(/ClipJuniorCorp/g, 'CopyJuniorCorp');
const DM_EMPTY = '';

const DML_HTML = `<html><body>
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

function mockPorts() {
  const parseEvents: any[] = [];
  const routingEvents: any[] = [];
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
  return { parseEvents, routingEvents, parseEventPort, routingPort };
}

describe('Merged-DM — Direct Mode (Signal 2a manual + Signal 2b clipboard)', () => {
  let storage: any;
  let adapter: MongoJobLifecycleAdapter;
  let realBus: RealDipBus;

  function realIngestor(): JobIngestor {
    return new JobIngestor(adapter, realBus.parsePort, realBus.routePort);
  }

  beforeAll(async () => {
    storage = await createTestStorage();
    const initializer = new MongoInitializer(storage.client, storage.dbName);
    await initializer.init();
    adapter = new MongoJobLifecycleAdapter(storage.client.db(storage.dbName));
    realBus = await createRealDipBus('jobs.events.int.c4.direct-mode');
  }, 120000);

  afterAll(async () => {
    await realBus.teardown();
    await storage.stop();
  });

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
    expect(fullDoc!.salary).toBe('12,000,000 VNĐ');
    expect(fullDoc!.location).toBe('Ho Chi Minh City');
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

  it('Signal 2b creates new FULL_PARSED job with clip-* ID — real-DIP', async () => {
    const ingestor = realIngestor();
    const col = storage.client.db(storage.dbName).collection('job_lifecycle');
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
    const col = storage.client.db(storage.dbName).collection('job_lifecycle');
    await col.deleteMany({});

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
  let storage: any;
  let dbCollection: any;
  let adapter: MongoJobLifecycleAdapter;
  let realBus: RealDipBus;

  function realIngestor(): JobIngestor {
    return new JobIngestor(adapter, realBus.parsePort, realBus.routePort);
  }

  beforeAll(async () => {
    storage = await createTestStorage();
    const initializer = new MongoInitializer(storage.client, storage.dbName);
    await initializer.init();
    adapter = new MongoJobLifecycleAdapter(storage.client.db(storage.dbName));
    dbCollection = storage.client.db(storage.dbName).collection('job_lifecycle');
    realBus = await createRealDipBus('jobs.events.int.c4.direct-lifecycle');
  }, 120000);

  afterAll(async () => {
    await realBus.teardown();
    await storage.stop();
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
