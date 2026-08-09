import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createE2eApp, ActionEvent, type E2eApp } from '../helpers/e2e-app.js';
import { topcvDetailHtml } from '../helpers/html-fixtures.js';
import { JobStage, JobStatus } from '../../src/domain/types/job-lifecycle.js';

describe('C4 direct e2e — [i] clipboard ingest → fully job → [d] trash → next cycle (prod bootstrap, no queue/asset mocks)', () => {
  let app: E2eApp;

  beforeAll(async () => {
    app = await createE2eApp({ ns: 'c4-direct' });
  }, 120000);

  afterAll(async () => {
    await app.stop();
  });

  it('[i] clipboard ingest → ENRICHED clip-* doc; [d] trash → TRASHED; next direct ingest still completes', async () => {
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

    const stored = await app.adapter.findById(firstJobId);
    expect(stored).not.toBeNull();
    expect(stored!.status).toBe(JobStatus.ENRICHED);
    expect(stored!.source).toBe('manual');

    const trash = await app.events.on([ActionEvent.TRASHED, ActionEvent.ROUTE_FAILED, ActionEvent.PARSE_FAILED]);
    const dRes = await app.uds.action(firstJobId, 'trash');
    expect(dRes.statusCode).toBe(200);

    const trashMsg = await trash.msg();
    expect(trashMsg.jobLifecycleId).toBe(firstJobId);
    expect(trashMsg.reason).toBe('operator:trash');

    const trashed = await app.adapter.findById(firstJobId);
    expect(trashed).not.toBeNull();
    expect(trashed!.status).toBe(JobStatus.TRASHED);

    const comp2 = await app.events.on([ActionEvent.PARSE_COMPLETED]);
    const i2Res = await app.uds.ingest(topcvDetailHtml('Data Engineer', 'C4DirectCo2'));
    expect(i2Res.statusCode).toBe(200);

    const comp2Msg = await comp2.msg();
    expect(comp2Msg.job._id).toMatch(/^clip-/);
    expect(comp2Msg.job._id).not.toBe(firstJobId);
    expect(comp2Msg.job.company).toBe('C4DirectCo2');

    const stored2 = await app.adapter.findById(comp2Msg.job._id);
    expect(stored2).not.toBeNull();
    expect(stored2!.status).toBe(JobStatus.ENRICHED);
  }, 60000);
});