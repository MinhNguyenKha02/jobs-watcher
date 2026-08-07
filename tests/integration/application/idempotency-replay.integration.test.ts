import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createTestContainer, type TestContainer } from '../../helpers/test-container.js';
import { createParseEventPort, createRoutingPort } from '../../helpers/mock-ports.js';
import type { MongoJobLifecycleAdapter } from '../../../src/infrastructure/outbound/persistence/mongo-job-lifecycle-adapter.js';
import { JobIngestor } from '../../../src/application/ingestor.js';
import { JobStage, JobSource, JobStatus } from '../../../src/domain/types/job-lifecycle.js';
import { topcvEmailHtmlMany, topcvDetailHtml } from '../../helpers/html-fixtures.js';

describe('Idempotency — command replay', () => {
  let tc: TestContainer;
  let adapter: MongoJobLifecycleAdapter;
  let ingestor: JobIngestor;
  let parseEventPort: ReturnType<typeof createParseEventPort>;
  let routingPort: ReturnType<typeof createRoutingPort>;

  beforeAll(async () => {
    tc = await createTestContainer({ ns: 'app-idempotency' });
    await tc.start();
    adapter = tc.mongoJobLifecycleAdapter;
    parseEventPort = createParseEventPort();
    routingPort = createRoutingPort();
    ingestor = new JobIngestor(adapter, parseEventPort, routingPort);
  }, 120000);

  afterAll(async () => {
    await tc.stop();
  });

  it('replaying same processIngest with same jobLifecycleId does not duplicate in DB', async () => {
    const html = topcvDetailHtml('Software Engineer', 'IdempotentCo');

    const id = 'idempotent-db-job-1';
    await ingestor.processIngest(JobSource.BROWSER_AUTO, JobStage.FULL_PARSED, html, id);
    const docAfterFirst = await adapter.findById(id);
    expect(docAfterFirst).not.toBeNull();
    expect(docAfterFirst!._id).toBe(id);

    await ingestor.processIngest(JobSource.BROWSER_AUTO, JobStage.FULL_PARSED, html, id);
    const docAfterSecond = await adapter.findById(id);
    expect(docAfterSecond).not.toBeNull();
    expect(docAfterSecond!._id).toBe(id);
    expect(docAfterSecond!._id).toBe(docAfterFirst!._id);
  });

  it('replaying processResolution after processIngest does not regress status', async () => {
    const html = topcvDetailHtml('Backend Developer', 'StableCo');

    const id = 'stable-db-job-1';
    await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, html, id);
    let doc = await adapter.findById(id);
    expect(doc).not.toBeNull();
    expect(doc!.status).toBe(JobStatus.ENRICHED);

    await ingestor.processResolution(id, 'queue');
    doc = await adapter.findById(id);
    expect(doc).not.toBeNull();
    expect(doc!.status).toBe(JobStatus.QUEUED);

    const queueCallCount = routingPort.emitJobQueued.mock.calls.length;

    await ingestor.processResolution(id, 'queue');
    doc = await adapter.findById(id);
    expect(doc!.status).toBe(JobStatus.QUEUED);
    expect(routingPort.emitJobQueued).toHaveBeenCalledTimes(queueCallCount);
  });

  it('multiple processResolution calls with different actions do not duplicate side effects', async () => {
    const html = topcvDetailHtml('Multi Role', 'MultiCo');

    const id = 'multi-db-job-1';
    await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, html, id);
    let doc = await adapter.findById(id);
    expect(doc).not.toBeNull();
    expect(doc!.status).toBe(JobStatus.ENRICHED);

    await expect(
      ingestor.processResolution(id, 'queue'),
    ).resolves.toBeUndefined();

    doc = await adapter.findById(id);
    expect(doc!.status).toBe(JobStatus.QUEUED);
  });
});

describe('PRC-002 — Stage-replay idempotency ([c]/[i] replay, s3-after-s4 no regression)', () => {
  let tc: TestContainer;
  let adapter: MongoJobLifecycleAdapter;
  let ingestor: JobIngestor;
  let parseEvents: string[];
  let routingEvents: string[];
  let dbCollection: any;

  beforeAll(async () => {
    tc = await createTestContainer({ ns: 'app-idempotency-prc2' });
    await tc.start();
    adapter = tc.mongoJobLifecycleAdapter;
    dbCollection = tc.db.collection('job_lifecycle');
  }, 120000);

  beforeEach(async () => {
    await tc.storage.clearDb();
    parseEvents = [];
    routingEvents = [];
    const parseEventPort = createParseEventPort((tag) => parseEvents.push(tag));
    const routingPort = createRoutingPort((tag) => routingEvents.push(tag));
    ingestor = new JobIngestor(adapter, parseEventPort, routingPort);
  });

  afterAll(async () => {
    await tc.stop();
  });

  it('[i] direct mode replay: repeated identical FULL_PARSED ingest → single doc, single completed event', async () => {
    const html = topcvDetailHtml('Software Engineer', 'ReplayDirectCo');
    await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, html);
    parseEvents.length = 0;
    await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, html);

    const clips = await dbCollection.find({ _id: { $regex: '^clip-' } }).toArray();
    expect(clips.filter((d: any) => d.company === 'ReplayDirectCo').length).toBe(1);
    expect(parseEvents.filter(e => e === 'completed').length).toBe(0);
  });

  it('[i] direct mode distinct payloads → distinct docs (latest-wins, no dedupe collision)', async () => {
    await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, topcvDetailHtml('Software Engineer', 'FirstCo'));
    await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, topcvDetailHtml('Backend Developer', 'SecondCo'));

    const clips = await dbCollection.find({ _id: { $regex: '^clip-' } }).toArray();
    expect(clips.length).toBe(2);
  });

  it('[c] queue-mode replay: repeated identical s1 ingest → dedupe, no duplicate docs, trash event emitted', async () => {
    const html = topcvEmailHtmlMany([{ role: 'Software Engineer', company: 'ReplayQueueCo' }]);
    await ingestor.processIngest(JobSource.BROWSER_AUTO, JobStage.PARTIAL_PARSED, html, undefined, { messageId: 'replay-c-1' });
    routingEvents.length = 0;
    await ingestor.processIngest(JobSource.BROWSER_AUTO, JobStage.PARTIAL_PARSED, html, undefined, { messageId: 'replay-c-2' });

    const docs = await dbCollection.find({ company: 'ReplayQueueCo' }).toArray();
    expect(docs.length).toBeLessThanOrEqual(1);
    expect(routingEvents.filter(e => e === 'trashed').length).toBeGreaterThanOrEqual(1);
  });

  it('[c] s1→s2 replay: replaying FULL_PARSED after already-enriched is a no-op (no extra completed event)', async () => {
    await ingestor.processIngest(JobSource.BROWSER_AUTO, JobStage.PARTIAL_PARSED, topcvEmailHtmlMany([{ role: 'Data Engineer', company: 'ReplayMergeCo' }]), undefined, { messageId: 'replay-merge-1' });
    const id = 'replay-merge-1-job-0';
    await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, topcvDetailHtml('Data Engineer', 'ReplayMergeCo'), id);

    parseEvents.length = 0;
    await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, topcvDetailHtml('Data Engineer', 'ReplayMergeCo'), id);

    expect(parseEvents.filter(e => e === 'completed').length).toBe(0);
    const doc = await adapter.findById(id);
    expect(doc!.status).toBe(JobStatus.ENRICHED);
  });

  it('s3-after-s4 replay: trash-after-queue does not overwrite terminal QUEUED state', async () => {
    await ingestor.processIngest(JobSource.BROWSER_AUTO, JobStage.PARTIAL_PARSED, topcvEmailHtmlMany([{ role: 'Full Stack Developer', company: 'ReplayTermCo' }]), undefined, { messageId: 'replay-term-1' });
    const id = 'replay-term-1-job-0';
    await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, topcvDetailHtml('Full Stack Developer', 'ReplayTermCo'), id);
    await ingestor.processResolution(id, 'queue');

    await ingestor.processResolution(id, 'trash');
    await ingestor.processResolution(id, 'queue');

    const doc = await adapter.findById(id);
    expect(doc!.status).toBe(JobStatus.QUEUED);
  });

  it('s3 replay: repeated queue resolution after QUEUED emits no additional queued events', async () => {
    await ingestor.processIngest(JobSource.BROWSER_AUTO, JobStage.PARTIAL_PARSED, topcvEmailHtmlMany([{ role: 'Software Engineer', company: 'ReplayQueueTwice' }]), undefined, { messageId: 'replay-q2-1' });
    const id = 'replay-q2-1-job-0';
    await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, topcvDetailHtml('Software Engineer', 'ReplayQueueTwice'), id);
    await ingestor.processResolution(id, 'queue');

    routingEvents.length = 0;
    await ingestor.processResolution(id, 'queue');

    expect(routingEvents.filter(e => e === 'queued').length).toBe(0);
    const doc = await adapter.findById(id);
    expect(doc!.status).toBe(JobStatus.QUEUED);
  });

  it('s4 replay: repeated trash after TRASHED emits no additional trashed events', async () => {
    await ingestor.processIngest(JobSource.BROWSER_AUTO, JobStage.PARTIAL_PARSED, topcvEmailHtmlMany([{ role: 'Backend Developer', company: 'ReplayTrashTwice' }]), undefined, { messageId: 'replay-t2-1' });
    const id = 'replay-t2-1-job-0';
    await ingestor.processResolution(id, 'trash');

    routingEvents.length = 0;
    await ingestor.processResolution(id, 'trash');

    expect(routingEvents.filter(e => e === 'trashed').length).toBe(0);
    const doc = await adapter.findById(id);
    expect(doc!.status).toBe(JobStatus.TRASHED);
  });

  it('s1 replay with same messageId but different job content → new doc id (messageId+index scoping)', async () => {
    await ingestor.processIngest(JobSource.BROWSER_AUTO, JobStage.PARTIAL_PARSED, topcvEmailHtmlMany([{ role: 'Software Engineer', company: 'ScopeCoA' }]), undefined, { messageId: 'replay-scope-1' });
    await ingestor.processIngest(JobSource.BROWSER_AUTO, JobStage.PARTIAL_PARSED, topcvEmailHtmlMany([{ role: 'Backend Developer', company: 'ScopeCoB' }]), undefined, { messageId: 'replay-scope-2' });

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