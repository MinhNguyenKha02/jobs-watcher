/*
 * e2e c4-direct (prod bootstrap, real deps, black-box; no IoC in the body):
 * GIVEN an [i] clipboard ingest (no S1) WHEN [j]/[d] UDS resolution is applied
 * THEN a clip-* ENRICHED doc routes to S3 QUEUED / S4 TRASHED and the next direct ingest completes.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createE2eApp, ActionEvent, type E2eApp } from '../helpers/e2e-app.js';
import { topcvDetailHtml } from '../helpers/html-fixtures.js';
import { JobStage, JobStatus, JobSource } from '../../src/domain/types/job-lifecycle.js';

describe('C4 direct e2e — [i] clipboard ingest → fully job → [d] trash → next cycle (prod bootstrap, no queue/asset mocks)', () => {
  let app: E2eApp;

  beforeAll(async () => {
    app = await createE2eApp({ ns: 'c4-direct' });
  }, 120000);

  afterAll(async () => {
    await app.stop();
  });

  it('GIVEN [i] clipboard ingest WHEN ENRICHED clip-* doc; [d] trash THEN TRASHED; next direct ingest still completes', async () => {
    const comp = await app.events.on([ActionEvent.PARSE_COMPLETED]);
    const iRes = await app.uds.ingest(topcvDetailHtml('Backend Engineer', 'C4DirectCo'));
    expect(iRes.statusCode).toBe(200);

    const compMsg = await comp.msg();
    const firstJobId: string = compMsg.job._id;
    expect(firstJobId).toMatch(/^clip-/);
    expect(compMsg.job.role).toBe('Backend Engineer');
    expect(compMsg.job.company).toBe('C4DirectCo');
    expect(compMsg.job.stage).toBe(JobStage.FULL_PARSED);
    expect(compMsg.job.status).toBe(JobStatus.ENRICHED);
    expect(compMsg.job.source).toBe(JobSource.MANUAL);

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

    const comp2 = await app.events.on([ActionEvent.PARSE_COMPLETED]);
    const i2Res = await app.uds.ingest(topcvDetailHtml('Data Engineer', 'C4DirectCo2'));
    expect(i2Res.statusCode).toBe(200);

    const comp2Msg = await comp2.msg();
    expect(comp2Msg.job._id).toMatch(/^clip-/);
    expect(comp2Msg.job._id).not.toBe(firstJobId);
    expect(comp2Msg.job.company).toBe('C4DirectCo2');
    expect(comp2Msg.job.status).toBe(JobStatus.ENRICHED);
  }, 60000);

  it('GIVEN [i] clipboard ingest WHEN a [j] resolution is applied THEN QUEUED + real asset pdf; next direct ingest still completes', async () => {
    const comp = await app.events.on([ActionEvent.PARSE_COMPLETED]);
    const iRes = await app.uds.ingest(topcvDetailHtml('DevOps Engineer', 'C4QueueCo'));
    expect(iRes.statusCode).toBe(200);

    const compMsg = await comp.msg();
    const jobId: string = compMsg.job._id;
    expect(jobId).toMatch(/^clip-/);
    expect(compMsg.job.status).toBe(JobStatus.ENRICHED);

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

    const comp2 = await app.events.on([ActionEvent.PARSE_COMPLETED]);
    const i2Res = await app.uds.ingest(topcvDetailHtml('Frontend Engineer', 'C4QueueCo2'));
    expect(i2Res.statusCode).toBe(200);

    const comp2Msg = await comp2.msg();
    expect(comp2Msg.job._id).toMatch(/^clip-/);
    expect(comp2Msg.job._id).not.toBe(jobId);
    expect(comp2Msg.job.company).toBe('C4QueueCo2');
    expect(comp2Msg.job.status).toBe(JobStatus.ENRICHED);
  }, 60000);

  it('GIVEN an empty [i] clipboard WHEN the path is exercised THEN the UDS boundary rejects it (400 empty payload) with no parse attempt; next direct ingest still completes', async () => {
    const fail = await app.events.on([ActionEvent.PARSE_FAILED], 2000);
    const emptyRes = await app.uds.ingest('');
    expect(emptyRes.statusCode).toBe(400);
    await expect(fail.msg()).rejects.toThrow();

    const comp = await app.events.on([ActionEvent.PARSE_COMPLETED]);
    const okRes = await app.uds.ingest(topcvDetailHtml('Site Reliability Engineer', 'C4EmptyCo'));
    expect(okRes.statusCode).toBe(200);

    const compMsg = await comp.msg();
    expect(compMsg.job._id).toMatch(/^clip-/);
    expect(compMsg.job.company).toBe('C4EmptyCo');
    expect(compMsg.job.status).toBe(JobStatus.ENRICHED);
  }, 60000);
});
