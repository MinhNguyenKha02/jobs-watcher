import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createTestStorage } from '../helpers/create-test-storage.js';
import { MongoJobLifecycleAdapter } from '../../src/infrastructure/outbound/persistence/mongo-job-lifecycle-adapter.js' ;
import { getLogger } from '../../src/infrastructure/outbound/logging/logger.js' ;
import { JobStage, JobSource, JobStatus } from '../../src/domain/types/job-lifecycle.js' ;

const logger = getLogger();
const { JobIngestor } = await import('../../src/application/ingestor.js');

function htmlFor(role: string, company: string): string {
  return '<div class="job-detail__info--title"><h1>' + role + '</h1></div>'
    + '<div class="company-name-label"><a class="name">' + company + '</a></div>'
    + '<div>topcv</div>'
    + '<p>TypeScript</p>'
    + '<div class="job-description__item"><h3>Mô tả công việc</h3>'
    + '<div class="job-description__item--content">We need a TypeScript developer with JavaScript skills</div>'
    + '</div>';
}

function makeStage1Partial(overrides: any = {}): any {
  return {
    _id: overrides._id || 'test-id',
    raw: '<html><body>partial</body></html>',
    stage: JobStage.PARTIAL_PARSED,
    status: JobStatus.ENRICHING,
    source: JobSource.BROWSER_AUTO,
    company: overrides.company || 'TestCo',
    role: overrides.role || 'Software Engineer',
    url: overrides.url || 'https://test.com/job',
    createdAt: new Date(),
    updatedAt: new Date(),
    stageTimestamp: new Date(),
    ...overrides,
  };
}

describe('High-ROI sequential tests (H1-H5)', () => {
  let storage: any;
  let adapter: MongoJobLifecycleAdapter;
  let parseEvents: any[];
  let routingEvents: any[];
  let ingestor: JobIngestor;

  beforeAll(async () => {
    storage = await createTestStorage();
    adapter = new MongoJobLifecycleAdapter(storage.client.db(storage.dbName));

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

  // ── H1: Rate stress — 5 sequential S1→S2→S3→S1 cycles ──────────────
  it('H1: Rate stress — 5 sequential S1→S2→S3→S1 cycles with no state leakage', async () => {
    const totalCycles = 5;

    for (let i = 0; i < totalCycles; i++) {
      const messageId = `h1-cycle-${i}`;
      const role = 'Software Engineer';
      const company = `RateCo${i}`;

      await ingestor.processIngest(JobSource.BROWSER_AUTO, JobStage.PARTIAL_PARSED, htmlFor(role, company), undefined, { messageId, subject: role });

      const genEvents = parseEvents.filter(([t]) => t === 'generated');
      expect(genEvents.length).toBe(i + 1);
      const jobLifecycleId = genEvents[i][1]._id;
      expect(jobLifecycleId).toMatch(/-job-0$/);

      const partialDoc = await adapter.findById(jobLifecycleId);
      expect(partialDoc).not.toBeNull();
      expect(partialDoc!.stage).toBe(JobStage.PARTIAL_PARSED);
      expect(partialDoc!.status).toBe(JobStatus.ENRICHING);

      await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, htmlFor(role, company), jobLifecycleId);

      const completedEvents = parseEvents.filter(([t]) => t === 'completed');
      expect(completedEvents.length).toBe(i + 1);
      expect(completedEvents[i][1]._id).toBe(jobLifecycleId);

      const enrichedDoc = await adapter.findById(jobLifecycleId);
      expect(enrichedDoc).not.toBeNull();
      expect(enrichedDoc!.stage).toBe(JobStage.FULL_PARSED);
      expect(enrichedDoc!.status).toBe(JobStatus.ENRICHED);

      await ingestor.processResolution(jobLifecycleId, 'queue');

      const queuedEvents = routingEvents.filter(([t]) => t === 'queued');
      expect(queuedEvents.length).toBe(i + 1);

      const routedDoc = await adapter.findById(jobLifecycleId);
      expect(routedDoc).not.toBeNull();
      expect(routedDoc!.status).toBe(JobStatus.QUEUED);
    }

    expect(parseEvents.filter(([t]) => t === 'failed').length).toBe(0);
    expect(routingEvents.filter(([t]) => t === 'failed').length).toBe(0);
  });

  // ── H2: Rapid [c] double-press idempotency ──────────────────────────
  it('H2: Rapid [c] double-press — signal2aManual twice for same partial job', async () => {
    const jobLifecycleId = 'h2-double-c';
    await adapter.upsert(makeStage1Partial({
      _id: jobLifecycleId,
      company: 'DoubleCo',
      role: 'Junior Dev',
    }));

    await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, htmlFor('Junior Dev', 'DoubleCo'), jobLifecycleId);

    const completedAfterFirst = parseEvents.filter(([t]) => t === 'completed').length;
    expect(completedAfterFirst).toBe(1);

    const firstDoc = await adapter.findById(jobLifecycleId);
    expect(firstDoc!.stage).toBe(JobStage.FULL_PARSED);

    await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, htmlFor('Junior Dev', 'DoubleCo'), jobLifecycleId);

    const completedAfterSecond = parseEvents.filter(([t]) => t === 'completed');
    expect(completedAfterSecond.length).toBe(1);

    const secondDoc = await adapter.findById(jobLifecycleId);
    expect(secondDoc!.stage).toBe(JobStage.FULL_PARSED);

    expect(parseEvents.filter(([t]) => t === 'failed').length).toBe(0);
  });

  // ── H3: [c] then [j] race — S2 arrives after queue ──────────────────
  it('H3: [c] then [j] race — S2 enrichment after queue is guarded (B2 guard prevents overwrite)', async () => {
    const jobLifecycleId = 'h3-enrich-after-queue';
    await adapter.upsert(makeStage1Partial({
      _id: jobLifecycleId,
      company: 'RaceCo',
      role: 'Junior Dev',
      stage: JobStage.FULL_PARSED,
      status: JobStatus.ENRICHED,
    }));

    await ingestor.processResolution(jobLifecycleId, 'queue');

    const queuedEvents = routingEvents.filter(([t]) => t === 'queued');
    expect(queuedEvents.length).toBe(1);

    const queuedDoc = await adapter.findById(jobLifecycleId);
    expect(queuedDoc!.status).toBe(JobStatus.QUEUED);

    await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, htmlFor('Junior Dev', 'RaceCo'), jobLifecycleId);

    // B2 guard: already FULL_PARSED, so no completed event
    const completedEvents = parseEvents.filter(([t]) => t === 'completed');
    expect(completedEvents.length).toBe(0);

    // Status stays QUEUED — guard prevents regression to ENRICHED
    const enrichedDoc = await adapter.findById(jobLifecycleId);
    expect(enrichedDoc!.stage).toBe(JobStage.FULL_PARSED);
    expect(enrichedDoc!.status).toBe(JobStatus.QUEUED);

    expect(parseEvents.filter(([t]) => t === 'failed').length).toBe(0);
  });

  // ── H4: S2 enrichment with missing stage1Partial fallback ───────────
  it('H4: S2 enrichment with missing stage1Partial — fallback to HTML-only parsed job', async () => {
    const jobLifecycleId = 'h4-no-partial';

    await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, htmlFor('Fallback Role', 'FallbackCo'), jobLifecycleId);

    const completedEvents = parseEvents.filter(([t]) => t === 'completed');
    expect(completedEvents.length).toBe(1);
    expect(completedEvents[0][1]._id).toBe(jobLifecycleId);

    const doc = await adapter.findById(jobLifecycleId);
    expect(doc).not.toBeNull();
    expect(doc!.stage).toBe(JobStage.FULL_PARSED);
    expect(doc!.status).toBe(JobStatus.ENRICHED);
    expect(doc!.company).toBe('FallbackCo');
    expect(doc!.role).toBe('Fallback Role');

    expect(parseEvents.filter(([t]) => t === 'failed').length).toBe(0);
  });

  // ── H5: S3 route failure → S4 → S1 next job ────────────────────────
  it('H5: S3 route failure (S4) then next S1 partial processes normally', async () => {
    const docId = 'h5-route-fail';
    await adapter.upsert(makeStage1Partial({
      _id: docId,
      company: 'FailCo',
      role: 'Senior Engineer',
      stage: JobStage.FULL_PARSED,
      status: JobStatus.ENRICHED,
    }));

    vi.spyOn(adapter, 'updateStage').mockRejectedValueOnce(new Error('DB write timeout'));

    await ingestor.processResolution(docId, 'queue');

    const routeFailedEvents = routingEvents.filter(([t]) => t === 'failed');
    expect(routeFailedEvents.length).toBe(1);
    expect(routeFailedEvents[0][2]).toBe('DB write timeout');

    vi.restoreAllMocks();

    await ingestor.processIngest(JobSource.BROWSER_AUTO, JobStage.PARTIAL_PARSED, htmlFor('Software Engineer', 'NextCo'), undefined, { messageId: 'h5-next' });

    const genEvents = parseEvents.filter(([t]) => t === 'generated');
    expect(genEvents.length).toBe(1);

    const doc = await adapter.findById('h5-next-job-0');
    expect(doc).not.toBeNull();
    expect(doc!.stage).toBe(JobStage.PARTIAL_PARSED);
    expect(doc!.status).toBe(JobStatus.ENRICHING);

    expect(parseEvents.filter(([t]) => t === 'failed').length).toBe(0);
  });
});
