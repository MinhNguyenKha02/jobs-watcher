import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { createTestStorage } from '../../../helpers/create-test-storage.js';
import { createRealDipBus, type RealDipBus } from '../../../helpers/real-dip-bus.js';
import { MongoJobLifecycleAdapter } from '../../../../src/infrastructure/outbound/persistence/mongo-job-lifecycle-adapter.js' ;
import { JobIngestor } from '../../../../src/application/ingestor.js';
import { JobStage, JobStatus, JobSource } from '../../../../src/domain/types/job-lifecycle.js' ;
import { ActionEvent } from '../../../../src/domain/types/action-event.js';

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
  let realIngestor: () => JobIngestor;
  let realBus: RealDipBus;

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
    realBus = await createRealDipBus('jobs.events.int.c4.signal-flow');
    realIngestor = () => new JobIngestor(adapter, realBus.parsePort, realBus.routePort);
  });

  afterAll(async () => {
    await realBus.teardown();
    await storage.stop();
  });

  beforeEach(async () => {
    await storage.client.db(storage.dbName).dropDatabase();
    parseEventPort = createParseEventPort();
    routingPort = createRoutingPort();
    ingestor = new JobIngestor(adapter, parseEventPort, routingPort);
  });

  it('S2b: signal2bManual creates job with clip-* ID and FULL_PARSED status — real-DIP', async () => {
    const html = htmlFor('Software Engineer', 'Clipboard Co');
    const comp = await realBus.setup([ActionEvent.PARSE_COMPLETED]);
    await realIngestor().processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, html);
    const compMsg = await comp.msg();
    const id = compMsg.job._id;
    expect(id).toMatch(/^clip-/);
    const doc = await adapter.findById(id);
    expect(doc).not.toBeNull();
    expect(doc!.status).toBe(JobStatus.ENRICHED);
    expect(doc!.stage).toBe(JobStage.FULL_PARSED);
    expect(doc!.source).toBe(JobSource.MANUAL);
  });

  it('S1→S2: chained enrich preserves and merges fields from partial to full — real-DIP', async () => {
    const partialHtml = emailHtmlFor('Software Engineer', 'Chained Co');
    const gen = await realBus.setup([ActionEvent.GENERATED]);
    await realIngestor().processIngest(JobSource.BROWSER_AUTO, JobStage.PARTIAL_PARSED, partialHtml, undefined, { messageId: 'chain-msg' });
    const genMsg = await gen.msg();
    const jobLifecycleId = genMsg._id;
    const s1Doc = await adapter.findById(jobLifecycleId);
    expect(s1Doc).not.toBeNull();
    expect(s1Doc!.stage).toBe(JobStage.PARTIAL_PARSED);

    const fullHtml = htmlFor('Software Engineer', 'Chained Co');
    const comp = await realBus.setup([ActionEvent.PARSE_COMPLETED]);
    await realIngestor().processIngest(JobSource.BROWSER_AUTO, JobStage.FULL_PARSED, fullHtml, jobLifecycleId);
    const compMsg = await comp.msg();
    expect(compMsg.job._id).toBe(jobLifecycleId);
    const s2Doc = await adapter.findById(jobLifecycleId);
    expect(s2Doc).not.toBeNull();
    expect(s2Doc!.stage).toBe(JobStage.FULL_PARSED);
    expect(s2Doc!.status).toBe(JobStatus.ENRICHED);
  });

  it('S2b: signal2bManual stores correct source and stage in MongoDB — real-DIP', async () => {
    const html = htmlFor('Software Engineer', 'Direct Co');
    const comp = await realBus.setup([ActionEvent.PARSE_COMPLETED]);
    await realIngestor().processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, html);
    const compMsg = await comp.msg();
    const id = compMsg.job._id;
    const doc = await adapter.findById(id);
    expect(doc!.source).toBe(JobSource.MANUAL);
    expect(doc!.stage).toBe(JobStage.FULL_PARSED);
    expect(doc!.company).toBe('Direct Co');
    expect(doc!.role).toBe('Software Engineer');
  });

  it('S2a: emits parse.failed on empty HTML payload — real-DIP', async () => {
    const fail = await realBus.setup([ActionEvent.PARSE_FAILED]);
    await realIngestor().processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, '', 'test-empty-id');
    const failMsg = await fail.msg();
    expect(failMsg.jobLifecycleId).toBe('test-empty-id');
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
