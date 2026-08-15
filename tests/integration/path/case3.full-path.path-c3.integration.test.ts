/* Path cell (c3): full-path failure→recovery sagas observed only via the real
 * RabbitMQ-DIP bus (PARSE_FAILED/ROUTE_FAILED/QUEUED/GENERATED/PARSE_COMPLETED)
 * and driven through daemon.apps.ingest plus the UDS boundary for [j]/[d] resolution.
 * All failures are injected at the real persistence adapter (updateStage reject)
 * — no mock in-application ports are used anywhere in this file.
 * GWT cause-effect (path c3): GIVEN an S1 seed WHEN a failure path is exercised (PARSE_FAILED / ROUTE_FAILED)
 *   THEN S4 is emitted, the doc is untouched, and the next valid S1 recovers (checkpoint contract §1).
 *
 * Injection semantics: each failure is a deterministic, single-shot, guard-style
 * invariant placed at the checkpoint where the ring MUST break — the saga
 * ingestor's job_lifecycle write (updateStage reject) or its 5-probe miss
 * (findById → null). The break is expected and ensured: S4 emits the propagating
 * reason, the doc stays in its prior stage, and the next valid S1 closes the ring.
 * Injections are NOT random spies at arbitrary nested checkpoints; the
 * asset-producer downstream consumer is never reached on the failed path
 * (emitJobQueued never fires after a rejected updateStage — ingestor resolution
 * try-block).
 *
 * 3 failure-saga roots (parse-failure / route-failure / guards+ring-closure); each
 * root owns nested checkpoints only, asserting the S4→S1 next-pick recovery ring.
 */
import fc from 'fast-check';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

import type { JobLifecyclePort } from '../../../src/application/ports/job-lifecycle.port.js';
import { ActionEvent } from '../../../src/domain/types/action-event.js';
import { JobStage, JobSource, JobStatus } from '../../../src/domain/types/job-lifecycle.js';
import {
  topcvEmailHtmlMany,
  topcvDetailHtml,
  linkedinSduiDetailHtml,
  nonJobHtml,
} from '../../helpers/html-fixtures.js';
import { makeStage1Partial, makeFullParsedDoc } from '../../helpers/test-builders.js';
import {
  buildTestDaemonContainer,
  buildTestTuiContainer,
  type TestDaemonContainer,
  type TuiTestContainer,
} from '../../helpers/test-container.js';
import { purgeTuiQueues, waitFor } from '../../helpers/test-utils.js';

describe('Failure saga (a) — parse failure (S2→S4) with S1 recovery ring', () => {
  let daemon: TestDaemonContainer;
  let adapter: JobLifecyclePort;
  let tui: TuiTestContainer;

  beforeAll(async () => {
    daemon = await buildTestDaemonContainer({ ns: 'c3-full-path' });
    await daemon.start();
    adapter = daemon.jobLifecycle;
    tui = await buildTestTuiContainer({ ns: 'c3-full-path' });
  }, 120000);

  afterAll(async () => {
    await tui.stop();
    await daemon.stop();
  });

  beforeEach(async () => {
    await daemon.storage.clearDb();
    await purgeTuiQueues('c3-full-path');
    tui.rmq.reader.resetReader();
    tui.ipc.clear();
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

    const fail = tui.rmq.consume('s34');
    await daemon.apps.ingest.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, '', failedJobId);
    const failMsg = await fail;
    expect(failMsg.jobLifecycleId).toBe(failedJobId);

    const failedDoc = await adapter.findById(failedJobId);
    expect(failedDoc).not.toBeNull();
    expect(failedDoc!.stage).toBe(JobStage.PARTIAL_PARSED);
    expect(failedDoc!.status).toBe(JobStatus.ENRICHING);

    const gen = tui.rmq.consume('s1');
    await daemon.apps.ingest.processIngest(
      JobSource.BROWSER_AUTO,
      JobStage.PARTIAL_PARSED,
      topcvEmailHtmlMany([{ role: 'Software Engineer', company: 'NextCorp' }]),
      undefined,
      { messageId: 'next-valid-s1' }
    );
    const genMsg = await gen;
    expect(genMsg.company).toBe('NextCorp');
    expect(genMsg._id).toMatch(/^next-valid-s1-job-0$/);
    expect(genMsg.stage).toBe(JobStage.PARTIAL_PARSED);
    expect(genMsg.status).toBe(JobStatus.ENRICHING);

    const nextDoc = await adapter.findById('next-valid-s1-job-0');
    expect(nextDoc).not.toBeNull();
    expect(nextDoc!.company).toBe('NextCorp');
  });

  it('GIVEN unparsable FULL_PARSED payload WHEN the path is exercised THEN PARSE_FAILED (saga reaches S4) (S2+S4) · path c3', async () => {
    const fail = tui.rmq.consume('s34');
    await daemon.apps.ingest.processIngest(
      JobSource.BROWSER_AUTO,
      JobStage.FULL_PARSED,
      nonJobHtml(),
      'fail-parse-id'
    );
    const msg = await fail;
    expect(msg.jobLifecycleId).toBe('fail-parse-id');
  });

  it('GIVEN empty HTML payload WHEN the path is exercised THEN graceful PARSE_FAILED without crash (S2+S4) · path c3', async () => {
    const fail = tui.rmq.consume('s34');
    await expect(
      daemon.apps.ingest.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, '', 'empty-html-id')
    ).resolves.toBeUndefined();
    const msg = await fail;
    expect(msg.jobLifecycleId).toBe('empty-html-id');
  });

  it('GIVEN S2 parse.failed WHEN the path is exercised THEN next S1 partial emits GENERATED and persists the partial document (S1+S2+S4) · path c3', async () => {
    const fail = tui.rmq.consume('s34');
    await daemon.apps.ingest.processIngest(
      JobSource.MANUAL,
      JobStage.FULL_PARSED,
      '',
      'job-fail-s4a'
    );
    const failMsg = await fail;
    expect(failMsg.jobLifecycleId).toBe('job-fail-s4a');

    const gen = tui.rmq.consume('s1');
    await daemon.apps.ingest.processIngest(
      JobSource.BROWSER_AUTO,
      JobStage.PARTIAL_PARSED,
      topcvEmailHtmlMany([{ role: 'Software Engineer', company: 'AlphaCo' }]),
      undefined,
      { messageId: 'job-after-s4a' }
    );
    const genMsg = await gen;
    expect(genMsg.company).toBe('AlphaCo');

    const doc = await adapter.findById('job-after-s4a-job-0');
    expect(doc).not.toBeNull();
    expect(doc!.stage).toBe(JobStage.PARTIAL_PARSED);
    expect(doc!.status).toBe(JobStatus.ENRICHING);
    expect(doc!.company).toBe('AlphaCo');
  });

  it('GIVEN an S2 manual FULL_PARSED input WHEN an ingest signal is processed THEN S2 parse.failed (empty) then S2a manual succeeds for a different job (S2+S4) · path c3', async () => {
    const fail = tui.rmq.consume('s34');
    await daemon.apps.ingest.processIngest(
      JobSource.MANUAL,
      JobStage.FULL_PARSED,
      '',
      'job-s4-empty'
    );
    const failMsg = await fail;
    expect(failMsg.jobLifecycleId).toBe('job-s4-empty');

    await adapter.upsert(
      makeStage1Partial({
        _id: 'job-s4-recover',
        company: 'RecoveryCo',
        role: 'Junior Engineer',
        url: 'https://recovery.com/job',
      })
    );

    const comp = tui.rmq.consume('s2');
    await daemon.apps.ingest.processIngest(
      JobSource.MANUAL,
      JobStage.FULL_PARSED,
      linkedinSduiDetailHtml('Software Engineer', 'RecoveryCo'),
      'job-s4-recover'
    );
    const compMsg = await comp;
    expect(compMsg.job).toBeDefined();
    expect(compMsg.job._id).toBe('job-s4-recover');

    const fullDoc = await adapter.findById('job-s4-recover');
    expect(fullDoc).not.toBeNull();
    expect(fullDoc!.stage).toBe(JobStage.FULL_PARSED);
    expect(fullDoc!.status).toBe(JobStatus.ENRICHED);
    expect(fullDoc!.company).toBe('RecoveryCo');
  });

  it('property: arbitrary parse-failure attempts never move a partial doc to a routed terminal state', async () => {
    let run = 0;
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 0, max: 3 }), async (attempts) => {
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
          await daemon.apps.ingest.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, '', jobId);
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
});

describe('Failure saga (b) — route failure (S3→S4) with S1 recovery ring', () => {
  let daemon: TestDaemonContainer;
  let adapter: JobLifecyclePort;
  let tui: TuiTestContainer;

  beforeAll(async () => {
    daemon = await buildTestDaemonContainer({ ns: 'c3-full-path-route' });
    await daemon.start();
    adapter = daemon.jobLifecycle;
    tui = await buildTestTuiContainer({ ns: 'c3-full-path-route' });
  }, 120000);

  afterAll(async () => {
    await tui.stop();
    await daemon.stop();
  });

  beforeEach(async () => {
    await daemon.storage.clearDb();
    await purgeTuiQueues('c3-full-path-route');
    tui.rmq.reader.resetReader();
    tui.ipc.clear();
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

    const fail = tui.rmq.consume('s34');
    await tui.uds.write.queue(routeFailId);
    const failMsg = await fail;
    expect(failMsg.jobLifecycleId).toBe(routeFailId);
    expect(failMsg.reason).toBe('DB write conflict');
    vi.restoreAllMocks();

    const failedDoc = await adapter.findById(routeFailId);
    expect(failedDoc).not.toBeNull();
    expect(failedDoc!.stage).toBe(JobStage.FULL_PARSED);
    expect(failedDoc!.status).toBe(JobStatus.ENRICHED);

    const gen = tui.rmq.consume('s1');
    await daemon.apps.ingest.processIngest(
      JobSource.BROWSER_AUTO,
      JobStage.PARTIAL_PARSED,
      topcvEmailHtmlMany([{ role: 'Software Engineer', company: 'NextAfterRouteFail' }]),
      undefined,
      { messageId: 'next-after-route-fail' }
    );
    const genMsg = await gen;
    expect(genMsg.company).toBe('NextAfterRouteFail');
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
    const fail = tui.rmq.consume('s34');
    await tui.uds.write.queue('fail-route-id');
    const msg = await fail;
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

    vi.spyOn(daemon.rmq.ports.route, 'emitJobTrashed').mockRejectedValueOnce(
      new Error('Trash route unavailable')
    );
    const fail = tui.rmq.consume('s34');
    await tui.uds.write.trash('fail-route-trash-id');
    const msg = await fail;
    expect(msg.jobLifecycleId).toBe('fail-route-trash-id');
    expect(msg.reason).toBe('Trash route unavailable');
    vi.restoreAllMocks();

    const doc = await adapter.findById('fail-route-trash-id');
    expect(doc).not.toBeNull();
    expect(doc!.status).toBe(JobStatus.TRASHED);
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
    const fail = tui.rmq.consume('s34');
    await tui.uds.write.queue('job-fail-s4b');
    const failMsg = await fail;
    expect(failMsg.jobLifecycleId).toBe('job-fail-s4b');
    expect(failMsg.reason).toBe('DB write timeout');
    vi.restoreAllMocks();

    const gen = tui.rmq.consume('s1');
    await daemon.apps.ingest.processIngest(
      JobSource.BROWSER_AUTO,
      JobStage.PARTIAL_PARSED,
      topcvEmailHtmlMany([{ role: 'Software Engineer', company: 'BetaCo' }]),
      undefined,
      { messageId: 'job-after-s4b' }
    );
    const genMsg = await gen;
    expect(genMsg.company).toBe('BetaCo');
  });

  it('GIVEN route failure (S4) WHEN the path is exercised THEN next S1 partial processes normally (S1+S2+S4) · path c3', async () => {
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
    const fail = tui.rmq.consume('s34');
    await tui.uds.write.queue(docId);
    const failMsg = await fail;
    expect(failMsg.jobLifecycleId).toBe(docId);
    expect(failMsg.reason).toBe('DB write timeout');
    vi.restoreAllMocks();

    const gen = tui.rmq.consume('s1');
    await daemon.apps.ingest.processIngest(
      JobSource.BROWSER_AUTO,
      JobStage.PARTIAL_PARSED,
      topcvEmailHtmlMany([{ role: 'Software Engineer', company: 'NextCo' }]),
      undefined,
      { messageId: 'h5-next' }
    );
    const genMsg = await gen;
    expect(genMsg.company).toBe('NextCo');

    const doc = await adapter.findById('h5-next-job-0');
    expect(doc).not.toBeNull();
    expect(doc!.stage).toBe(JobStage.PARTIAL_PARSED);
    expect(doc!.status).toBe(JobStatus.ENRICHING);
    expect(doc!.company).toBe('NextCo');
  });

  it('property: route failure then valid S1 always recovers to an ENRICHED clip-* doc', async () => {
    let run = 0;
    await fc.assert(
      fc.asyncProperty(fc.string({ minLength: 1, maxLength: 12 }), async (name) => {
        const clean = name.replace(/[^a-zA-Z0-9]/g, '') || 'Co';
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
        await daemon.apps.ingest.processResolution(jobId, 'queue');
        vi.restoreAllMocks();

        const comp = tui.rmq.consume('s2');
        await daemon.apps.ingest.processIngest(
          JobSource.MANUAL,
          JobStage.FULL_PARSED,
          topcvDetailHtml('Software Engineer', `RecoverCo-${token}`),
          undefined,
          undefined,
          new Date()
        );
        const compMsg = await comp;
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

describe('Failure saga (c) — guards, S4→S1 ring closure and tui seam', () => {
  let daemon: TestDaemonContainer;
  let adapter: JobLifecyclePort;
  let tui: TuiTestContainer;

  beforeAll(async () => {
    daemon = await buildTestDaemonContainer({ ns: 'c3-full-path-guards' });
    await daemon.start();
    adapter = daemon.jobLifecycle;
    tui = await buildTestTuiContainer({ ns: 'c3-full-path-guards' });
  }, 120000);

  afterAll(async () => {
    await tui.stop();
    await daemon.stop();
  });

  beforeEach(async () => {
    await daemon.storage.clearDb();
    await purgeTuiQueues('c3-full-path-guards');
    tui.rmq.reader.resetReader();
    tui.ipc.clear();
  });

  it('GIVEN S1 WHEN the path is exercised THEN S2 enrichment, then the next S1 still dequeues — no saga state leaks between jobs (S1+S2) · path c3', async () => {
    const gen = tui.rmq.consume('s1');
    await daemon.apps.ingest.processIngest(
      JobSource.BROWSER_AUTO,
      JobStage.PARTIAL_PARSED,
      topcvEmailHtmlMany([{ role: 'Software Engineer', company: 'EnrichCo' }]),
      undefined,
      { messageId: 'fpcy-enrich-msg' }
    );
    const genMsg = await gen;
    const s1JoblifecycleId = genMsg._id;
    expect(s1JoblifecycleId).toBe('fpcy-enrich-msg-job-0');

    const comp = tui.rmq.consume('s2');
    await daemon.apps.ingest.processIngest(
      JobSource.MANUAL,
      JobStage.FULL_PARSED,
      topcvDetailHtml('Software Engineer', 'EnrichCo'),
      s1JoblifecycleId
    );
    const compMsg = await comp;
    expect(compMsg.job).toBeDefined();
    expect(compMsg.job._id).toBe(s1JoblifecycleId);

    const nextGen = tui.rmq.consume('s1');
    await daemon.apps.ingest.processIngest(
      JobSource.BROWSER_AUTO,
      JobStage.PARTIAL_PARSED,
      topcvEmailHtmlMany([{ role: 'Software Engineer', company: 'KeepCo' }]),
      undefined,
      { messageId: 'fpcy-keep-msg' }
    );
    const nextGenMsg = await nextGen;
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

    const comp = tui.rmq.consume('s2');
    await daemon.apps.ingest.processIngest(
      JobSource.MANUAL,
      JobStage.FULL_PARSED,
      linkedinSduiDetailHtml('Software Engineer', 'B9IntegCo'),
      docId
    );
    const compMsg = await comp;
    expect(compMsg.job).toBeDefined();
    expect(compMsg.job._id).toBe(docId);
    expect(compMsg.job.company).toBe('B9IntegCo');

    const doc = await adapter.findById(docId);
    expect(doc).not.toBeNull();
    expect(doc!.stage).toBe(JobStage.FULL_PARSED);
    expect(doc!.status).toBe(JobStatus.ENRICHED);
  });

  it('GIVEN detail-page HTML on a PARTIAL_PARSED pass WHEN the path is exercised THEN still resolves without emitting (S1+S4) · path c3', async () => {
    const silence = tui.rmq.consume([ActionEvent.GENERATED, ActionEvent.PARSE_FAILED], 1500);
    await expect(
      daemon.apps.ingest.processIngest(
        JobSource.MANUAL,
        JobStage.PARTIAL_PARSED,
        topcvDetailHtml('Any Job', 'AnyCo')
      )
    ).resolves.toBeUndefined();
    await expect(silence).rejects.toThrow(/Timeout/);
  });

  it('GIVEN rapid re-[c] on the same partial job WHEN the path is exercised THEN no second completion (S2) · path c3', async () => {
    const jobLifecycleId = 'h2-double-c';
    await adapter.upsert(
      makeStage1Partial({
        _id: jobLifecycleId,
        company: 'DoubleCo',
        role: 'Junior Dev',
      })
    );

    const first = tui.rmq.consume('s2');
    await daemon.apps.ingest.processIngest(
      JobSource.MANUAL,
      JobStage.FULL_PARSED,
      linkedinSduiDetailHtml('Junior Dev', 'DoubleCo'),
      jobLifecycleId
    );
    const firstMsg = await first;
    expect(firstMsg.job).toBeDefined();
    expect(firstMsg.job._id).toBe(jobLifecycleId);

    const firstDoc = await adapter.findById(jobLifecycleId);
    expect(firstDoc).not.toBeNull();
    expect(firstDoc!.stage).toBe(JobStage.FULL_PARSED);

    const silence = tui.rmq.consume('s2', 1500);
    await daemon.apps.ingest.processIngest(
      JobSource.MANUAL,
      JobStage.FULL_PARSED,
      linkedinSduiDetailHtml('Junior Dev', 'DoubleCo'),
      jobLifecycleId
    );
    await expect(silence).rejects.toThrow(/Timeout/);

    const secondDoc = await adapter.findById(jobLifecycleId);
    expect(secondDoc).not.toBeNull();
    expect(secondDoc!.stage).toBe(JobStage.FULL_PARSED);
    expect(secondDoc!.status).toBe(JobStatus.ENRICHED);
  });

  it('GIVEN [c]-then-[j] race WHEN the path is exercised THEN S2 enrichment after queue is guarded, status stays QUEUED (S2+S3) · path c3', async () => {
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

    const queued = tui.rmq.consume('s34');
    await tui.uds.write.queue(jobLifecycleId);
    const queuedMsg = await queued;
    expect(queuedMsg.jobLifecycleId).toBe(jobLifecycleId);

    const queuedDoc = await adapter.findById(jobLifecycleId);
    expect(queuedDoc).not.toBeNull();
    expect(queuedDoc!.status).toBe(JobStatus.QUEUED);

    const silence = tui.rmq.consume('s2', 1500);
    await daemon.apps.ingest.processIngest(
      JobSource.MANUAL,
      JobStage.FULL_PARSED,
      linkedinSduiDetailHtml('Junior Dev', 'RaceCo'),
      jobLifecycleId
    );
    await expect(silence).rejects.toThrow(/Timeout/);

    const guardDoc = await adapter.findById(jobLifecycleId);
    expect(guardDoc).not.toBeNull();
    expect(guardDoc!.stage).toBe(JobStage.FULL_PARSED);
    expect(guardDoc!.status).toBe(JobStatus.QUEUED);
  });

  it('GIVEN an S2 manual FULL_PARSED input WHEN an ingest signal is processed THEN S2 enrichment with missing stage1Partial falls back to an HTML-only parsed job · path c3', async () => {
    const jobLifecycleId = 'h4-no-partial';

    const comp = tui.rmq.consume('s2');
    await daemon.apps.ingest.processIngest(
      JobSource.MANUAL,
      JobStage.FULL_PARSED,
      linkedinSduiDetailHtml('Fallback Role', 'FallbackCo'),
      jobLifecycleId
    );
    const compMsg = await comp;
    expect(compMsg.job).toBeDefined();
    expect(compMsg.job._id).toBe(jobLifecycleId);

    const doc = await adapter.findById(jobLifecycleId);
    expect(doc).not.toBeNull();
    expect(doc!.stage).toBe(JobStage.FULL_PARSED);
    expect(doc!.status).toBe(JobStatus.ENRICHED);
    expect(doc!.company).toBe('FallbackCo');
    expect(doc!.role).toBe('Fallback Role');
  });

  it('GIVEN an S4 route failure WHEN a fresh valid S1 follows THEN the ring closes: the next job reaches S3 QUEUED (s4→s1→s3) · path c3', async () => {
    await adapter.upsert(
      makeFullParsedDoc({
        _id: 'closure-fail',
        company: 'ClosureFailCo',
        role: 'Engineer',
      })
    );

    vi.spyOn(adapter, 'updateStage').mockRejectedValueOnce(new Error('closure-fail'));
    const fail = tui.rmq.consume('s34');
    await tui.uds.write.queue('closure-fail');
    const failMsg = await fail;
    expect(failMsg.jobLifecycleId).toBe('closure-fail');
    expect(failMsg.reason).toBe('closure-fail');
    vi.restoreAllMocks();

    const gen = tui.rmq.consume('s1');
    await daemon.apps.ingest.processIngest(
      JobSource.BROWSER_AUTO,
      JobStage.PARTIAL_PARSED,
      topcvEmailHtmlMany([{ role: 'Software Engineer', company: 'RingCloseCo' }]),
      undefined,
      { messageId: 'closure-next' }
    );
    const genMsg = await gen;
    const nextId: string = genMsg._id;
    expect(genMsg.company).toBe('RingCloseCo');

    const comp = tui.rmq.consume('s2');
    await daemon.apps.ingest.processIngest(
      JobSource.MANUAL,
      JobStage.FULL_PARSED,
      topcvDetailHtml('Software Engineer', 'RingCloseCo'),
      nextId
    );
    const compMsg = await comp;
    expect(compMsg.job).toBeDefined();
    expect(compMsg.job._id).toBe(nextId);

    const queued = tui.rmq.consume('s34');
    await tui.uds.write.queue(nextId);
    const queuedMsg = await queued;
    expect(queuedMsg.jobLifecycleId).toBe(nextId);

    const routedDoc = await adapter.findById(nextId);
    expect(routedDoc).not.toBeNull();
    expect(routedDoc!.status).toBe(JobStatus.QUEUED);
  });

  it('GIVEN the tui-ioc precondition WHEN the daemon publishes S1+S2 over RMQ and the tui sends [j] over UDS THEN the reader mirrors then clears the job on the ipc seam (tui↔daemon real RMQ+UDS) · path c3', async () => {
    await waitFor(() => tui.rmq.reader.isConnected());
    const jobId = 'c3-full-path-guards-tui-1';
    await daemon.rmq.ports.parse.emitGenerated(
      {
        _id: jobId,
        role: 'Backend Developer',
        company: 'BoundaryC3',
        stage: JobStage.PARTIAL_PARSED,
      },
      { stage: JobStage.PARTIAL_PARSED, source: JobSource.BROWSER_AUTO }
    );
    await waitFor(() => tui.ipc.read().jobLifecycleId === jobId);
    expect(tui.ipc.read().stage).toBe(JobStage.PARTIAL_PARSED);
    await daemon.rmq.ports.parse.emitCompleted(
      {
        _id: jobId,
        role: 'Backend Developer',
        company: 'BoundaryC3',
        description: 'c3-full-path-guards boundary desc',
        stage: JobStage.FULL_PARSED,
        status: JobStatus.ENRICHED,
      },
      { stage: JobStage.FULL_PARSED, source: JobSource.MANUAL }
    );
    await waitFor(() => tui.ipc.read().job?.description === 'c3-full-path-guards boundary desc');
    expect(tui.ipc.read().stage).toBe(JobStage.FULL_PARSED);
    await daemon.jobLifecycle.upsert({
      _id: jobId,
      company: 'BoundaryC3',
      role: 'Backend Developer',
      description: 'c3-full-path-guards boundary desc',
      stage: JobStage.FULL_PARSED,
      status: JobStatus.ENRICHED,
      source: JobSource.MANUAL,
    });
    await tui.uds.write.queue(jobId);
    await waitFor(() => tui.ipc.read().jobLifecycleId === null);
    expect(tui.ipc.read().job).toBeNull();
  }, 60000);
});
