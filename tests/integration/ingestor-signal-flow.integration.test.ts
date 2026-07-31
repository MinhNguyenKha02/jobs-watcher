import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { createTestStorage } from '../helpers/create-test-storage.js';
import { MongoJobLifecycleAdapter } from '../../src/infrastructure/outbound/persistence/mongo-job-lifecycle-adapter.js' ;
import { JobIngestor } from '../../src/application/ingestor.js';
import { JobStage, JobStatus, JobSource } from '../../src/domain/types/job-lifecycle.js' ;

function htmlFor(role: string, company: string): string {
  return `<div class="job-detail__info--title"><h1>${role}</h1></div>`
    + `<div class="company-name-label"><a class="name">${company}</a></div>`
    + '<div>topcv</div>'
    + '<p>TypeScript</p>'
    + '<div class="job-description__item"><h3>Mô tả công việc</h3>'
    + '<div class="job-description__item--content">We need a TypeScript developer with JavaScript skills</div>'
    + '</div>';
}

function topcvHtml(role: string, company: string, langContent: string): string {
  return '<div class="job-detail__info--title"><h1>' + role + '</h1></div>'
    + '<div class="company-name-label"><a class="name">' + company + '</a></div>'
    + '<h3>Mô tả công việc</h3>'
    + '<div class="job-description__item--content">' + langContent + '</div>';
}

function emailHtmlFor(role: string, company: string): string {
  const encodedUrl = `/viec-lam/${role.toLowerCase().replace(/\s+/g, '-')}`;
  return '<html><body>'
    + '<a class="job-item-link" href="' + encodedUrl + '">'
    + '<div class="topcv-job-item">'
    + '<div class="title"><span>' + role + '</span></div>'
    + '<div class="company"><span>' + company + '</span></div>'
    + '<div>Hà Nội</div>'
    + '</div>'
    + '</a>'
    + '<p>topcv job-item</p>'
    + '<p>TypeScript</p>'
    + '</body></html>';
}

describe('Ingestor Signal Flow Integration', { timeout: 30000 }, () => {
  let storage: Awaited<ReturnType<typeof createTestStorage>>;
  let adapter: MongoJobLifecycleAdapter;
  let parseEventPort: ReturnType<typeof createParseEventPort>;
  let routingPort: ReturnType<typeof createRoutingPort>;
  let ingestor: JobIngestor;

  function createParseEventPort() {
    return {
      emitGenerated: vi.fn(),
      emitCompleted: vi.fn(),
      emitFailed: vi.fn(),
    };
  }

  function createRoutingPort() {
    return {
      emitJobQueued: vi.fn(),
      emitJobTrashed: vi.fn(),
      emitRouteFailed: vi.fn(),
    };
  }

  beforeAll(async () => {
    storage = await createTestStorage();
    adapter = new MongoJobLifecycleAdapter(storage.client.db(storage.dbName));
  });

  afterAll(async () => {
    await storage.stop();
  });

  beforeEach(async () => {
    await storage.client.db(storage.dbName).dropDatabase();
    parseEventPort = createParseEventPort();
    routingPort = createRoutingPort();
    ingestor = new JobIngestor(adapter, parseEventPort, routingPort);
  });

  it('S2b: signal2bManual creates job with clip-* ID and FULL_PARSED status', async () => {
    const html = htmlFor('Software Engineer', 'Clipboard Co');
    await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, html);
    expect(parseEventPort.emitCompleted).toHaveBeenCalled();
    const id = parseEventPort.emitCompleted.mock.calls[0][0]._id;
    expect(id).toMatch(/^clip-/);
    const doc = await adapter.findById(id);
    expect(doc).not.toBeNull();
    expect(doc!.status).toBe(JobStatus.ENRICHED);
    expect(doc!.stage).toBe(JobStage.FULL_PARSED);
    expect(doc!.source).toBe(JobSource.MANUAL);
  });

  it('S1→S2: chained enrich preserves and merges fields from partial to full', async () => {
    const partialHtml = emailHtmlFor('Software Engineer', 'Chained Co');
    await ingestor.processIngest(JobSource.BROWSER_AUTO, JobStage.PARTIAL_PARSED, partialHtml, undefined, { messageId: 'chain-msg' });
    expect(parseEventPort.emitGenerated).toHaveBeenCalled();
    const s1Job = parseEventPort.emitGenerated.mock.calls[0][0];
    const jobLifecycleId = s1Job._id;
    const s1Doc = await adapter.findById(jobLifecycleId);
    expect(s1Doc).not.toBeNull();
    expect(s1Doc!.stage).toBe(JobStage.PARTIAL_PARSED);

    const fullHtml = htmlFor('Software Engineer', 'Chained Co');
    await ingestor.processIngest(JobSource.BROWSER_AUTO, JobStage.FULL_PARSED, fullHtml, jobLifecycleId);
    expect(parseEventPort.emitCompleted).toHaveBeenCalled();
    const s2Doc = await adapter.findById(jobLifecycleId);
    expect(s2Doc).not.toBeNull();
    expect(s2Doc!.stage).toBe(JobStage.FULL_PARSED);
    expect(s2Doc!.status).toBe(JobStatus.ENRICHED);
  });

  it('S2b: signal2bManual stores correct source and stage in MongoDB', async () => {
    const html = htmlFor('Software Engineer', 'Direct Co');
    await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, html);
    expect(parseEventPort.emitCompleted).toHaveBeenCalled();
    const id = parseEventPort.emitCompleted.mock.calls[0][0]._id;
    const doc = await adapter.findById(id);
    expect(doc!.source).toBe(JobSource.MANUAL);
    expect(doc!.stage).toBe(JobStage.FULL_PARSED);
    expect(doc!.company).toBe('Direct Co');
    expect(doc!.role).toBe('Software Engineer');
  });

  it('S2a: emits parse.failed on empty HTML payload', async () => {
    await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, '', 'test-empty-id');
    expect(parseEventPort.emitFailed).toHaveBeenCalledWith(
      'test-empty-id',
      expect.objectContaining({ error: 'Empty HTML payload' })
    );
  });

  it('propagates non-11000 upsert error', async () => {
    const badDb = new MongoJobLifecycleAdapter(storage.client.db(storage.dbName));
    vi.spyOn(badDb, 'upsert').mockRejectedValueOnce(
      Object.assign(new Error('Disk full'), { code: 9000 })
    );
    const standalone = new JobIngestor(badDb, parseEventPort, routingPort);

    await expect(
      standalone.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, htmlFor('Software Engineer', 'FailCo'))
    ).rejects.toThrow('Disk full');
  });
});
