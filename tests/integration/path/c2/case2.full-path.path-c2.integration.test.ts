/* Path cell (c2): full browser-extraction-to-resolution cycle — S2 direct arrival,
   S1→S2 merge via cluster-paste webhook, S3 real scheduler + Playwright full-parse,
   queue exhaustion/fairness, extraction-failure fallback, fast-check invariants
   (consolidated: case2.browser-full-parsed / extraction-exhaustion /
   extraction-scheduler / extraction-pipeline). See plans/tests-path-matrix.md.
   All boundaries cross the REAL UDS socket; the production composition root
 * GWT cause-effect (path c2): GIVEN email S1 with URL WHEN scheduler+Playwright S2 full parse + [j]/[d] UDS action
 *   THEN S3 QUEUED + real pdf / S4 TRASHED, with S3 drain + extraction-failure fallbacks (checkpoint contract §1).
   provides the real ingestor, scheduler, Playwright browser, RMQ events and the
   AssetProducingAdapter rendering PDFs into tc.assetDir (see test-container.ts). */
import fs from 'node:fs';
import http from 'node:http';

import fc from 'fast-check';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

import { ActionEvent } from '../../../../src/domain/types/action-event.js';
import { JobStage, JobSource, JobStatus } from '../../../../src/domain/types/job-lifecycle.js';
import type { JobLifecyclePort } from '../../../../src/application/ports/job-lifecycle.port.js';
import type { ExtractionQueuePort } from '../../../../src/application/ports/extraction-queue.port.js';
import { udsHelpers } from '../../../helpers/e2e-harness.js';
import { indeedEmailHtmlMany, indeedDetailHtml } from '../../../helpers/html-fixtures.js';
import { makeStage1Partial } from '../../../helpers/test-builders.js';
import { createTestContainer, type TestContainer } from '../../../helpers/test-container.js';

const UDS_TOKEN = 'e2e-internal-token';

const FULL_PARSED_HTML = indeedDetailHtml(
  'Backend Developer',
  'FullParsedCo',
  'https://vn.indeed.com/viewjob?jk=e2e-c2-full'
);

const MERGE_EMAIL_HTML = indeedEmailHtmlMany([
  {
    role: 'Backend Developer',
    company: 'MergeCo',
    url: 'https://vn.indeed.com/viewjob?jk=e2e-c2-merge',
  },
]);

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

function waitForPdfFiles(dir: string, timeoutMs = 20000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const poll = () => {
      try {
        const files = fs.readdirSync(dir).filter((f) => f.endsWith('.pdf'));
        if (files.length > 0) return resolve();
      } catch {
        /* dir may not be created yet */
      }
      if (Date.now() - start > timeoutMs)
        return reject(new Error(`Timeout waiting for pdf asset in ${dir}`));
      setTimeout(poll, 250);
    };
    poll();
  });
}

describe('c2 browser extraction + resolution cycle', () => {
  let tc: TestContainer;
  let adapter: JobLifecyclePort;
  let eqAdapter: ExtractionQueuePort;
  let detail: DetailServer;
  let uds: ReturnType<typeof udsHelpers>;

  beforeAll(async () => {
    tc = await createTestContainer({ ns: 'c2-full-path', startScheduler: true });
    await tc.start();
    adapter = tc.mongoJobLifecycleAdapter;
    eqAdapter = tc.extractionQueueAdapter;
    uds = udsHelpers(tc.socket, UDS_TOKEN);
    detail = await startDetailServer();
  }, 120000);

  afterAll(async () => {
    try {
      await detail.close();
    } catch {
      /* best-effort */
    }
    try {
      await tc.stop();
    } catch {
      /* best-effort */
    }
  });

  beforeEach(async () => {
    await tc.storage.clearDb();
  });

  describe('(a) S2 full direct arrival — Queue[j] / trash[d]', () => {
    it('GIVEN S2 BROWSER_AUTO FULL_PARSED arrival WHEN parse events → [j] over UDS THEN QUEUED + pdf asset (S1+S2+S3) · path c2', async () => {
      const jobLifecycleId = 'e2e-c2-full-arrival';

      const gen = await tc.bus.setup([ActionEvent.GENERATED]);
      const comp = await tc.bus.setup([ActionEvent.PARSE_COMPLETED]);
      await tc.ingestor.processIngest(
        JobSource.BROWSER_AUTO,
        JobStage.FULL_PARSED,
        FULL_PARSED_HTML,
        jobLifecycleId
      );

      const genMsg = await gen.msg();
      expect(genMsg).toBeDefined();

      const compMsg = await comp.msg();
      expect(compMsg.job).toBeDefined();
      expect(compMsg.job._id).toBe(jobLifecycleId);
      expect(compMsg.job.stage).toBe(JobStage.FULL_PARSED);
      expect(compMsg.job.status).toBe(JobStatus.ENRICHED);

      const doc = await adapter.findById(jobLifecycleId);
      expect(doc).not.toBeNull();
      expect(doc!.stage).toBe(JobStage.FULL_PARSED);
      expect(doc!.status).toBe(JobStatus.ENRICHED);

      const queue = await tc.bus.setup([
        ActionEvent.QUEUED,
        ActionEvent.TRASHED,
        ActionEvent.ROUTE_FAILED,
      ]);
      const jRes = await uds.action(jobLifecycleId, 'queue');
      expect(jRes.statusCode).toBe(200);

      const queueMsg = await queue.msg();
      expect(queueMsg.jobLifecycleId).toBe(jobLifecycleId);

      await waitForPdfFiles(tc.assetDir);

      const queuedDoc = await adapter.findById(jobLifecycleId);
      expect(queuedDoc).not.toBeNull();
      expect(queuedDoc!.stage).toBe(JobStage.FULL_PARSED);
      expect(queuedDoc!.status).toBe(JobStatus.QUEUED);
    }, 60000);

    it('GIVEN S2 BROWSER_AUTO FULL_PARSED arrival WHEN [d] over UDS THEN TRASHED (S2+S3) · path c2', async () => {
      const jobLifecycleId = 'e2e-c2-full-trash';

      const comp = await tc.bus.setup([ActionEvent.PARSE_COMPLETED]);
      await tc.ingestor.processIngest(
        JobSource.BROWSER_AUTO,
        JobStage.FULL_PARSED,
        FULL_PARSED_HTML,
        jobLifecycleId
      );

      const compMsg = await comp.msg();
      expect(compMsg.job).toBeDefined();
      expect(compMsg.job._id).toBe(jobLifecycleId);
      expect(compMsg.job.status).toBe(JobStatus.ENRICHED);

      const trash = await tc.bus.setup([
        ActionEvent.TRASHED,
        ActionEvent.ROUTE_FAILED,
        ActionEvent.PARSE_FAILED,
      ]);
      const dRes = await uds.action(jobLifecycleId, 'trash');
      expect(dRes.statusCode).toBe(200);

      const trashMsg = await trash.msg();
      expect(trashMsg.jobLifecycleId).toBe(jobLifecycleId);
      expect(trashMsg.reason).toBe('operator:trash');

      const trashedDoc = await adapter.findById(jobLifecycleId);
      expect(trashedDoc).not.toBeNull();
      expect(trashedDoc!.stage).toBe(JobStage.FULL_PARSED);
      expect(trashedDoc!.status).toBe(JobStatus.TRASHED);
    }, 60000);

    it('GIVEN an S2 browser auto FULL_PARSED input WHEN an ingest signal is processed THEN S2 BROWSER_AUTO FULL_PARSED without jobLifecycleId auto-creates browser-auto-* doc (S2) · path c2', async () => {
      await tc.ingestor.processIngest(
        JobSource.BROWSER_AUTO,
        JobStage.FULL_PARSED,
        FULL_PARSED_HTML
      );

      const col = tc.db.collection('job_lifecycle');
      const docs = await col.find({}).toArray();
      expect(docs.length).toBe(1);
      expect(docs[0]._id).toMatch(/^browser-auto-/);
      expect(docs[0].role).toBe('Backend Developer');
      expect(docs[0].company).toBe('FullParsedCo');
      expect(docs[0].stage).toBe(JobStage.FULL_PARSED);
      expect(docs[0].status).toBe(JobStatus.ENRICHED);
    });
  });

  describe('(b) signal1 → signal2 cluster-merge → [j] (no scheduler)', () => {
    let tcB: TestContainer;
    let adapterB: JobLifecyclePort;
    let eqB: ExtractionQueuePort;
    let udsB: ReturnType<typeof udsHelpers>;

    beforeAll(async () => {
      tcB = await createTestContainer({ ns: 'c2-merge-def' });
      await tcB.start();
      adapterB = tcB.mongoJobLifecycleAdapter;
      eqB = tcB.extractionQueueAdapter;
      udsB = udsHelpers(tcB.socket, UDS_TOKEN);
    }, 120000);

    afterAll(async () => {
      await tcB.stop();
    });

    beforeEach(async () => {
      await tcB.storage.clearDb();
    });

    it('GIVEN signal1 partial with Indeed URL WHEN the path is exercised THEN doc PARTIAL/ENRICHING, deferred to extraction queue (no generated) (S1) · path c2', async () => {
      const messageId = 'e2e-c2-merge-sig1';
      const jobLifecycleId = `${messageId}-job-0`;

      const gen = await tcB.bus.setup([ActionEvent.GENERATED], 3000);
      await tcB.ingestor.processIngest(
        JobSource.BROWSER_AUTO,
        JobStage.PARTIAL_PARSED,
        MERGE_EMAIL_HTML,
        undefined,
        {
          messageId,
          subject: 'Indeed Job Alert - Backend Developer',
        }
      );

      await expect(gen.msg()).rejects.toThrow();

      const doc = await adapterB.findById(jobLifecycleId);
      expect(doc).not.toBeNull();
      expect(doc!.stage).toBe(JobStage.PARTIAL_PARSED);
      expect(doc!.status).toBe(JobStatus.ENRICHING);
      expect(doc!.role).toBe('Backend Developer');

      const queueSize = await eqB.size();
      expect(queueSize).toBe(1);
    });

    it('GIVEN signal1 partial WHEN [c]-style cluster-paste webhook (UDS /internal/ingest) → FULL_PARSED → [j] via UDS THEN QUEUED + pdf (S1+S2+S3) · path c2', async () => {
      const messageId = 'e2e-c2-merge-paste';
      const jobLifecycleId = `${messageId}-job-0`;

      await tcB.ingestor.processIngest(
        JobSource.BROWSER_AUTO,
        JobStage.PARTIAL_PARSED,
        MERGE_EMAIL_HTML,
        undefined,
        {
          messageId,
          subject: 'Indeed Job Alert - Backend Developer',
        }
      );

      const partialDoc = await adapterB.findById(jobLifecycleId);
      expect(partialDoc).not.toBeNull();
      expect(partialDoc!.stage).toBe(JobStage.PARTIAL_PARSED);
      expect(partialDoc!.status).toBe(JobStatus.ENRICHING);

      // Cluster-paste (signal-2 webhook) through the real UDS /internal/ingest?webhook=true.
      const comp = await tcB.bus.setup([ActionEvent.PARSE_COMPLETED]);
      const cRes = await udsB.ingest(
        indeedDetailHtml('Backend Developer', 'MergeCo'),
        jobLifecycleId
      );
      expect(cRes.statusCode).toBe(200);

      const compMsg = await comp.msg();
      expect(compMsg.job).toBeDefined();
      expect(compMsg.job._id).toBe(jobLifecycleId);
      expect(compMsg.job.stage).toBe(JobStage.FULL_PARSED);
      expect(compMsg.job.status).toBe(JobStatus.ENRICHED);
      expect(compMsg.job.company).toBe('MergeCo');

      const fullDoc = await adapterB.findById(jobLifecycleId);
      expect(fullDoc).not.toBeNull();
      expect(fullDoc!.stage).toBe(JobStage.FULL_PARSED);
      expect(fullDoc!.status).toBe(JobStatus.ENRICHED);

      const queue = await tcB.bus.setup([
        ActionEvent.QUEUED,
        ActionEvent.TRASHED,
        ActionEvent.ROUTE_FAILED,
      ]);
      const jRes = await udsB.action(jobLifecycleId, 'queue');
      expect(jRes.statusCode).toBe(200);

      const queueMsg = await queue.msg();
      expect(queueMsg.jobLifecycleId).toBe(jobLifecycleId);

      await waitForPdfFiles(tcB.assetDir);

      const queuedDoc = await adapterB.findById(jobLifecycleId);
      expect(queuedDoc).not.toBeNull();
      expect(queuedDoc!.status).toBe(JobStatus.QUEUED);
    }, 60000);
  });

  describe('(c) S3 scheduler real-browser full-parse', () => {
    it('GIVEN seed PARTIAL WHEN real scheduler+Playwright dequeue → local server extraction THEN FULL_PARSED/ENRICHED (S1+S2) · path c2', async () => {
      const jobId = 'c2-sched-full-0';
      await seedPartial(
        adapter,
        jobId,
        detail.urlFor('Backend Developer', 'C2SchedFullCo'),
        'Backend Developer',
        'C2SchedFullCo'
      );

      const gen = await tc.bus.setup([ActionEvent.GENERATED]);
      const comp = await tc.bus.setup([ActionEvent.PARSE_COMPLETED]);
      await eqAdapter.enqueue(jobId);

      const genMsg = await gen.msg();
      expect(genMsg._id).toBe(jobId);
      expect(genMsg.role).toBe('Backend Developer');
      expect(genMsg.company).toBe('C2SchedFullCo');

      const compMsg = await comp.msg();
      expect(compMsg.job).toBeDefined();
      expect(compMsg.job._id).toBe(jobId);
      expect(compMsg.job.stage).toBe(JobStage.FULL_PARSED);
      expect(compMsg.job.status).toBe(JobStatus.ENRICHED);
      expect(compMsg.job.company).toBe('C2SchedFullCo');

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

      const comp = await tc.bus.setup([ActionEvent.PARSE_COMPLETED]);
      await eqAdapter.enqueue(jobId);

      const compMsg = await comp.msg();
      expect(compMsg.job).toBeDefined();
      expect(compMsg.job._id).toBe(jobId);
      expect(compMsg.job.status).toBe(JobStatus.ENRICHED);

      const queue = await tc.bus.setup([
        ActionEvent.QUEUED,
        ActionEvent.TRASHED,
        ActionEvent.ROUTE_FAILED,
      ]);
      await uds.action(jobId, 'queue');
      const queueMsg = await queue.msg();
      expect(queueMsg.jobLifecycleId).toBe(jobId);

      await waitForPdfFiles(tc.assetDir);

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
      const comp2 = await tc.bus.setup([ActionEvent.PARSE_COMPLETED]);
      await eqAdapter.enqueue(jobId2);

      const comp2Msg = await comp2.msg();
      expect(comp2Msg.job).toBeDefined();
      expect(comp2Msg.job._id).toBe(jobId2);
      expect(comp2Msg.job.status).toBe(JobStatus.ENRICHED);
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

      const comp = await tc.bus.setup([ActionEvent.PARSE_COMPLETED]);
      await eqAdapter.enqueue(jobId);

      const compMsg = await comp.msg();
      expect(compMsg.job).toBeDefined();
      expect(compMsg.job._id).toBe(jobId);
      expect(compMsg.job.status).toBe(JobStatus.ENRICHED);

      const trash = await tc.bus.setup([
        ActionEvent.TRASHED,
        ActionEvent.ROUTE_FAILED,
        ActionEvent.PARSE_FAILED,
      ]);
      await uds.action(jobId, 'trash');
      const trashMsg = await trash.msg();
      expect(trashMsg.jobLifecycleId).toBe(jobId);
      expect(trashMsg.reason).toBe('operator:trash');

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
      const comp2 = await tc.bus.setup([ActionEvent.PARSE_COMPLETED]);
      await eqAdapter.enqueue(jobId2);

      const comp2Msg = await comp2.msg();
      expect(comp2Msg.job).toBeDefined();
      expect(comp2Msg.job._id).toBe(jobId2);
      expect(comp2Msg.job.status).toBe(JobStatus.ENRICHED);
    }, 60000);
  });

  describe('(d) scheduler empty-queue drains + exhaustion/fairness', () => {
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
      const docs = await tc.db
        .collection('job_lifecycle')
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
        const comp = await tc.bus.setup([ActionEvent.PARSE_COMPLETED]);
        await eqAdapter.enqueue(jobId);

        const compMsg = await comp.msg();
        expect(compMsg.job).toBeDefined();
        expect(compMsg.job._id).toBe(jobId);
        expect(compMsg.job.status).toBe(JobStatus.ENRICHED);

        expect(await eqAdapter.size()).toBe(0);
      },
      60000
    );
  });

  describe('(f) S4 explicit — browser HTML-parse failure', () => {
    it('GIVEN S2 BROWSER_AUTO FULL_PARSED garbage HTML WHEN the path is exercised THEN PARSE_FAILED emitted, seeded doc stays ENRICHING (S1+S2+S4) · path c2', async () => {
      const jobId = 'c2-s4-1';
      await seedPartial(
        adapter,
        jobId,
        'https://127.0.0.1:1/nope',
        'Backend Developer',
        'S4FailCo'
      );

      const fail = await tc.bus.setup([ActionEvent.PARSE_FAILED]);
      await tc.ingestor.processIngest(
        JobSource.BROWSER_AUTO,
        JobStage.FULL_PARSED,
        '<div>not a job format</div>',
        jobId
      );

      const failMsg = await fail.msg();
      expect(failMsg.jobLifecycleId).toBe(jobId);

      const doc = await adapter.findById(jobId);
      expect(doc).not.toBeNull();
      expect(doc!.status).toBe(JobStatus.ENRICHING);
      expect(doc!.stage).toBe(JobStage.PARTIAL_PARSED);
    });
  });

  describe('(e) scheduler extraction-failure fallback to PARTIAL_PARSED-ENRICHING', () => {
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
      const gen = await tc.bus.setup([ActionEvent.GENERATED]);
      await eqAdapter.enqueue(jobId);

      const genMsg = await gen.msg();
      expect(genMsg._id).toBe(jobId);

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

      const comp = await tc.bus.setup([ActionEvent.PARSE_COMPLETED]);
      await eqAdapter.enqueue(badId);
      await eqAdapter.enqueue(goodId);

      // The failing item falls back to PARTIAL_PARSED-ENRICHING; the good item still
      // reaches FULL_PARSED/ENRICHED — proof the workers survived the mid-stream crash.
      const compMsg = await comp.msg();
      expect(compMsg.job).toBeDefined();
      expect(compMsg.job._id).toBe(goodId);
      expect(compMsg.job.status).toBe(JobStatus.ENRICHED);

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
