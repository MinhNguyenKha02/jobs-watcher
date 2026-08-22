/*
 * e2e c4-direct (P3 skeleton: 2 real containers, black-box, final-outcome asserts):
 *   [i] clipboard ingest → clip-* FULL_PARSED → [j] QUEUED + PDF / [d] TRASHED + empty-payload 400 boundary.
 *   Assert ONLY final outcomes (daemon.mongo S3/S4 + real asset PDF + the ipc seam folded in).
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

import { JobStage, JobStatus, JobSource } from '../../src/domain/types/job-lifecycle.js';
import { ActionEvent, createE2eApp, type E2eApp } from '../helpers/e2e-app.js';
import { linkedinSduiDetailHtml } from '../helpers/html-fixtures.js';

const waitForDoc = (app: E2eApp, jobId: string) =>
  vi.waitUntil(async () => (await app.jobLifecycle.findById(jobId)) !== null, {
    timeout: 15000,
  });

describe('C4 direct e2e — [i] clipboard ingest → fully job → [j] queue + pdf / [d] trash / 400 boundary → next cycle (prod bootstrap)', () => {
  let app: E2eApp;

  beforeAll(async () => {
    app = await createE2eApp({ ns: 'c4-direct' });
  }, 120000);

  afterAll(async () => {
    await app.stop();
  });

  describe('(a) [i] direct ingest → [d] TRASHED → next direct ingest', () => {
    it('GIVEN [i] clipboard ingest WHEN ENRICHED clip-* doc; [d] trash THEN TRASHED; next direct ingest still completes · e2e c4', async () => {
      const comp = await app.events.on([ActionEvent.PARSE_COMPLETED]);
      const iRes = await app.uds.ingest(linkedinSduiDetailHtml('Backend Engineer', 'C4DirectCo'));
      expect(iRes.statusCode).toBe(200);

      const compMsg = await comp.msg();
      const firstJobId: string = compMsg.job._id;
      expect(firstJobId).toMatch(/^clip-/);

      const trash = await app.events.on([
        ActionEvent.TRASHED,
        ActionEvent.ROUTE_FAILED,
        ActionEvent.PARSE_FAILED,
      ]);
      const dRes = await app.uds.action(firstJobId, 'trash');
      expect(dRes.statusCode).toBe(200);

      const trashMsg = await trash.msg();
      expect(trashMsg.jobLifecycleId).toBe(firstJobId);
      expect(trashMsg.reason).toBe('operator:trash');

      const trashedDoc = await app.jobLifecycle.findById(firstJobId);
      expect(trashedDoc!.status).toBe(JobStatus.TRASHED);

      const comp2 = await app.events.on([ActionEvent.PARSE_COMPLETED]);
      const i2Res = await app.uds.ingest(linkedinSduiDetailHtml('Data Engineer', 'C4DirectCo2'));
      expect(i2Res.statusCode).toBe(200);

      const comp2Msg = await comp2.msg();
      const nextId: string = comp2Msg.job._id;
      expect(nextId).toMatch(/^clip-/);
      expect(nextId).not.toBe(firstJobId);

      const nextDoc = await app.jobLifecycle.findById(nextId);
      expect(nextDoc!.company).toBe('C4DirectCo2');
      expect(nextDoc!.status).toBe(JobStatus.ENRICHED);
    }, 60000);
  });

  describe('(b) [i] direct ingest → [j] QUEUED + asset PDF → next direct ingest', () => {
    it('GIVEN [i] clipboard ingest WHEN a [j] resolution is applied THEN QUEUED + real asset pdf; next direct ingest still completes · e2e c4', async () => {
      const comp = await app.events.on([ActionEvent.PARSE_COMPLETED]);
      const iRes = await app.uds.ingest(linkedinSduiDetailHtml('DevOps Engineer', 'C4QueueCo'));
      expect(iRes.statusCode).toBe(200);

      const compMsg = await comp.msg();
      const jobId: string = compMsg.job._id;
      expect(jobId).toMatch(/^clip-/);
      expect(compMsg.job.source).toBe(JobSource.MANUAL);

      const queue = await app.events.on([
        ActionEvent.QUEUED,
        ActionEvent.TRASHED,
        ActionEvent.ROUTE_FAILED,
      ]);
      const jRes = await app.uds.action(jobId, 'queue');
      expect(jRes.statusCode).toBe(200);

      const queueMsg = await queue.msg();
      expect(queueMsg.jobLifecycleId).toBe(jobId);

      const pdfPath = await app.artifacts.waitForPdf();
      expect(pdfPath).toBeTruthy();

      const queuedDoc = await app.jobLifecycle.findById(jobId);
      expect(queuedDoc!.status).toBe(JobStatus.QUEUED);

      const comp2 = await app.events.on([ActionEvent.PARSE_COMPLETED]);
      const i2Res = await app.uds.ingest(linkedinSduiDetailHtml('Frontend Engineer', 'C4QueueCo2'));
      expect(i2Res.statusCode).toBe(200);

      const comp2Msg = await comp2.msg();
      const nextId: string = comp2Msg.job._id;
      expect(nextId).toMatch(/^clip-/);
      expect(nextId).not.toBe(jobId);

      const nextDoc = await app.jobLifecycle.findById(nextId);
      expect(nextDoc!.company).toBe('C4QueueCo2');
      expect(nextDoc!.status).toBe(JobStatus.ENRICHED);
    }, 60000);
  });

  describe('(c) empty [i] clipboard → 400 boundary, no parse attempt, next completes', () => {
    it('GIVEN an empty [i] clipboard WHEN the path is exercised THEN the UDS boundary rejects it (400 empty payload) with no parse attempt; next direct ingest still completes · e2e c4', async () => {
      const fail = await app.events.on([ActionEvent.PARSE_FAILED], 2000);
      const emptyRes = await app.uds.ingest('');
      expect(emptyRes.statusCode).toBe(400);
      await expect(fail.msg()).rejects.toThrow();

      const comp = await app.events.on([ActionEvent.PARSE_COMPLETED]);
      const okRes = await app.uds.ingest(linkedinSduiDetailHtml('Site Reliability Engineer', 'C4EmptyCo'));
      expect(okRes.statusCode).toBe(200);

      const compMsg = await comp.msg();
      const clipId: string = compMsg.job._id;
      expect(clipId).toMatch(/^clip-/);

      const clipDoc = await app.jobLifecycle.findById(clipId);
      expect(clipDoc!.company).toBe('C4EmptyCo');
      expect(clipDoc!.status).toBe(JobStatus.ENRICHED);
    }, 60000);
  });

  describe('(d) ring closure — webhook S1 → [c] paste → [j] QUEUED + tui seam', () => {
    it('GIVEN a recovery ring WHEN a full webhook→paste→[j] cycle runs THEN QUEUED and the ipc seam mirrors then clears · e2e c4', async () => {
      await app.resetDb();
      app.tui.rmq.reader.resetReader();
      const jobId = 'c4-boundary-msg-job-0';

      const res = await app.webhook.post('c4-boundary-msg');
      expect(res.status).toBe(202);
      await waitForDoc(app, jobId);

      const cRes = await app.uds.ingest(
        linkedinSduiDetailHtml('Software Engineer', 'E2eCanonicalCo'),
        jobId
      );
      expect(cRes.statusCode).toBe(200);

      await vi.waitUntil(
        () =>
          app.tui.ipc.read().jobLifecycleId === jobId &&
          app.tui.ipc.read().stage === JobStage.FULL_PARSED,
        { timeout: 15000 }
      );

      const jRes = await app.uds.action(jobId, 'queue');
      expect(jRes.statusCode).toBe(200);

      await vi.waitUntil(
        async () => (await app.jobLifecycle.findById(jobId))?.status === JobStatus.QUEUED,
        { timeout: 15000 }
      );
      await vi.waitUntil(() => app.tui.ipc.read().jobLifecycleId === null, { timeout: 15000 });
      expect(app.tui.ipc.read().job).toBeNull();
    }, 90000);
  });
});
