import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createE2eApp, ActionEvent, type E2eApp } from '../helpers/e2e-app.js';
import { topcvDetailHtml, nonJobHtml } from '../helpers/html-fixtures.js';
import { JobStage, JobStatus } from '../../src/domain/types/job-lifecycle.js';

describe('C3 error e2e — s2 failure → s4 → next valid s2 recovers (prod bootstrap, real deps)', () => {
  const messageId = 'c3-error-recovery';
  let app: E2eApp;

  beforeAll(async () => {
    app = await createE2eApp({ ns: 'c3-error' });
  }, 120000);

  afterAll(async () => {
    await app.stop();
  });

  it('unparseable UDS ingest → PARSE_FAILED (s4); next valid clipboard → PARSE_COMPLETED + ENRICHED clip-* doc (recovery)', async () => {
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

    const okDoc = await app.adapter.findById(compMsg.job._id);
    expect(okDoc).not.toBeNull();
    expect(okDoc!.company).toBe('C3RecoveryCo');
  }, 60000);
});
