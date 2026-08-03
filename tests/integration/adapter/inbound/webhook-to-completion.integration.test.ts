import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { createTestStorage } from '../../../helpers/create-test-storage.js';
import { MongoJobLifecycleAdapter } from '../../../../src/infrastructure/outbound/persistence/mongo-job-lifecycle-adapter.js';
import { JobIngestor } from '../../../../src/application/ingestor.js';
import { JobStage, JobStatus, JobSource } from '../../../../src/domain/types/job-lifecycle.js';

function topcvHtml(role: string, company: string, langContent: string): string {
  return '<div class="job-detail__info--title"><h1>' + role + '</h1></div>'
    + '<div class="company-name-label"><a class="name">' + company + '</a></div>'
    + '<h3>Mô tả công việc</h3>'
    + '<div class="job-description__item--content">' + langContent + '</div>';
}

describe('Webhook-to-completion saga (S1->S2->S3->S4)', () => {
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

  it('processIngest with PARTIAL_PARSED creates job and transitions S1->S2', async () => {
    const html = '<div data-source="topcv">'
      + '<a class="job-item-link" href="/viec-lam/software-engineer">'
      + '<div class="title"><span>Software Engineer</span></div>'
      + '<div class="company"><span>TestCo</span></div>'
      + '</a></div>';

    await ingestor.processIngest(JobSource.BROWSER_AUTO, JobStage.PARTIAL_PARSED, html);

    expect(parseEventPort.emitGenerated).toHaveBeenCalledOnce();
    expect(parseEventPort.emitCompleted).not.toHaveBeenCalled();
  });

  it('processIngest with FULL_PARSED completes S2 and transitions S2->S3', async () => {
    const html = topcvHtml('Full Stack', 'FullCo', 'TypeScript and Node.js developer');

    await ingestor.processIngest(JobSource.BROWSER_AUTO, JobStage.FULL_PARSED, html, 'saga-2-id');

    expect(parseEventPort.emitCompleted).toHaveBeenCalled();
  });

  it('processResolution with queue action transitions S3->S4', async () => {
    const html = topcvHtml('Software Engineer', 'QueueCo', 'Python developer for backend');

    await ingestor.processIngest(JobSource.BROWSER_AUTO, JobStage.FULL_PARSED, html, 'saga-3-id');
    await ingestor.processResolution('saga-3-id', 'queue');

    expect(routingPort.emitJobQueued).toHaveBeenCalledWith(
      'saga-3-id',
      expect.objectContaining({ source: JobSource.MANUAL }),
    );
  });

  it('processResolution with trash action transitions S3->S4 with discard', async () => {
    const html = topcvHtml('Backend Developer', 'TrashCo', 'Golang developer for API');
    await ingestor.processIngest(JobSource.BROWSER_AUTO, JobStage.FULL_PARSED, html, 'trash-test-id');
    await ingestor.processResolution('trash-test-id', 'trash');

    expect(routingPort.emitJobTrashed).toHaveBeenCalled();
  });

  it('full saga with metadata flows end-to-end', async () => {
    const html = '<div data-source="topcv">'
      + '<a class="job-item-link" href="/viec-lam/data-engineer">'
      + '<div class="title"><span>Data Engineer</span></div>'
      + '<div class="company"><span>DataCo</span></div>'
      + '</a></div>';

    await ingestor.processIngest(
      JobSource.BROWSER_AUTO,
      JobStage.PARTIAL_PARSED,
      html,
      undefined,
      { subject: 'Job Alert: Data Engineer', from: 'jobs@example.com', messageId: 'msg-1' },
    );

    expect(parseEventPort.emitGenerated).toHaveBeenCalled();
  });
});
