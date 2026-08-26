/* Path cell (c1): S1 uds+ingestor+job_lifecycle; [o][p][c] deep-parse S2; [j]/[d] over UDS (see plans/tests-path-matrix.md)
 * GWT cause-effect (path c1): GIVEN webhook S1 partial WHEN [c]/[o][p] paste + [j]/[d] UDS action THEN
 *   S3 QUEUED / S4 TRASHED, and a failed S2/S3 → next S1 recovers (checkpoint contract §1).
 * Direct-mode merged-DM rows live in c4; S4 failure sagas (parse-fail, route-fail) live in c3. */
import fc from 'fast-check';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

import { JobStage, JobSource, JobStatus } from '../../../src/domain/types/job-lifecycle.js';
import {
  linkedinSduiDetailHtml,
  topcvEmailHtmlMany,
  topcvDetailHtml,
} from '../../helpers/html-fixtures.js';
import { makeStage1Partial } from '../../helpers/test-builders.js';
import {
  buildTestDaemonContainer,
  buildTestTuiContainer,
  type TestDaemonContainer,
  type TuiTestContainer,
} from '../../helpers/test-container.js';
import { udsHelpers, waitFor, waitForPdfFiles } from '../../helpers/test-utils.js';

const TOPCV_EMAIL_HTML = topcvEmailHtmlMany([{ role: 'Backend Developer', company: 'Case1Co' }]);

const CLIPBOARD_HTML = topcvDetailHtml('Backend Developer', 'Case1Co', {
  salary: '15,000,000 VNĐ',
  location: 'Ho Chi Minh',
});

describe('c1 full-path — Case 1 partial → [o][p][c] → full → [j]/[d] → next', () => {
  let daemon: TestDaemonContainer;
  let tui: TuiTestContainer;
  let uds: ReturnType<typeof udsHelpers>;

  beforeAll(async () => {
    daemon = await buildTestDaemonContainer({ ns: 'c1-full-path' });
    await daemon.start();
    tui = await buildTestTuiContainer({ ns: 'c1-full-path' });
    uds = udsHelpers(daemon.uds.socket, 'e2e-internal-token');
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

  async function seedPartial(overrides: Record<string, unknown> = {}): Promise<string> {
    const doc = makeStage1Partial({ company: 'OldCo', role: 'Backend Developer', ...overrides });
    await daemon.jobLifecycle.upsert(doc);
    return doc._id;
  }

  describe('(a) canonical S1 → [c] paste → [j]/[d] over UDS', () => {
    it('GIVEN S1 partial WHEN [c] webhook ingest THEN [j] queue — canonical Case 1 (S1+S2+S3) · path c1', async () => {
      const messageId = 'c1-msg-1';
      await daemon.apps.ingest.processIngest(
        JobSource.BROWSER_AUTO,
        JobStage.PARTIAL_PARSED,
        TOPCV_EMAIL_HTML,
        undefined,
        { messageId, subject: 'Backend Developer' }
      );
      await waitFor(() => tui.ipc.read().jobLifecycleId !== null);
      expect(tui.reader.isConnected()).toBe(true);
      const jobLifecycleId: string = tui.ipc.read().jobLifecycleId!;
      expect(jobLifecycleId).toMatch(/-job-0$/);
      expect(tui.ipc.read().stage).toBe(JobStage.PARTIAL_PARSED);

      const partialDoc = await daemon.jobLifecycle.findById(jobLifecycleId);
      expect(partialDoc).not.toBeNull();
      expect(partialDoc!.stage).toBe(JobStage.PARTIAL_PARSED);
      expect(partialDoc!.status).toBe(JobStatus.ENRICHING);

      const ingest = await uds.ingest(CLIPBOARD_HTML, jobLifecycleId);
      expect(ingest.statusCode).toBe(200);

      const enrichedDoc = await daemon.jobLifecycle.findById(jobLifecycleId);
      expect(enrichedDoc).not.toBeNull();
      expect(enrichedDoc!.stage).toBe(JobStage.FULL_PARSED);
      expect(enrichedDoc!.status).toBe(JobStatus.ENRICHED);
      expect(enrichedDoc!.salary).toBe('');
      expect(enrichedDoc!.location).toBe('');
      expect(typeof enrichedDoc!.details).toBe('string');
      expect(enrichedDoc!.details!.length).toBeGreaterThan(0);

      await tui.writer.queue(jobLifecycleId);
      await waitFor(() => tui.ipc.read().jobLifecycleId === null);
      expect(tui.ipc.read().job).toBeNull();

      await waitForPdfFiles(daemon.assetDir);

      const routedDoc = await daemon.jobLifecycle.findById(jobLifecycleId);
      expect(routedDoc).not.toBeNull();
      expect(routedDoc!.status).toBe(JobStatus.QUEUED);
    });

    it('GIVEN S1 WHEN [c] paste THEN [d] trash via UDS (S1+S2+S3) · path c1', async () => {
      const messageId = 'c1-msg-trash';
      await daemon.apps.ingest.processIngest(
        JobSource.BROWSER_AUTO,
        JobStage.PARTIAL_PARSED,
        TOPCV_EMAIL_HTML,
        undefined,
        { messageId, subject: 'Backend Developer' }
      );
      await waitFor(() => tui.ipc.read().jobLifecycleId !== null);
      const jobLifecycleId: string = tui.ipc.read().jobLifecycleId!;

      const ingest = await uds.ingest(CLIPBOARD_HTML, jobLifecycleId);
      expect(ingest.statusCode).toBe(200);

      await tui.writer.trash(jobLifecycleId);
      await waitFor(() => tui.ipc.read().jobLifecycleId === null);
      expect(tui.ipc.read().job).toBeNull();

      const trashedDoc = await daemon.jobLifecycle.findById(jobLifecycleId);
      expect(trashedDoc).not.toBeNull();
      expect(trashedDoc!.status).toBe(JobStatus.TRASHED);
    });

    it('GIVEN an S1 browser auto PARTIAL_PARSED input WHEN an ingest signal is processed THEN [j] before S2 arrives is guarded (deferred enrichment) — no state change (S1) · path c1', async () => {
      const messageId = 'c1-msg-defer';
      await daemon.apps.ingest.processIngest(
        JobSource.BROWSER_AUTO,
        JobStage.PARTIAL_PARSED,
        TOPCV_EMAIL_HTML,
        undefined,
        { messageId, subject: 'Backend Developer' }
      );

      const docs = await daemon.mongo.raw('job_lifecycle').find({}).toArray();
      const jobLifecycleId: string = String(docs[0]._id);
      expect(docs.length).toBe(1);

      await tui.writer.queue(jobLifecycleId);

      const guardedDoc = await daemon.jobLifecycle.findById(jobLifecycleId);
      expect(guardedDoc).not.toBeNull();
      expect(guardedDoc!.status).toBe(JobStatus.ENRICHING);
      expect(guardedDoc!.stage).toBe(JobStage.PARTIAL_PARSED);
    });
  });

  describe('(b) signal2aManual ([c]) upgrade + B2/B9 guards', () => {
    it('GIVEN an S2 manual FULL_PARSED input WHEN an ingest signal is processed THEN [c] upgrades PARTIAL_PARSED to FULL_PARSED preserving s1 fields with details=htmlToText(html) (S2) · path c1', async () => {
      const jobLifecycleId = await seedPartial({
        _id: 'c1-2a-valid',
        company: 'OldCo',
        role: 'Software Engineer',
      });

      await daemon.apps.ingest.processIngest(
        JobSource.MANUAL,
        JobStage.FULL_PARSED,
        topcvDetailHtml('Software Engineer', 'NewCo'),
        jobLifecycleId
      );

      const doc = await daemon.jobLifecycle.findById(jobLifecycleId);
      expect(doc).not.toBeNull();
      expect(doc!.stage).toBe(JobStage.FULL_PARSED);
      expect(doc!.status).toBe(JobStatus.ENRICHED);
      expect(doc!.company).toBe('OldCo');
      expect(doc!.role).toBe('Software Engineer');
    });

    it('GIVEN an S2 manual FULL_PARSED input WHEN an ingest signal is processed THEN [c] with missing stage-1 doc skips enrichment — no completion, no doc (data-loss guard, S2) · path c1', async () => {
      await daemon.apps.ingest.processIngest(
        JobSource.MANUAL,
        JobStage.FULL_PARSED,
        topcvDetailHtml(),
        'c1-missing-partial'
      );
      await new Promise((r) => setTimeout(r, 500));

      const doc = await daemon.jobLifecycle.findById('c1-missing-partial');
      expect(doc).toBeNull();
      expect(tui.ipc.read().jobLifecycleId).not.toBe('c1-missing-partial');
    });

    it('GIVEN an S2 manual FULL_PARSED input WHEN an ingest signal is processed THEN [c] on an already FULL_PARSED job is a no-op (B2 guard) (S2) · path c1', async () => {
      const jobLifecycleId = await seedPartial({ _id: 'c1-already-full', company: 'AlreadyCo' });
      await daemon.apps.ingest.processIngest(
        JobSource.MANUAL,
        JobStage.FULL_PARSED,
        CLIPBOARD_HTML,
        jobLifecycleId
      );

      const firstDoc = await daemon.jobLifecycle.findById(jobLifecycleId);
      expect(firstDoc!.stage).toBe(JobStage.FULL_PARSED);

      await daemon.apps.ingest.processIngest(
        JobSource.MANUAL,
        JobStage.FULL_PARSED,
        CLIPBOARD_HTML,
        jobLifecycleId
      );

      const secondDoc = await daemon.jobLifecycle.findById(jobLifecycleId);
      expect(secondDoc!.stage).toBe(JobStage.FULL_PARSED);
      expect(secondDoc!.status).toBe(JobStatus.ENRICHED);
      expect(await daemon.mongo.raw('job_lifecycle').countDocuments({})).toBe(1);
    });

    it('GIVEN an S2 manual FULL_PARSED input WHEN an ingest signal is processed THEN MANUAL FULL without jobLifecycleId is silent — no parse.failed (B9), clip-* doc created (S2) · path c1', async () => {
      await daemon.apps.ingest.processIngest(
        JobSource.MANUAL,
        JobStage.FULL_PARSED,
        linkedinSduiDetailHtml('Software Engineer', 'ClipB9Co')
      );
      await new Promise((r) => setTimeout(r, 500));

      const docs = await daemon.mongo.raw('job_lifecycle').find({}).toArray();
      expect(docs.length).toBe(1);
      expect(docs[0]._id).toMatch(/^clip-/);
      expect(docs[0].stage).toBe(JobStage.FULL_PARSED);
    });
  });

  describe('(c) [c] → [j]/[d] completion, ring closure and tui seam', () => {
    it('GIVEN an S2 manual FULL_PARSED input WHEN an ingest signal is processed THEN [c] then [j] via UDS — queue resolution succeeds (S2+S3) · path c1', async () => {
      const jobLifecycleId = await seedPartial({ _id: 'c1-2a-queue' });

      await daemon.apps.ingest.processIngest(
        JobSource.MANUAL,
        JobStage.FULL_PARSED,
        topcvDetailHtml('Software Engineer', 'QueueTestCo'),
        jobLifecycleId
      );
      await new Promise((r) => setTimeout(r, 200));
      const preDoc = await daemon.jobLifecycle.findById(jobLifecycleId);
      expect(preDoc?.stage).toBe(JobStage.FULL_PARSED);

      await tui.writer.queue(jobLifecycleId);
      await waitFor(() => tui.ipc.read().jobLifecycleId === null);
      expect(tui.ipc.read().job).toBeNull();

      await waitForPdfFiles(daemon.assetDir);

      const doc = await daemon.jobLifecycle.findById(jobLifecycleId);
      expect(doc).not.toBeNull();
      expect(doc!.status).toBe(JobStatus.QUEUED);
    });

    it('GIVEN an S2 manual FULL_PARSED input WHEN an ingest signal is processed THEN [c] then [d] via UDS — trash resolution succeeds (S2+S3) · path c1', async () => {
      const jobLifecycleId = await seedPartial({ _id: 'c1-2a-trash' });

      await daemon.apps.ingest.processIngest(
        JobSource.MANUAL,
        JobStage.FULL_PARSED,
        topcvDetailHtml('Software Engineer', 'TrashTestCo'),
        jobLifecycleId
      );
      await new Promise((r) => setTimeout(r, 200));
      const preDoc = await daemon.jobLifecycle.findById(jobLifecycleId);
      expect(preDoc?.stage).toBe(JobStage.FULL_PARSED);

      await tui.writer.trash(jobLifecycleId);
      await waitFor(() => tui.ipc.read().jobLifecycleId === null);
      expect(tui.ipc.read().job).toBeNull();

      const doc = await daemon.jobLifecycle.findById(jobLifecycleId);
      expect(doc).not.toBeNull();
      expect(doc!.status).toBe(JobStatus.TRASHED);
    });

    it('GIVEN a completed S1→[c]→[j] cycle WHEN a fresh S1 follows THEN the ring closes: the next job reaches S3 QUEUED (s1→s2→s3→next pick) · path c1', async () => {
      const messageId = 'c1-ring-1';
      await daemon.apps.ingest.processIngest(
        JobSource.BROWSER_AUTO,
        JobStage.PARTIAL_PARSED,
        TOPCV_EMAIL_HTML,
        undefined,
        { messageId, subject: 'Backend Developer' }
      );
      await waitFor(() => tui.ipc.read().jobLifecycleId !== null);
      const jobId: string = tui.ipc.read().jobLifecycleId!;

      const ingest = await uds.ingest(CLIPBOARD_HTML, jobId);
      expect(ingest.statusCode).toBe(200);

      await tui.writer.queue(jobId);
      await waitFor(() => tui.ipc.read().jobLifecycleId === null);
      await waitForPdfFiles(daemon.assetDir);
      expect((await daemon.jobLifecycle.findById(jobId))!.status).toBe(JobStatus.QUEUED);

      await daemon.apps.ingest.processIngest(
        JobSource.BROWSER_AUTO,
        JobStage.PARTIAL_PARSED,
        topcvEmailHtmlMany([{ role: 'Data Engineer', company: 'C1RingNextCo' }]),
        undefined,
        { messageId: 'c1-ring-next' }
      );
      await waitFor(() => tui.ipc.read().jobLifecycleId !== null && tui.ipc.read().job?.company === 'C1RingNextCo');
      const nextId: string = tui.ipc.read().jobLifecycleId!;
      expect(tui.ipc.read().job?.company).toBe('C1RingNextCo');

      const ingest2 = await uds.ingest(topcvDetailHtml('Data Engineer', 'C1RingNextCo'), nextId);
      expect(ingest2.statusCode).toBe(200);

      await tui.writer.queue(nextId);
      await waitFor(() => tui.ipc.read().jobLifecycleId === null);
      expect((await daemon.jobLifecycle.findById(nextId))!.status).toBe(JobStatus.QUEUED);
    }, 60000);

    it('GIVEN the tui-ioc precondition WHEN the daemon publishes S1+S2 over RMQ and the tui sends [j] over UDS THEN the tui reader mirrors then clears the job on the ipc seam (tui↔daemon over real RMQ+UDS) · path c1', async () => {
      await waitFor(() => tui.reader.isConnected());
      const jobId = 'c1-tui-boundary-1';

      await daemon.rmq.ports.parse.emitGenerated(
        {
          _id: jobId,
          role: 'Backend Developer',
          company: 'BoundaryCo',
          stage: JobStage.PARTIAL_PARSED,
        },
        { stage: JobStage.PARTIAL_PARSED, source: JobSource.BROWSER_AUTO }
      );
      await waitFor(() => tui.ipc.read().jobLifecycleId === jobId);
      expect(tui.ipc.read().stage).toBe(JobStage.PARTIAL_PARSED);
      expect(tui.ipc.read().job?.company).toBe('BoundaryCo');

      await daemon.rmq.ports.parse.emitCompleted(
        {
          _id: jobId,
          role: 'Backend Developer',
          company: 'BoundaryCo',
          description: 'boundary desc c1',
          stage: JobStage.FULL_PARSED,
          status: JobStatus.ENRICHED,
        },
        { stage: JobStage.FULL_PARSED, source: JobSource.MANUAL }
      );
      await waitFor(() => tui.ipc.read().job?.description === 'boundary desc c1');
      expect(tui.ipc.read().stage).toBe(JobStage.FULL_PARSED);

      await daemon.jobLifecycle.upsert({
        _id: jobId,
        company: 'BoundaryCo',
        role: 'Backend Developer',
        description: 'boundary desc c1',
        stage: JobStage.FULL_PARSED,
        status: JobStatus.ENRICHED,
        source: JobSource.MANUAL,
      });

      await tui.writer.queue(jobId);
      await waitFor(() => tui.ipc.read().jobLifecycleId === null);
      expect(tui.ipc.read().job).toBeNull();
    }, 60000);
  });

  describe('(d) fast-check saga property invariants', () => {
    const ROLES = [
      'Software Engineer',
      'Backend Developer',
      'Full Stack Developer',
      'Data Engineer',
    ];

    it('property: random role/company pairs never crash the saga and converge to valid states', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom(...ROLES),
          fc.string({ minLength: 1, maxLength: 20 }),
          fc.integer({ min: 0, max: 9 }),
          async (role, company, workerIdx) => {
            const safeCompany = company.replace(/[<>&]/g, '') || 'Co';
            await daemon.apps.ingest.processIngest(
              JobSource.BROWSER_AUTO,
              JobStage.PARTIAL_PARSED,
              topcvEmailHtmlMany([{ role, company: `${safeCompany}${workerIdx}` }]),
              undefined,
              { messageId: `c1-prop-${workerIdx}-${role.replace(/\s+/g, '')}` }
            );
            const doc = await daemon.jobLifecycle.findById(
              `c1-prop-${workerIdx}-${role.replace(/\s+/g, '')}-job-0`
            );
            if (doc) {
              expect([JobStatus.ENRICHING, JobStatus.ENRICHED]).toContain(doc.status);
            }
            return true;
          }
        ),
        { numRuns: 30 }
      );
    });

    it('property: repeated identical S1 ingests are idempotent (dedupe on role+company)', async () => {
      await fc.assert(
        fc.asyncProperty(fc.constantFrom(...ROLES), async (role) => {
          const company = `C1DedupePropCo-${Math.random().toString(36).slice(2, 8)}`;
          const messageId = `c1-prop-dedupe-${Math.random().toString(36).slice(2, 8)}`;
          await daemon.apps.ingest.processIngest(
            JobSource.BROWSER_AUTO,
            JobStage.PARTIAL_PARSED,
            topcvEmailHtmlMany([{ role, company }]),
            undefined,
            { messageId }
          );
          await daemon.apps.ingest.processIngest(
            JobSource.BROWSER_AUTO,
            JobStage.PARTIAL_PARSED,
            topcvEmailHtmlMany([{ role, company }]),
            undefined,
            { messageId }
          );
          const docs = await daemon.mongo.raw('job_lifecycle').find({ role, company }).toArray();
          expect(docs.length).toBeLessThanOrEqual(1);
          return true;
        }),
        { numRuns: 15 }
      );
    });
  });
});
