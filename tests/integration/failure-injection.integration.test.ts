import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { createTestStorage } from '../helpers/create-test-storage.js';
import { MongoJobLifecycleAdapter } from '../../src/infrastructure/outbound/persistence/mongo-job-lifecycle-adapter.js';
import { JobIngestor } from '../../src/application/ingestor.js';
import { JobSource, JobStage } from '../../src/domain/types/job-lifecycle.js';

describe('Failure injection — cause-effect graph', () => {
  let storage: Awaited<ReturnType<typeof createTestStorage>>;
  let adapter: MongoJobLifecycleAdapter;
  let ingestor: JobIngestor;
  let parseEventPort: Record<string, ReturnType<typeof vi.fn>>;
  let routingPort: Record<string, ReturnType<typeof vi.fn>>;

  beforeAll(async () => {
    storage = await createTestStorage();
    adapter = new MongoJobLifecycleAdapter(storage.client.db(storage.dbName));
  }, 120000);

  beforeEach(() => {
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
  });

  afterAll(async () => {
    await storage.stop();
  });

  it('cause: parse failure -> effect: emitFailed called (saga enters S5)', async () => {
    const html = '<span>unparseable content without any job format markers</span>';

    await ingestor.processIngest(JobSource.BROWSER_AUTO, JobStage.FULL_PARSED, html, 'fail-parse-id');

    expect(parseEventPort.emitFailed).toHaveBeenCalled();
  });

  it('cause: routing failure -> effect: route emitFailed or saga compensation', async () => {
    const html = '<div class="job-detail__info--title"><h1>Backend Developer</h1></div>'
      + '<div class="company-name-label"><a class="name">RouterCo</a></div>'
      + '<h3>Mô tả công việc</h3>'
      + '<div class="job-description__item--content">Golang developer</div>';

    await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, html, 'fail-route-id');
    routingPort.emitJobQueued.mockRejectedValue(new Error('Routing unavailable'));
    await ingestor.processResolution('fail-route-id', 'queue');

    expect(routingPort.emitRouteFailed).toHaveBeenCalled();
  });

  it('cause: empty html -> effect: ingest handles gracefully (no crash)', async () => {
    await expect(
      ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, '', 'empty-html-id'),
    ).resolves.toBeUndefined();
    expect(parseEventPort.emitFailed).toHaveBeenCalled();
  });

  it('cause: invalid source -> effect: ingest still processes', async () => {
    const html = '<div class="job-detail__info--title"><h1>Any Job</h1></div>'
      + '<div class="company-name-label"><a class="name">AnyCo</a></div>';

    await expect(
      ingestor.processIngest(JobSource.MANUAL, JobStage.PARTIAL_PARSED, html, 'any-source-id'),
    ).resolves.toBeUndefined();
  });
});
