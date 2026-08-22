/*
 * e2e c1-canonical (P3 skeleton: 2 real containers, black-box, final-outcome asserts):
 *   root = path ring; nested describe = ONE checkpoint boundary.
 *   Inputs via app.webhook (fake gmail) + app.uds.ingest ([c] paste carrying the id);
 *   operator via app.uds.action (tui.uds.write). Assert ONLY final external outcomes:
 *   daemon.mongo S3/S4 status + real asset PDF + the tui ipc seam mirror→clear folded
 *   into the needy checkpoints. No S1/S2 intermediate re-proving (integ owns that).
 */
import fs from 'node:fs';

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

import { JobStage, JobStatus } from '../../src/domain/types/job-lifecycle.js';
import { ActionEvent, createE2eApp, type E2eApp } from '../helpers/e2e-app.js';
import { topcvDetailHtml, nonJobHtml } from '../helpers/html-fixtures.js';

const waitForDoc = (app: E2eApp, jobId: string) =>
  vi.waitUntil(async () => (await app.jobLifecycle.findById(jobId)) !== null, {
    timeout: 15000,
  });

const waitForStatus = (app: E2eApp, jobId: string, status: JobStatus) =>
  vi.waitUntil(async () => (await app.jobLifecycle.findById(jobId))?.status === status, {
    timeout: 15000,
  });

describe('C1 canonical e2e — webhook msg → s1 → s2 full parse → [j] queue → asset pdf → next (prod bootstrap, real deps)', () => {
  let app: E2eApp;

  beforeAll(async () => {
    app = await createE2eApp({
      ns: 'c1-canonical',
      role: 'Software Engineer',
      company: 'C1CanonicalCo',
      jobForMessage: (mid) => {
        if (mid === 'c1-canonical-msg')
          return { role: 'Software Engineer', company: 'C1CanonicalCo' };
        if (mid === 'c1-fail-msg') return { role: 'Software Engineer', company: 'C1FailCo' };
        if (mid === 'c1-ring-msg') return { role: 'Software Engineer', company: 'C1RingCo' };
        if (mid === 'c1-ring-next-msg')
          return { role: 'Software Engineer', company: 'C1RingNextCo' };
        return { role: 'Software Engineer', company: 'C1RecoveryCo' };
      },
    });
  }, 120000);

  afterAll(async () => {
    await app.stop();
  });

  describe('(a) canonical S1 → [c] paste → [j] QUEUED + pdf (+ tui mirror folded)', () => {
    it('GIVEN webhook S1 WHEN [c] paste THEN [j] queue → QUEUED + real asset pdf and the tui mirror advances then clears · e2e c1', async () => {
      await app.resetDb();
      const jobId = 'c1-canonical-msg-job-0';
      app.tui.rmq.reader.resetReader();

      const res = await app.webhook.post('c1-canonical-msg');
      expect(res.status).toBe(202);
      await waitForDoc(app, jobId);

      const cRes = await app.uds.ingest(
        topcvDetailHtml('Software Engineer', 'C1CanonicalCo'),
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

      await waitForStatus(app, jobId, JobStatus.QUEUED);
      const pdfPath = await app.artifacts.waitForPdf();
      expect(fs.existsSync(pdfPath)).toBe(true);
      expect(fs.statSync(pdfPath).size).toBeGreaterThan(0);

      await vi.waitUntil(() => app.tui.ipc.read().jobLifecycleId === null, { timeout: 15000 });
      expect(app.tui.ipc.read().job).toBeNull();
    }, 90000);
  });

  describe('(b) S4 PARSE_FAILED → next webhook S1 recovery', () => {
    it('GIVEN a non-LinkedIn clipboard paste WHEN s2b evaluates THEN PARSE_FAILED (no doc persisted); next webhook S1 recovers to a fresh doc · e2e c1', async () => {
      const fail = await app.events.on([ActionEvent.PARSE_FAILED]);
      const cRes = await app.uds.ingest(nonJobHtml());
      expect(cRes.statusCode).toBe(200);

      const failMsg = await fail.msg();
      expect(failMsg.jobLifecycleId).toMatch(/^clip-/);

      const clipId: string = failMsg.jobLifecycleId;
      const failedDoc = await app.jobLifecycle.findById(clipId);
      expect(failedDoc).toBeNull();

      const recoveryId = 'c1-recovery-msg-job-0';
      await app.webhook.post('c1-recovery-msg');
      await waitForDoc(app, recoveryId);
      const recDoc = await app.jobLifecycle.findById(recoveryId);
      expect(recDoc!.company).toBe('C1RecoveryCo');
      expect(recDoc!.stage).toBe(JobStage.PARTIAL_PARSED);
    }, 60000);
  });

  describe('(c) ring closure — next pick after a completed cycle', () => {
    it('GIVEN a completed webhook→paste→[j] cycle WHEN a fresh S1 follows THEN the next job reaches QUEUED and the ipc seam is empty again · e2e c1', async () => {
      await app.resetDb();
      app.tui.rmq.reader.resetReader();
      const jobId = 'c1-ring-msg-job-0';

      const res = await app.webhook.post('c1-ring-msg');
      expect(res.status).toBe(202);
      await waitForDoc(app, jobId);

      const cRes = await app.uds.ingest(topcvDetailHtml('Software Engineer', 'C1RingCo'), jobId);
      expect(cRes.statusCode).toBe(200);

      const jRes = await app.uds.action(jobId, 'queue');
      expect(jRes.statusCode).toBe(200);

      await waitForStatus(app, jobId, JobStatus.QUEUED);
      await vi.waitUntil(() => app.tui.ipc.read().jobLifecycleId === null, { timeout: 15000 });

      const nextId = 'c1-ring-next-msg-job-0';
      const res2 = await app.webhook.post('c1-ring-next-msg');
      expect(res2.status).toBe(202);
      await waitForDoc(app, nextId);
      const nextDoc = await app.jobLifecycle.findById(nextId);
      expect(nextDoc!.company).toBe('C1RingNextCo');
      expect(nextDoc!.stage).toBe(JobStage.PARTIAL_PARSED);
    }, 90000);
  });
});
