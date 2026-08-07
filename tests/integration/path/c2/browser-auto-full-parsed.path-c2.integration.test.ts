/* Path cell (c2): S1→S2 browser full-parse → S3 via scheduler+rabbitmq (see plans/tests-path-matrix.md) */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createTestContainer, type TestContainer } from '../../../helpers/test-container.js';
import { createParseEventPort, createRoutingPort } from '../../../helpers/mock-ports.js';
import { indeedEmailHtmlMany, indeedDetailHtml } from '../../../helpers/html-fixtures.js';

import type { MongoJobLifecycleAdapter } from '../../../../src/infrastructure/outbound/persistence/mongo-job-lifecycle-adapter.js';
import { JobStage, JobSource, JobStatus } from '../../../../src/domain/types/job-lifecycle.js';

const { JobIngestor } = await import('../../../../src/application/ingestor.js');

const FULL_PARSED_HTML = indeedDetailHtml(
  'Backend Developer',
  'FullParsedCo',
  'https://vn.indeed.com/viewjob?jk=e2e-c2-full',
);

  describe('Case 2 full-parsed direct arrival (browser-auto S2 path)', () => {
  let tc: TestContainer;
  let adapter: MongoJobLifecycleAdapter;
  let parseEvents: any[];
  let routingEvents: any[];
  let ingestor: JobIngestor;

  beforeAll(async () => {
    tc = await createTestContainer({ ns: 'c2-browser-auto-full' });
    await tc.start();
    adapter = tc.mongoJobLifecycleAdapter;

    parseEvents = [];
    routingEvents = [];

    const parseEventPort = createParseEventPort((tag, args) => parseEvents.push([tag, ...args]));

    const routingPort = createRoutingPort((tag, args) => routingEvents.push([tag, ...args]));

    ingestor = new JobIngestor(adapter, parseEventPort, routingPort);
  }, 120000);

  afterAll(async () => {
    await tc.stop();
  });

  beforeEach(async () => {
    parseEvents.length = 0;
    routingEvents.length = 0;
    await tc.storage.clearDb();
  });

  it('T2a: S2 via BROWSER_AUTO→[j] queue (no S1 needed, full already)', async () => {
    const jobLifecycleId = 'e2e-c2-full-arrival';

    await ingestor.processIngest(JobSource.BROWSER_AUTO, JobStage.FULL_PARSED, FULL_PARSED_HTML, jobLifecycleId);

    const genEvents = parseEvents.filter(([t]) => t === 'generated');
    expect(genEvents.length).toBe(1);

    const completedEvents = parseEvents.filter(([t]) => t === 'completed');
    expect(completedEvents.length).toBe(1);

    const doc = await adapter.findById(jobLifecycleId);
    expect(doc).not.toBeNull();
    expect(doc!.stage).toBe(JobStage.FULL_PARSED);
    expect(doc!.status).toBe(JobStatus.ENRICHED);

    await ingestor.processResolution(jobLifecycleId, 'queue');

    const queuedDoc = await adapter.findById(jobLifecycleId);
    expect(queuedDoc).not.toBeNull();
    expect(queuedDoc!.status).toBe(JobStatus.QUEUED);

    expect(routingEvents.filter(([t]) => t === 'queued').length).toBe(1);
  });

  it('T2b: S2 via BROWSER_AUTO→[d] trash', async () => {
    const jobLifecycleId = 'e2e-c2-full-trash';

    await ingestor.processIngest(JobSource.BROWSER_AUTO, JobStage.FULL_PARSED, FULL_PARSED_HTML, jobLifecycleId);

    const completedEvents = parseEvents.filter(([t]) => t === 'completed');
    expect(completedEvents.length).toBe(1);

    await ingestor.processResolution(jobLifecycleId, 'trash');

    const trashedDoc = await adapter.findById(jobLifecycleId);
    expect(trashedDoc).not.toBeNull();
    expect(trashedDoc!.status).toBe(JobStatus.TRASHED);

    expect(routingEvents.filter(([t]) => t === 'trashed').length).toBe(1);
  });

  it('T2c: S2 without jobLifecycleId creates browser-auto-* doc (fallback)', async () => {
    await ingestor.processIngest(JobSource.BROWSER_AUTO, JobStage.FULL_PARSED, FULL_PARSED_HTML);

    const completedEvents = parseEvents.filter(([t]) => t === 'completed');
    expect(completedEvents.length).toBe(1);

    const col = tc.db.collection('job_lifecycle');
    const docs = await col.find({}).toArray();
    expect(docs.length).toBe(1);
    expect(docs[0]._id).toMatch(/^browser-auto-/);
    expect(docs[0].role).toBe('Backend Developer');
    expect(docs[0].stage).toBe(JobStage.FULL_PARSED);
    expect(docs[0].status).toBe(JobStatus.ENRICHED);
  });

  it('T2d: S1→S2 inside same tick (browser-auto merge) then [j]', async () => {
    const messageId = 'e2e-c2-merged';
    const jobLifecycleId = `${messageId}-job-0`;

    const emailHtml = indeedEmailHtmlMany([{ role: 'Backend Developer', company: 'MergeCo', url: 'https://vn.indeed.com/viewjob?jk=e2e-c2-merge' }]);

    await ingestor.processIngest(JobSource.BROWSER_AUTO, JobStage.PARTIAL_PARSED, emailHtml, undefined, { messageId, subject: 'Backend Developer' });

    const genEvents = parseEvents.filter(([t]) => t === 'generated');
    expect(genEvents.length).toBe(1);
    expect(genEvents[0][1]._id).toBe(jobLifecycleId);

    await ingestor.processIngest(JobSource.BROWSER_AUTO, JobStage.FULL_PARSED, FULL_PARSED_HTML, jobLifecycleId);

    const completedEvents = parseEvents.filter(([t]) => t === 'completed');
    expect(completedEvents.length).toBe(1);

    const doc = await adapter.findById(jobLifecycleId);
    expect(doc).not.toBeNull();
    expect(doc!.stage).toBe(JobStage.FULL_PARSED);
    expect(doc!.status).toBe(JobStatus.ENRICHED);
    expect(doc!.company).toBe('FullParsedCo');

    await ingestor.processResolution(jobLifecycleId, 'queue');

    expect(routingEvents.filter(([t]) => t === 'queued').length).toBe(1);
  });
});
