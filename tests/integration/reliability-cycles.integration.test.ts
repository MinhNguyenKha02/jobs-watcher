import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createTestStorage } from '../helpers/create-test-storage.js';
import { MongoJobLifecycleAdapter } from '../../src/infrastructure/outbound/persistence/mongo-job-lifecycle-adapter.js' ;
import { getLogger } from '../../src/infrastructure/outbound/logging/logger.js' ;
import { JobStage, JobSource, JobStatus } from '../../src/domain/types/job-lifecycle.js' ;

const logger = getLogger();
const { JobIngestor } = await import('../../src/application/ingestor.js');

function makeTopCvHtml(company = 'TestCo'): string {
  return '<div class="job-detail__info--title"><h1>Software Engineer</h1></div>'
    + '<div class="company-name-label"><a class="name">' + company + '</a></div>'
    + '<div>topcv</div>'
    + '<p>TypeScript</p>'
    + '<div class="job-description__item"><h3>Mô tả công việc</h3>'
    + '<div class="job-description__item--content">We need a TypeScript developer with JavaScript skills</div>'
    + '</div>';
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

describe('Reliability cycles (S2→S4→S1 failure auto-advance)', () => {
  let storage: any;
  let adapter: MongoJobLifecycleAdapter;
  let parseEvents: any[];
  let routingEvents: any[];
  let ingestor: any;

  beforeAll(async () => {
    storage = await createTestStorage();
    adapter = new MongoJobLifecycleAdapter(storage.client.db(storage.dbName));

    parseEvents = [];
    routingEvents = [];

    const parseEventPort = {
      emitGenerated: vi.fn((...args: any[]) => { parseEvents.push(['generated', ...args]); }),
      emitCompleted: vi.fn((...args: any[]) => { parseEvents.push(['completed', ...args]); }),
      emitFailed: vi.fn((...args: any[]) => { parseEvents.push(['failed', ...args]); }),
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

  beforeEach(() => {
    parseEvents.length = 0;
    routingEvents.length = 0;
  });

  it('S2 parse.failed → S1 next job: emits s4a then s1 for new job', async () => {
    await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, '', 'job-fail-s4a');

    const failedEvents = parseEvents.filter(([t]) => t === 'failed');
    expect(failedEvents.length).toBe(1);

    await ingestor.processIngest(JobSource.BROWSER_AUTO, JobStage.PARTIAL_PARSED, emailHtmlFor('Software Engineer', 'AlphaCo'), undefined, { messageId: 'job-after-s4a' });

    const generatedEvents = parseEvents.filter(([t]) => t === 'generated');
    expect(generatedEvents.length).toBe(1);
    const doc = await adapter.findById('job-after-s4a-job-0');
    expect(doc).not.toBeNull();
    expect(doc!.stage).toBe(JobStage.PARTIAL_PARSED);
  });

  it('S3 route.failed → S1 next job: emits s4b then s1 for new job', async () => {
    const doc = {
      _id: 'job-fail-s4b',
      raw: '<html>test</html>',
      stage: JobStage.FULL_PARSED,
      status: JobStatus.ENRICHED,
      source: JobSource.MANUAL,
      company: 'FailCo',
      role: 'Engineer',
      createdAt: new Date(),
      updatedAt: new Date(),
      stageTimestamp: new Date(),
    };
    await adapter.upsert(doc);
    vi.spyOn(adapter, 'updateStage').mockRejectedValueOnce(new Error('DB write timeout'));

    await ingestor.processResolution('job-fail-s4b', 'queue');

    const failedRoutingEvents = routingEvents.filter(([t]) => t === 'failed');
    expect(failedRoutingEvents.length).toBe(1);

    vi.restoreAllMocks();

    await ingestor.processIngest(JobSource.BROWSER_AUTO, JobStage.PARTIAL_PARSED, emailHtmlFor('Software Engineer', 'BetaCo'), undefined, { messageId: 'job-after-s4b' });

    const generatedEvents = parseEvents.filter(([t]) => t === 'generated');
    expect(generatedEvents.length).toBe(1);
  });

  it('S2 parse.failed (empty html) then S2a manual succeeds for different job', async () => {
    await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, '', 'job-s4-empty');

    const failBefore = parseEvents.filter(([t]) => t === 'failed').length;
    expect(failBefore).toBe(1);

    const partialDoc = {
      _id: 'job-s4-recover',
      raw: '<html><body>partial</body></html>',
      stage: JobStage.PARTIAL_PARSED,
      status: JobStatus.ENRICHING,
      source: JobSource.BROWSER_AUTO,
      company: 'RecoveryCo',
      role: 'Junior Engineer',
      url: 'https://recovery.com/job',
      createdAt: new Date(),
      updatedAt: new Date(),
      stageTimestamp: new Date(),
    };
    await adapter.upsert(partialDoc);

    await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, makeTopCvHtml('RecoveryCo'), 'job-s4-recover');

    const completedEvents = parseEvents.filter(([t]) => t === 'completed');
    expect(completedEvents.length).toBe(1);

    const fullDoc = await adapter.findById('job-s4-recover');
    expect(fullDoc).not.toBeNull();
    expect(fullDoc!.stage).toBe(JobStage.FULL_PARSED);
    expect(fullDoc!.status).toBe(JobStatus.ENRICHED);
  });
});
