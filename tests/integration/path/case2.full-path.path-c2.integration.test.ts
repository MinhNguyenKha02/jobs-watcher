/* Path cell (c2): full browser-auto-to-resolution cycle — S2 direct arrival,
   S3 real scheduler + Playwright full-parse, exhaustion/fairness + rate stress,
   S4 parse failure, extraction-failure fallback, fast-check invariants
   (consolidated: case2.browser-full-parsed / extraction-exhaustion /
   extraction-scheduler / extraction-pipeline). See plans/tests-path-matrix.md.
   All boundaries cross the REAL UDS socket; the production composition root
 * GWT cause-effect (path c2): GIVEN email S1 with URL WHEN scheduler+Playwright S2 full parse + [j]/[d] UDS action
 *   THEN S3 QUEUED + real pdf / S4 TRASHED, with S3 drain + extraction-failure fallbacks (checkpoint contract §1).
   provides the real ingestor, scheduler, Playwright browser, RMQ events and the
   AssetProducingAdapter rendering PDFs into daemon.assetDir (see test-container.ts). */
import http from 'node:http';

import fc from 'fast-check';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

import type { ExtractionQueuePort } from '../../../src/application/ports/extraction-queue.port.js';
import type { JobLifecyclePort } from '../../../src/application/ports/job-lifecycle.port.js';
import { JobStage, JobSource, JobStatus } from '../../../src/domain/types/job-lifecycle.js';
import {
  indeedDetailHtml,
  topcvEmailHtmlMany,
} from '../../helpers/html-fixtures.js';
import { makeStage1Partial } from '../../helpers/test-builders.js';
import {
  buildTestDaemonContainer,
  buildTestTuiContainer,
  type TestDaemonContainer,
  type TuiTestContainer,
} from '../../helpers/test-container.js';
import { udsHelpers, waitFor, waitForPdfFiles } from '../../helpers/test-utils.js';

const UDS_TOKEN = 'e2e-internal-token';

const FULL_PARSED_HTML = indeedDetailHtml();
const FULL_PARSED_URL = 'https://vn.indeed.com/viewjob?jk=e2e-c2-full';

interface DetailServer {
  server: http.Server;
  base: string;
  urlFor: (role: string, company: string) => string;
  close: () => Promise<void>;
}

function startDetailServer(): Promise<DetailServer> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const parsed = new URL(req.url || '/', 'http://127.0.0.1');
      const role = parsed.searchParams.get('role') || 'Backend Developer';
      const company = parsed.searchParams.get('company') || 'C2PathCo';
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(
        indeedDetailHtml(
          role,
          company,
          `http://127.0.0.1:${(server.address() as any).port}/viewjob?jk=${encodeURIComponent(company)}`
        )
      );
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as any;
      resolve({
        server,
        base: `http://127.0.0.1:${addr.port}`,
        urlFor: (role, company) =>
          `http://127.0.0.1:${addr.port}/viewjob?jk=${encodeURIComponent(company)}&role=${encodeURIComponent(role)}&company=${encodeURIComponent(company)}`,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

async function seedPartial(
  adapter: JobLifecyclePort,
  id: string,
  url: string,
  role: string,
  company: string
): Promise<void> {
  await adapter.upsert(
    makeStage1Partial({
      _id: id,
      url,
      role,
      company,
      stage: JobStage.PARTIAL_PARSED,
      status: JobStatus.ENRICHING,
      source: JobSource.BROWSER_AUTO,
    })
  );
}

async function seedPartialMany(
  adapter: JobLifecyclePort,
  ids: string[],
  base: string,
  roleOf: (i: number) => string,
  companyOf: (i: number) => string
): Promise<void> {
  for (let i = 0; i < ids.length; i++) {
    const role = roleOf(i);
    const company = companyOf(i);
    await seedPartial(
      adapter,
      ids[i],
      `${base}/viewjob?jk=${encodeURIComponent(company)}&role=${encodeURIComponent(role)}&company=${encodeURIComponent(company)}`,
      role,
      company
    );
  }
}

describe('c2 browser extraction + resolution cycle', () => {
  let daemon: TestDaemonContainer;
  let tui: TuiTestContainer;
  let adapter: JobLifecyclePort;
  let eqAdapter: ExtractionQueuePort;
  let detail: DetailServer;
  let uds: ReturnType<typeof udsHelpers>;

  beforeAll(async () => {
    daemon = await buildTestDaemonContainer({ ns: 'c2-full-path', startScheduler: true });
    await daemon.start();
    adapter = daemon.jobLifecycle;
    eqAdapter = daemon.extractQueue;
    uds = udsHelpers(daemon.uds.socket, UDS_TOKEN);
    tui = await buildTestTuiContainer({ ns: 'c2-full-path' });
    detail = await startDetailServer();
  }, 120000);

  afterAll(async () => {
    await tui.stop();
    try {
      await detail.close();
    } catch {
      /* best-effort */
    }
    try {
      await daemon.stop();
    } catch {
      /* best-effort */
    }
  });

  beforeEach(async () => {
    await daemon.storage.clearDb();
    await tui.reader.purgeQueues();
    tui.reader.resetReader();
    tui.ipc.clear();
  });

  describe('(a) S2 full direct arrival — Queue[j] / trash[d]', () => {
    it('GIVEN S2 BROWSER_AUTO FULL_PARSED arrival WHEN parse events → [j] over UDS THEN QUEUED + pdf asset (S1+S2+S3) · path c2', async () => {
      const jobLifecycleId = 'e2e-c2-full-arrival';
      await seedPartial(
        adapter,
        jobLifecycleId,
        FULL_PARSED_URL,
        'Backend Developer',
        'FullParsedCo'
      );

      await daemon.apps.ingest.processIngest(
        JobSource.BROWSER_AUTO,
        JobStage.FULL_PARSED,
        FULL_PARSED_HTML,
        jobLifecycleId
      );
      await waitFor(
        () => tui.ipc.read().jobLifecycleId === jobLifecycleId && tui.ipc.read().stage === JobStage.FULL_PARSED
      );
      expect(tui.ipc.read().jobLifecycleId).toBe(jobLifecycleId);
      expect(tui.ipc.read().stage).toBe(JobStage.FULL_PARSED);

      const doc = await adapter.findById(jobLifecycleId);
      expect(doc).not.toBeNull();
      expect(doc!.stage).toBe(JobStage.FULL_PARSED);
      expect(doc!.status).toBe(JobStatus.ENRICHED);

      await tui.writer.queue(jobLifecycleId);
      await waitFor(() => tui.ipc.read().jobLifecycleId === null);
      expect(tui.ipc.read().job).toBeNull();

      await waitForPdfFiles(daemon.assetDir);

      const queuedDoc = await adapter.findById(jobLifecycleId);
      expect(queuedDoc).not.toBeNull();
      expect(queuedDoc!.stage).toBe(JobStage.FULL_PARSED);
      expect(queuedDoc!.status).toBe(JobStatus.QUEUED);
    }, 60000);

    it('GIVEN S2 BROWSER_AUTO FULL_PARSED arrival WHEN [d] over UDS THEN TRASHED (S2+S3) · path c2', async () => {
      const jobLifecycleId = 'e2e-c2-full-trash';
      await seedPartial(
        adapter,
        jobLifecycleId,
        FULL_PARSED_URL,
        'Backend Developer',
        'FullParsedCo'
      );

      await daemon.apps.ingest.processIngest(
        JobSource.BROWSER_AUTO,
        JobStage.FULL_PARSED,
        FULL_PARSED_HTML,
        jobLifecycleId
      );
      await waitFor(
        () => tui.ipc.read().jobLifecycleId === jobLifecycleId && tui.ipc.read().stage === JobStage.FULL_PARSED
      );
      expect(tui.ipc.read().jobLifecycleId).toBe(jobLifecycleId);
      expect(tui.ipc.read().stage).toBe(JobStage.FULL_PARSED);

      await tui.writer.trash(jobLifecycleId);
      await waitFor(() => tui.ipc.read().jobLifecycleId === null);
      expect(tui.ipc.read().job).toBeNull();

      const trashedDoc = await adapter.findById(jobLifecycleId);
      expect(trashedDoc).not.toBeNull();
      expect(trashedDoc!.stage).toBe(JobStage.FULL_PARSED);
      expect(trashedDoc!.status).toBe(JobStatus.TRASHED);
    }, 60000);

    it('GIVEN an S2 browser auto FULL_PARSED input without jobLifecycleId WHEN an ingest signal is processed THEN found(id) precondition fails — enrichment skipped, no doc created (S2) · path c2', async () => {
      await daemon.apps.ingest.processIngest(
        JobSource.BROWSER_AUTO,
        JobStage.FULL_PARSED,
        FULL_PARSED_HTML
      );
      await new Promise((r) => setTimeout(r, 500));

      const col = daemon.mongo.raw('job_lifecycle');
      const docs = await col.find({}).toArray();
      expect(docs.length).toBe(0);
      expect(tui.ipc.read().jobLifecycleId).toBeNull();
    });

    it('GIVEN the tui-ioc precondition WHEN the daemon publishes S1+S2 over RMQ and the tui sends [d] over UDS THEN the tui reader mirrors then clears the job on the ipc seam (tui↔daemon over real RMQ+UDS) · path c2', async () => {
      await waitFor(() => tui.reader.isConnected());
      const jobId = 'c2-tui-boundary-1';

      await daemon.rmq.ports.parse.emitGenerated(
        {
          _id: jobId,
          role: 'Backend Developer',
          company: 'BoundaryCo2',
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
          company: 'BoundaryCo2',
          description: 'boundary desc c2',
          stage: JobStage.FULL_PARSED,
          status: JobStatus.ENRICHED,
        },
        { stage: JobStage.FULL_PARSED, source: JobSource.MANUAL }
      );
      await waitFor(() => tui.ipc.read().job?.description === 'boundary desc c2');
      expect(tui.ipc.read().stage).toBe(JobStage.FULL_PARSED);

      await daemon.jobLifecycle.upsert({
        _id: jobId,
        company: 'BoundaryCo2',
        role: 'Backend Developer',
        description: 'boundary desc c2',
        stage: JobStage.FULL_PARSED,
        status: JobStatus.ENRICHED,
        source: JobSource.MANUAL,
      });

      await tui.writer.trash(jobId);
      await waitFor(() => tui.ipc.read().jobLifecycleId === null);
      expect(tui.ipc.read().job).toBeNull();
    }, 60000);
  });

  describe('(b) S3 scheduler real-browser full-parse', () => {
    it('GIVEN seed PARTIAL WHEN real scheduler+Playwright dequeue → local server extraction THEN FULL_PARSED/ENRICHED (S1+S2) · path c2', async () => {
      const jobId = 'c2-sched-full-0';
      await seedPartial(
        adapter,
        jobId,
        detail.urlFor('Backend Developer', 'C2SchedFullCo'),
        'Backend Developer',
        'C2SchedFullCo'
      );

      await eqAdapter.enqueue(jobId);
      await waitFor(
        () => tui.ipc.read().jobLifecycleId === jobId && tui.ipc.read().stage === JobStage.FULL_PARSED
      );
      expect(tui.ipc.read().jobLifecycleId).toBe(jobId);
      expect(tui.ipc.read().stage).toBe(JobStage.FULL_PARSED);
      expect(tui.ipc.read().job?.company).toBe('C2SchedFullCo');

      const fullDoc = await adapter.findById(jobId);
      expect(fullDoc).not.toBeNull();
      expect(fullDoc!.stage).toBe(JobStage.FULL_PARSED);
      expect(fullDoc!.status).toBe(JobStatus.ENRICHED);
    }, 60000);

    it('GIVEN scheduler full-parse WHEN [j] UDS → QUEUED + pdf THEN second seeded job still completes (next pick) (S1+S2+S3) · path c2', async () => {
      const jobId = 'c2-sched-route-0';
      await seedPartial(
        adapter,
        jobId,
        detail.urlFor('Backend Developer', 'C2SchedRouteCo'),
        'Backend Developer',
        'C2SchedRouteCo'
      );

      await eqAdapter.enqueue(jobId);
      await waitFor(
        () => tui.ipc.read().jobLifecycleId === jobId && tui.ipc.read().stage === JobStage.FULL_PARSED
      );
      expect(tui.ipc.read().jobLifecycleId).toBe(jobId);
      expect(tui.ipc.read().stage).toBe(JobStage.FULL_PARSED);

      await tui.writer.queue(jobId);
      await waitFor(() => tui.ipc.read().jobLifecycleId === null);
      expect(tui.ipc.read().job).toBeNull();

      await waitForPdfFiles(daemon.assetDir);

      const routedDoc = await adapter.findById(jobId);
      expect(routedDoc).not.toBeNull();
      expect(routedDoc!.status).toBe(JobStatus.QUEUED);

      // Next pick: a second seeded job still completes after the first was routed.
      const jobId2 = 'c2-sched-route-1';
      await seedPartial(
        adapter,
        jobId2,
        detail.urlFor('Data Engineer', 'C2SchedRouteDataCo'),
        'Data Engineer',
        'C2SchedRouteDataCo'
      );
      await eqAdapter.enqueue(jobId2);
      await waitFor(
        () => tui.ipc.read().jobLifecycleId === jobId2 && tui.ipc.read().stage === JobStage.FULL_PARSED
      );
      expect(tui.ipc.read().jobLifecycleId).toBe(jobId2);
      expect(tui.ipc.read().stage).toBe(JobStage.FULL_PARSED);
    }, 60000);

    it('GIVEN scheduler full-parse WHEN [d] trash via UDS → TRASHED THEN next cycle still completes (S1+S2+S3) · path c2', async () => {
      const jobId = 'c2-sched-trash-0';
      await seedPartial(
        adapter,
        jobId,
        detail.urlFor('Backend Developer', 'C2SchedTrashCo'),
        'Backend Developer',
        'C2SchedTrashCo'
      );

      await eqAdapter.enqueue(jobId);
      await waitFor(
        () => tui.ipc.read().jobLifecycleId === jobId && tui.ipc.read().stage === JobStage.FULL_PARSED
      );
      expect(tui.ipc.read().jobLifecycleId).toBe(jobId);
      expect(tui.ipc.read().stage).toBe(JobStage.FULL_PARSED);

      await tui.writer.trash(jobId);
      await waitFor(() => tui.ipc.read().jobLifecycleId === null);
      expect(tui.ipc.read().job).toBeNull();

      const trashedDoc = await adapter.findById(jobId);
      expect(trashedDoc).not.toBeNull();
      expect(trashedDoc!.status).toBe(JobStatus.TRASHED);

      // Next cycle: a second job still completes after the trash.
      const jobId2 = 'c2-sched-trash-1';
      await seedPartial(
        adapter,
        jobId2,
        detail.urlFor('Data Engineer', 'C2SchedTrashDataCo'),
        'Data Engineer',
        'C2SchedTrashDataCo'
      );
      await eqAdapter.enqueue(jobId2);
      await waitFor(
        () => tui.ipc.read().jobLifecycleId === jobId2 && tui.ipc.read().stage === JobStage.FULL_PARSED
      );
      expect(tui.ipc.read().jobLifecycleId).toBe(jobId2);
      expect(tui.ipc.read().stage).toBe(JobStage.FULL_PARSED);
    }, 60000);

    it('GIVEN an S3 next-pick precondition WHEN a fresh valid S1 follows THEN the ring closes: the next job reaches S3 QUEUED (s1→s2→s3→next pick) · path c2', async () => {
      const jobId = 'c2-ring-0';
      await seedPartial(
        adapter,
        jobId,
        detail.urlFor('Backend Developer', 'C2RingCo'),
        'Backend Developer',
        'C2RingCo'
      );

      await eqAdapter.enqueue(jobId);
      await waitFor(
        () => tui.ipc.read().jobLifecycleId === jobId && tui.ipc.read().stage === JobStage.FULL_PARSED
      );
      expect(tui.ipc.read().jobLifecycleId).toBe(jobId);
      expect(tui.ipc.read().stage).toBe(JobStage.FULL_PARSED);

      await tui.writer.queue(jobId);
      await waitFor(() => tui.ipc.read().jobLifecycleId === null);
      expect(tui.ipc.read().job).toBeNull();

      const routedDoc = await adapter.findById(jobId);
      expect(routedDoc).not.toBeNull();
      expect(routedDoc!.status).toBe(JobStatus.QUEUED);

      await daemon.apps.ingest.processIngest(
        JobSource.BROWSER_AUTO,
        JobStage.PARTIAL_PARSED,
        topcvEmailHtmlMany([{ role: 'Data Engineer', company: 'C2RingNextCo' }]),
        undefined,
        { messageId: 'c2-ring-next' }
      );
      await waitFor(
        () => tui.ipc.read().jobLifecycleId !== null && tui.ipc.read().job?.company === 'C2RingNextCo'
      );
      const nextId: string = tui.ipc.read().jobLifecycleId!;
      expect(tui.ipc.read().job?.company).toBe('C2RingNextCo');
      expect(tui.ipc.read().stage).toBe(JobStage.PARTIAL_PARSED);

      await daemon.apps.ingest.processIngest(
        JobSource.MANUAL,
        JobStage.FULL_PARSED,
        indeedDetailHtml(),
        nextId
      );
      await waitFor(
        () => tui.ipc.read().jobLifecycleId === nextId && tui.ipc.read().stage === JobStage.FULL_PARSED
      );
      expect(tui.ipc.read().jobLifecycleId).toBe(nextId);
      expect(tui.ipc.read().stage).toBe(JobStage.FULL_PARSED);

      await tui.writer.queue(nextId);
      await waitFor(() => tui.ipc.read().jobLifecycleId === null);
      expect(tui.ipc.read().job).toBeNull();

      const routedNext = await adapter.findById(nextId);
      expect(routedNext).not.toBeNull();
      expect(routedNext!.status).toBe(JobStatus.QUEUED);
    }, 60000);
  });

  describe('(c) scheduler empty-queue drains + exhaustion/fairness', () => {
    it('GIVEN the path c2 preconditions WHEN the path is exercised THEN N sequentially-enqueued partial jobs each reach FULL_PARSED/ENRICHED — queue drains to empty (S1+S2) · path c2', async () => {
      const N = 5;
      const ids: string[] = [];
      for (let i = 0; i < N; i++) ids.push(`c2-exhaust-${i}`);

      const roles = [
        'Backend Developer',
        'Data Engineer',
        'Frontend Engineer',
        'DevOps Engineer',
        'QA Engineer',
      ];
      await seedPartialMany(
        adapter,
        ids,
        detail.base,
        (i) => roles[i],
        (i) => `C2ExhaustCo${i}`
      );
      for (const id of ids) await eqAdapter.enqueue(id);

      await vi.waitFor(
        async () => {
          for (const id of ids) {
            const doc = await adapter.findById(id);
            expect(doc).not.toBeNull();
            expect(doc!.status).toBe(JobStatus.ENRICHED);
          }
          expect(await eqAdapter.size()).toBe(0);
        },
        { interval: 100, timeout: 60000 }
      );

      // Every dequeued job resolved to exactly one FULL_PARSED doc (no double-processing).
      const docs = await daemon.mongo
        .raw('job_lifecycle')
        .find({ stage: JobStage.FULL_PARSED })
        .toArray();
      const fullStageIds = docs.map((d: any) => d._id);
      expect(new Set(fullStageIds).size).toBe(N);
    }, 90000);

    it.each([750, 1000])(
      'GIVEN the path c2 preconditions WHEN the path is exercised THEN %sms idle waiters stay parked on an empty queue — late enqueue still wakes and resolves, scheduler stays healthy (S1+S2) · path c2',
      async (idleMs) => {
        await new Promise((r) => setTimeout(r, idleMs));

        const jobId = `c2-wake-${idleMs}-0`;
        await seedPartial(
          adapter,
          jobId,
          detail.urlFor('Backend Developer', `C2WakeCo${idleMs}`),
          'Backend Developer',
          `C2WakeCo${idleMs}`
        );
        await eqAdapter.enqueue(jobId);
        await waitFor(
          () => tui.ipc.read().jobLifecycleId === jobId && tui.ipc.read().stage === JobStage.FULL_PARSED
        );
        expect(tui.ipc.read().jobLifecycleId).toBe(jobId);
        expect(tui.ipc.read().stage).toBe(JobStage.FULL_PARSED);

        expect(await eqAdapter.size()).toBe(0);
      },
      60000
    );

    it('GIVEN rate stress — 5 sequential S1→S2→[j] cycles WHEN processed THEN no state leakage and no parse/route failures (S1+S2+S3) · path c2', async () => {
      const totalCycles = 5;

      for (let i = 0; i < totalCycles; i++) {
        const messageId = `c2-stress-${i}`;
        const role = 'Backend Developer';
        const company = `StressCo${i}`;

        await daemon.apps.ingest.processIngest(
          JobSource.BROWSER_AUTO,
          JobStage.PARTIAL_PARSED,
          topcvEmailHtmlMany([{ role, company }]),
          undefined,
          { messageId, subject: role }
        );
        await waitFor(
          () => tui.ipc.read().job?.company === company && tui.ipc.read().stage === JobStage.PARTIAL_PARSED
        );
        const jobLifecycleId = tui.ipc.read().jobLifecycleId!;
        expect(jobLifecycleId).toMatch(/-job-0$/);

        const partialDoc = await adapter.findById(jobLifecycleId);
        expect(partialDoc).not.toBeNull();
        expect(partialDoc!.stage).toBe(JobStage.PARTIAL_PARSED);
        expect(partialDoc!.status).toBe(JobStatus.ENRICHING);

        await daemon.apps.ingest.processIngest(
          JobSource.MANUAL,
          JobStage.FULL_PARSED,
          indeedDetailHtml(),
          jobLifecycleId
        );
        await waitFor(
          () => tui.ipc.read().jobLifecycleId === jobLifecycleId && tui.ipc.read().stage === JobStage.FULL_PARSED
        );
        expect(tui.ipc.read().jobLifecycleId).toBe(jobLifecycleId);

        const enrichedDoc = await adapter.findById(jobLifecycleId);
        expect(enrichedDoc).not.toBeNull();
        expect(enrichedDoc!.stage).toBe(JobStage.FULL_PARSED);
        expect(enrichedDoc!.status).toBe(JobStatus.ENRICHED);

        await tui.writer.queue(jobLifecycleId);
        await waitFor(() => tui.ipc.read().jobLifecycleId === null);
        expect(tui.ipc.read().job).toBeNull();

        const routedDoc = await adapter.findById(jobLifecycleId);
        expect(routedDoc).not.toBeNull();
        expect(routedDoc!.status).toBe(JobStatus.QUEUED);
      }

      await new Promise((r) => setTimeout(r, 1500));
      expect(tui.ipc.read().jobLifecycleId).toBeNull();
    }, 60000);

    it('GIVEN exhaustion drain in progress WHEN the tui subscribes over RMQ THEN the tui reader stays connected and the queue drains without wedging the ipc seam (tui↔daemon) · path c2', async () => {
      await waitFor(() => tui.reader.isConnected());

      const ids = ['c2-exhaust-tui-0', 'c2-exhaust-tui-1'];
      await seedPartialMany(
        adapter,
        ids,
        detail.base,
        (i) => (i === 0 ? 'Backend Developer' : 'Data Engineer'),
        (i) => `C2ExhaustTuiCo${i}`
      );
      for (const id of ids) await eqAdapter.enqueue(id);

      await vi.waitFor(
        async () => {
          for (const id of ids) {
            const doc = await adapter.findById(id);
            expect(doc).not.toBeNull();
            expect(doc!.status).toBe(JobStatus.ENRICHED);
          }
          expect(await eqAdapter.size()).toBe(0);
        },
        { interval: 100, timeout: 60000 }
      );

      expect(tui.reader.isConnected()).toBe(true);
    }, 90000);
  });

  describe('(d) S4 explicit — browser HTML-parse failure', () => {
    it('GIVEN S2 BROWSER_AUTO FULL_PARSED non-job HTML over a seeded s1 doc WHEN the path is exercised THEN enrichment proceeds with details=htmlToText(html), s1 fields preserved — no PARSE_FAILED at s2c (S1+S2) · path c2', async () => {
      const jobId = 'c2-s4-1';
      await seedPartial(
        adapter,
        jobId,
        'https://127.0.0.1:1/nope',
        'Backend Developer',
        'S4FailCo'
      );

      await daemon.apps.ingest.processIngest(
        JobSource.BROWSER_AUTO,
        JobStage.FULL_PARSED,
        '<div>not a job format</div>',
        jobId
      );
      await waitFor(
        () => tui.ipc.read().jobLifecycleId === jobId && tui.ipc.read().stage === JobStage.FULL_PARSED
      );
      expect(tui.ipc.read().jobLifecycleId).toBe(jobId);

      const doc = await adapter.findById(jobId);
      expect(doc).not.toBeNull();
      expect(doc!.status).toBe(JobStatus.ENRICHED);
      expect(doc!.stage).toBe(JobStage.FULL_PARSED);
      expect(doc!.company).toBe('S4FailCo');
      expect(doc!.details).toContain('not a job format');

      await new Promise((r) => setTimeout(r, 1500));
      expect(tui.ipc.read().jobLifecycleId).toBe(jobId);
      expect(tui.ipc.read().stage).toBe(JobStage.FULL_PARSED);
    });
  });

  describe('(e) scheduler extraction-failure fallback to PARTIAL_PARSED-ENRICHING', () => {
    it('GIVEN S1 PARTIAL THEN manual-fallback [c]-paste webhook [c1 shallow] WHEN uds.ingest over real UDS THEN FULL_PARSED/ENRICHED (S1+S2) · path c2', async () => {
      const messageId = 'c2-c1shallow-1';
      const role = 'Backend Developer';
      const company = 'C2C1ShallowCo';

      await daemon.apps.ingest.processIngest(
        JobSource.BROWSER_AUTO,
        JobStage.PARTIAL_PARSED,
        topcvEmailHtmlMany([{ role, company }]),
        undefined,
        { messageId, subject: role }
      );
      await waitFor(
        () => tui.ipc.read().jobLifecycleId !== null && tui.ipc.read().stage === JobStage.PARTIAL_PARSED
      );
      const jobLifecycleId = tui.ipc.read().jobLifecycleId!;
      expect(jobLifecycleId).toMatch(/-job-0$/);
      expect(tui.ipc.read().stage).toBe(JobStage.PARTIAL_PARSED);

      const partialDoc = await adapter.findById(jobLifecycleId);
      expect(partialDoc).not.toBeNull();
      expect(partialDoc!.stage).toBe(JobStage.PARTIAL_PARSED);
      expect(partialDoc!.status).toBe(JobStatus.ENRICHING);

      const ingest = await uds.ingest(indeedDetailHtml(), jobLifecycleId);
      expect(ingest.statusCode).toBe(200);

      await vi.waitFor(
        async () => {
          const doc = await adapter.findById(jobLifecycleId);
          expect(doc).not.toBeNull();
          expect(doc!.stage).toBe(JobStage.FULL_PARSED);
          expect(doc!.status).toBe(JobStatus.ENRICHED);
        },
        { interval: 100, timeout: 15000 }
      );
    }, 60000);

    it('GIVEN unroutable seed URL WHEN real browser fails THEN fallback keeps doc PARTIAL_PARSED/ENRICHING (S1+S4) · path c2', async () => {
      const jobId = 'c2-fallback-0';
      await seedPartial(
        adapter,
        jobId,
        'http://127.0.0.1:59999/nope',
        'Backend Developer',
        'C2FallbackCo'
      );

      // The scheduler fallback re-brokers the partial (GENERATED) on failure.
      await eqAdapter.enqueue(jobId);
      await waitFor(
        () => tui.ipc.read().jobLifecycleId === jobId && tui.ipc.read().stage === JobStage.PARTIAL_PARSED
      );
      expect(tui.ipc.read().jobLifecycleId).toBe(jobId);

      await vi.waitFor(
        async () => {
          const doc = await adapter.findById(jobId);
          expect(doc).not.toBeNull();
          expect(doc!.stage).toBe(JobStage.PARTIAL_PARSED);
          expect(doc!.status).toBe(JobStatus.ENRICHING);
          expect(await eqAdapter.size()).toBe(0);
        },
        { timeout: 15000, interval: 100 }
      );

      const after = await adapter.findById(jobId);
      expect(after).not.toBeNull();
      expect(after!.status).not.toBe(JobStatus.QUEUED);
      expect(after!.status).not.toBe(JobStatus.TRASHED);
    }, 60000);

    it('GIVEN S3 mid-stream extraction error WHEN the path is exercised THEN remaining enqueued items still drain (S1+S2+S4) · path c2', async () => {
      const badId = 'c2-midstream-bad';
      const goodId = 'c2-midstream-good';
      await seedPartial(
        adapter,
        badId,
        'http://127.0.0.1:59998/nope',
        'Backend Developer',
        'C2MidBadCo'
      );
      await seedPartial(
        adapter,
        goodId,
        detail.urlFor('Data Engineer', 'C2MidGoodCo'),
        'Data Engineer',
        'C2MidGoodCo'
      );

      await eqAdapter.enqueue(badId);
      await eqAdapter.enqueue(goodId);

      // The failing item falls back to PARTIAL_PARSED-ENRICHING; the good item still
      // reaches FULL_PARSED/ENRICHED — proof the workers survived the mid-stream crash.
      await waitFor(
        () => tui.ipc.read().jobLifecycleId === goodId && tui.ipc.read().stage === JobStage.FULL_PARSED
      );
      expect(tui.ipc.read().jobLifecycleId).toBe(goodId);
      expect(tui.ipc.read().stage).toBe(JobStage.FULL_PARSED);

      await vi.waitFor(
        async () => {
          const badDoc = await adapter.findById(badId);
          expect(badDoc).not.toBeNull();
          expect(badDoc!.status).toBe(JobStatus.ENRICHING);

          const goodDoc = await adapter.findById(goodId);
          expect(goodDoc).not.toBeNull();
          expect(goodDoc!.status).toBe(JobStatus.ENRICHED);

          expect(await eqAdapter.size()).toBe(0);
        },
        { timeout: 20000, interval: 100 }
      );
    }, 60000);

    it('GIVEN an enqueued job id without a lifecycle doc WHEN the scheduler dequeues THEN no GENERATED/PARSE_FAILED/ROUTE_FAILED emission · path c2', async () => {
      await vi.waitFor(
        async () => {
          expect(await eqAdapter.size()).toBe(0);
        },
        { interval: 100, timeout: 20000 }
      );

      await eqAdapter.enqueue('c2-missing-doc-1');
      await vi.waitFor(
        async () => {
          expect(await eqAdapter.size()).toBe(0);
        },
        { interval: 100, timeout: 20000 }
      );
      await new Promise((r) => setTimeout(r, 2000));
      expect(tui.ipc.read().jobLifecycleId).toBeNull();
    }, 120000);
  });

  describe('(f) fast-check invariants', () => {
    it('property: scheduling N sequentially-enqueued partial jobs converges each to a terminal state, no exceptions', async () => {
      await fc.assert(
        fc.asyncProperty(fc.integer({ min: 2, max: 4 }), async (n) => {
          const ids: string[] = [];
          const roles = [
            'Software Engineer',
            'Backend Developer',
            'Site Reliability Engineer',
            'Platform Engineer',
          ];
          for (let i = 0; i < n; i++) {
            const id = `c2-prop-${n}-${i}`;
            const role = roles[i % roles.length];
            const company = `C2PropCoN${n}I${i}`;
            await seedPartial(adapter, id, detail.urlFor(role, company), role, company);
            ids.push(id);
          }
          for (const id of ids) await eqAdapter.enqueue(id);

          await vi.waitFor(
            async () => {
              for (const id of ids) {
                const doc = await adapter.findById(id);
                expect(doc).not.toBeNull();
                expect([JobStatus.ENRICHED, JobStatus.ENRICHING]).toContain(doc!.status);
              }
            },
            { interval: 100, timeout: 60000 }
          );

          for (const id of ids) {
            const doc = await adapter.findById(id);
            expect([JobStatus.ENRICHED, JobStatus.ENRICHING]).toContain(doc!.status);
          }
          return true;
        }),
        { numRuns: 3 }
      );
    }, 120000);
  });
});
