import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

import { JobStage, JobSource } from '../../../src/domain/types/job-lifecycle.js';
import { topcvEmailHtmlMany, topcvDetailHtml } from '../../helpers/html-fixtures.js';
import {
  buildTestDaemonContainer,
  buildTestTuiContainer,
  type TestDaemonContainer,
  type TuiTestContainer,
} from '../../helpers/test-container.js';
import { waitFor } from '../../helpers/test-utils.js';

/**
 * RMQ pub/sub pair contract: the daemon's real outbound Parse/Route adapters
 * publish labeled signals (GENERATED / PARSE_COMPLETED / PARSE_FAILED / QUEUED /
 * TRASHED / ROUTE_FAILED), and the TUI durable reader → ipc seam proves each
 * label lands on its own topic over real RMQ.
 */
describe(
  'RMQ pub/sub pair — daemon publisher ↔ tui ipc · contract rmq-pubsub',
  { timeout: 60000 },
  () => {
    let daemon: TestDaemonContainer;
    let tui: TuiTestContainer;

    beforeAll(async () => {
      daemon = await buildTestDaemonContainer({ ns: 'rmq-pubsub' });
      await daemon.start();
      tui = await buildTestTuiContainer({ ns: 'rmq-pubsub' });
    }, 120000);

    afterAll(async () => {
      // Per-suite cycle teardown: stops first, then self-deletes the 4
      // namespaced queues + test exchange (finally => no cleanup script).
      try {
        await tui.stop();
        await daemon.stop();
      } finally {
        await tui.reader.deleteQueues();
      }
    });

    beforeEach(async () => {
      await daemon.storage.clearDb();
      await tui.reader.purgeQueues();
      tui.reader.resetReader();
      tui.ipc.clear();
    });

    // — (a) GENERATED ↔ ipc(s1) — the published job doc arrives on the s1 topic —
    it('GIVEN the RMQ pub/sub precondition WHEN the daemon emits GENERATED on the real RMQ pub/sub pair THEN ipc shows the job doc with role/company/stage (S1) · contract rmq-pubsub', async () => {
      const doc = {
        _id: 'rmq-probe-s1',
        role: 'Software Engineer',
        company: 'Test Co',
        stage: JobStage.PARTIAL_PARSED,
      };

      await daemon.rmq.ports.parse.emitGenerated(doc, {
        stage: JobStage.PARTIAL_PARSED,
        source: JobSource.BROWSER_AUTO,
      });

      await waitFor(() => tui.ipc.read().jobLifecycleId === 'rmq-probe-s1');
      expect(tui.ipc.read().jobLifecycleId).toBe('rmq-probe-s1');
      expect(tui.ipc.read().job?.role).toBe('Software Engineer');
      expect(tui.ipc.read().stage).toBe(JobStage.PARTIAL_PARSED);
    });

    it('GIVEN the RMQ pub/sub precondition WHEN processIngest on the real RMQ pub/sub pair THEN the repoed PARTIAL job republishes GENERATED to the s1 topic (S1) · contract rmq-pubsub', async () => {
      const html = topcvEmailHtmlMany([{ role: 'Software Engineer', company: 'S1 Co' }]);

      await daemon.apps.ingest.processIngest(
        JobSource.BROWSER_AUTO,
        JobStage.PARTIAL_PARSED,
        html,
        undefined,
        { messageId: 'rmq-s1-msg' }
      );

      await waitFor(
        () =>
          tui.ipc.read().jobLifecycleId !== null &&
          tui.ipc.read().jobLifecycleId!.startsWith('rmq-s1-msg-job-')
      );
      expect(tui.ipc.read().jobLifecycleId).toMatch(/^rmq-s1-msg-job-/);
      expect(tui.ipc.read().job?.role).toBe('Software Engineer');
      expect(tui.ipc.read().job?.company).toBe('S1 Co');
      expect(tui.ipc.read().stage).toBe(JobStage.PARTIAL_PARSED);
    });

    // — (b) PARSE_COMPLETED ↔ ipc(s2) — the { job } envelope arrives on the s2 topic —
    it('GIVEN the RMQ pub/sub precondition WHEN the daemon emits PARSE_COMPLETED on the real RMQ pub/sub pair THEN ipc shows the { job } envelope (S2) · contract rmq-pubsub', async () => {
      const base = {
        _id: 'rmq-probe-s2',
        role: 'Backend Engineer',
        company: 'S2ProbeCo',
        stage: JobStage.PARTIAL_PARSED,
      };
      await daemon.rmq.ports.parse.emitGenerated(base, {
        stage: JobStage.PARTIAL_PARSED,
        source: JobSource.BROWSER_AUTO,
      });
      await waitFor(() => tui.ipc.read().jobLifecycleId === 'rmq-probe-s2');
      const job = { _id: 'rmq-probe-s2', role: 'Backend Engineer', stage: JobStage.FULL_PARSED };

      await daemon.rmq.ports.parse.emitCompleted(job, {
        stage: JobStage.FULL_PARSED,
        source: JobSource.MANUAL,
      });

      await waitFor(() => tui.ipc.read().stage === JobStage.FULL_PARSED);
      expect(tui.ipc.read().jobLifecycleId).toBe('rmq-probe-s2');
      expect(tui.ipc.read().stage).toBe(JobStage.FULL_PARSED);
      expect(tui.ipc.read().job?._id ?? tui.ipc.read().jobLifecycleId).toBe('rmq-probe-s2');
    });

    it('GIVEN the RMQ pub/sub precondition WHEN a full merge runs on the real RMQ pub/sub pair THEN the ENRICHED job republishes PARSE_COMPLETED to the s2 topic (S2+S1) · contract rmq-pubsub', async () => {
      const partialHtml = topcvEmailHtmlMany([{ role: 'Software Engineer', company: 'S2 Co' }]);
      await daemon.apps.ingest.processIngest(
        JobSource.BROWSER_AUTO,
        JobStage.PARTIAL_PARSED,
        partialHtml,
        undefined,
        { messageId: 'rmq-s2-msg' }
      );
      await waitFor(() => tui.ipc.read().jobLifecycleId !== null);
      const jobLifecycleId = tui.ipc.read().jobLifecycleId!;

      const fullHtml = topcvDetailHtml('Software Engineer', 'S2 Co');
      await daemon.apps.ingest.processIngest(
        JobSource.MANUAL,
        JobStage.FULL_PARSED,
        fullHtml,
        jobLifecycleId
      );

      await waitFor(
        () =>
          tui.ipc.read().jobLifecycleId === jobLifecycleId &&
          tui.ipc.read().stage === JobStage.FULL_PARSED
      );
      expect(tui.ipc.read().jobLifecycleId).toBe(jobLifecycleId);
      expect(tui.ipc.read().stage).toBe(JobStage.FULL_PARSED);
      const doc = await daemon.jobLifecycle.findById(jobLifecycleId);
      expect(doc?.status).toBe('enriched');
    });

    // — (c) QUEUED / TRASHED / ROUTE_FAILED / PARSE_FAILED ↔ ipc(s34) — the jobLifecycleId arrives on the s34 topic —
    it('GIVEN the RMQ pub/sub precondition WHEN the daemon emits QUEUED on the real RMQ pub/sub pair THEN ipc clears to null (S3) · contract rmq-pubsub', async () => {
      await daemon.rmq.ports.route.emitJobQueued('rmq-probe-queued', {
        source: JobSource.MANUAL,
      });

      await waitFor(() => tui.ipc.read().jobLifecycleId === null);
      expect(tui.ipc.read().jobLifecycleId).toBeNull();
      expect(tui.ipc.read().job).toBeNull();
    });

    it('GIVEN the RMQ pub/sub precondition WHEN the daemon emits TRASHED on the real RMQ pub/sub pair THEN ipc clears to null (S4) · contract rmq-pubsub', async () => {
      await daemon.rmq.ports.route.emitJobTrashed('rmq-probe-trash', 'operator:trash');

      await waitFor(() => tui.ipc.read().jobLifecycleId === null);
      expect(tui.ipc.read().jobLifecycleId).toBeNull();
      expect(tui.ipc.read().job).toBeNull();
    });

    it('GIVEN the RMQ pub/sub precondition WHEN the daemon emits ROUTE_FAILED on the real RMQ pub/sub pair THEN ipc clears to null (S4) · contract rmq-pubsub', async () => {
      await daemon.rmq.ports.route.emitRouteFailed(
        'rmq-probe-fail',
        'No existing job lifecycle found'
      );

      await waitFor(() => tui.ipc.read().jobLifecycleId === null);
      expect(tui.ipc.read().jobLifecycleId).toBeNull();
      expect(tui.ipc.read().job).toBeNull();
    });

    it('GIVEN the RMQ pub/sub precondition WHEN the daemon emits PARSE_FAILED on the real RMQ pub/sub pair THEN ipc clears to null (S4) · contract rmq-pubsub', async () => {
      await daemon.rmq.ports.parse.emitFailed('rmq-probe-parse-fail', {
        stage: JobStage.FULL_PARSED,
        source: JobSource.MANUAL,
        error: 'Parse error',
      });

      await waitFor(() => tui.ipc.read().jobLifecycleId === null);
      expect(tui.ipc.read().jobLifecycleId).toBeNull();
      expect(tui.ipc.read().job).toBeNull();
    });

    it('GIVEN an ENRICHED job WHEN processResolution(queue) on the real RMQ pub/sub pair THEN the saga republishes QUEUED to the s34 topic (S2+S1+S3) · contract rmq-pubsub', async () => {
      const partialHtml = topcvEmailHtmlMany([{ role: 'Software Engineer', company: 'Queue Co' }]);
      await daemon.apps.ingest.processIngest(
        JobSource.BROWSER_AUTO,
        JobStage.PARTIAL_PARSED,
        partialHtml,
        undefined,
        { messageId: 'rmq-queue-msg' }
      );
      await waitFor(() => tui.ipc.read().jobLifecycleId !== null);
      const jobLifecycleId = tui.ipc.read().jobLifecycleId!;

      await daemon.apps.ingest.processIngest(
        JobSource.MANUAL,
        JobStage.FULL_PARSED,
        topcvDetailHtml('Software Engineer', 'Queue Co'),
        jobLifecycleId
      );
      await waitFor(
        () =>
          tui.ipc.read().jobLifecycleId === jobLifecycleId &&
          tui.ipc.read().stage === JobStage.FULL_PARSED
      );

      await daemon.apps.ingest.processResolution(jobLifecycleId, 'queue');

      await waitFor(() => tui.ipc.read().jobLifecycleId === null);
      expect(tui.ipc.read().jobLifecycleId).toBeNull();
      expect(tui.ipc.read().job).toBeNull();
      const doc = await daemon.jobLifecycle.findById(jobLifecycleId);
      expect(doc?.status).toBe('queued');
    });

    it('GIVEN an ENRICHED job WHEN processResolution(trash) on the real RMQ pub/sub pair THEN the saga republishes TRASHED to the s34 topic (S2+S1) · contract rmq-pubsub', async () => {
      const partialHtml = topcvEmailHtmlMany([{ role: 'Software Engineer', company: 'Trash Co' }]);
      await daemon.apps.ingest.processIngest(
        JobSource.BROWSER_AUTO,
        JobStage.PARTIAL_PARSED,
        partialHtml,
        undefined,
        { messageId: 'rmq-trash-msg' }
      );
      await waitFor(() => tui.ipc.read().jobLifecycleId !== null);
      const jobLifecycleId = tui.ipc.read().jobLifecycleId!;

      await daemon.apps.ingest.processIngest(
        JobSource.MANUAL,
        JobStage.FULL_PARSED,
        topcvDetailHtml('Software Engineer', 'Trash Co'),
        jobLifecycleId
      );
      await waitFor(
        () =>
          tui.ipc.read().jobLifecycleId === jobLifecycleId &&
          tui.ipc.read().stage === JobStage.FULL_PARSED
      );

      await daemon.apps.ingest.processResolution(jobLifecycleId, 'trash');

      await waitFor(() => tui.ipc.read().jobLifecycleId === null);
      expect(tui.ipc.read().jobLifecycleId).toBeNull();
      expect(tui.ipc.read().job).toBeNull();
      const doc = await daemon.jobLifecycle.findById(jobLifecycleId);
      expect(doc?.status).toBe('trashed');
    });

    it('GIVEN a missing job WHEN processResolution on the real RMQ pub/sub pair THEN the saga republishes ROUTE_FAILED to the s34 topic · contract rmq-pubsub', async () => {
      await daemon.apps.ingest.processResolution('nonexistent-job', 'queue');

      await waitFor(() => tui.ipc.read().jobLifecycleId === null);
      expect(tui.ipc.read().jobLifecycleId).toBeNull();
      const doc = await daemon.jobLifecycle.findById('nonexistent-job');
      expect(doc).toBeNull();
    });

    it('GIVEN empty HTML WHEN processIngest on the real RMQ pub/sub pair THEN the saga republishes PARSE_FAILED to the s34 topic (S2) · contract rmq-pubsub', async () => {
      await daemon.apps.ingest.processIngest(
        JobSource.MANUAL,
        JobStage.FULL_PARSED,
        '',
        'empty-rmq-id'
      );

      await waitFor(() => tui.ipc.read().jobLifecycleId === null);
      expect(tui.ipc.read().jobLifecycleId).toBeNull();
      const doc = await daemon.jobLifecycle.findById('empty-rmq-id');
      expect(doc).toBeNull();
    });

    // — (d) real reader read-back — publish → RabbitMqJobReader queue depth / ipc seam —
    it('GIVEN two GENERATED events WHEN published on the real RMQ pub/sub pair THEN the reader seam shows the first job while queue depth holds the second', async () => {
      await daemon.rmq.ports.parse.emitGenerated(
        { _id: 'rmq-q-1', role: 'A', company: 'QCo1', stage: JobStage.PARTIAL_PARSED },
        { stage: JobStage.PARTIAL_PARSED, source: JobSource.BROWSER_AUTO }
      );
      await daemon.rmq.ports.parse.emitGenerated(
        { _id: 'rmq-q-2', role: 'B', company: 'QCo2', stage: JobStage.PARTIAL_PARSED },
        { stage: JobStage.PARTIAL_PARSED, source: JobSource.BROWSER_AUTO }
      );

      await waitFor(() => tui.ipc.read().jobLifecycleId === 'rmq-q-1');
      await waitFor(() => tui.reader.getQueueDepth() === 1);
      expect(tui.ipc.read().job?.company).toBe('QCo1');
      expect(tui.reader.getQueueDepth()).toBe(1);
    });

    it('GIVEN a PARSE_COMPLETED event WHEN published on the real RMQ pub/sub pair THEN the reader seam advances the stage to FULL_PARSED (S2)', async () => {
      await daemon.rmq.ports.parse.emitGenerated(
        {
          _id: 'rmq-pc-1',
          role: 'Software Engineer',
          company: 'PCo',
          stage: JobStage.PARTIAL_PARSED,
        },
        { stage: JobStage.PARTIAL_PARSED, source: JobSource.BROWSER_AUTO }
      );
      await waitFor(() => tui.ipc.read().jobLifecycleId === 'rmq-pc-1');

      await daemon.rmq.ports.parse.emitCompleted(
        {
          _id: 'rmq-pc-1',
          role: 'Software Engineer',
          company: 'PCo',
          stage: JobStage.FULL_PARSED,
        },
        { stage: JobStage.FULL_PARSED, source: JobSource.BROWSER_AUTO }
      );

      await waitFor(() => tui.ipc.read().stage === JobStage.FULL_PARSED);
      expect(tui.reader.getQueueDepth()).toBe(0);
    });
  }
);
