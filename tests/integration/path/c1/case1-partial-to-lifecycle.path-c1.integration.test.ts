/* Path cell (c1): S1 uds+ingestor+job_lifecycle; deep-parse enrichment S2 via rabbitmq (see plans/tests-path-matrix.md) */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createTestContainer } from '../../../helpers/test-container.js';
import { createParseEventPort, createRoutingPort } from '../../../helpers/mock-ports.js';

import { topcvEmailHtmlMany, topcvDetailHtml } from '../../../helpers/html-fixtures.js';
import { makeStage1Partial } from '../../../helpers/test-builders.js';
import { JobStage, JobSource, JobStatus } from '../../../../src/domain/types/job-lifecycle.js';
import { ActionEvent } from '../../../../src/domain/types/action-event.js';
import type { TestContainer } from '../../../helpers/test-container.js';

const { JobIngestor } = await import('../../../../src/application/ingestor.js');

const TOPCV_EMAIL_HTML = topcvEmailHtmlMany([{ role: 'Backend Developer', company: 'Case1Co' }]);

const CLIPBOARD_HTML = topcvDetailHtml('Backend Developer', 'Case1Co', {
  salary: '15,000,000 VNĐ',
  location: 'Ho Chi Minh',
});

describe('Case 1 partial→[o][p][c]→full→[j][d]→next', () => {
  let tc: TestContainer;
  let parseEvents: any[];
  let routingEvents: any[];

  beforeAll(async () => {
    tc = await createTestContainer({ ns: 'c1-case1' });
    await tc.start();
    parseEvents = [];
    routingEvents = [];
  }, 120000);

  afterAll(async () => {
    await tc.stop();
  });

  beforeEach(async () => {
    parseEvents.length = 0;
    routingEvents.length = 0;
    await tc.storage.clearDb();
  });

  // parts-integ: mock event ports for deterministic guard/no-emit assertions.
  function mockIngestor(): JobIngestor {
    const parseEventPort = createParseEventPort((tag, args) => parseEvents.push([tag, ...args]));
    const routingPort = createRoutingPort((tag, args) => routingEvents.push([tag, ...args]));
    return new JobIngestor(tc.mongoJobLifecycleAdapter, parseEventPort, routingPort);
  }

  // real-DIP: the production composition-root ingestor (real Parse/Route/Queue/Asset adapters).
  function realIngestor(): JobIngestor {
    return tc.ingestor;
  }

  it('T1a: S1 partial→S2 enrichment→[j] queue (canonical Case 1) — real-DIP', async () => {
    const ingestor = realIngestor();
    const messageId = 'e2e-case1-msg-1';

    const gen = await tc.bus.setup([ActionEvent.GENERATED]);
    await ingestor.processIngest(JobSource.BROWSER_AUTO, JobStage.PARTIAL_PARSED, TOPCV_EMAIL_HTML, undefined, { messageId, subject: 'Backend Developer' });

    const genMsg = await gen.msg();
    expect(genMsg._id).toMatch(/-job-0$/);
    const jobLifecycleId = genMsg._id;

    const partialDoc = await tc.mongoJobLifecycleAdapter.findById(jobLifecycleId);
    expect(partialDoc).not.toBeNull();
    expect(partialDoc!.stage).toBe(JobStage.PARTIAL_PARSED);
    expect(partialDoc!.status).toBe(JobStatus.ENRICHING);

    const comp = await tc.bus.setup([ActionEvent.PARSE_COMPLETED]);
    await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, CLIPBOARD_HTML, jobLifecycleId);

    const compMsg = await comp.msg();
    expect(compMsg.job).toBeDefined();
    expect(compMsg.job._id).toBe(jobLifecycleId);
    expect(compMsg.job.stage).toBe(JobStage.FULL_PARSED);
    expect(compMsg.job.status).toBe(JobStatus.ENRICHED);

    const enrichedDoc = await tc.mongoJobLifecycleAdapter.findById(jobLifecycleId);
    expect(enrichedDoc).not.toBeNull();
    expect(enrichedDoc!.stage).toBe(JobStage.FULL_PARSED);
    expect(enrichedDoc!.status).toBe(JobStatus.ENRICHED);
    expect(enrichedDoc!.salary).toBe('15,000,000 VNĐ');
    expect(enrichedDoc!.location).toBe('Ho Chi Minh');

    const queue = await tc.bus.setup([ActionEvent.QUEUED, ActionEvent.TRASHED, ActionEvent.ROUTE_FAILED]);
    await ingestor.processResolution(jobLifecycleId, 'queue');

    const queueMsg = await queue.msg();
    expect(queueMsg.jobLifecycleId).toBe(jobLifecycleId);

    const routedDoc = await tc.mongoJobLifecycleAdapter.findById(jobLifecycleId);
    expect(routedDoc).not.toBeNull();
    expect(routedDoc!.status).toBe(JobStatus.QUEUED);
  });

  it('T1b: [stack] queue before S2 arrives is guarded (deferred enrichment guard)', async () => {
    const ingestor = mockIngestor();
    const messageId = 'e2e-case1-msg-defer';

    await ingestor.processIngest(JobSource.BROWSER_AUTO, JobStage.PARTIAL_PARSED, TOPCV_EMAIL_HTML, undefined, { messageId, subject: 'Backend Developer' });

    const genEvents = parseEvents.filter(([t]) => t === 'generated');
    expect(genEvents.length).toBe(1);
    const jobLifecycleId = genEvents[0][1]._id;

    await ingestor.processResolution(jobLifecycleId, 'queue');

    const guardedDoc = await tc.mongoJobLifecycleAdapter.findById(jobLifecycleId);
    expect(guardedDoc).not.toBeNull();
    expect(guardedDoc!.status).toBe(JobStatus.ENRICHING);

    const queuedEvents = routingEvents.filter(([t]) => t === 'queued');
    expect(queuedEvents.length).toBe(0);
  });

  it('T1c: S1→S2→[2d] trash (Case 1 trash path) — real-DIP', async () => {
    const ingestor = realIngestor();
    const messageId = 'e2e-case1-trash';

    const gen = await tc.bus.setup([ActionEvent.GENERATED]);
    await ingestor.processIngest(JobSource.BROWSER_AUTO, JobStage.PARTIAL_PARSED, TOPCV_EMAIL_HTML, undefined, { messageId, subject: 'Backend Developer' });

    const genMsg = await gen.msg();
    const jobLifecycleId = genMsg._id;

    const comp = await tc.bus.setup([ActionEvent.PARSE_COMPLETED]);
    await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, CLIPBOARD_HTML, jobLifecycleId);

    await comp.msg();

    const trash = await tc.bus.setup([ActionEvent.TRASHED, ActionEvent.ROUTE_FAILED, ActionEvent.PARSE_FAILED]);
    await ingestor.processResolution(jobLifecycleId, 'trash');

    const trashMsg = await trash.msg();
    expect(trashMsg.jobLifecycleId).toBe(jobLifecycleId);
    expect(trashMsg.reason).toBe('operator:trash');

    const trashedDoc = await tc.mongoJobLifecycleAdapter.findById(jobLifecycleId);
    expect(trashedDoc).not.toBeNull();
    expect(trashedDoc!.status).toBe(JobStatus.TRASHED);
  });

  it('T1d: [c] on already FULL_PARSED job is no-op (B2 guard)', async () => {
    const ingestor = mockIngestor();
    const jobLifecycleId = 'e2e-case1-already-full';
    const partialDoc = makeStage1Partial({ _id: jobLifecycleId, company: 'AlreadyCo' });
    await tc.mongoJobLifecycleAdapter.upsert(partialDoc);

    await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, CLIPBOARD_HTML, jobLifecycleId);

    const completedBefore = parseEvents.filter(([t]) => t === 'completed').length;
    expect(completedBefore).toBe(1);

    await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, CLIPBOARD_HTML, jobLifecycleId);

    const completedAfter = parseEvents.filter(([t]) => t === 'completed').length;
    expect(completedAfter).toBe(completedBefore);

    const failedEvents = parseEvents.filter(([t]) => t === 'failed');
    expect(failedEvents.length).toBe(0);
  });

  it('T1e: [c] with empty clipboard emits parse.failed (S4 via B1 path)', async () => {
    const ingestor = mockIngestor();
    const jobLifecycleId = 'e2e-case1-empty-clip';
    const partialDoc = makeStage1Partial({ _id: jobLifecycleId, company: 'EmptyCo' });
    await tc.mongoJobLifecycleAdapter.upsert(partialDoc);

    await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, '', jobLifecycleId);

    const failedEvents = parseEvents.filter(([t]) => t === 'failed');
    expect(failedEvents.length).toBe(1);

    const failedDoc = await tc.mongoJobLifecycleAdapter.findById(jobLifecycleId);
    expect(failedDoc).not.toBeNull();
    expect(failedDoc!.status).toBe(JobStatus.ENRICHING);
  });
});
