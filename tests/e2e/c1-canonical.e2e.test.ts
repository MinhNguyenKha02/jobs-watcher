/*
 * e2e c1-canonical (prod bootstrap, real deps, black-box; no IoC in the body):
 * GIVEN a webhook msg WHEN the prod bootstrap ingests → [c] UDS paste → [j] UDS action
 * THEN S1 GENERATED → S2 PARSE_COMPLETED → S3 QUEUED and a real asset PDF is produced.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import { createE2eApp, ActionEvent, type E2eApp } from '../helpers/e2e-app.js';
import { topcvDetailHtml, nonJobHtml } from '../helpers/html-fixtures.js';
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
      jobForMessage: (mid) => {
        if (mid === 'c1-canonical-msg')
          return { role: 'Software Engineer', company: 'C1CanonicalCo' };
        if (mid === 'c1-fail-msg') return { role: 'Software Engineer', company: 'C1FailCo' };
        return { role: 'Software Engineer', company: 'C1RecoveryCo' };
      },
    });
  }, 120000);

  afterAll(async () => {
    await app.stop();
  });

  it('GIVEN webhook s1 WHEN GENERATED; s2 full parse → PARSE_COMPLETED; [j] THEN QUEUED + real asset pdf', async () => {
    const gen = await app.events.on([ActionEvent.GENERATED]);
    const res = await app.webhook.post(messageId);
    expect(res.status).toBe(202);

    const genMsg = await gen.msg();
    expect(genMsg._id).toBe(jobLifecycleId);
    expect(genMsg.role).toBe('Software Engineer');
    expect(genMsg.company).toBe('C1CanonicalCo');
    expect(genMsg.stage).toBe(JobStage.PARTIAL_PARSED);
    expect(genMsg.status).toBe(JobStatus.ENRICHING);

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
  }, 60000);

  it('GIVEN an unparseable [c] paste after webhook s1 WHEN the path is exercised THEN PARSE_FAILED (s4); next webhook s1 recovers (GENERATED)', async () => {
    const gen = await app.events.on([ActionEvent.GENERATED]);
    const failRes = await app.webhook.post('c1-fail-msg');
    expect(failRes.status).toBe(202);

    const genMsg = await gen.msg();
    const s1Id: string = genMsg._id;
    expect(genMsg.company).toBe('C1FailCo');
    expect(genMsg.status).toBe(JobStatus.ENRICHING);

    const fail = await app.events.on([ActionEvent.PARSE_FAILED]);
    const cRes = await app.uds.ingest(nonJobHtml(), s1Id);
    expect(cRes.statusCode).toBe(200);

    const failMsg = await fail.msg();
    expect(failMsg.jobLifecycleId).toBe(s1Id);

    const gen2 = await app.events.on([ActionEvent.GENERATED]);
    const res2 = await app.webhook.post('c1-recovery-msg');
    expect(res2.status).toBe(202);

    const gen2Msg = await gen2.msg();
    expect(gen2Msg._id).toBe('c1-recovery-msg-job-0');
    expect(gen2Msg.company).toBe('C1RecoveryCo');
    expect(gen2Msg.status).toBe(JobStatus.ENRICHING);
  }, 60000);
});
