import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { createTestStorage } from '../helpers/create-test-storage.js';
import { MongoJobLifecycleAdapter } from '../../src/infrastructure/outbound/persistence/mongo-job-lifecycle-adapter.js';
import { JobIngestor } from '../../src/application/ingestor.js';
import { JobSource, JobStage, JobStatus } from '../../src/domain/types/job-lifecycle.js';

describe('Idempotency — command replay', () => {
  let storage: Awaited<ReturnType<typeof createTestStorage>>;
  let adapter: MongoJobLifecycleAdapter;
  let ingestor: JobIngestor;
  let parseEventPort: Record<string, ReturnType<typeof vi.fn>>;
  let routingPort: Record<string, ReturnType<typeof vi.fn>>;

  beforeAll(async () => {
    storage = await createTestStorage();
    adapter = new MongoJobLifecycleAdapter(storage.client.db(storage.dbName));
    parseEventPort = {
      emitGenerated: vi.fn(() => Promise.resolve()),
      emitCompleted: vi.fn(() => Promise.resolve()),
      emitFailed: vi.fn(() => Promise.resolve()),
    };
    routingPort = {
      emitJobQueued: vi.fn(() => Promise.resolve()),
      emitJobTrashed: vi.fn(() => Promise.resolve()),
      emitRouteFailed: vi.fn(() => Promise.resolve()),
    };
    ingestor = new JobIngestor(adapter, parseEventPort, routingPort);
  }, 120000);

  afterAll(async () => {
    await storage.stop();
  });

  it('replaying same processIngest with same jobLifecycleId does not duplicate in DB', async () => {
    const html = '<div class="job-detail__info--title"><h1>Software Engineer</h1></div>'
      + '<div class="company-name-label"><a class="name">IdempotentCo</a></div>'
      + '<h3>Mô tả công việc</h3>'
      + '<div class="job-description__item--content">TypeScript developer</div>';

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
    const html = '<div class="job-detail__info--title"><h1>Backend Developer</h1></div>'
      + '<div class="company-name-label"><a class="name">StableCo</a></div>'
      + '<h3>Mô tả công việc</h3>'
      + '<div class="job-description__item--content">Golang developer for API</div>';

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
    const html = '<div class="job-detail__info--title"><h1>Multi Role</h1></div>'
      + '<div class="company-name-label"><a class="name">MultiCo</a></div>'
      + '<p>Go</p>';

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
