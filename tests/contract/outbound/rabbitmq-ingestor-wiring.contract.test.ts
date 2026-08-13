import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { ActionEvent } from '../../../src/domain/types/action-event.js';
import { JobStage, JobSource } from '../../../src/domain/types/job-lifecycle.js';
import { topcvEmailHtmlMany, topcvDetailHtml } from '../../helpers/html-fixtures.js';
import { buildTestDaemonContainer, type TestDaemonContainer } from '../../helpers/test-container.js';

/**
 * Ingestor saga over the real composition root: processIngest / processResolution
 * driven on the container-resolved JobIngestor (real Mongo + real RMQ outbound
 * adapters), with each republished signal asserted on its labeled topic.
 */
describe('RMQ + Ingestor wiring', { timeout: 60000 }, () => {
  let tc: TestDaemonContainer;

  beforeAll(async () => {
    tc = await buildTestDaemonContainer({ ns: 'rmq-ingestor-wiring' });
    await tc.start();
  }, 120000);

  afterAll(async () => {
    await tc.stop();
  });

  it('GIVEN the RMQ precondition WHEN processIngest on the real Ingestor THEN S1 signal: PARTIAL_PARSED publish emits GENERATED event on RMQ (S1)', async () => {
    const html = topcvEmailHtmlMany([{ role: 'Software Engineer', company: 'S1 Co' }]);
    const genHandle = await tc.bus.setup([ActionEvent.GENERATED]);

    await tc.ingestor.processIngest(
      JobSource.BROWSER_AUTO,
      JobStage.PARTIAL_PARSED,
      html,
      undefined,
      {
        messageId: 's1-test-msg',
      }
    );

    const msg = await genHandle.msg();
    expect(msg).toBeDefined();
    expect(msg._id).toMatch(/^s1-test-msg-job-/);
    expect(msg.role).toBe('Software Engineer');
    expect(msg.company).toBe('S1 Co');
    expect(msg.stage).toBe(JobStage.PARTIAL_PARSED);
  });

  it('GIVEN the RMQ precondition WHEN processIngest on the real Ingestor THEN S2 signal: MANUAL FULL_PARSED with jobLifecycleId emits PARSE_COMPLETED (S2+S1)', async () => {
    const partialHtml = topcvEmailHtmlMany([{ role: 'Software Engineer', company: 'S2 Co' }]);
    const genHandle = await tc.bus.setup([ActionEvent.GENERATED]);

    await tc.ingestor.processIngest(
      JobSource.BROWSER_AUTO,
      JobStage.PARTIAL_PARSED,
      partialHtml,
      undefined,
      {
        messageId: 's2-msg',
      }
    );
    const genMsg = await genHandle.msg();
    const jobLifecycleId = genMsg._id;

    const fullHtml = topcvDetailHtml('Software Engineer', 'S2 Co');
    const compHandle = await tc.bus.setup([ActionEvent.PARSE_COMPLETED]);

    await tc.ingestor.processIngest(
      JobSource.MANUAL,
      JobStage.FULL_PARSED,
      fullHtml,
      jobLifecycleId
    );

    const compMsg = await compHandle.msg();
    expect(compMsg).toBeDefined();
    expect(compMsg.job).toBeDefined();
    expect(compMsg.job._id).toBe(jobLifecycleId);
    expect(compMsg.job.stage).toBe(JobStage.FULL_PARSED);
    expect(compMsg.job.status).toBe('enriched');
  });

  it('GIVEN the RMQ precondition WHEN processIngest → processResolution on the real Ingestor THEN Queue resolution emits QUEUED event on RMQ (S2+S1)', async () => {
    const partialHtml = topcvEmailHtmlMany([{ role: 'Software Engineer', company: 'Queue Co' }]);
    const genHandle = await tc.bus.setup([ActionEvent.GENERATED]);

    await tc.ingestor.processIngest(
      JobSource.BROWSER_AUTO,
      JobStage.PARTIAL_PARSED,
      partialHtml,
      undefined,
      {
        messageId: 'queue-msg',
      }
    );
    const genMsg = await genHandle.msg();
    const jobLifecycleId = genMsg._id;

    const fullHtml = topcvDetailHtml('Software Engineer', 'Queue Co');
    const compHandle = await tc.bus.setup([ActionEvent.PARSE_COMPLETED]);
    await tc.ingestor.processIngest(
      JobSource.MANUAL,
      JobStage.FULL_PARSED,
      fullHtml,
      jobLifecycleId
    );
    await compHandle.msg();

    const queueHandle = await tc.bus.setup([ActionEvent.QUEUED]);
    await tc.ingestor.processResolution(jobLifecycleId, 'queue');

    const queueMsg = await queueHandle.msg();
    expect(queueMsg).toBeDefined();
    expect(queueMsg.jobLifecycleId).toBe(jobLifecycleId);
  });

  it('GIVEN the RMQ precondition WHEN processIngest → processResolution on the real Ingestor THEN Trash resolution emits TRASHED event on RMQ (S2+S1)', async () => {
    const partialHtml = topcvEmailHtmlMany([{ role: 'Software Engineer', company: 'Trash Co' }]);
    const genHandle = await tc.bus.setup([ActionEvent.GENERATED]);

    await tc.ingestor.processIngest(
      JobSource.BROWSER_AUTO,
      JobStage.PARTIAL_PARSED,
      partialHtml,
      undefined,
      {
        messageId: 'trash-msg',
      }
    );
    const genMsg = await genHandle.msg();
    const jobLifecycleId = genMsg._id;

    const fullHtml = topcvDetailHtml('Software Engineer', 'Trash Co');
    const compHandle = await tc.bus.setup([ActionEvent.PARSE_COMPLETED]);
    await tc.ingestor.processIngest(
      JobSource.MANUAL,
      JobStage.FULL_PARSED,
      fullHtml,
      jobLifecycleId
    );
    await compHandle.msg();

    const trashHandle = await tc.bus.setup([ActionEvent.TRASHED]);
    await tc.ingestor.processResolution(jobLifecycleId, 'trash');

    const trashMsg = await trashHandle.msg();
    expect(trashMsg).toBeDefined();
    expect(trashMsg.jobLifecycleId).toBe(jobLifecycleId);
    expect(trashMsg.reason).toBe('operator:trash');
  });

  it('GIVEN the RMQ precondition WHEN processResolution on the real Ingestor THEN Resolution with missing job emits ROUTE_FAILED event on RMQ', async () => {
    const failHandle = await tc.bus.setup([ActionEvent.ROUTE_FAILED]);
    await tc.ingestor.processResolution('nonexistent-job', 'queue');

    const failMsg = await failHandle.msg();
    expect(failMsg).toBeDefined();
    expect(failMsg.jobLifecycleId).toBe('nonexistent-job');
    expect(failMsg.reason).toBe('No existing job lifecycle found');
  });

  it('GIVEN the RMQ precondition WHEN processIngest on the real Ingestor THEN Empty HTML ingest emits PARSE_FAILED event on RMQ (S2)', async () => {
    const failHandle = await tc.bus.setup([ActionEvent.PARSE_FAILED]);
    await tc.ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, '', 'empty-id');

    const failMsg = await failHandle.msg();
    expect(failMsg).toBeDefined();
    expect(failMsg.jobLifecycleId).toBe('empty-id');
  });
});
