import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { createTestStorage } from '../helpers/create-test-storage.js';
import { MongoJobLifecycleAdapter } from '../../src/infrastructure/outbound/persistence/mongo-job-lifecycle-adapter.js';
import { MongoInitializer } from '../../src/infrastructure/outbound/persistence/mongo-init.js';
import { JobIngestor } from '../../src/application/ingestor.js';
import { JobStage, JobSource, JobStatus } from '../../src/domain/types/job-lifecycle.js';
import { emailHtmlFor, detailHtmlFor } from '../helpers/html-fixtures.js';

describe('PRC-007 — Failure recovery at every stage (crash at s1/s2/s3/s4)', () => {
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

  it('s1 crash: extraction failure → PARTIAL_PARSED fallback keeps doc enriching and no crash', async () => {
    await ingestor.processIngest(JobSource.BROWSER_AUTO, JobStage.PARTIAL_PARSED, emailHtmlFor('Software Engineer', 'CrashS1Co'), undefined, { messageId: 'crash-s1-1' });
    const id = 'crash-s1-1-job-0';
    const doc = await adapter.findById(id);
    expect(doc).not.toBeNull();
    expect(doc!.status).toBe(JobStatus.ENRICHING);
  });

  it('s2 crash: parse failure → emitFailed (s4), job stays partial, next cycle continues', async () => {
    parseEvents.length = 0;
    await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, '<span>garbage no job structure</span>', 'crash-s2-1');
    expect(parseEvents.filter(e => e === 'failed').length).toBe(1);
    const doc = await adapter.findById('crash-s2-1');
    expect(doc).toBeNull();
  });

  it('s2 crash after s1: merge path with unparseable full payload emits failed, s1 doc intact', async () => {
    await ingestor.processIngest(JobSource.BROWSER_AUTO, JobStage.PARTIAL_PARSED, emailHtmlFor('Data Engineer', 'CrashS2Co'), undefined, { messageId: 'crash-s2-2' });
    const id = 'crash-s2-2-job-0';
    parseEvents.length = 0;
    await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, '<span>garbage</span>', id);
    expect(parseEvents.filter(e => e === 'failed').length).toBe(1);
    const doc = await adapter.findById(id);
    expect(doc).not.toBeNull();
    expect(doc!.stage).toBe(JobStage.PARTIAL_PARSED);
  });

  it('s3 crash (queue): missing job → emitRouteFailed (s4), next job unaffected', async () => {
    routingEvents.length = 0;
    await ingestor.processResolution('missing-job-for-queue', 'queue');
    expect(routingEvents.filter(e => e === 'routed_failed').length).toBe(1);
  });

  it('s3 crash (trash): missing job → emitRouteFailed (s4)', async () => {
    routingEvents.length = 0;
    await ingestor.processResolution('missing-job-for-trash', 'trash');
    expect(routingEvents.filter(e => e === 'routed_failed').length).toBe(1);
  });

  it('s4 → next cycle: after a failed s2, a new valid ingest still completes', async () => {
    await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, '<span>garbage</span>', 'fail-then-ok');
    parseEvents.length = 0;
    await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, detailHtmlFor('Backend Developer', 'NextCycleCo'));

    expect(parseEvents.filter(e => e === 'completed').length).toBe(1);
    const docs = await dbCollection.find({ _id: { $regex: '^clip-' } }).toArray();
    expect(docs.some((d: any) => d.company === 'NextCycleCo')).toBe(true);
  });

  it('s1 filter-reject → s4 trashed with reason, no doc, next body continues', async () => {
    const html = emailHtmlFor('NonSoftwareRole', 'RejectedCo');
    routingEvents.length = 0;
    await ingestor.processIngest(JobSource.BROWSER_AUTO, JobStage.PARTIAL_PARSED, html, undefined, { messageId: 'reject-1' });
    expect(routingEvents.filter(e => e === 'trashed').length).toBe(1);
    const docs = await dbCollection.find({ company: 'RejectedCo' }).toArray();
    expect(docs.length).toBe(0);
  });

  it('s1 duplicate role+company → trashed, no duplicate doc', async () => {
    await ingestor.processIngest(JobSource.BROWSER_AUTO, JobStage.PARTIAL_PARSED, emailHtmlFor('Full Stack Developer', 'DupFailCo'), undefined, { messageId: 'dup-1' });
    routingEvents.length = 0;
    await ingestor.processIngest(JobSource.BROWSER_AUTO, JobStage.PARTIAL_PARSED, emailHtmlFor('Full Stack Developer', 'DupFailCo'), undefined, { messageId: 'dup-2' });
    expect(routingEvents.filter(e => e === 'trashed').length).toBe(1);
    const docs = await dbCollection.find({ company: 'DupFailCo' }).toArray();
    expect(docs.length).toBe(1);
  });

  it('s3 crash: persistence failure on updateStage surfaces as route failed', async () => {
    const failAdapter = {
      findById: vi.fn().mockResolvedValue({ _id: 'persist-fail-1', stage: JobStage.FULL_PARSED, status: JobStatus.ENRICHED, company: 'X', role: 'Y' }),
      upsert: vi.fn(),
      updateStage: vi.fn().mockRejectedValue(new Error('disk full')),
    };
    const ingestor2 = new JobIngestor(failAdapter as any, {
      emitGenerated: vi.fn(), emitCompleted: vi.fn(), emitFailed: vi.fn(),
    }, {
      emitJobQueued: vi.fn(() => { routingEvents.push('queued'); return Promise.resolve(); }),
      emitJobTrashed: vi.fn(),
      emitRouteFailed: vi.fn(() => { routingEvents.push('routed_failed'); return Promise.resolve(); }),
    });
    routingEvents.length = 0;
    await ingestor2.processResolution('persist-fail-1', 'queue');
    expect(routingEvents.filter(e => e === 'routed_failed').length).toBe(1);
  });

  it('s2 empty-html failure → s4, then valid [i] direct ingest works (next cycle)', async () => {
    parseEvents.length = 0;
    await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, '', 'empty-then-ok');
    await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, detailHtmlFor('Web Developer', 'AfterEmptyCo'));

    const failed = parseEvents.filter(e => e === 'failed').length;
    const completed = parseEvents.filter(e => e === 'completed').length;
    expect(failed).toBe(1);
    expect(completed).toBe(1);
  });
});
