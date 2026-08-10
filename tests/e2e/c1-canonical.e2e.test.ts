import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import { createE2eApp, ActionEvent, type E2eApp } from '../helpers/e2e-app.js';
import { topcvDetailHtml } from '../helpers/html-fixtures.js';
import { JobStage, JobStatus } from '../../src/domain/types/job-lifecycle.js';

describe('C1 canonical e2e — webhook msg → s1 → s2 full parse → [j] queue → asset pdf (prod bootstrap, real deps)', () => {
  const messageId = 'c1-canonical-msg';
  const jobLifecycleId = `${messageId}-job-0`;
  let app: E2eApp;

  beforeAll(async () => {
    app = await createE2eApp({
      ns: 'c1-canonical',
      role: 'Software Engineer',
      company: 'C1CanonicalCo',
    });
  }, 120000);

  afterAll(async () => {
    await app.stop();
  });

  it('webhook s1 → GENERATED; s2 full parse → PARSE_COMPLETED; [j] → QUEUED + real asset pdf', async () => {
    const gen = await app.events.on([ActionEvent.GENERATED]);
    const res = await app.webhook.post(messageId);
    expect(res.status).toBe(202);

    const genMsg = await gen.msg();
    expect(genMsg._id).toBe(jobLifecycleId);
    expect(genMsg.role).toBe('Software Engineer');
    expect(genMsg.company).toBe('C1CanonicalCo');
    expect(genMsg.stage).toBe(JobStage.PARTIAL_PARSED);

    const s1Doc = await app.adapter.findById(jobLifecycleId);
    expect(s1Doc).not.toBeNull();
    expect(s1Doc!.status).toBe(JobStatus.ENRICHING);

    const comp = await app.events.on([ActionEvent.PARSE_COMPLETED]);
    const cRes = await app.uds.ingest(
      topcvDetailHtml('Software Engineer', 'C1CanonicalCo'),
      jobLifecycleId
    );
    expect(cRes.statusCode).toBe(200);

    const compMsg = await comp.msg();
    expect(compMsg.job).toBeDefined();
    expect(compMsg.job._id).toBe(jobLifecycleId);
    expect(compMsg.job.stage).toBe(JobStage.FULL_PARSED);
    expect(compMsg.job.status).toBe(JobStatus.ENRICHED);

    const queue = await app.events.on([
      ActionEvent.QUEUED,
      ActionEvent.TRASHED,
      ActionEvent.ROUTE_FAILED,
    ]);
    const jRes = await app.uds.action(jobLifecycleId, 'queue');
    expect(jRes.statusCode).toBe(200);

    const queueMsg = await queue.msg();
    expect(queueMsg.jobLifecycleId).toBe(jobLifecycleId);

    const pdfPath = await app.artifacts.waitForPdf();
    expect(pdfPath).toBeTruthy();
    expect(fs.existsSync(pdfPath)).toBe(true);
    expect(fs.statSync(pdfPath).size).toBeGreaterThan(0);

    const finalDoc = await app.adapter.findById(jobLifecycleId);
    expect(finalDoc).not.toBeNull();
    expect(finalDoc!.stage).toBe(JobStage.FULL_PARSED);
    expect(finalDoc!.status).toBe(JobStatus.QUEUED);
  }, 60000);
});
