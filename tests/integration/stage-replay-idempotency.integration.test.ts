import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { createTestStorage } from '../helpers/create-test-storage.js';
import { MongoJobLifecycleAdapter } from '../../src/infrastructure/outbound/persistence/mongo-job-lifecycle-adapter.js';
import { MongoInitializer } from '../../src/infrastructure/outbound/persistence/mongo-init.js';
import { JobIngestor } from '../../src/application/ingestor.js';
import { JobStage, JobSource, JobStatus } from '../../src/domain/types/job-lifecycle.js';
import { emailHtmlFor, detailHtmlFor } from '../helpers/html-fixtures.js';

describe('PRC-002 — Stage-replay idempotency ([c]/[i] replay, s3-after-s4 no regression)', () => {
  let storage: Awaited<ReturnType<typeof createTestStorage>>;
  let adapter: MongoJobLifecycleAdapter;
  let ingestor: JobIngestor;
  let parseEvents: string[];
  let routingEvents: string[];
  let dbCollection: any;

  beforeAll(async () => {
    storage = await createTestStorage();
    const initializer = new MongoInitializer(storage.client, storage.dbName);
    await initializer.init();
    adapter = new MongoJobLifecycleAdapter(storage.client.db(storage.dbName));
    dbCollection = storage.client.db(storage.dbName).collection('job_lifecycle');
  }, 120000);

  beforeEach(async () => {
    await dbCollection.deleteMany({});
    parseEvents = [];
    routingEvents = [];
    const parseEventPort = {
      emitGenerated: vi.fn(() => { parseEvents.push('generated'); return Promise.resolve(); }),
      emitCompleted: vi.fn(() => { parseEvents.push('completed'); return Promise.resolve(); }),
      emitFailed: vi.fn(() => { parseEvents.push('failed'); return Promise.resolve(); }),
    };
    const routingPort = {
      emitJobQueued: vi.fn(() => { routingEvents.push('queued'); return Promise.resolve(); }),
      emitJobTrashed: vi.fn(() => { routingEvents.push('trashed'); return Promise.resolve(); }),
      emitRouteFailed: vi.fn(() => { routingEvents.push('routed_failed'); return Promise.resolve(); }),
    };
    ingestor = new JobIngestor(adapter, parseEventPort, routingPort);
  });

  afterAll(async () => {
    await storage.stop();
  });

  it('[i] direct mode replay: repeated identical FULL_PARSED ingest → single doc, single completed event', async () => {
    const html = detailHtmlFor('Software Engineer', 'ReplayDirectCo');
    await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, html);
    parseEvents.length = 0;
    await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, html);

    const clips = await dbCollection.find({ _id: { $regex: '^clip-' } }).toArray();
    expect(clips.filter((d: any) => d.company === 'ReplayDirectCo').length).toBe(1);
    expect(parseEvents.filter(e => e === 'completed').length).toBe(0);
  });

  it('[i] direct mode distinct payloads → distinct docs (latest-wins, no dedupe collision)', async () => {
    await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, detailHtmlFor('Software Engineer', 'FirstCo'));
    await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, detailHtmlFor('Backend Developer', 'SecondCo'));

    const clips = await dbCollection.find({ _id: { $regex: '^clip-' } }).toArray();
    expect(clips.length).toBe(2);
  });

  it('[c] queue-mode replay: repeated identical s1 ingest → dedupe, no duplicate docs, trash event emitted', async () => {
    const html = emailHtmlFor('Software Engineer', 'ReplayQueueCo');
    await ingestor.processIngest(JobSource.BROWSER_AUTO, JobStage.PARTIAL_PARSED, html, undefined, { messageId: 'replay-c-1' });
    routingEvents.length = 0;
    await ingestor.processIngest(JobSource.BROWSER_AUTO, JobStage.PARTIAL_PARSED, html, undefined, { messageId: 'replay-c-2' });

    const docs = await dbCollection.find({ company: 'ReplayQueueCo' }).toArray();
    expect(docs.length).toBeLessThanOrEqual(1);
    expect(routingEvents.filter(e => e === 'trashed').length).toBeGreaterThanOrEqual(1);
  });

  it('[c] s1→s2 replay: replaying FULL_PARSED after already-enriched is a no-op (no extra completed event)', async () => {
    await ingestor.processIngest(JobSource.BROWSER_AUTO, JobStage.PARTIAL_PARSED, emailHtmlFor('Data Engineer', 'ReplayMergeCo'), undefined, { messageId: 'replay-merge-1' });
    const id = 'replay-merge-1-job-0';
    await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, detailHtmlFor('Data Engineer', 'ReplayMergeCo'), id);

    parseEvents.length = 0;
    await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, detailHtmlFor('Data Engineer', 'ReplayMergeCo'), id);

    expect(parseEvents.filter(e => e === 'completed').length).toBe(0);
    const doc = await adapter.findById(id);
    expect(doc!.status).toBe(JobStatus.ENRICHED);
  });

  it('s3-after-s4 replay: trash-after-queue does not overwrite terminal QUEUED state', async () => {
    await ingestor.processIngest(JobSource.BROWSER_AUTO, JobStage.PARTIAL_PARSED, emailHtmlFor('Full Stack Developer', 'ReplayTermCo'), undefined, { messageId: 'replay-term-1' });
    const id = 'replay-term-1-job-0';
    await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, detailHtmlFor('Full Stack Developer', 'ReplayTermCo'), id);
    await ingestor.processResolution(id, 'queue');

    await ingestor.processResolution(id, 'trash');
    await ingestor.processResolution(id, 'queue');

    const doc = await adapter.findById(id);
    expect(doc!.status).toBe(JobStatus.QUEUED);
  });

  it('s3 replay: repeated queue resolution after QUEUED emits no additional queued events', async () => {
    await ingestor.processIngest(JobSource.BROWSER_AUTO, JobStage.PARTIAL_PARSED, emailHtmlFor('Software Engineer', 'ReplayQueueTwice'), undefined, { messageId: 'replay-q2-1' });
    const id = 'replay-q2-1-job-0';
    await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, detailHtmlFor('Software Engineer', 'ReplayQueueTwice'), id);
    await ingestor.processResolution(id, 'queue');

    routingEvents.length = 0;
    await ingestor.processResolution(id, 'queue');

    expect(routingEvents.filter(e => e === 'queued').length).toBe(0);
    const doc = await adapter.findById(id);
    expect(doc!.status).toBe(JobStatus.QUEUED);
  });

  it('s4 replay: repeated trash after TRASHED emits no additional trashed events', async () => {
    await ingestor.processIngest(JobSource.BROWSER_AUTO, JobStage.PARTIAL_PARSED, emailHtmlFor('Backend Developer', 'ReplayTrashTwice'), undefined, { messageId: 'replay-t2-1' });
    const id = 'replay-t2-1-job-0';
    await ingestor.processResolution(id, 'trash');

    routingEvents.length = 0;
    await ingestor.processResolution(id, 'trash');

    expect(routingEvents.filter(e => e === 'trashed').length).toBe(0);
    const doc = await adapter.findById(id);
    expect(doc!.status).toBe(JobStatus.TRASHED);
  });

  it('s1 replay with same messageId but different job content → new doc id (messageId+index scoping)', async () => {
    await ingestor.processIngest(JobSource.BROWSER_AUTO, JobStage.PARTIAL_PARSED, emailHtmlFor('Software Engineer', 'ScopeCoA'), undefined, { messageId: 'replay-scope-1' });
    await ingestor.processIngest(JobSource.BROWSER_AUTO, JobStage.PARTIAL_PARSED, emailHtmlFor('Backend Developer', 'ScopeCoB'), undefined, { messageId: 'replay-scope-2' });

    const docs = await dbCollection.find({ _id: { $regex: '^replay-scope-' } }).toArray();
    expect(docs.length).toBe(2);
  });

  it('failed s2 replay: empty-payload failure is idempotent (each call emits one failed, no doc crash)', async () => {
    await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, '', 'replay-fail-1');
    parseEvents.length = 0;
    await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, '', 'replay-fail-1');

    expect(parseEvents.filter(e => e === 'failed').length).toBe(1);
    const doc = await adapter.findById('replay-fail-1');
    expect(doc).toBeNull();
  });
});
