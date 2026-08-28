/*
 * e2e c3-error (P3 skeleton: 2 real containers, black-box, final-outcome asserts):
 *   S4 PARSE_FAILED / ROUTE_FAILED sagas, each followed by a recovery ring.
 *   Assert ONLY final outcomes (daemon.mongo S4 + the recovering clip-* ENRICHED doc);
 *   the tui ipc seam is folded into the ring-closure checkpoint over real RMQ+UDS.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

import { JobStage, JobStatus } from '../../src/domain/types/job-lifecycle.js';
import { ActionEvent, createE2eApp, type E2eApp } from '../helpers/e2e-app.js';
import { linkedinSduiDetailHtml, nonJobHtml } from '../helpers/html-fixtures.js';

const waitForDoc = (app: E2eApp, jobId: string) =>
  vi.waitUntil(async () => (await app.jobLifecycle.findById(jobId)) !== null, {
    timeout: 15000,
  });

describe('C3 error e2e — s2 failure → s4 → next valid s2 recovers (prod bootstrap, real deps)', () => {
  const _messageId = 'c3-error-recovery';
  let app: E2eApp;

  beforeAll(async () => {
    app = await createE2eApp({ ns: 'c3-error' });
  }, 120000);

  afterAll(async () => {
    await app.stop();
  });

  describe('(a) S4 PARSE_FAILED → next valid clipboard recovers', () => {
    it('GIVEN unparseable UDS ingest WHEN PARSE_FAILED (s4); next valid clipboard THEN a clip-* doc is ENRICHED (recovery) · e2e c3', async () => {
      const fail = await app.events.on([ActionEvent.PARSE_FAILED]);
      const failRes = await app.uds.ingest(nonJobHtml());
      expect(failRes.statusCode).toBe(200);

      const failMsg = await fail.msg();
      expect(failMsg.jobLifecycleId).toMatch(/^clip-/);

      const comp = await app.events.on([ActionEvent.PARSE_COMPLETED]);
      const okRes = await app.uds.ingest(
        linkedinSduiDetailHtml('Software Engineer', 'C3RecoveryCo')
      );
      expect(okRes.statusCode).toBe(200);

      const compMsg = await comp.msg();
      const clipId: string = compMsg.job._id;
      expect(clipId).toMatch(/^clip-/);

      const clipDoc = await app.jobLifecycle.findById(clipId);
      expect(clipDoc!.company).toBe('C3RecoveryCo');
      expect(clipDoc!.stage).toBe(JobStage.FULL_PARSED);
      expect(clipDoc!.status).toBe(JobStatus.ENRICHED);
    }, 60000);
  });

  describe('(b) S4 ROUTE_FAILED (unknown [j]) → next valid clipboard recovers', () => {
    it('GIVEN a [j] action for an unknown jobLifecycleId WHEN the path is exercised THEN ROUTE_FAILED (s4); next valid clipboard still recovers · e2e c3', async () => {
      const fail = await app.events.on([ActionEvent.ROUTE_FAILED]);
      const res = await app.uds.action('c3-route-fail-unknown', 'queue');
      expect(res.statusCode).toBe(200);

      const failMsg = await fail.msg();
      expect(failMsg.jobLifecycleId).toBe('c3-route-fail-unknown');
      expect(failMsg.reason).toBe('No existing job lifecycle found');

      const comp = await app.events.on([ActionEvent.PARSE_COMPLETED]);
      const okRes = await app.uds.ingest(
        linkedinSduiDetailHtml('Software Engineer', 'C3ResilientCo')
      );
      expect(okRes.statusCode).toBe(200);

      const compMsg = await comp.msg();
      const clipId: string = compMsg.job._id;
      expect(clipId).toMatch(/^clip-/);

      const clipDoc = await app.jobLifecycle.findById(clipId);
      expect(clipDoc!.company).toBe('C3ResilientCo');
      expect(clipDoc!.stage).toBe(JobStage.FULL_PARSED);
      expect(clipDoc!.status).toBe(JobStatus.ENRICHED);
    }, 60000);
  });

  describe('(c) ring closure — webhook S1 → [c] paste → [j] QUEUED + tui seam', () => {
    it('GIVEN a recovery ring WHEN a full webhook→paste→[j] cycle runs THEN QUEUED and the ipc seam mirrors then clears · e2e c3', async () => {
      await app.resetDb();
      app.tui.reader.resetReader();
      await app.tui.reader.purgeQueues();
      const jobId = 'c3-boundary-msg-job-0';

      const res = await app.webhook.post('c3-boundary-msg');
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
