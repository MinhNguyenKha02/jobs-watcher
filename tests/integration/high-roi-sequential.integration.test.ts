import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createTestStorage } from '../helpers/create-test-storage.js';
import { MongoDBStorageAdapter } from '../../src/infrastructure/outbound/persistence/mongodb-storage-adapter.js' ;
import { getLogger } from '../../src/infrastructure/outbound/logging/logger.js' ;
import { JobStage, JobSource, JobStatus } from '../../src/domain/types/job-lifecycle.js' ;

const logger = getLogger();
const { default: JobIngestor } = await import('../../src/application/ingestor.js');

function htmlFor(role: string, company: string): string {
  return '<div class="job-detail__info--title"><h1>' + role + '</h1></div>'
    + '<div class="company-name-label"><a class="name">' + company + '</a></div>'
    + '<div>topcv</div>';
}

function makeStage1Partial(overrides: any = {}): any {
  return {
    _id: overrides._id || 'test-id',
    raw: '<html><body>partial</body></html>',
    stage: JobStage.PARTIAL_PARSED,
    status: JobStatus.ENRICHING,
    source: JobSource.BROWSER_AUTO,
    company: overrides.company || 'TestCo',
    role: overrides.role || 'Junior Engineer',
    url: overrides.url || 'https://test.com/job',
    createdAt: new Date(),
    updatedAt: new Date(),
    stageTimestamp: new Date(),
    ...overrides,
  };
}

describe('High-ROI sequential tests (H1-H5)', () => {
  let storage: any;
  let adapter: MongoDBStorageAdapter;
  let parseEvents: any[];
  let routingEvents: any[];
  let ingestor: JobIngestor;

  beforeAll(async () => {
    storage = await createTestStorage();
    adapter = new MongoDBStorageAdapter({
      mongoUri: storage.uri,
      dbName: storage.dbName,
      logger,
    });
    await adapter.connect();

    parseEvents = [];
    routingEvents = [];

    const parseEventPort = {
      emitJobGenerated: vi.fn((...args: any[]) => { parseEvents.push(['generated', ...args]); return Promise.resolve(); }),
      emitJobGeneratedFailed: vi.fn((...args: any[]) => { parseEvents.push(['generatedFailed', ...args]); return Promise.resolve(); }),
      emitParseCompleted: vi.fn((...args: any[]) => { parseEvents.push(['completed', ...args]); return Promise.resolve(); }),
      emitParseFailed: vi.fn((...args: any[]) => { parseEvents.push(['failed', ...args]); return Promise.resolve(); }),
    };

    const routingPort = {
      emitJobQueued: vi.fn((...args: any[]) => { routingEvents.push(['queued', ...args]); return Promise.resolve(); }),
      emitJobTrashed: vi.fn((...args: any[]) => { routingEvents.push(['trashed', ...args]); return Promise.resolve(); }),
      emitRouteFailed: vi.fn((...args: any[]) => { routingEvents.push(['failed', ...args]); return Promise.resolve(); }),
    };

    ingestor = new JobIngestor(adapter, { parseEventPort, routingPort });
  }, 120000);

  afterAll(async () => {
    await adapter.disconnect();
    await storage.stop();
  });

  beforeEach(async () => {
    parseEvents.length = 0;
    routingEvents.length = 0;
    const db = (adapter as any).db;
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
      const role = 'Junior Engineer';
      const company = `RateCo${i}`;

      await ingestor.processIngestCommand({
        source: JobSource.BROWSER_AUTO,
        stage: JobStage.PARTIAL_PARSED,
        rawPayload: htmlFor(role, company),
        metadata: { messageId, subject: role },
      });

      const genEvents = parseEvents.filter(([t]) => t === 'generated');
      expect(genEvents.length).toBe(i + 1);
      const joblifecycleId = genEvents[i][1]._id;
      expect(joblifecycleId).toMatch(/-job-0$/);

      const partialDoc = await adapter.findJobLifecycleById(joblifecycleId);
      expect(partialDoc).not.toBeNull();
      expect(partialDoc!.stage).toBe(JobStage.PARTIAL_PARSED);
      expect(partialDoc!.status).toBe(JobStatus.ENRICHING);

      await ingestor.processIngestCommand({
        source: JobSource.MANUAL,
        stage: JobStage.FULL_PARSED,
        rawPayload: htmlFor(role, company),
        joblifecycleId,
      });

      const completedEvents = parseEvents.filter(([t]) => t === 'completed');
      expect(completedEvents.length).toBe(i + 1);
      expect(completedEvents[i][1]).toBe(joblifecycleId);

      const enrichedDoc = await adapter.findJobLifecycleById(joblifecycleId);
      expect(enrichedDoc).not.toBeNull();
      expect(enrichedDoc!.stage).toBe(JobStage.FULL_PARSED);
      expect(enrichedDoc!.status).toBe(JobStatus.ENRICHED);
      expect(enrichedDoc!.matchScore).toBeGreaterThan(0);

      await ingestor.processResolutionCommand({
        joblifecycleId,
        action: 'queue',
      });

      const queuedEvents = routingEvents.filter(([t]) => t === 'queued');
      expect(queuedEvents.length).toBe(i + 1);

      const routedDoc = await adapter.findJobLifecycleById(joblifecycleId);
      expect(routedDoc).not.toBeNull();
      expect(routedDoc!.status).toBe(JobStatus.QUEUED);
    }

    expect(parseEvents.filter(([t]) => t === 'failed').length).toBe(0);
    expect(routingEvents.filter(([t]) => t === 'failed').length).toBe(0);
  });

  // ── H2: Rapid [c] double-press idempotency ──────────────────────────
  it('H2: Rapid [c] double-press — signal2aManual twice for same partial job', async () => {
    const joblifecycleId = 'h2-double-c';
    await adapter.upsertJobLifecycle(makeStage1Partial({
      _id: joblifecycleId,
      company: 'DoubleCo',
      role: 'Junior Dev',
    }));

    await ingestor.processIngestCommand({
      source: JobSource.MANUAL,
      stage: JobStage.FULL_PARSED,
      rawPayload: htmlFor('Junior Dev', 'DoubleCo'),
      joblifecycleId,
    });

    const completedAfterFirst = parseEvents.filter(([t]) => t === 'completed').length;
    expect(completedAfterFirst).toBe(1);

    const firstDoc = await adapter.findJobLifecycleById(joblifecycleId);
    expect(firstDoc!.stage).toBe(JobStage.FULL_PARSED);

    await ingestor.processIngestCommand({
      source: JobSource.MANUAL,
      stage: JobStage.FULL_PARSED,
      rawPayload: htmlFor('Junior Dev', 'DoubleCo'),
      joblifecycleId,
    });

    const completedAfterSecond = parseEvents.filter(([t]) => t === 'completed');
    expect(completedAfterSecond.length).toBe(2);

    const secondDoc = await adapter.findJobLifecycleById(joblifecycleId);
    expect(secondDoc!.stage).toBe(JobStage.FULL_PARSED);

    expect(parseEvents.filter(([t]) => t === 'failed').length).toBe(0);
  });

  // ── H3: [c] then [j] race — S2 arrives after queue ──────────────────
  it('H3: [c] then [j] race — S2 enrichment after queue overwrites QUEUED status (known sequencing gap)', async () => {
    const joblifecycleId = 'h3-enrich-after-queue';
    await adapter.upsertJobLifecycle(makeStage1Partial({
      _id: joblifecycleId,
      company: 'RaceCo',
      role: 'Junior Dev',
    }));

    await ingestor.processResolutionCommand({
      joblifecycleId,
      action: 'queue',
    });

    const queuedEvents = routingEvents.filter(([t]) => t === 'queued');
    expect(queuedEvents.length).toBe(1);

    const queuedDoc = await adapter.findJobLifecycleById(joblifecycleId);
    expect(queuedDoc!.status).toBe(JobStatus.QUEUED);

    await ingestor.processIngestCommand({
      source: JobSource.MANUAL,
      stage: JobStage.FULL_PARSED,
      rawPayload: htmlFor('Junior Dev', 'RaceCo'),
      joblifecycleId,
    });

    const completedEvents = parseEvents.filter(([t]) => t === 'completed');
    expect(completedEvents.length).toBe(1);

    const enrichedDoc = await adapter.findJobLifecycleById(joblifecycleId);
    expect(enrichedDoc!.stage).toBe(JobStage.FULL_PARSED);
    expect(enrichedDoc!.matchScore).toBeGreaterThan(0);

    // KNOWN: signal2aManual upsert overwrites status back to ENRICHED
    // This is a sequencing gap — [j] before S2 returns is not possible
    // via manual test steps (operator waits for S2 before pressing [j]).
    // Flagged for awareness: if operator bypasses TUI (direct UDS call),
    // status can regress from QUEUED to ENRICHED.
    expect(enrichedDoc!.status).toBe(JobStatus.ENRICHED);

    expect(parseEvents.filter(([t]) => t === 'failed').length).toBe(0);
  });

  // ── H4: S2 enrichment with missing stage1Partial fallback ───────────
  it('H4: S2 enrichment with missing stage1Partial — fallback to HTML-only parsed job', async () => {
    const joblifecycleId = 'h4-no-partial';

    await ingestor.processIngestCommand({
      source: JobSource.MANUAL,
      stage: JobStage.FULL_PARSED,
      rawPayload: htmlFor('Fallback Role', 'FallbackCo'),
      joblifecycleId,
    });

    const completedEvents = parseEvents.filter(([t]) => t === 'completed');
    expect(completedEvents.length).toBe(1);
    expect(completedEvents[0][1]).toBe(joblifecycleId);

    const doc = await adapter.findJobLifecycleById(joblifecycleId);
    expect(doc).not.toBeNull();
    expect(doc!.stage).toBe(JobStage.FULL_PARSED);
    expect(doc!.status).toBe(JobStatus.ENRICHED);
    expect(doc!.company).toBe('FallbackCo');
    expect(doc!.role).toBe('Fallback Role');
    expect(doc!.matchScore).toBeGreaterThanOrEqual(0);

    expect(parseEvents.filter(([t]) => t === 'failed').length).toBe(0);
  });

  // ── H5: S3 route failure → S4 → S1 next job ────────────────────────
  it('H5: S3 route failure (S4) then next S1 partial processes normally', async () => {
    const docId = 'h5-route-fail';
    await adapter.upsertJobLifecycle(makeStage1Partial({
      _id: docId,
      company: 'FailCo',
      role: 'Senior Engineer',
      stage: JobStage.FULL_PARSED,
      status: JobStatus.ENRICHED,
    }));

    vi.spyOn(adapter, 'updateJobStatus').mockRejectedValueOnce(new Error('DB write timeout'));

    await ingestor.processResolutionCommand({
      joblifecycleId: docId,
      action: 'queue',
      editedKVs: {},
    });

    const routeFailedEvents = routingEvents.filter(([t]) => t === 'failed');
    expect(routeFailedEvents.length).toBe(1);
    expect(routeFailedEvents[0][2]).toBe('DB write timeout');

    vi.restoreAllMocks();

    await ingestor.processIngestCommand({
      source: JobSource.BROWSER_AUTO,
      stage: JobStage.PARTIAL_PARSED,
      rawPayload: htmlFor('Junior Engineer', 'NextCo'),
      metadata: { messageId: 'h5-next' },
    });

    const genEvents = parseEvents.filter(([t]) => t === 'generated');
    expect(genEvents.length).toBe(1);

    const doc = await adapter.findJobLifecycleById('h5-next-job-0');
    expect(doc).not.toBeNull();
    expect(doc!.stage).toBe(JobStage.PARTIAL_PARSED);
    expect(doc!.status).toBe(JobStatus.ENRICHING);

    expect(parseEvents.filter(([t]) => t === 'failed').length).toBe(0);
  });
});
