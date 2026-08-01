import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createTestStorage } from '../helpers/create-test-storage.js';
import { MongoJobLifecycleAdapter } from '../../src/infrastructure/outbound/persistence/mongo-job-lifecycle-adapter.js';
import { JobStage, JobSource, JobStatus } from '../../src/domain/types/job-lifecycle.js';

const { JobIngestor } = await import('../../src/application/ingestor.js');

const FULL_PARSED_HTML = '<html><body>' +
  '<div class="job-detail__info--title"><h1>Backend Developer</h1></div>' +
  '<div class="company-name-label"><a class="name">FullParsedCo</a></div>' +
  '<div class="job-detail__body">' +
  '<div class="job-description__item"><h3>Requirements</h3>' +
  '<div class="job-description__item--content">TypeScript and Node.js required</div></div>' +
  '</div></body></html>';

  describe('Case 2 full-parsed direct arrival (browser-auto S2 path)', () => {
  let storage: any;
  let adapter: MongoJobLifecycleAdapter;
  let parseEvents: any[];
  let routingEvents: any[];
  let ingestor: JobIngestor;

  beforeAll(async () => {
    storage = await createTestStorage();
    adapter = new MongoJobLifecycleAdapter(
      storage.client.db(storage.dbName),
    );

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

  beforeEach(async () => {
    parseEvents.length = 0;
    routingEvents.length = 0;
    const db = storage.client.db(storage.dbName);
    const cols = await db.listCollections().toArray();
    for (const col of cols) {
      await db.collection(col.name).deleteMany({});
    }
  });

  it('T2a: S2 via BROWSER_AUTO→[j] queue (no S1 needed, full already)', async () => {
    const jobLifecycleId = 'e2e-c2-full-arrival';

    await ingestor.processIngest(JobSource.BROWSER_AUTO, JobStage.FULL_PARSED, FULL_PARSED_HTML, jobLifecycleId);

    const genEvents = parseEvents.filter(([t]) => t === 'generated');
    expect(genEvents.length).toBe(1);

    const completedEvents = parseEvents.filter(([t]) => t === 'completed');
    expect(completedEvents.length).toBe(1);

    const doc = await adapter.findById(jobLifecycleId);
    expect(doc).not.toBeNull();
    expect(doc!.stage).toBe(JobStage.FULL_PARSED);
    expect(doc!.status).toBe(JobStatus.ENRICHED);

    await ingestor.processResolution(jobLifecycleId, 'queue');

    const queuedDoc = await adapter.findById(jobLifecycleId);
    expect(queuedDoc).not.toBeNull();
    expect(queuedDoc!.status).toBe(JobStatus.QUEUED);

    expect(routingEvents.filter(([t]) => t === 'queued').length).toBe(1);
  });

  it('T2b: S2 via BROWSER_AUTO→[d] trash', async () => {
    const jobLifecycleId = 'e2e-c2-full-trash';

    await ingestor.processIngest(JobSource.BROWSER_AUTO, JobStage.FULL_PARSED, FULL_PARSED_HTML, jobLifecycleId);

    const completedEvents = parseEvents.filter(([t]) => t === 'completed');
    expect(completedEvents.length).toBe(1);

    await ingestor.processResolution(jobLifecycleId, 'trash');

    const trashedDoc = await adapter.findById(jobLifecycleId);
    expect(trashedDoc).not.toBeNull();
    expect(trashedDoc!.status).toBe(JobStatus.TRASHED);

    expect(routingEvents.filter(([t]) => t === 'trashed').length).toBe(1);
  });

  it('T2c: S2 without jobLifecycleId creates browser-auto-* doc (fallback)', async () => {
    await ingestor.processIngest(JobSource.BROWSER_AUTO, JobStage.FULL_PARSED, FULL_PARSED_HTML);

    const completedEvents = parseEvents.filter(([t]) => t === 'completed');
    expect(completedEvents.length).toBe(1);

    const col = storage.client.db(storage.dbName).collection('job_lifecycle');
    const docs = await col.find({}).toArray();
    expect(docs.length).toBe(1);
    expect(docs[0]._id).toMatch(/^browser-auto-/);
    expect(docs[0].role).toBe('Backend Developer');
    expect(docs[0].stage).toBe(JobStage.FULL_PARSED);
    expect(docs[0].status).toBe(JobStatus.ENRICHED);
  });

  it('T2d: S1→S2 inside same tick (browser-auto merge) then [j]', async () => {
    const messageId = 'e2e-c2-merged';
    const jobLifecycleId = `${messageId}-job-0`;

    const emailHtml = `<html><body><a class="job-item-link" href="/viec-lam/backend-developer"><div class="topcv-job-item"><div class="title"><span>Backend Developer</span></div><div class="company"><span>MergeCo</span></div></div></a><p>topcv job-item</p></body></html>`;

    await ingestor.processIngest(JobSource.BROWSER_AUTO, JobStage.PARTIAL_PARSED, emailHtml, undefined, { messageId, subject: 'Backend Developer' });

    const genEvents = parseEvents.filter(([t]) => t === 'generated');
    expect(genEvents.length).toBe(1);
    expect(genEvents[0][1]._id).toBe(jobLifecycleId);

    await ingestor.processIngest(JobSource.BROWSER_AUTO, JobStage.FULL_PARSED, FULL_PARSED_HTML, jobLifecycleId);

    const completedEvents = parseEvents.filter(([t]) => t === 'completed');
    expect(completedEvents.length).toBe(1);

    const doc = await adapter.findById(jobLifecycleId);
    expect(doc).not.toBeNull();
    expect(doc!.stage).toBe(JobStage.FULL_PARSED);
    expect(doc!.status).toBe(JobStatus.ENRICHED);
    expect(doc!.company).toBe('FullParsedCo');

    await ingestor.processResolution(jobLifecycleId, 'queue');

    expect(routingEvents.filter(([t]) => t === 'queued').length).toBe(1);
  });
});
