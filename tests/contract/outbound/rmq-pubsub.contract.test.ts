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
import { purgeTuiQueues, waitFor } from '../../helpers/test-utils.js';

/**
 * RMQ pub/sub pair contract: the daemon's real outbound Parse/Route adapters
 * publish labeled signals (GENERATED / PARSE_COMPLETED / PARSE_FAILED / QUEUED /
 * TRASHED / ROUTE_FAILED), and the TUI consumer leg (`tui.rmq.consume` fresh
 * exclusive queue + the real RabbitMqJobReader read-back) proves each label
 * lands on its own topic over real RMQ.
 */
describe(
  'RMQ pub/sub pair — daemon publisher ↔ tui consumer · contract rmq-pubsub',
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
      await tui.stop();
      await daemon.stop();
    });

    beforeEach(async () => {
      await daemon.storage.clearDb();
      await purgeTuiQueues('rmq-pubsub');
      tui.rmq.reader.resetReader();
      tui.ipc.clear();
    });

    describe('(a) GENERATED ↔ consume(s1) — the published job doc arrives on the s1 topic', () => {
      it('GIVEN the RMQ pub/sub precondition WHEN the daemon emits GENERATED on the real RMQ pub/sub pair THEN consume(s1) returns the job doc with role/company/stage (S1) · contract rmq-pubsub', async () => {
        const doc = {
          _id: 'rmq-probe-s1',
          role: 'Software Engineer',
          company: 'Test Co',
          stage: JobStage.PARTIAL_PARSED,
        };
        const gen = tui.rmq.consume('s1');

        await daemon.rmq.ports.parse.emitGenerated(doc, {
          stage: JobStage.PARTIAL_PARSED,
          source: JobSource.BROWSER_AUTO,
        });

        const msg = await gen;
        expect(msg._id).toBe('rmq-probe-s1');
        expect(msg.role).toBe('Software Engineer');
        expect(msg.stage).toBe(JobStage.PARTIAL_PARSED);
      });

      it('GIVEN the RMQ pub/sub precondition WHEN processIngest on the real RMQ pub/sub pair THEN the repoed PARTIAL job republishes GENERATED to the s1 topic (S1) · contract rmq-pubsub', async () => {
        const html = topcvEmailHtmlMany([{ role: 'Software Engineer', company: 'S1 Co' }]);
        const gen = tui.rmq.consume('s1');

        await daemon.apps.ingest.processIngest(
          JobSource.BROWSER_AUTO,
          JobStage.PARTIAL_PARSED,
          html,
          undefined,
          { messageId: 'rmq-s1-msg' }
        );

        const msg = await gen;
        expect(msg._id).toMatch(/^rmq-s1-msg-job-/);
        expect(msg.role).toBe('Software Engineer');
        expect(msg.company).toBe('S1 Co');
        expect(msg.stage).toBe(JobStage.PARTIAL_PARSED);
      });
    });

    describe('(b) PARSE_COMPLETED ↔ consume(s2) — the { job } envelope arrives on the s2 topic', () => {
      it('GIVEN the RMQ pub/sub precondition WHEN the daemon emits PARSE_COMPLETED on the real RMQ pub/sub pair THEN consume(s2) returns the { job } envelope (S2) · contract rmq-pubsub', async () => {
        const job = { _id: 'rmq-probe-s2', role: 'Backend Engineer', stage: JobStage.FULL_PARSED };
        const comp = tui.rmq.consume('s2');

        await daemon.rmq.ports.parse.emitCompleted(job, {
          stage: JobStage.FULL_PARSED,
          source: JobSource.MANUAL,
        });

        const msg = await comp;
        expect(msg).toBeDefined();
        expect(msg.job).toBeDefined();
        expect(msg.job._id).toBe('rmq-probe-s2');
        expect(msg.job.stage).toBe(JobStage.FULL_PARSED);
      });

      it('GIVEN the RMQ pub/sub precondition WHEN a full merge runs on the real RMQ pub/sub pair THEN the ENRICHED job republishes PARSE_COMPLETED to the s2 topic (S2+S1) · contract rmq-pubsub', async () => {
        const partialHtml = topcvEmailHtmlMany([{ role: 'Software Engineer', company: 'S2 Co' }]);
        const gen = tui.rmq.consume('s1');
        await daemon.apps.ingest.processIngest(
          JobSource.BROWSER_AUTO,
          JobStage.PARTIAL_PARSED,
          partialHtml,
          undefined,
          { messageId: 'rmq-s2-msg' }
        );
        const genMsg = await gen;
        const jobLifecycleId = genMsg._id;

        const fullHtml = topcvDetailHtml('Software Engineer', 'S2 Co');
        const comp = tui.rmq.consume('s2');
        await daemon.apps.ingest.processIngest(
          JobSource.MANUAL,
          JobStage.FULL_PARSED,
          fullHtml,
          jobLifecycleId
        );

        const compMsg = await comp;
        expect(compMsg).toBeDefined();
        expect(compMsg.job).toBeDefined();
        expect(compMsg.job._id).toBe(jobLifecycleId);
        expect(compMsg.job.stage).toBe(JobStage.FULL_PARSED);
        expect(compMsg.job.status).toBe('enriched');
      });
    });

    describe('(c) QUEUED / TRASHED / ROUTE_FAILED / PARSE_FAILED ↔ consume(s34) — the jobLifecycleId arrives on the s34 topic', () => {
      it('GIVEN the RMQ pub/sub precondition WHEN the daemon emits QUEUED on the real RMQ pub/sub pair THEN consume(s34) returns the jobLifecycleId (S3) · contract rmq-pubsub', async () => {
        const queued = tui.rmq.consume('s34');

        await daemon.rmq.ports.route.emitJobQueued('rmq-probe-queued', {
          source: JobSource.MANUAL,
        });

        const msg = await queued;
        expect(msg.jobLifecycleId).toBe('rmq-probe-queued');
      });

      it('GIVEN the RMQ pub/sub precondition WHEN the daemon emits TRASHED on the real RMQ pub/sub pair THEN consume(s34) returns the jobLifecycleId + operator:trash reason (S4) · contract rmq-pubsub', async () => {
        const trash = tui.rmq.consume('s34');

        await daemon.rmq.ports.route.emitJobTrashed('rmq-probe-trash', 'operator:trash');

        const msg = await trash;
        expect(msg.jobLifecycleId).toBe('rmq-probe-trash');
        expect(msg.reason).toBe('operator:trash');
      });

      it('GIVEN the RMQ pub/sub precondition WHEN the daemon emits ROUTE_FAILED on the real RMQ pub/sub pair THEN consume(s34) returns the jobLifecycleId + failure reason (S4) · contract rmq-pubsub', async () => {
        const fail = tui.rmq.consume('s34');

        await daemon.rmq.ports.route.emitRouteFailed(
          'rmq-probe-fail',
          'No existing job lifecycle found'
        );

        const msg = await fail;
        expect(msg.jobLifecycleId).toBe('rmq-probe-fail');
        expect(msg.reason).toBe('No existing job lifecycle found');
      });

      it('GIVEN the RMQ pub/sub precondition WHEN the daemon emits PARSE_FAILED on the real RMQ pub/sub pair THEN consume(s34) returns the jobLifecycleId (S4) · contract rmq-pubsub', async () => {
        const fail = tui.rmq.consume('s34');

        await daemon.rmq.ports.parse.emitFailed('rmq-probe-parse-fail', {
          stage: JobStage.FULL_PARSED,
          source: JobSource.MANUAL,
          error: 'Parse error',
        });

        const msg = await fail;
        expect(msg.jobLifecycleId).toBe('rmq-probe-parse-fail');
      });

      it('GIVEN an ENRICHED job WHEN processResolution(queue) on the real RMQ pub/sub pair THEN the saga republishes QUEUED to the s34 topic (S2+S1+S3) · contract rmq-pubsub', async () => {
        const partialHtml = topcvEmailHtmlMany([
          { role: 'Software Engineer', company: 'Queue Co' },
        ]);
        const gen = tui.rmq.consume('s1');
        await daemon.apps.ingest.processIngest(
          JobSource.BROWSER_AUTO,
          JobStage.PARTIAL_PARSED,
          partialHtml,
          undefined,
          { messageId: 'rmq-queue-msg' }
        );
        const genMsg = await gen;
        const jobLifecycleId = genMsg._id;

        const comp = tui.rmq.consume('s2');
        await daemon.apps.ingest.processIngest(
          JobSource.MANUAL,
          JobStage.FULL_PARSED,
          topcvDetailHtml('Software Engineer', 'Queue Co'),
          jobLifecycleId
        );
        await comp;

        const queue = tui.rmq.consume('s34');
        await daemon.apps.ingest.processResolution(jobLifecycleId, 'queue');

        const queueMsg = await queue;
        expect(queueMsg).toBeDefined();
        expect(queueMsg.jobLifecycleId).toBe(jobLifecycleId);
      });

      it('GIVEN an ENRICHED job WHEN processResolution(trash) on the real RMQ pub/sub pair THEN the saga republishes TRASHED to the s34 topic (S2+S1) · contract rmq-pubsub', async () => {
        const partialHtml = topcvEmailHtmlMany([
          { role: 'Software Engineer', company: 'Trash Co' },
        ]);
        const gen = tui.rmq.consume('s1');
        await daemon.apps.ingest.processIngest(
          JobSource.BROWSER_AUTO,
          JobStage.PARTIAL_PARSED,
          partialHtml,
          undefined,
          { messageId: 'rmq-trash-msg' }
        );
        const genMsg = await gen;
        const jobLifecycleId = genMsg._id;

        const comp = tui.rmq.consume('s2');
        await daemon.apps.ingest.processIngest(
          JobSource.MANUAL,
          JobStage.FULL_PARSED,
          topcvDetailHtml('Software Engineer', 'Trash Co'),
          jobLifecycleId
        );
        await comp;

        const trash = tui.rmq.consume('s34');
        await daemon.apps.ingest.processResolution(jobLifecycleId, 'trash');

        const trashMsg = await trash;
        expect(trashMsg).toBeDefined();
        expect(trashMsg.jobLifecycleId).toBe(jobLifecycleId);
        expect(trashMsg.reason).toBe('operator:trash');
      });

      it('GIVEN a missing job WHEN processResolution on the real RMQ pub/sub pair THEN the saga republishes ROUTE_FAILED to the s34 topic · contract rmq-pubsub', async () => {
        const fail = tui.rmq.consume('s34');
        await daemon.apps.ingest.processResolution('nonexistent-job', 'queue');

        const failMsg = await fail;
        expect(failMsg).toBeDefined();
        expect(failMsg.jobLifecycleId).toBe('nonexistent-job');
        expect(failMsg.reason).toBe('No existing job lifecycle found');
      });

      it('GIVEN empty HTML WHEN processIngest on the real RMQ pub/sub pair THEN the saga republishes PARSE_FAILED to the s34 topic (S2) · contract rmq-pubsub', async () => {
        const fail = tui.rmq.consume('s34');
        await daemon.apps.ingest.processIngest(
          JobSource.MANUAL,
          JobStage.FULL_PARSED,
          '',
          'empty-rmq-id'
        );

        const failMsg = await fail;
        expect(failMsg).toBeDefined();
        expect(failMsg.jobLifecycleId).toBe('empty-rmq-id');
      });
    });

    describe('(d) real reader read-back — publish → RabbitMqJobReader queue depth / ipc seam', () => {
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
        await waitFor(() => tui.rmq.reader.getQueueDepth() === 1);
        expect(tui.ipc.read().job?.company).toBe('QCo1');
        expect(tui.rmq.reader.getQueueDepth()).toBe(1);
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
        expect(tui.rmq.reader.getQueueDepth()).toBe(0);
      });
    });
  }
);
