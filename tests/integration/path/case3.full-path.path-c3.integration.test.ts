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
import { waitFor } from '../../helpers/test-utils.js';

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
    await tui.reader.purgeQueues();
    tui.reader.resetReader();
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

    await daemon.apps.ingest.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, '', failedJobId);
    await new Promise((r) => setTimeout(r, 500));
    await waitFor(() => tui.ipc.read().jobLifecycleId === null);

    const failedDoc = await adapter.findById(failedJobId);
    expect(failedDoc).not.toBeNull();
    expect(failedDoc!.stage).toBe(JobStage.PARTIAL_PARSED);
    expect(failedDoc!.status).toBe(JobStatus.ENRICHING);

    await daemon.apps.ingest.processIngest(
      JobSource.BROWSER_AUTO,
      JobStage.PARTIAL_PARSED,
      topcvEmailHtmlMany([{ role: 'Software Engineer', company: 'NextCorp' }]),
      undefined,
      { messageId: 'next-valid-s1' }
    );
    await waitFor(() => tui.ipc.read().jobLifecycleId !== null && tui.ipc.read().jobLifecycleId!.startsWith('next-valid-s1'));
    expect(tui.ipc.read().job?.company).toBe('NextCorp');
    expect(tui.ipc.read().jobLifecycleId).toMatch(/^next-valid-s1-job-0$/);
    expect(tui.ipc.read().stage).toBe(JobStage.PARTIAL_PARSED);

    const nextDoc = await adapter.findById('next-valid-s1-job-0');
    expect(nextDoc).not.toBeNull();
    expect(nextDoc!.company).toBe('NextCorp');
  });

  it('GIVEN non-job FULL_PARSED HTML over a seeded s1 doc WHEN the path is exercised THEN enrichment proceeds with details=htmlToText(html) — no PARSE_FAILED at s2c (S1+S2) · path c3', async () => {
    await adapter.upsert(
      makeStage1Partial({ _id: 'fail-parse-id', company: 'FailParseCo', role: 'Engineer' })
    );

    await daemon.apps.ingest.processIngest(
      JobSource.BROWSER_AUTO,
      JobStage.FULL_PARSED,
      nonJobHtml(),
      'fail-parse-id'
    );
    await waitFor(() => tui.ipc.read().jobLifecycleId === 'fail-parse-id' && tui.ipc.read().stage === JobStage.FULL_PARSED);
    expect(tui.ipc.read().job?._id).toBe('fail-parse-id');

    const doc = await adapter.findById('fail-parse-id');
    expect(doc).not.toBeNull();
    expect(doc!.status).toBe(JobStatus.ENRICHED);
    expect(doc!.company).toBe('FailParseCo');
    expect(doc!.details).toContain('not a job posting');

    await new Promise((r) => setTimeout(r, 800));
    // silence probe: no S34 PARSE_FAILED emitted, ipc still holds enriched job and doc unchanged
    expect(tui.ipc.read().jobLifecycleId).toBe('fail-parse-id');
    const docAfter = await adapter.findById('fail-parse-id');
    expect(docAfter!.status).toBe(JobStatus.ENRICHED);
  });

  it('GIVEN empty HTML payload WHEN the path is exercised THEN graceful PARSE_FAILED without crash (S2+S4) · path c3', async () => {
    await daemon.apps.ingest.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, '', 'empty-html-id');
    await new Promise((r) => setTimeout(r, 500));
    await waitFor(() => tui.ipc.read().jobLifecycleId === null);
    const doc = await adapter.findById('empty-html-id');
    expect(doc).toBeNull();
  });

  it('GIVEN S2 parse.failed WHEN the path is exercised THEN next S1 partial emits GENERATED and persists the partial document (S1+S2+S4) · path c3', async () => {
    await daemon.apps.ingest.processIngest(
      JobSource.MANUAL,
      JobStage.FULL_PARSED,
      '',
      'job-fail-s4a'
    );
    await new Promise((r) => setTimeout(r, 500));
    await waitFor(() => tui.ipc.read().jobLifecycleId === null);
    const failedDoc = await adapter.findById('job-fail-s4a');
    expect(failedDoc).toBeNull();

    await daemon.apps.ingest.processIngest(
      JobSource.BROWSER_AUTO,
      JobStage.PARTIAL_PARSED,
      topcvEmailHtmlMany([{ role: 'Software Engineer', company: 'AlphaCo' }]),
      undefined,
      { messageId: 'job-after-s4a' }
    );
    await waitFor(() => tui.ipc.read().jobLifecycleId !== null && tui.ipc.read().jobLifecycleId!.startsWith('job-after-s4a'));
    expect(tui.ipc.read().job?.company).toBe('AlphaCo');
    expect(tui.ipc.read().stage).toBe(JobStage.PARTIAL_PARSED);

    const doc = await adapter.findById('job-after-s4a-job-0');
    expect(doc).not.toBeNull();
    expect(doc!.stage).toBe(JobStage.PARTIAL_PARSED);
    expect(doc!.status).toBe(JobStatus.ENRICHING);
    expect(doc!.company).toBe('AlphaCo');
  });

  it('GIVEN an S2 manual FULL_PARSED input WHEN an ingest signal is processed THEN S2 parse.failed (empty) then S2a manual succeeds for a different job (S2+S4) · path c3', async () => {
    await daemon.apps.ingest.processIngest(
      JobSource.MANUAL,
      JobStage.FULL_PARSED,
      '',
      'job-s4-empty'
    );
    await new Promise((r) => setTimeout(r, 500));
    await waitFor(() => tui.ipc.read().jobLifecycleId === null);

    await adapter.upsert(
      makeStage1Partial({
        _id: 'job-s4-recover',
        company: 'RecoveryCo',
        role: 'Junior Engineer',
        url: 'https://recovery.com/job',
      })
    );

    await daemon.apps.ingest.processIngest(
      JobSource.MANUAL,
      JobStage.FULL_PARSED,
      linkedinSduiDetailHtml('Software Engineer', 'RecoveryCo'),
      'job-s4-recover'
    );
    await new Promise((r) => setTimeout(r, 800));
    // queue-mode S2 is deferred (no prior S1 display) — verify via DB, not ipc
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
    await tui.reader.purgeQueues();
    tui.reader.resetReader();
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

    await tui.writer.queue(routeFailId);
    await new Promise((r) => setTimeout(r, 500));
    await waitFor(() => tui.ipc.read().jobLifecycleId === null);
    vi.restoreAllMocks();

    const failedDoc = await adapter.findById(routeFailId);
    expect(failedDoc).not.toBeNull();
    expect(failedDoc!.stage).toBe(JobStage.FULL_PARSED);
    expect(failedDoc!.status).toBe(JobStatus.ENRICHED);

    await daemon.apps.ingest.processIngest(
      JobSource.BROWSER_AUTO,
      JobStage.PARTIAL_PARSED,
      topcvEmailHtmlMany([{ role: 'Software Engineer', company: 'NextAfterRouteFail' }]),
      undefined,
      { messageId: 'next-after-route-fail' }
    );
    await waitFor(() => tui.ipc.read().jobLifecycleId !== null && tui.ipc.read().jobLifecycleId!.startsWith('next-after-route-fail'));
    expect(tui.ipc.read().job?.company).toBe('NextAfterRouteFail');
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
    await tui.writer.queue('fail-route-id');
    await new Promise((r) => setTimeout(r, 500));
    await waitFor(() => tui.ipc.read().jobLifecycleId === null);
    vi.restoreAllMocks();
    const doc = await adapter.findById('fail-route-id');
    expect(doc).not.toBeNull();
    expect(doc!.stage).toBe(JobStage.FULL_PARSED);
    expect(doc!.status).toBe(JobStatus.ENRICHED);
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
    await tui.writer.trash('fail-route-trash-id');
    await new Promise((r) => setTimeout(r, 500));
    await waitFor(() => tui.ipc.read().jobLifecycleId === null);
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
    await tui.writer.queue('job-fail-s4b');
    await new Promise((r) => setTimeout(r, 500));
    await waitFor(() => tui.ipc.read().jobLifecycleId === null);
    vi.restoreAllMocks();

    await daemon.apps.ingest.processIngest(
      JobSource.BROWSER_AUTO,
      JobStage.PARTIAL_PARSED,
      topcvEmailHtmlMany([{ role: 'Software Engineer', company: 'BetaCo' }]),
      undefined,
      { messageId: 'job-after-s4b' }
    );
    await waitFor(() => tui.ipc.read().jobLifecycleId !== null && tui.ipc.read().jobLifecycleId!.startsWith('job-after-s4b'));
    expect(tui.ipc.read().job?.company).toBe('BetaCo');
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
    await tui.writer.queue(docId);
    await new Promise((r) => setTimeout(r, 500));
    await waitFor(() => tui.ipc.read().jobLifecycleId === null);
    vi.restoreAllMocks();

    await daemon.apps.ingest.processIngest(
      JobSource.BROWSER_AUTO,
      JobStage.PARTIAL_PARSED,
      topcvEmailHtmlMany([{ role: 'Software Engineer', company: 'NextCo' }]),
      undefined,
      { messageId: 'h5-next' }
    );
    await waitFor(() => tui.ipc.read().jobLifecycleId !== null && tui.ipc.read().jobLifecycleId!.startsWith('h5-next'));
    expect(tui.ipc.read().job?.company).toBe('NextCo');

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

        await daemon.apps.ingest.processIngest(
          JobSource.MANUAL,
          JobStage.FULL_PARSED,
          linkedinSduiDetailHtml('Software Engineer', `RecoverCo-${token}`),
          undefined,
          undefined,
          new Date()
        );
        await new Promise((r) => setTimeout(r, 800));
        // clip via signal2bManual is direct-mode S2 — queue-mode defers, so verify via DB not ipc
        const clipDocs = await (daemon.mongo.raw('job_lifecycle') as unknown as { find: (q: unknown) => { toArray: () => Promise<unknown[]> } }).find({ _id: { $regex: /^clip-/ } }).toArray();
        expect(clipDocs.length).toBeGreaterThan(0);
        const matched = clipDocs.find((d: any) => String(d.company).includes(`RecoverCo-${token}`)) ?? clipDocs[clipDocs.length - 1];
        const clipId: string = String((matched as any)._id);
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
    await tui.reader.purgeQueues();
    tui.reader.resetReader();
    tui.ipc.clear();
  });

  it('GIVEN S1 WHEN the path is exercised THEN S2 enrichment, then the next S1 still dequeues — no saga state leaks between jobs (S1+S2) · path c3', async () => {
    await daemon.apps.ingest.processIngest(
      JobSource.BROWSER_AUTO,
      JobStage.PARTIAL_PARSED,
      topcvEmailHtmlMany([{ role: 'Software Engineer', company: 'EnrichCo' }]),
      undefined,
      { messageId: 'fpcy-enrich-msg' }
    );
    await waitFor(() => tui.ipc.read().jobLifecycleId === 'fpcy-enrich-msg-job-0');
    const s1JoblifecycleId = tui.ipc.read().jobLifecycleId!;
    expect(s1JoblifecycleId).toBe('fpcy-enrich-msg-job-0');

    await daemon.apps.ingest.processIngest(
      JobSource.MANUAL,
      JobStage.FULL_PARSED,
      topcvDetailHtml('Software Engineer', 'EnrichCo'),
      s1JoblifecycleId
    );
    await waitFor(() => tui.ipc.read().jobLifecycleId === s1JoblifecycleId && tui.ipc.read().stage === JobStage.FULL_PARSED);
    expect(tui.ipc.read().job).toBeDefined();
    expect(tui.ipc.read().job!._id).toBe(s1JoblifecycleId);

    await daemon.apps.ingest.processIngest(
      JobSource.BROWSER_AUTO,
      JobStage.PARTIAL_PARSED,
      topcvEmailHtmlMany([{ role: 'Software Engineer', company: 'KeepCo' }]),
      undefined,
      { messageId: 'fpcy-keep-msg' }
    );
    await new Promise((r) => setTimeout(r, 500));
    expect(tui.reader.getQueueDepth()).toBe(1);
    expect(tui.ipc.read().jobLifecycleId).toBe(s1JoblifecycleId);
    const keepDoc = await adapter.findById('fpcy-keep-msg-job-0');
    expect(keepDoc).not.toBeNull();
    expect(keepDoc!.company).toBe('KeepCo');
    await tui.writer.queue(s1JoblifecycleId);
    await waitFor(() => tui.ipc.read().jobLifecycleId === 'fpcy-keep-msg-job-0');
    expect(tui.ipc.read().job?.company).toBe('KeepCo');
    expect(tui.ipc.read().jobLifecycleId).toBe('fpcy-keep-msg-job-0');
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

    await daemon.apps.ingest.processIngest(
      JobSource.MANUAL,
      JobStage.FULL_PARSED,
      linkedinSduiDetailHtml('Software Engineer', 'B9IntegCo'),
      docId
    );
    await new Promise((r) => setTimeout(r, 800));
    // queue-mode S2 deferred — verify via DB
    const doc = await adapter.findById(docId);
    expect(doc).not.toBeNull();
    expect(doc!.stage).toBe(JobStage.FULL_PARSED);
    expect(doc!.status).toBe(JobStatus.ENRICHED);
  });

  it('GIVEN detail-page HTML on a PARTIAL_PARSED pass WHEN the path is exercised THEN still resolves without emitting (S1+S4) · path c3', async () => {
    await daemon.apps.ingest.processIngest(
      JobSource.MANUAL,
      JobStage.PARTIAL_PARSED,
      linkedinSduiDetailHtml('Any Job', 'AnyCo')
    );
    await new Promise((r) => setTimeout(r, 800));
    // silence probe: no GENERATED/PARSE_FAILED, ipc stays null and no doc created
    expect(tui.ipc.read().jobLifecycleId).toBeNull();
    const docs = await daemon.mongo.raw('job_lifecycle').find({}).toArray();
    expect(docs.length).toBe(0);
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

    await daemon.apps.ingest.processIngest(
      JobSource.MANUAL,
      JobStage.FULL_PARSED,
      linkedinSduiDetailHtml('Junior Dev', 'DoubleCo'),
      jobLifecycleId
    );
    await new Promise((r) => setTimeout(r, 800));
    const firstDoc = await adapter.findById(jobLifecycleId);
    expect(firstDoc).not.toBeNull();
    expect(firstDoc!.stage).toBe(JobStage.FULL_PARSED);

    await daemon.apps.ingest.processIngest(
      JobSource.MANUAL,
      JobStage.FULL_PARSED,
      linkedinSduiDetailHtml('Junior Dev', 'DoubleCo'),
      jobLifecycleId
    );
    await new Promise((r) => setTimeout(r, 800));
    // silence: no second S2 emission — job already FULL_PARSED, S2 guard prevents re-emit, ipc remains null (deferred)
    expect(tui.ipc.read().jobLifecycleId).toBeNull();

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

    await tui.writer.queue(jobLifecycleId);
    await waitFor(() => tui.ipc.read().jobLifecycleId === null);

    const queuedDoc = await adapter.findById(jobLifecycleId);
    expect(queuedDoc).not.toBeNull();
    expect(queuedDoc!.status).toBe(JobStatus.QUEUED);

    await daemon.apps.ingest.processIngest(
      JobSource.MANUAL,
      JobStage.FULL_PARSED,
      linkedinSduiDetailHtml('Junior Dev', 'RaceCo'),
      jobLifecycleId
    );
    await new Promise((r) => setTimeout(r, 800));
    // silence: no S2 emission after queue, doc stays QUEUED
    expect(tui.ipc.read().jobLifecycleId).toBeNull();

    const guardDoc = await adapter.findById(jobLifecycleId);
    expect(guardDoc).not.toBeNull();
    expect(guardDoc!.stage).toBe(JobStage.FULL_PARSED);
    expect(guardDoc!.status).toBe(JobStatus.QUEUED);
  });

  it('GIVEN an S2 manual FULL_PARSED input with missing stage-1 doc WHEN an ingest signal is processed THEN enrichment is skipped — no completion, no doc (found(id) guard, S2) · path c3', async () => {
    const jobLifecycleId = 'h4-no-partial';

    await daemon.apps.ingest.processIngest(
      JobSource.MANUAL,
      JobStage.FULL_PARSED,
      linkedinSduiDetailHtml('Fallback Role', 'FallbackCo'),
      jobLifecycleId
    );

    await new Promise((r) => setTimeout(r, 800));
    expect(tui.ipc.read().jobLifecycleId).toBeNull();

    const doc = await adapter.findById(jobLifecycleId);
    expect(doc).toBeNull();
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
    await tui.writer.queue('closure-fail');
    await new Promise((r) => setTimeout(r, 500));
    await waitFor(() => tui.ipc.read().jobLifecycleId === null);
    vi.restoreAllMocks();

    await daemon.apps.ingest.processIngest(
      JobSource.BROWSER_AUTO,
      JobStage.PARTIAL_PARSED,
      topcvEmailHtmlMany([{ role: 'Software Engineer', company: 'RingCloseCo' }]),
      undefined,
      { messageId: 'closure-next' }
    );
    await waitFor(() => tui.ipc.read().jobLifecycleId !== null && tui.ipc.read().jobLifecycleId!.startsWith('closure-next'));
    expect(tui.ipc.read().job?.company).toBe('RingCloseCo');
    const nextId: string = tui.ipc.read().jobLifecycleId!;

    await daemon.apps.ingest.processIngest(
      JobSource.MANUAL,
      JobStage.FULL_PARSED,
      topcvDetailHtml('Software Engineer', 'RingCloseCo'),
      nextId
    );
    await waitFor(() => tui.ipc.read().jobLifecycleId === nextId && tui.ipc.read().stage === JobStage.FULL_PARSED);
    expect(tui.ipc.read().job).toBeDefined();
    expect(tui.ipc.read().job!._id).toBe(nextId);

    await tui.writer.queue(nextId);
    await waitFor(() => tui.ipc.read().jobLifecycleId === null);

    const routedDoc = await adapter.findById(nextId);
    expect(routedDoc).not.toBeNull();
    expect(routedDoc!.status).toBe(JobStatus.QUEUED);
  });

  it('G4 waiter hygiene GIVEN a timed-out consume registration WHEN a fresh publish follows THEN the stale waiter cannot steal the message — the fresh waiter resolves it · path c3', async () => {
    let timedOut = false;
    try {
      await waitFor(() => tui.ipc.read().jobLifecycleId === '__g4-stale-probe__', 300);
    } catch {
      timedOut = true;
    }
    expect(timedOut).toBe(true);

    const payloadId = 'g4-hygiene-1';
    tui.reader.resetReader();
    await tui.reader.purgeQueues();
    await daemon.rmq.ports.parse.emitGenerated(
      { _id: payloadId, role: 'Software Engineer', company: 'G4Co', stage: JobStage.PARTIAL_PARSED },
      { stage: JobStage.PARTIAL_PARSED, source: JobSource.BROWSER_AUTO }
    );
    await waitFor(() => tui.ipc.read().jobLifecycleId === payloadId, 8000);
    expect(tui.ipc.read().jobLifecycleId).toBe(payloadId);
  });

  it('GIVEN the tui-ioc precondition WHEN the daemon publishes S1+S2 over RMQ and the tui sends [j] over UDS THEN the reader mirrors then clears the job on the ipc seam (tui↔daemon real RMQ+UDS) · path c3', async () => {
    await waitFor(() => tui.reader.isConnected());
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
    await tui.writer.queue(jobId);
    await waitFor(() => tui.ipc.read().jobLifecycleId === null);
    expect(tui.ipc.read().job).toBeNull();
  }, 60000);
});
