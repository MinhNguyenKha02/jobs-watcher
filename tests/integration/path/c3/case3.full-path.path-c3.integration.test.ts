/* Path cell (c3): full-path failure→recovery sagas observed only via the real
 * RabbitMQ-DIP bus (PARSE_FAILED/ROUTE_FAILED/QUEUED/GENERATED/PARSE_COMPLETED)
 * and driven through tc.ingestor plus the UDS boundary for [j]/[d] resolution.
 * All failures are injected at the real persistence adapter (updateStage reject)
 * — no mock in-application ports are used anywhere in this file.
 * GWT cause-effect (path c3): GIVEN an S1 seed WHEN a failure path is exercised (PARSE_FAILED / ROUTE_FAILED)
 *   THEN S4 is emitted, the doc is untouched, and the next valid S1 recovers (checkpoint contract §1).
 */
import fc from 'fast-check';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

import { ActionEvent } from '../../../../src/domain/types/action-event.js';
import { JobStage, JobSource, JobStatus } from '../../../../src/domain/types/job-lifecycle.js';
import type { JobLifecyclePort } from '../../../../src/application/ports/job-lifecycle.port.js';
import type { ExtractionQueuePort } from '../../../../src/application/ports/extraction-queue.port.js';
import { udsHelpers } from '../../../helpers/e2e-harness.js';
import {
  topcvEmailHtmlMany,
  topcvDetailHtml,
  linkedinSduiDetailHtml,
  nonJobHtml,
} from '../../../helpers/html-fixtures.js';
import type { RealDipBus } from '../../../helpers/real-dip-bus.js';
import { makeStage1Partial, makeFullParsedDoc } from '../../../helpers/test-builders.js';
import { createTestContainer, type TestContainer } from '../../../helpers/test-container.js';

const INTERNAL_TOKEN = 'e2e-internal-token';
// Resolution / enrichment steps are driven across the real UDS boundary.
const UDS = (tc: TestContainer) => udsHelpers(tc.socket, INTERNAL_TOKEN);

/** Asserts that no matching event landed on a bound exclusive queue within the window. */
async function assertNoMessage(handle: Awaited<ReturnType<RealDipBus['setup']>>): Promise<void> {
  await expect(handle.msg()).rejects.toThrow(/Timeout/);
}

describe('Failure cycle (S4→S1 auto-advance)', () => {
  let tc: TestContainer;
  let adapter: JobLifecyclePort;
  let bus: RealDipBus;

  beforeAll(async () => {
    tc = await createTestContainer({ ns: 'c3-full-path-failure' });
    await tc.start();
    adapter = tc.mongoJobLifecycleAdapter;
    bus = tc.bus;
  }, 120000);

  afterAll(async () => {
    await tc.stop();
  });

  it('GIVEN an S2 manual FULL_PARSED input WHEN an ingest signal is processed THEN parse-failure cycle: empty FULL_PARSED ing yields PARSE_FAILED, doc stays ENRICHING, next valid S1 recovers (S1+S2+S4) · path c3', async () => {
    const failedJobId = 'fpcy-parse-fail-1';
    await adapter.upsert(
      makeStage1Partial({
        _id: failedJobId,
        company: 'FailCorp',
        role: 'Fail Role',
      })
    );

    const fail = await bus.setup([ActionEvent.PARSE_FAILED]);
    await tc.ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, '', failedJobId);
    const failMsg = await fail.msg();
    expect(failMsg.jobLifecycleId).toBe(failedJobId);

    const failedDoc = await adapter.findById(failedJobId);
    expect(failedDoc).not.toBeNull();
    expect(failedDoc!.stage).toBe(JobStage.PARTIAL_PARSED);
    expect(failedDoc!.status).toBe(JobStatus.ENRICHING);

    const gen = await bus.setup([ActionEvent.GENERATED]);
    await tc.ingestor.processIngest(
      JobSource.BROWSER_AUTO,
      JobStage.PARTIAL_PARSED,
      topcvEmailHtmlMany([{ role: 'Software Engineer', company: 'NextCorp' }]),
      undefined,
      { messageId: 'next-valid-s1' }
    );
    const genMsg = await gen.msg();
    expect(genMsg.company).toBe('NextCorp');
    expect(genMsg._id).toMatch(/^next-valid-s1-job-0$/);
    expect(genMsg.stage).toBe(JobStage.PARTIAL_PARSED);
    expect(genMsg.status).toBe(JobStatus.ENRICHING);

    const nextDoc = await adapter.findById('next-valid-s1-job-0');
    expect(nextDoc).not.toBeNull();
    expect(nextDoc!.company).toBe('NextCorp');
  });

  it('GIVEN an S2 browser auto FULL_PARSED input WHEN findById loads the doc THEN route-failure cycle: [j] with rejected updateStage emits ROUTE_FAILED(reason), status untouched, next valid S1 recovers (S1+S2+S4) · path c3', async () => {
    const routeFailId = 'cycle-route-fail-1';
    await adapter.upsert(
      makeFullParsedDoc({
        _id: routeFailId,
        company: 'RouteFailCo',
        role: 'Engineer',
      })
    );

    vi.spyOn(adapter, 'updateStage').mockRejectedValueOnce(new Error('DB write conflict'));

    const fail = await bus.setup([
      ActionEvent.QUEUED,
      ActionEvent.TRASHED,
      ActionEvent.ROUTE_FAILED,
    ]);
    await UDS(tc).action(routeFailId, 'queue');
    const failMsg = await fail.msg();
    expect(failMsg.jobLifecycleId).toBe(routeFailId);
    expect(failMsg.reason).toBe('DB write conflict');
    vi.restoreAllMocks();

    const failedDoc = await adapter.findById(routeFailId);
    expect(failedDoc).not.toBeNull();
    expect(failedDoc!.stage).toBe(JobStage.FULL_PARSED);
    expect(failedDoc!.status).toBe(JobStatus.ENRICHED);

    const gen = await bus.setup([ActionEvent.GENERATED]);
    await tc.ingestor.processIngest(
      JobSource.BROWSER_AUTO,
      JobStage.PARTIAL_PARSED,
      topcvEmailHtmlMany([{ role: 'Software Engineer', company: 'NextAfterRouteFail' }]),
      undefined,
      { messageId: 'next-after-route-fail' }
    );
    const genMsg = await gen.msg();
    expect(genMsg.company).toBe('NextAfterRouteFail');
  });

  it('GIVEN S1 WHEN the path is exercised THEN S2 enrichment, then the next S1 still dequeues — no saga state leaks between jobs (S1+S2) · path c3', async () => {
    const gen = await bus.setup([ActionEvent.GENERATED]);
    await tc.ingestor.processIngest(
      JobSource.BROWSER_AUTO,
      JobStage.PARTIAL_PARSED,
      topcvEmailHtmlMany([{ role: 'Software Engineer', company: 'EnrichCo' }]),
      undefined,
      { messageId: 'fpcy-enrich-msg' }
    );
    const genMsg = await gen.msg();
    const s1JoblifecycleId = genMsg._id;
    expect(s1JoblifecycleId).toBe('fpcy-enrich-msg-job-0');

    const comp = await bus.setup([ActionEvent.PARSE_COMPLETED]);
    await tc.ingestor.processIngest(
      JobSource.MANUAL,
      JobStage.FULL_PARSED,
      topcvDetailHtml('Software Engineer', 'EnrichCo'),
      s1JoblifecycleId
    );
    const compMsg = await comp.msg();
    expect(compMsg.job).toBeDefined();
    expect(compMsg.job._id).toBe(s1JoblifecycleId);

    const nextGen = await bus.setup([ActionEvent.GENERATED]);
    await tc.ingestor.processIngest(
      JobSource.BROWSER_AUTO,
      JobStage.PARTIAL_PARSED,
      topcvEmailHtmlMany([{ role: 'Software Engineer', company: 'KeepCo' }]),
      undefined,
      { messageId: 'fpcy-keep-msg' }
    );
    const nextGenMsg = await nextGen.msg();
    expect(nextGenMsg.company).toBe('KeepCo');
    expect(nextGenMsg._id).toBe('fpcy-keep-msg-job-0');
  });

  it('GIVEN S2a manual with an existing jobLifecycleId WHEN the path is exercised THEN S2 enriches instead of failing · path c3', async () => {
    const docId = 'c3-b9-integration-job';
    await adapter.upsert(
      makeStage1Partial({
        _id: docId,
        company: 'B9IntegCo',
        role: 'B9 Role',
      })
    );

    const comp = await bus.setup([ActionEvent.PARSE_COMPLETED]);
    await tc.ingestor.processIngest(
      JobSource.MANUAL,
      JobStage.FULL_PARSED,
      linkedinSduiDetailHtml('Software Engineer', 'B9IntegCo'),
      docId
    );
    const compMsg = await comp.msg();
    expect(compMsg.job).toBeDefined();
    expect(compMsg.job._id).toBe(docId);
    expect(compMsg.job.company).toBe('B9IntegCo');

    const doc = await adapter.findById(docId);
    expect(doc).not.toBeNull();
    expect(doc!.stage).toBe(JobStage.FULL_PARSED);
    expect(doc!.status).toBe(JobStatus.ENRICHED);
  });
});

describe('Failure injection (cause→effect, real-DIP)', () => {
  let tc: TestContainer;
  let adapter: JobLifecyclePort;
  let bus: RealDipBus;

  beforeAll(async () => {
    tc = await createTestContainer({ ns: 'c3-full-path-inject' });
    await tc.start();
    adapter = tc.mongoJobLifecycleAdapter;
    bus = tc.bus;
  }, 120000);

  afterAll(async () => {
    await tc.stop();
  });

  it('GIVEN unparsable FULL_PARSED payload WHEN the path is exercised THEN PARSE_FAILED (saga reaches S4) (S2+S4) · path c3', async () => {
    const fail = await bus.setup([ActionEvent.PARSE_FAILED]);
    await tc.ingestor.processIngest(
      JobSource.BROWSER_AUTO,
      JobStage.FULL_PARSED,
      nonJobHtml(),
      'fail-parse-id'
    );
    const msg = await fail.msg();
    expect(msg.jobLifecycleId).toBe('fail-parse-id');
  });

  it('GIVEN empty HTML payload WHEN the path is exercised THEN graceful PARSE_FAILED without crash (S2+S4) · path c3', async () => {
    const fail = await bus.setup([ActionEvent.PARSE_FAILED]);
    await expect(
      tc.ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, '', 'empty-html-id')
    ).resolves.toBeUndefined();
    const msg = await fail.msg();
    expect(msg.jobLifecycleId).toBe('empty-html-id');
  });

  it('GIVEN routing write failure WHEN the path is exercised THEN ROUTE_FAILED with the propagating reason (S4) · path c3', async () => {
    await adapter.upsert(
      makeFullParsedDoc({
        _id: 'fail-route-id',
        company: 'RouterCo',
        role: 'Backend Developer',
      })
    );

    vi.spyOn(adapter, 'updateStage').mockRejectedValueOnce(new Error('Routing unavailable'));
    const fail = await bus.setup([ActionEvent.ROUTE_FAILED]);
    await UDS(tc).action('fail-route-id', 'queue');
    const msg = await fail.msg();
    expect(msg.jobLifecycleId).toBe('fail-route-id');
    expect(msg.reason).toBe('Routing unavailable');
    vi.restoreAllMocks();
  });

  it('GIVEN trash routing write failure ([d] variant) WHEN the path is exercised THEN ROUTE_FAILED with the propagating reason (S4) · path c3', async () => {
    await adapter.upsert(
      makeFullParsedDoc({
        _id: 'fail-route-trash-id',
        company: 'TrashRouteCo',
        role: 'Backend Developer',
      })
    );

    vi.spyOn(tc.container.routeAdapter, 'emitJobTrashed').mockRejectedValueOnce(
      new Error('Trash route unavailable')
    );
    const fail = await bus.setup([ActionEvent.ROUTE_FAILED]);
    await UDS(tc).action('fail-route-trash-id', 'trash');
    const msg = await fail.msg();
    expect(msg.jobLifecycleId).toBe('fail-route-trash-id');
    expect(msg.reason).toBe('Trash route unavailable');
    vi.restoreAllMocks();

    const doc = await adapter.findById('fail-route-trash-id');
    expect(doc).not.toBeNull();
    expect(doc!.status).toBe(JobStatus.TRASHED);
  });

  it('GIVEN detail-page HTML on a PARTIAL_PARSED pass WHEN the path is exercised THEN still resolves without emitting (S1+S4) · path c3', async () => {
    const silence = await bus.setup([ActionEvent.GENERATED, ActionEvent.PARSE_FAILED], 1500);
    await expect(
      tc.ingestor.processIngest(
        JobSource.MANUAL,
        JobStage.PARTIAL_PARSED,
        topcvDetailHtml('Any Job', 'AnyCo')
      )
    ).resolves.toBeUndefined();
    await assertNoMessage(silence);
  });
});

describe('Reliability cycles (S2→S4→S1)', () => {
  let tc: TestContainer;
  let adapter: JobLifecyclePort;
  let bus: RealDipBus;

  beforeAll(async () => {
    tc = await createTestContainer({ ns: 'c3-full-path-reliability' });
    await tc.start();
    adapter = tc.mongoJobLifecycleAdapter;
    bus = tc.bus;
  }, 120000);

  afterAll(async () => {
    await tc.stop();
  });

  it('GIVEN S2 parse.failed WHEN the path is exercised THEN next S1 partial emits GENERATED and persists the partial document (S1+S2+S4) · path c3', async () => {
    const fail = await bus.setup([ActionEvent.PARSE_FAILED]);
    await tc.ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, '', 'job-fail-s4a');
    const failMsg = await fail.msg();
    expect(failMsg.jobLifecycleId).toBe('job-fail-s4a');

    const gen = await bus.setup([ActionEvent.GENERATED]);
    await tc.ingestor.processIngest(
      JobSource.BROWSER_AUTO,
      JobStage.PARTIAL_PARSED,
      topcvEmailHtmlMany([{ role: 'Software Engineer', company: 'AlphaCo' }]),
      undefined,
      { messageId: 'job-after-s4a' }
    );
    const genMsg = await gen.msg();
    expect(genMsg.company).toBe('AlphaCo');

    const doc = await adapter.findById('job-after-s4a-job-0');
    expect(doc).not.toBeNull();
    expect(doc!.stage).toBe(JobStage.PARTIAL_PARSED);
    expect(doc!.status).toBe(JobStatus.ENRICHING);
    expect(doc!.company).toBe('AlphaCo');
  });

  it('GIVEN a queue resolution on an S2 FULL_PARSED doc WHEN routing write fails THEN next S1 partial emits GENERATED (S1+S2+S4) · path c3', async () => {
    await adapter.upsert(
      makeFullParsedDoc({
        _id: 'job-fail-s4b',
        company: 'FailCo',
        role: 'Engineer',
      })
    );

    vi.spyOn(adapter, 'updateStage').mockRejectedValueOnce(new Error('DB write timeout'));
    const fail = await bus.setup([
      ActionEvent.QUEUED,
      ActionEvent.TRASHED,
      ActionEvent.ROUTE_FAILED,
    ]);
    await UDS(tc).action('job-fail-s4b', 'queue');
    const failMsg = await fail.msg();
    expect(failMsg.jobLifecycleId).toBe('job-fail-s4b');
    expect(failMsg.reason).toBe('DB write timeout');
    vi.restoreAllMocks();

    const gen = await bus.setup([ActionEvent.GENERATED]);
    await tc.ingestor.processIngest(
      JobSource.BROWSER_AUTO,
      JobStage.PARTIAL_PARSED,
      topcvEmailHtmlMany([{ role: 'Software Engineer', company: 'BetaCo' }]),
      undefined,
      { messageId: 'job-after-s4b' }
    );
    const genMsg = await gen.msg();
    expect(genMsg.company).toBe('BetaCo');
  });

  it('GIVEN an S2 manual FULL_PARSED input WHEN an ingest signal is processed THEN S2 parse.failed (empty) then S2a manual succeeds for a different job (S2+S4) · path c3', async () => {
    const fail = await bus.setup([ActionEvent.PARSE_FAILED]);
    await tc.ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, '', 'job-s4-empty');
    const failMsg = await fail.msg();
    expect(failMsg.jobLifecycleId).toBe('job-s4-empty');

    await adapter.upsert(
      makeStage1Partial({
        _id: 'job-s4-recover',
        company: 'RecoveryCo',
        role: 'Junior Engineer',
        url: 'https://recovery.com/job',
      })
    );

    const comp = await bus.setup([ActionEvent.PARSE_COMPLETED]);
    await tc.ingestor.processIngest(
      JobSource.MANUAL,
      JobStage.FULL_PARSED,
      linkedinSduiDetailHtml('Software Engineer', 'RecoveryCo'),
      'job-s4-recover'
    );
    const compMsg = await comp.msg();
    expect(compMsg.job).toBeDefined();
    expect(compMsg.job._id).toBe('job-s4-recover');

    const fullDoc = await adapter.findById('job-s4-recover');
    expect(fullDoc).not.toBeNull();
    expect(fullDoc!.stage).toBe(JobStage.FULL_PARSED);
    expect(fullDoc!.status).toBe(JobStatus.ENRICHED);
    expect(fullDoc!.company).toBe('RecoveryCo');
  });
});

describe('High-ROI rate stress & guards (H1-H5)', () => {
  let tc: TestContainer;
  let adapter: JobLifecyclePort;
  let bus: RealDipBus;

  beforeAll(async () => {
    tc = await createTestContainer({ ns: 'c3-full-path-roi' });
    await tc.start();
    adapter = tc.mongoJobLifecycleAdapter;
    bus = tc.bus;
  }, 120000);

  afterAll(async () => {
    await tc.stop();
  });

  beforeEach(async () => {
    await tc.storage.clearDb();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('GIVEN rate stress — 5 sequential S1 WHEN S2 THEN [j] cycles with no state leakage (S1+S2+S3) · path c3', async () => {
    const noFailures = await bus.setup([ActionEvent.PARSE_FAILED, ActionEvent.ROUTE_FAILED], 1500);
    const totalCycles = 5;

    for (let i = 0; i < totalCycles; i++) {
      const messageId = `h1-cycle-${i}`;
      const role = 'Software Engineer';
      const company = `RateCo${i}`;

      const gen = await bus.setup([ActionEvent.GENERATED]);
      await tc.ingestor.processIngest(
        JobSource.BROWSER_AUTO,
        JobStage.PARTIAL_PARSED,
        topcvEmailHtmlMany([{ role, company }]),
        undefined,
        { messageId, subject: role }
      );
      const genMsg = await gen.msg();
      const jobLifecycleId = genMsg._id;
      expect(jobLifecycleId).toMatch(/-job-0$/);

      const partialDoc = await adapter.findById(jobLifecycleId);
      expect(partialDoc).not.toBeNull();
      expect(partialDoc!.stage).toBe(JobStage.PARTIAL_PARSED);
      expect(partialDoc!.status).toBe(JobStatus.ENRICHING);

      const comp = await bus.setup([ActionEvent.PARSE_COMPLETED]);
      await tc.ingestor.processIngest(
        JobSource.MANUAL,
        JobStage.FULL_PARSED,
        topcvDetailHtml(role, company),
        jobLifecycleId
      );
      const compMsg = await comp.msg();
      expect(compMsg.job).toBeDefined();
      expect(compMsg.job._id).toBe(jobLifecycleId);

      const enrichedDoc = await adapter.findById(jobLifecycleId);
      expect(enrichedDoc).not.toBeNull();
      expect(enrichedDoc!.stage).toBe(JobStage.FULL_PARSED);
      expect(enrichedDoc!.status).toBe(JobStatus.ENRICHED);

      const queued = await bus.setup([
        ActionEvent.QUEUED,
        ActionEvent.TRASHED,
        ActionEvent.ROUTE_FAILED,
      ]);
      await UDS(tc).action(jobLifecycleId, 'queue');
      const queuedMsg = await queued.msg();
      expect(queuedMsg.jobLifecycleId).toBe(jobLifecycleId);

      const routedDoc = await adapter.findById(jobLifecycleId);
      expect(routedDoc).not.toBeNull();
      expect(routedDoc!.status).toBe(JobStatus.QUEUED);
    }

    await assertNoMessage(noFailures);
  });

  it('GIVEN an S2 manual FULL_PARSED input WHEN an ingest signal is processed THEN rapid re-[c] on the same partial job does not produce a second completion (S2) · path c3', async () => {
    const jobLifecycleId = 'h2-double-c';
    await adapter.upsert(
      makeStage1Partial({
        _id: jobLifecycleId,
        company: 'DoubleCo',
        role: 'Junior Dev',
      })
    );

    const first = await bus.setup([ActionEvent.PARSE_COMPLETED]);
    await tc.ingestor.processIngest(
      JobSource.MANUAL,
      JobStage.FULL_PARSED,
      linkedinSduiDetailHtml('Junior Dev', 'DoubleCo'),
      jobLifecycleId
    );
    const firstMsg = await first.msg();
    expect(firstMsg.job).toBeDefined();
    expect(firstMsg.job._id).toBe(jobLifecycleId);

    const firstDoc = await adapter.findById(jobLifecycleId);
    expect(firstDoc).not.toBeNull();
    expect(firstDoc!.stage).toBe(JobStage.FULL_PARSED);

    const silence = await bus.setup([ActionEvent.PARSE_COMPLETED], 1500);
    await tc.ingestor.processIngest(
      JobSource.MANUAL,
      JobStage.FULL_PARSED,
      linkedinSduiDetailHtml('Junior Dev', 'DoubleCo'),
      jobLifecycleId
    );
    await assertNoMessage(silence);

    const secondDoc = await adapter.findById(jobLifecycleId);
    expect(secondDoc).not.toBeNull();
    expect(secondDoc!.stage).toBe(JobStage.FULL_PARSED);
    expect(secondDoc!.status).toBe(JobStatus.ENRICHED);
  });

  it('GIVEN an S2 manual FULL_PARSED input WHEN findById loads the doc THEN [c]-then-[j] race — S2 enrichment after queue is guarded, status stays QUEUED (S2+S3) · path c3', async () => {
    const jobLifecycleId = 'h3-enrich-after-queue';
    await adapter.upsert(
      makeStage1Partial({
        _id: jobLifecycleId,
        company: 'RaceCo',
        role: 'Junior Dev',
        stage: JobStage.FULL_PARSED,
        status: JobStatus.ENRICHED,
      })
    );

    const queued = await bus.setup([ActionEvent.QUEUED, ActionEvent.ROUTE_FAILED]);
    await UDS(tc).action(jobLifecycleId, 'queue');
    const queuedMsg = await queued.msg();
    expect(queuedMsg.jobLifecycleId).toBe(jobLifecycleId);

    const queuedDoc = await adapter.findById(jobLifecycleId);
    expect(queuedDoc).not.toBeNull();
    expect(queuedDoc!.status).toBe(JobStatus.QUEUED);

    const silence = await bus.setup([ActionEvent.PARSE_COMPLETED], 1500);
    await tc.ingestor.processIngest(
      JobSource.MANUAL,
      JobStage.FULL_PARSED,
      linkedinSduiDetailHtml('Junior Dev', 'RaceCo'),
      jobLifecycleId
    );
    await assertNoMessage(silence);

    const guardDoc = await adapter.findById(jobLifecycleId);
    expect(guardDoc).not.toBeNull();
    expect(guardDoc!.stage).toBe(JobStage.FULL_PARSED);
    expect(guardDoc!.status).toBe(JobStatus.QUEUED);
  });

  it('GIVEN an S2 manual FULL_PARSED input WHEN an ingest signal is processed THEN S2 enrichment with missing stage1Partial falls back to an HTML-only parsed job · path c3', async () => {
    const jobLifecycleId = 'h4-no-partial';

    const comp = await bus.setup([ActionEvent.PARSE_COMPLETED]);
    await tc.ingestor.processIngest(
      JobSource.MANUAL,
      JobStage.FULL_PARSED,
      linkedinSduiDetailHtml('Fallback Role', 'FallbackCo'),
      jobLifecycleId
    );
    const compMsg = await comp.msg();
    expect(compMsg.job).toBeDefined();
    expect(compMsg.job._id).toBe(jobLifecycleId);

    const doc = await adapter.findById(jobLifecycleId);
    expect(doc).not.toBeNull();
    expect(doc!.stage).toBe(JobStage.FULL_PARSED);
    expect(doc!.status).toBe(JobStatus.ENRICHED);
    expect(doc!.company).toBe('FallbackCo');
    expect(doc!.role).toBe('Fallback Role');
  });

  it('GIVEN an S2 browser auto FULL_PARSED input WHEN an ingest signal is processed THEN route failure (S4) then next S1 partial processes normally (S1+S2+S4) · path c3', async () => {
    const docId = 'h5-route-fail';
    await adapter.upsert(
      makeStage1Partial({
        _id: docId,
        company: 'FailCo',
        role: 'Senior Engineer',
        stage: JobStage.FULL_PARSED,
        status: JobStatus.ENRICHED,
      })
    );

    vi.spyOn(adapter, 'updateStage').mockRejectedValueOnce(new Error('DB write timeout'));
    const fail = await bus.setup([
      ActionEvent.QUEUED,
      ActionEvent.TRASHED,
      ActionEvent.ROUTE_FAILED,
    ]);
    await UDS(tc).action(docId, 'queue');
    const failMsg = await fail.msg();
    expect(failMsg.jobLifecycleId).toBe(docId);
    expect(failMsg.reason).toBe('DB write timeout');
    vi.restoreAllMocks();

    const gen = await bus.setup([ActionEvent.GENERATED]);
    await tc.ingestor.processIngest(
      JobSource.BROWSER_AUTO,
      JobStage.PARTIAL_PARSED,
      topcvEmailHtmlMany([{ role: 'Software Engineer', company: 'NextCo' }]),
      undefined,
      { messageId: 'h5-next' }
    );
    const genMsg = await gen.msg();
    expect(genMsg.company).toBe('NextCo');

    const doc = await adapter.findById('h5-next-job-0');
    expect(doc).not.toBeNull();
    expect(doc!.stage).toBe(JobStage.PARTIAL_PARSED);
    expect(doc!.status).toBe(JobStatus.ENRICHING);
    expect(doc!.company).toBe('NextCo');
  });
});

describe('Extraction-failure fallback (scheduler with real browser — unroutable URLs)', () => {
  let tc: TestContainer;
  let adapter: JobLifecyclePort;
  let queueAd: ExtractionQueuePort;
  let bus: RealDipBus;

  beforeAll(async () => {
    tc = await createTestContainer({ ns: 'c3-full-path-sched', startScheduler: true });
    await tc.start();
    adapter = tc.mongoJobLifecycleAdapter;
    queueAd = tc.extractionQueueAdapter;
    bus = tc.bus;
  }, 180000);

  afterAll(async () => {
    await tc.stop();
  });

  beforeEach(async () => {
    await tc.storage.clearDb();
  });

  it('GIVEN real chromium fails on unroutable URLs WHEN the path is exercised THEN scheduler falls back to S1 (GENERATED) and docs stay ENRICHING/PARTIAL · path c3', async () => {
    const jobIds = ['sched-fail-1', 'sched-fail-2'];
    for (const jobLifecycleId of jobIds) {
      await adapter.upsert(
        makeStage1Partial({
          _id: jobLifecycleId,
          company: `FailCorp-${jobLifecycleId}`,
          role: 'Backend Developer',
          url: 'http://127.0.0.1:1/none',
        })
      );

      const gen = await bus.setup([ActionEvent.GENERATED]);
      await queueAd.enqueue(jobLifecycleId);
      const genMsg = await gen.msg();
      expect(genMsg._id).toBe(jobLifecycleId);

      const doc = await adapter.findById(jobLifecycleId);
      expect(doc).not.toBeNull();
      expect(doc!.stage).toBe(JobStage.PARTIAL_PARSED);
      expect(doc!.status).toBe(JobStatus.ENRICHING);
    }
  }, 120000);

  it('GIVEN the path c3 preconditions WHEN the path is exercised THEN enqueued job with a missing lifecycle doc triggers no GENERATED/PARSE_FAILED emission · path c3', async () => {
    await vi.waitFor(
      async () => {
        expect(await queueAd.size()).toBe(0);
      },
      { interval: 100, timeout: 20000 }
    );

    const silence = await bus.setup(
      [ActionEvent.GENERATED, ActionEvent.PARSE_FAILED, ActionEvent.ROUTE_FAILED],
      2000
    );
    await queueAd.enqueue('sched-missing-doc-1');
    await vi.waitFor(
      async () => {
        expect(await queueAd.size()).toBe(0);
      },
      { interval: 100, timeout: 20000 }
    );
    await assertNoMessage(silence);
  }, 120000);
});

describe('fast-check failure-cycle invariants', () => {
  let tc: TestContainer;
  let adapter: JobLifecyclePort;

  beforeAll(async () => {
    tc = await createTestContainer({ ns: 'c3-full-path-fc' });
    await tc.start();
    adapter = tc.mongoJobLifecycleAdapter;
  }, 120000);

  afterAll(async () => {
    await tc.stop();
  });

  it('property: arbitrary parse-failure attempts never move a partial doc to a routed terminal state', async () => {
    let run = 0;
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 0, max: 3 }), async (attempts) => {
        // Monotonic per-run token keeps role+company unique across runs, so
        // the dedup index (E11000) can never fake a collision inside the
        // property — the identity to test is the injected failure, not fate.
        const token = `p${run}-${attempts}`;
        run += 1;
        const jobId = `fc-parse-${token}`;
        await adapter.upsert(
          makeStage1Partial({
            _id: jobId,
            role: `FcRole-${token}`,
            company: `FcCo-${token}`,
          })
        );

        for (let i = 0; i < attempts; i++) {
          await tc.ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, '', jobId);
        }

        const doc = await adapter.findById(jobId);
        expect(doc).not.toBeNull();
        expect(doc!.status).toBe(JobStatus.ENRICHING);
        expect(doc!.stage).toBe(JobStage.PARTIAL_PARSED);
        return true;
      }),
      { numRuns: 10 }
    );
  });

  it('property: route failure then valid S1 always recovers to an ENRICHED clip-* doc', async () => {
    let run = 0;
    await fc.assert(
      fc.asyncProperty(fc.string({ minLength: 1, maxLength: 12 }), async (name) => {
        const clean = name.replace(/[^a-zA-Z0-9]/g, '') || 'Co';
        // Monotonic per-run token keeps role+company unique across runs
        // (name-derived strings can collide as two samples), so the dedup
        // index never fakes a duplicate — only the injected route failure
        // drives the outcome.
        const token = `${clean}-${run}`;
        run += 1;
        const jobId = `fc-route-${token}`;
        await adapter.upsert(
          makeFullParsedDoc({
            _id: jobId,
            role: `FcRole-${token}`,
            company: `FcCo-${token}`,
          })
        );

        vi.spyOn(adapter, 'updateStage').mockRejectedValueOnce(new Error('fc-timeout'));
        await tc.ingestor.processResolution(jobId, 'queue');
        vi.restoreAllMocks();

        const comp = await tc.bus.setup([ActionEvent.PARSE_COMPLETED]);
        await tc.ingestor.processIngest(
          JobSource.MANUAL,
          JobStage.FULL_PARSED,
          topcvDetailHtml('Software Engineer', `RecoverCo-${token}`),
          undefined,
          undefined,
          new Date()
        );
        const compMsg = await comp.msg();
        expect(compMsg.job).toBeDefined();
        const clipId: string = compMsg.job._id;
        expect(clipId).toMatch(/^clip-/);

        const recovered = await adapter.findById(clipId);
        expect(recovered).not.toBeNull();
        expect(recovered!.status).toBe(JobStatus.ENRICHED);
        return true;
      }),
      { numRuns: 8 }
    );
  });
});
