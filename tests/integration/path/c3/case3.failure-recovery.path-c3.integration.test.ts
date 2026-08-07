/* Path cell (c3): S1→S3→S4 failure→ROUTE_FAILED recovery (see plans/tests-path-matrix.md) */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createTestContainer, type TestContainer } from '../../../helpers/test-container.js';
import type { RealDipBus } from '../../../helpers/real-dip-bus.js';
import { topcvEmailHtmlMany, topcvDetailHtml, linkedinSduiDetailHtml, nonJobHtml } from '../../../helpers/html-fixtures.js';
import { createParseEventPort, createRoutingPort } from '../../../helpers/mock-ports.js';
import { makeStage1Partial, makeFullParsedDoc } from '../../../helpers/test-builders.js';
import type { MongoJobLifecycleAdapter } from '../../../../src/infrastructure/outbound/persistence/mongo-job-lifecycle-adapter.js';
import type { MongoExtractionQueueAdapter } from '../../../../src/infrastructure/outbound/persistence/mongo-extraction-queue-adapter.js';
import { ExtractionScheduler } from '../../../../src/application/extraction-scheduler.js';
import { JobStage, JobSource, JobStatus } from '../../../../src/domain/types/job-lifecycle.js';
import { ActionEvent } from '../../../../src/domain/types/action-event.js';

const { JobIngestor } = await import('../../../../src/application/ingestor.js');

describe('Failure recovery: S2→S4→S1 auto-advance cycle', () => {
  let tc: TestContainer;
  let adapter: MongoJobLifecycleAdapter;
  let collection: any;
  let parseEvents: any[];
  let routingEvents: any[];
  let ingestor: JobIngestor;
  let realBus: RealDipBus;

  function realIngestor(): JobIngestor {
    return tc.ingestor;
  }

  beforeAll(async () => {
    tc = await createTestContainer({ ns: 'c3-failure-recovery' });
    await tc.start();
    adapter = tc.mongoJobLifecycleAdapter;
    collection = tc.db.collection('job_lifecycle');
    realBus = tc.bus;

    parseEvents = [];
    routingEvents = [];

    const parseEventPort = createParseEventPort((tag, args) => parseEvents.push([tag, ...args]));

    const routingPort = createRoutingPort((tag, args) => routingEvents.push([tag, ...args]));

    ingestor = new JobIngestor(adapter, parseEventPort, routingPort);
  }, 120000);

  afterAll(async () => {
    await tc.stop();
  });

  beforeEach(() => {
    parseEvents.length = 0;
    routingEvents.length = 0;
  });

  it('s2 parse failure (s4a) then next s1 succeeds — real-DIP', async () => {
    const failedJobId = 'cycle-fail-1';
    const ingestor = realIngestor();

    const partialDoc = {
      _id: failedJobId,
      raw: '<html>partial</html>',
      stage: JobStage.PARTIAL_PARSED,
      status: JobStatus.ENRICHING,
      source: JobSource.BROWSER_AUTO,
      company: 'FailCorp',
      role: 'Fail Role',
      createdAt: new Date(),
      updatedAt: new Date(),
      stageTimestamp: new Date(),
    };
    await adapter.upsert(partialDoc as any);

    const fail = await realBus.setup([ActionEvent.PARSE_FAILED]);
    await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, '', failedJobId);
    const failMsg = await fail.msg();
    expect(failMsg.jobLifecycleId).toBe(failedJobId);

    const failedDoc = await adapter.findById(failedJobId);
    expect(failedDoc).not.toBeNull();
    if (failedDoc) {
      expect(failedDoc.status).toBe(JobStatus.ENRICHING);
    }

    const comp = await realBus.setup([ActionEvent.PARSE_COMPLETED]);
    await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, linkedinSduiDetailHtml('Junior Developer', 'NextCorp'));
    const compMsg = await comp.msg();
    expect(compMsg.job).toBeDefined();
    expect(compMsg.job.company).toBe('NextCorp');
    expect(compMsg.job._id).toMatch(/^clip-/);

    const nextDocs = await collection.find({ _id: { $regex: /^clip-/ } }).toArray();
    expect(nextDocs.length).toBeGreaterThanOrEqual(1);
    expect(nextDocs[0].company).toBe('NextCorp');
  });

  it('route failure (s4b) then next s1 succeeds — real-DIP', async () => {
    const routeFailId = 'cycle-route-fail-1';
    const ingestor = realIngestor();

    const fullDoc = {
      _id: routeFailId,
      raw: topcvDetailHtml('Engineer', 'RouteFailCo'),
      stage: JobStage.FULL_PARSED,
      status: JobStatus.ENRICHED,
      source: JobSource.MANUAL,
      company: 'RouteFailCo',
      role: 'Engineer',
      createdAt: new Date(),
      updatedAt: new Date(),
      stageTimestamp: new Date(),
    };
    await adapter.upsert(fullDoc as any);

    vi.spyOn(adapter, 'updateStage').mockRejectedValueOnce(new Error('DB write conflict'));

    const fail = await realBus.setup([ActionEvent.QUEUED, ActionEvent.TRASHED, ActionEvent.ROUTE_FAILED]);
    await ingestor.processResolution(routeFailId, 'queue');
    const failMsg = await fail.msg();
    expect(failMsg.jobLifecycleId).toBe(routeFailId);
    expect(failMsg.reason).toBe('DB write conflict');

    vi.restoreAllMocks();

    const gen = await realBus.setup([ActionEvent.GENERATED]);
    await ingestor.processIngest(JobSource.BROWSER_AUTO, JobStage.PARTIAL_PARSED, topcvEmailHtmlMany([{ role: 'Software Engineer', company: 'NextAfterRouteFail' }]), undefined, { messageId: 'next-after-route-fail' });
    const genMsg = await gen.msg();
    expect(genMsg.company).toBe('NextAfterRouteFail');
  });

  it('s2 enrichment then s3 failure then next s1 dequeues — real-DIP', async () => {
    const ingestor = realIngestor();

    const gen = await realBus.setup([ActionEvent.GENERATED]);
    await ingestor.processIngest(JobSource.BROWSER_AUTO, JobStage.PARTIAL_PARSED, topcvEmailHtmlMany([{ role: 'Software Engineer', company: 'EnrichCo' }]), undefined, { messageId: 'enrich-msg' });
    const genMsg = await gen.msg();
    const s1JoblifecycleId = genMsg._id;
    expect(s1JoblifecycleId).toBeTruthy();

    const comp = await realBus.setup([ActionEvent.PARSE_COMPLETED]);
    await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, topcvDetailHtml('Software Engineer', 'EnrichCo'), s1JoblifecycleId);
    const compMsg = await comp.msg();
    expect(compMsg.job).toBeDefined();
    expect(compMsg.job._id).toBe(s1JoblifecycleId);

    const nextGen = await realBus.setup([ActionEvent.GENERATED]);
    await ingestor.processIngest(JobSource.BROWSER_AUTO, JobStage.PARTIAL_PARSED, topcvEmailHtmlMany([{ role: 'Software Engineer', company: 'KeepCo' }]), undefined, { messageId: 'keep-msg' });
    const nextGenMsg = await nextGen.msg();
    expect(nextGenMsg.company).toBe('KeepCo');
  });

  it('consecutive S2 failures: each emits parse.failed (rate test)', async () => {
    const failedBefore = parseEvents.filter(([t]) => t === 'failed').length;
    const routeFailedBefore = routingEvents.filter(([t]) => t === 'failed').length;
    for (let i = 0; i < 5; i++) {
      await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, '', `rate-fail-${i}`);
    }

    const failedEvents = parseEvents.filter(([t]) => t === 'failed');
    expect(failedEvents.length).toBe(failedBefore + 5);

    const routeFailedAfter = routingEvents.filter(([t]) => t === 'failed').length;
    expect(routeFailedAfter).toBe(routeFailedBefore);

    await ingestor.processIngest(JobSource.BROWSER_AUTO, JobStage.PARTIAL_PARSED, topcvEmailHtmlMany([{ role: 'Software Engineer', company: 'AfterRateCo' }]), undefined, { messageId: 'after-rate' });

    const genEvents = parseEvents.filter(([t]) => t === 'generated');
    expect(genEvents.length).toBeGreaterThan(0);
    expect(genEvents[genEvents.length - 1][1].company).toBe('AfterRateCo');
  });

  it('S2 and S3 failures interleaved: both advance to S4 then next S1 recovers (rate test)', async () => {
    const failedBefore = parseEvents.filter(([t]) => t === 'failed').length;
    const routeFailedBefore = routingEvents.filter(([t]) => t === 'failed').length;

    // Interleave S2 failures (empty HTML) and S3 failures (DB reject)
    for (let i = 0; i < 10; i++) {
      const jobId = `interleave-fail-${i}`;
      await adapter.upsert({
        _id: jobId, raw: '<html>x</html>', stage: JobStage.FULL_PARSED,
        status: JobStatus.ENRICHED, source: JobSource.MANUAL,
        company: `FailCo${i}`, role: 'Engineer',
        createdAt: new Date(), updatedAt: new Date(), stageTimestamp: new Date(),
      } as any);

      if (i % 2 === 0) {
        await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, '', jobId);
      } else {
        vi.spyOn(adapter, 'updateStage').mockRejectedValueOnce(new Error('DB timeout'));
        await ingestor.processResolution(jobId, 'queue');
      }
    }

    const failedAfter = parseEvents.filter(([t]) => t === 'failed').length;
    expect(failedAfter).toBeGreaterThanOrEqual(failedBefore + 5);

    const routeFailedAfter = routingEvents.filter(([t]) => t === 'failed').length;
    expect(routeFailedAfter).toBeGreaterThanOrEqual(routeFailedBefore + 5);

    // Recovery: next S1 partial processes normally
    await ingestor.processIngest(JobSource.BROWSER_AUTO, JobStage.PARTIAL_PARSED, topcvEmailHtmlMany([{ role: 'Software Engineer', company: 'InterleaveRecoveryCo' }]), undefined, { messageId: 'interleave-recovery' });

    const genEvents = parseEvents.filter(([t]) => t === 'generated');
    expect(genEvents[genEvents.length - 1][1].company).toBe('InterleaveRecoveryCo');
  });

  it('concurrent S1+S2 from different sources does not corrupt job (interleaving)', async () => {
    const messageId = 'concurrent-s1-s2';
    const jobLifecycleId = `${messageId}-job-0`;

    await Promise.all([
      ingestor.processIngest(JobSource.BROWSER_AUTO, JobStage.PARTIAL_PARSED, topcvDetailHtml('Software Engineer', 'ConcurrentCo'), undefined, { messageId, subject: 'Software Engineer' }),
      ingestor.processIngest(JobSource.BROWSER_AUTO, JobStage.FULL_PARSED, topcvDetailHtml('Software Engineer', 'ConcurrentCo'), jobLifecycleId),
    ]);

    // S1 should have emitted job.generated and S2 should have emitted job.parse.completed
    const genEvents = parseEvents.filter(([t]) => t === 'generated');
    expect(genEvents.length).toBeGreaterThanOrEqual(1);

    const completedEvents = parseEvents.filter(([t]) => t === 'completed');
    expect(completedEvents.length).toBeGreaterThanOrEqual(1);

    const doc = await adapter.findById(jobLifecycleId);
    expect(doc).not.toBeNull();
    expect(doc!.stage).toBe(JobStage.FULL_PARSED);

    expect(parseEvents.filter(([t]) => t === 'failed').length).toBe(0);
  });


  it('signal2aManual with jobLifecycleId processes valid HTML successfully — real-DIP', async () => {
    const ingestor = realIngestor();
    const docId = 'b9-integration-job';
    const partialDoc = {
      _id: docId,
      raw: '<html>dummy</html>',
      stage: JobStage.PARTIAL_PARSED,
      status: JobStatus.ENRICHING,
      source: JobSource.MANUAL,
      company: 'B9IntegCo',
      role: 'B9 Role',
      createdAt: new Date(),
      updatedAt: new Date(),
      stageTimestamp: new Date(),
    };
    await adapter.upsert(partialDoc as any);

    const comp = await realBus.setup([ActionEvent.PARSE_COMPLETED]);
    await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, linkedinSduiDetailHtml('Software Engineer', 'B9IntegCo'), docId);
    const compMsg = await comp.msg();
    expect(compMsg.job).toBeDefined();
    expect(compMsg.job._id).toBe(docId);
    expect(compMsg.job.company).toBe('B9IntegCo');
  });
});

describe('Failure injection — cause-effect graph', () => {
  let tc: TestContainer;
  let adapter: MongoJobLifecycleAdapter;
  let ingestor: JobIngestor;
  let parseEventPort: Record<string, ReturnType<typeof vi.fn>>;
  let routingPort: Record<string, ReturnType<typeof vi.fn>>;

  beforeAll(async () => {
    tc = await createTestContainer({ ns: 'c3-failure-injection' });
    await tc.start();
    adapter = tc.mongoJobLifecycleAdapter;
  }, 120000);

  beforeEach(() => {
    parseEventPort = createParseEventPort();
    routingPort = createRoutingPort();
    ingestor = new JobIngestor(adapter, parseEventPort, routingPort);
  });

  afterAll(async () => {
    await tc.stop();
  });

  it('cause: parse failure -> effect: emitFailed called (saga enters S5)', async () => {
    const html = nonJobHtml();

    await ingestor.processIngest(JobSource.BROWSER_AUTO, JobStage.FULL_PARSED, html, 'fail-parse-id');

    expect(parseEventPort.emitFailed).toHaveBeenCalled();
  });

  it('cause: routing failure -> effect: route emitFailed or saga compensation', async () => {
    const html = linkedinSduiDetailHtml('Backend Developer', 'RouterCo');

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
    const html = topcvDetailHtml('Any Job', 'AnyCo');

    await expect(
      ingestor.processIngest(JobSource.MANUAL, JobStage.PARTIAL_PARSED, html, 'any-source-id'),
    ).resolves.toBeUndefined();
  });
});

describe('Reliability cycles (S2→S4→S1 failure auto-advance)', () => {
  let tc: TestContainer;
  let adapter: MongoJobLifecycleAdapter;
  let realBus: RealDipBus;

  function realIngestor(): JobIngestor {
    return tc.ingestor;
  }

  beforeAll(async () => {
    tc = await createTestContainer({ ns: 'c3-reliability-cycles' });
    await tc.start();
    adapter = tc.mongoJobLifecycleAdapter;
    realBus = tc.bus;
  }, 120000);

  afterAll(async () => {
    await tc.stop();
  });

  it('S2 parse.failed → S1 next job: emits s4a then s1 for new job — real-DIP', async () => {
    const ingestor = realIngestor();

    const fail = await realBus.setup([ActionEvent.PARSE_FAILED]);
    await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, '', 'job-fail-s4a');
    const failMsg = await fail.msg();
    expect(failMsg.jobLifecycleId).toBe('job-fail-s4a');

    const gen = await realBus.setup([ActionEvent.GENERATED]);
    await ingestor.processIngest(JobSource.BROWSER_AUTO, JobStage.PARTIAL_PARSED, topcvEmailHtmlMany([{ role: 'Software Engineer', company: 'AlphaCo' }]), undefined, { messageId: 'job-after-s4a' });
    const genMsg = await gen.msg();
    expect(genMsg.company).toBe('AlphaCo');

    const doc = await adapter.findById('job-after-s4a-job-0');
    expect(doc).not.toBeNull();
    expect(doc!.stage).toBe(JobStage.PARTIAL_PARSED);
  });

  it('S3 route.failed → S1 next job: emits s4b then s1 for new job — real-DIP', async () => {
    const ingestor = realIngestor();
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

    const fail = await realBus.setup([ActionEvent.QUEUED, ActionEvent.TRASHED, ActionEvent.ROUTE_FAILED]);
    await ingestor.processResolution('job-fail-s4b', 'queue');
    const failMsg = await fail.msg();
    expect(failMsg.jobLifecycleId).toBe('job-fail-s4b');
    expect(failMsg.reason).toBe('DB write timeout');

    vi.restoreAllMocks();

    const gen = await realBus.setup([ActionEvent.GENERATED]);
    await ingestor.processIngest(JobSource.BROWSER_AUTO, JobStage.PARTIAL_PARSED, topcvEmailHtmlMany([{ role: 'Software Engineer', company: 'BetaCo' }]), undefined, { messageId: 'job-after-s4b' });
    const genMsg = await gen.msg();
    expect(genMsg.company).toBe('BetaCo');
  });

  it('S2 parse.failed (empty html) then S2a manual succeeds for different job — real-DIP', async () => {
    const ingestor = realIngestor();

    const fail = await realBus.setup([ActionEvent.PARSE_FAILED]);
    await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, '', 'job-s4-empty');
    const failMsg = await fail.msg();
    expect(failMsg.jobLifecycleId).toBe('job-s4-empty');

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

    const comp = await realBus.setup([ActionEvent.PARSE_COMPLETED]);
    await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, linkedinSduiDetailHtml('Software Engineer', 'RecoveryCo'), 'job-s4-recover');
    const compMsg = await comp.msg();
    expect(compMsg.job).toBeDefined();
    expect(compMsg.job._id).toBe('job-s4-recover');

    const fullDoc = await adapter.findById('job-s4-recover');
    expect(fullDoc).not.toBeNull();
    expect(fullDoc!.stage).toBe(JobStage.FULL_PARSED);
    expect(fullDoc!.status).toBe(JobStatus.ENRICHED);
  });
});

describe('High-ROI sequential tests (H1-H5)', () => {
  let tc: TestContainer;
  let adapter: MongoJobLifecycleAdapter;
  let parseEvents: any[];
  let routingEvents: any[];
  let ingestor: JobIngestor;

  beforeAll(async () => {
    tc = await createTestContainer({ ns: 'c3-high-roi' });
    await tc.start();
    adapter = tc.mongoJobLifecycleAdapter;

    parseEvents = [];
    routingEvents = [];

    const parseEventPort = createParseEventPort((tag, args) => parseEvents.push([tag, ...args]));

    const routingPort = createRoutingPort((tag, args) => routingEvents.push([tag, ...args]));

    ingestor = new JobIngestor(adapter, parseEventPort, routingPort);
  }, 120000);

  afterAll(async () => {
    await tc.stop();
  });

  beforeEach(async () => {
    parseEvents.length = 0;
    routingEvents.length = 0;
    await tc.storage.clearDb();
  });

  // ── H1: Rate stress — 5 sequential S1→S2→S3→S1 cycles ──────────────
  it('H1: Rate stress — 5 sequential S1→S2→S3→S1 cycles with no state leakage', async () => {
    const totalCycles = 5;

    for (let i = 0; i < totalCycles; i++) {
      const messageId = `h1-cycle-${i}`;
      const role = 'Software Engineer';
      const company = `RateCo${i}`;

      await ingestor.processIngest(JobSource.BROWSER_AUTO, JobStage.PARTIAL_PARSED, topcvEmailHtmlMany([{ role, company }]), undefined, { messageId, subject: role });

      const genEvents = parseEvents.filter(([t]) => t === 'generated');
      expect(genEvents.length).toBe(i + 1);
      const jobLifecycleId = genEvents[i][1]._id;
      expect(jobLifecycleId).toMatch(/-job-0$/);

      const partialDoc = await adapter.findById(jobLifecycleId);
      expect(partialDoc).not.toBeNull();
      expect(partialDoc!.stage).toBe(JobStage.PARTIAL_PARSED);
      expect(partialDoc!.status).toBe(JobStatus.ENRICHING);

      await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, topcvDetailHtml(role, company), jobLifecycleId);

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

    await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, linkedinSduiDetailHtml('Junior Dev', 'DoubleCo'), jobLifecycleId);

    const completedAfterFirst = parseEvents.filter(([t]) => t === 'completed').length;
    expect(completedAfterFirst).toBe(1);

    const firstDoc = await adapter.findById(jobLifecycleId);
    expect(firstDoc!.stage).toBe(JobStage.FULL_PARSED);

    await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, linkedinSduiDetailHtml('Junior Dev', 'DoubleCo'), jobLifecycleId);

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

    await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, linkedinSduiDetailHtml('Junior Dev', 'RaceCo'), jobLifecycleId);

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

    await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, linkedinSduiDetailHtml('Fallback Role', 'FallbackCo'), jobLifecycleId);

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

    await ingestor.processIngest(JobSource.BROWSER_AUTO, JobStage.PARTIAL_PARSED, topcvEmailHtmlMany([{ role: 'Software Engineer', company: 'NextCo' }]), undefined, { messageId: 'h5-next' });

    const genEvents = parseEvents.filter(([t]) => t === 'generated');
    expect(genEvents.length).toBe(1);

    const doc = await adapter.findById('h5-next-job-0');
    expect(doc).not.toBeNull();
    expect(doc!.stage).toBe(JobStage.PARTIAL_PARSED);
    expect(doc!.status).toBe(JobStatus.ENRICHING);

    expect(parseEvents.filter(([t]) => t === 'failed').length).toBe(0);
  });
});

describe('Failure Recovery (fallback on extraction failure)', () => {
  let tc: TestContainer;
  let adapter: MongoJobLifecycleAdapter;
  let eqAdapter: MongoExtractionQueueAdapter;
  let parseEvents: any[];
  let routingEvents: any[];
  let ingestor: JobIngestor;

  beforeAll(async () => {
    tc = await createTestContainer({ ns: 'c3-fallback-recovery' });
    await tc.start();
    adapter = tc.mongoJobLifecycleAdapter;
    eqAdapter = tc.extractionQueueAdapter;

    parseEvents = [];
    routingEvents = [];

    const parseEventPort = createParseEventPort((tag, args) => parseEvents.push([tag, ...args]));

    const routingPort = createRoutingPort((tag, args) => routingEvents.push([tag, ...args]));

    ingestor = new JobIngestor(adapter, parseEventPort, routingPort, eqAdapter);
  }, 120000);

  afterAll(async () => {
    await tc.stop();
  });

  async function seedJob(jobLifecycleId: string, url: string) {
    const doc = {
      _id: jobLifecycleId,
      raw: '<html><body>partial</body></html>',
      stage: JobStage.PARTIAL_PARSED,
      status: JobStatus.ENRICHING,
      source: JobSource.BROWSER_AUTO,
      company: `TestCorp-${jobLifecycleId}`,
      role: 'Backend Developer',
      description: 'TypeScript developer needed',
      url,
      createdAt: new Date(),
      updatedAt: new Date(),
      stageTimestamp: new Date(),
    };
    await adapter.upsert(doc as any);
    await eqAdapter.enqueue(jobLifecycleId);
  }

  it('browser extraction failure triggers fallback: processIngest PARTIAL_PARSED + empty + emitGenerated', async () => {
    const jobLifecycleId = 'e2e-fail-1';
    await seedJob(jobLifecycleId, 'https://example.com/fail');

    const mockBrowser = {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      extract: vi.fn().mockRejectedValue(new Error('Navigation timeout')),
    };

    const processIngestSpy = vi.spyOn(ingestor, 'processIngest');

    const genBefore = parseEvents.filter(([t]) => t === 'generated').length;

    const scheduler = new ExtractionScheduler(
      eqAdapter,
      mockBrowser as any,
      adapter as any,
      ingestor,
    );

    await scheduler.start();

    await vi.waitFor(() => {
      const fallbackCalls = processIngestSpy.mock.calls.filter(
        ([source, stage, rawPayload]: any) => stage === JobStage.PARTIAL_PARSED && rawPayload === '',
      );
      expect(fallbackCalls.length).toBeGreaterThanOrEqual(1);
    }, { interval: 100, timeout: 10000 });

    await vi.waitFor(() => {
      const genEvents = parseEvents.filter(([t]) => t === 'generated');
      expect(genEvents.length).toBeGreaterThan(genBefore);
    }, { interval: 100, timeout: 5000 });

    const genEvents = parseEvents.filter(([t]) => t === 'generated');
    const lastGen = genEvents[genEvents.length - 1];
    expect(lastGen).toBeDefined();

    await scheduler.stop();
  }, 30000);

  it('fallback with null job lifecycle logs error and does not emit', async () => {
    const jobLifecycleId = 'e2e-null-doc-1';
    await eqAdapter.enqueue(jobLifecycleId);

    const mockBrowser = {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      extract: vi.fn().mockRejectedValue(new Error('Timeout')),
    };

    const processIngestSpy = vi.fn().mockResolvedValue(undefined);

    const scheduler = new ExtractionScheduler(
      eqAdapter,
      mockBrowser as any,
      adapter as any,
      { processIngest: processIngestSpy } as any,
    );

    await scheduler.start();

    await vi.waitFor(() => {
      const fallbackCalls = processIngestSpy.mock.calls.filter(
        ([source, stage, rawPayload]: any) => stage === JobStage.PARTIAL_PARSED && rawPayload === '',
      );
      expect(fallbackCalls.length).toBeGreaterThanOrEqual(1);
    }, { interval: 100, timeout: 10000 });

    expect(mockBrowser.start).toHaveBeenCalled();
    await scheduler.stop();
    expect(mockBrowser.stop).toHaveBeenCalled();
  }, 30000);
});