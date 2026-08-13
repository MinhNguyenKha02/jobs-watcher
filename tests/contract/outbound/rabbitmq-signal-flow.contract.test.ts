import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { ActionEvent } from '../../../src/domain/types/action-event.js';
import { JobStage, JobSource } from '../../../src/domain/types/job-lifecycle.js';
import { buildTestDaemonContainer, type TestDaemonContainer } from '../../helpers/test-container.js';

/**
 * Labeled transport probe: the real outbound Parse/Route adapters resolved from
 * the production composition root publish signal labels, and dedicated topic
 * bindings prove each label routes to its own topic
 * (GENERATED / PARSE_COMPLETED / PARSE_FAILED / QUEUED / TRASHED / ROUTE_FAILED).
 */
describe(
  'RMQ Signal Flow — container adapters + labeled transport probe',
  { timeout: 30000 },
  () => {
    let tc: TestDaemonContainer;

    beforeAll(async () => {
      tc = await buildTestDaemonContainer({ ns: 'rmq-signal-flow' });
      await tc.container.rmq.connect();
    }, 120000);

    afterAll(async () => {
      try {
        await tc.container.rmq.disconnect();
      } catch {
        /* best-effort */
      }
    });

    it('GIVEN the container adapters WHEN GENERATED is emitted THEN the event lands on the GENERATED topic (S1)', async () => {
      const doc = {
        _id: 'probe-s1',
        role: 'Software Engineer',
        company: 'Test Co',
        stage: JobStage.PARTIAL_PARSED,
      };
      const handle = await tc.bus.setup([ActionEvent.GENERATED]);

      await tc.container.parseAdapter.emitGenerated(doc, {
        stage: JobStage.PARTIAL_PARSED,
        source: JobSource.BROWSER_AUTO,
      });

      const msg = await handle.msg();
      expect(msg._id).toBe('probe-s1');
      expect(msg.role).toBe('Software Engineer');
      expect(msg.stage).toBe(JobStage.PARTIAL_PARSED);
    });

    it('GIVEN the container adapters WHEN full signal flow (generated → parse_completed → queued) is emitted THEN each label lands on its own topic (S1+S2+S3)', async () => {
      const job = { _id: 'probe-flow', role: 'Backend Engineer', stage: JobStage.FULL_PARSED };

      const s1 = await tc.bus.setup([ActionEvent.GENERATED]);
      await tc.container.parseAdapter.emitGenerated(job, {
        stage: JobStage.FULL_PARSED,
        source: JobSource.MANUAL,
      });
      const generated = await s1.msg();
      expect(generated._id).toBe('probe-flow');

      const s2 = await tc.bus.setup([ActionEvent.PARSE_COMPLETED]);
      await tc.container.parseAdapter.emitCompleted(job, {
        stage: JobStage.FULL_PARSED,
        source: JobSource.MANUAL,
      });
      const completed = await s2.msg();
      expect(completed.job._id).toBe('probe-flow');

      const s3 = await tc.bus.setup([ActionEvent.QUEUED]);
      await tc.container.routeAdapter.emitJobQueued('probe-flow', { source: JobSource.MANUAL });
      const queued = await s3.msg();
      expect(queued.jobLifecycleId).toBe('probe-flow');
    });

    it('GIVEN the container adapters WHEN TRASHED is emitted THEN the event lands on the TRASHED topic (S4)', async () => {
      const handle = await tc.bus.setup([ActionEvent.TRASHED]);

      await tc.container.routeAdapter.emitJobTrashed('probe-trash', 'operator:trash');

      const msg = await handle.msg();
      expect(msg.jobLifecycleId).toBe('probe-trash');
      expect(msg.reason).toBe('operator:trash');
    });

    it('GIVEN the container adapters WHEN ROUTE_FAILED is emitted THEN the event lands on the ROUTE_FAILED topic (S4)', async () => {
      const handle = await tc.bus.setup([ActionEvent.ROUTE_FAILED]);

      await tc.container.routeAdapter.emitRouteFailed(
        'probe-fail',
        'No existing job lifecycle found'
      );

      const msg = await handle.msg();
      expect(msg.jobLifecycleId).toBe('probe-fail');
      expect(msg.reason).toBe('No existing job lifecycle found');
    });

    it('GIVEN the container adapters WHEN PARSE_FAILED is emitted THEN the event lands on the PARSE_FAILED topic (S4)', async () => {
      const handle = await tc.bus.setup([ActionEvent.PARSE_FAILED]);

      await tc.container.parseAdapter.emitFailed('probe-parse-fail', {
        stage: JobStage.FULL_PARSED,
        source: JobSource.MANUAL,
        error: 'Parse error',
      });

      const msg = await handle.msg();
      expect(msg.jobLifecycleId).toBe('probe-parse-fail');
    });
  }
);
