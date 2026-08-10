/*
 * e2e c3-error (prod bootstrap, real deps, black-box; no IoC in the body):
 * GIVEN an unparseable UDS clipboard WHEN the parse fails THEN S4 PARSE_FAILED,
 * and the next valid clipboard recovers to S2 PARSE_COMPLETED (ENRICHED clip-* doc).
 */
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
});
