/*
 * e2e c3-error (prod bootstrap, real deps, black-box; no IoC in the body):
 * GIVEN an unparseable UDS clipboard WHEN the parse fails THEN S4 PARSE_FAILED,
 * and the next valid clipboard recovers to S2 PARSE_COMPLETED (ENRICHED clip-* doc).
 */
import amqplib from 'amqplib';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { JobStage, JobStatus } from '../../src/domain/types/job-lifecycle.js';
import { getCurrentJob } from '../../src/presentation/tui/shared-tui-state.js';
import { createE2eApp, ActionEvent, type E2eApp } from '../helpers/e2e-app.js';
import { topcvDetailHtml, nonJobHtml } from '../helpers/html-fixtures.js';
import { buildTuiTestContainer } from '../helpers/test-container.js';

const RMQ_URL = process.env.RABBITMQ_URL || 'amqp://localhost';

async function waitFor(check: () => boolean, timeoutMs = 15000, intervalMs = 50): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms`);
}

async function purgeTuiQueues(ns: string): Promise<void> {
  const conn = await amqplib.connect(RMQ_URL);
  const ch = await conn.createChannel();
  for (const suffix of ['s1', 's2', 's3s4']) {
    try {
      await ch.assertQueue(`tui.${ns}.${suffix}`);
      await ch.purgeQueue(`tui.${ns}.${suffix}`);
    } catch {
      /* best-effort — a missing/closed queue is treated as empty */
    }
  }
  try {
    await ch.close();
  } catch {
    /* channel may already be closed by the server */
  }
  await conn.close();
}

describe('C3 error e2e — s2 failure → s4 → next valid s2 recovers (prod bootstrap, real deps)', () => {
  const messageId = 'c3-error-recovery';
  let app: E2eApp;

  beforeAll(async () => {
    app = await createE2eApp({ ns: 'c3-error' });
  }, 120000);

  afterAll(async () => {
    await app.stop();
  });

  it('GIVEN unparseable UDS ingest WHEN PARSE_FAILED (s4); next valid clipboard THEN PARSE_COMPLETED + ENRICHED clip-* doc (recovery)', async () => {
    const fail = await app.events.on([ActionEvent.PARSE_FAILED]);
    const failRes = await app.uds.ingest(nonJobHtml(), messageId);
    expect(failRes.statusCode).toBe(200);

    const failMsg = await fail.msg();
    expect(failMsg.jobLifecycleId).toBe(messageId);

    const comp = await app.events.on([ActionEvent.PARSE_COMPLETED]);
    const okRes = await app.uds.ingest(topcvDetailHtml('Software Engineer', 'C3RecoveryCo'));
    expect(okRes.statusCode).toBe(200);

    const compMsg = await comp.msg();
    expect(compMsg.job).toBeDefined();
    expect(compMsg.job._id).toMatch(/^clip-/);
    expect(compMsg.job.company).toBe('C3RecoveryCo');
    expect(compMsg.job.stage).toBe(JobStage.FULL_PARSED);
    expect(compMsg.job.status).toBe(JobStatus.ENRICHED);
  }, 60000);

  it('GIVEN a [j] action for an unknown jobLifecycleId WHEN the path is exercised THEN ROUTE_FAILED (s4); next valid clipboard still recovers', async () => {
    const fail = await app.events.on([ActionEvent.ROUTE_FAILED]);
    const res = await app.uds.action('c3-route-fail-unknown', 'queue');
    expect(res.statusCode).toBe(200);

    const failMsg = await fail.msg();
    expect(failMsg.jobLifecycleId).toBe('c3-route-fail-unknown');
    expect(failMsg.reason).toBe('No existing job lifecycle found');

    const comp = await app.events.on([ActionEvent.PARSE_COMPLETED]);
    const okRes = await app.uds.ingest(topcvDetailHtml('Software Engineer', 'C3ResilientCo'));
    expect(okRes.statusCode).toBe(200);

    const compMsg = await comp.msg();
    expect(compMsg.job).toBeDefined();
    expect(compMsg.job._id).toMatch(/^clip-/);
    expect(compMsg.job.company).toBe('C3ResilientCo');
    expect(compMsg.job.status).toBe(JobStatus.ENRICHED);
  }, 60000);

  it('GIVEN the tui-ioc precondition WHEN the daemon webhook+paste publishes S1+S2 over RMQ and the tui sends [j] over UDS THEN the reader mirrors then clears the job on the ipc seam (tui↔daemon real RMQ+UDS) · e2e c3', async () => {
    await purgeTuiQueues('c3-error');
    const tui = await buildTuiTestContainer({ ns: 'c3-error' });
    try {
      await waitFor(() => tui.rmqReader.isConnected());
      await app.resetDb();

      const gen = await app.events.on([ActionEvent.GENERATED]);
      const res = await app.webhook.post('c3-boundary-msg');
      expect(res.status).toBe(202);

      const genMsg = await gen.msg();
      const jobId: string = genMsg._id;
      await waitFor(() => getCurrentJob().jobLifecycleId === jobId);
      expect(getCurrentJob().stage).toBe(JobStage.PARTIAL_PARSED);

      const comp = await app.events.on([ActionEvent.PARSE_COMPLETED]);
      const cRes = await app.uds.ingest(
        topcvDetailHtml('Software Engineer', 'E2eCanonicalCo'),
        jobId
      );
      expect(cRes.statusCode).toBe(200);

      const compMsg = await comp.msg();
      expect(compMsg.job._id).toBe(jobId);
      await waitFor(
        () =>
          getCurrentJob().jobLifecycleId === jobId && getCurrentJob().stage === JobStage.FULL_PARSED
      );

      const queue = await app.events.on([
        ActionEvent.QUEUED,
        ActionEvent.TRASHED,
        ActionEvent.ROUTE_FAILED,
      ]);
      await tui.udsWriter.queue(jobId);

      const queueMsg = await queue.msg();
      expect(queueMsg.jobLifecycleId).toBe(jobId);
      await waitFor(() => getCurrentJob().jobLifecycleId === null);
      expect(getCurrentJob().job).toBeNull();
    } finally {
      await tui.stop();
    }
  }, 90000);
});
