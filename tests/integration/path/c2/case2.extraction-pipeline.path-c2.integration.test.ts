/* Path cell (c2): S3 S4 extraction scheduler + extraction_queue (see plans/tests-path-matrix.md) */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createTestContainer, type TestContainer } from '../../../helpers/test-container.js';
import { createParseEventPort, createRoutingPort } from '../../../helpers/mock-ports.js';

import type { MongoJobLifecycleAdapter } from '../../../../src/infrastructure/outbound/persistence/mongo-job-lifecycle-adapter.js';
import type { MongoExtractionQueueAdapter } from '../../../../src/infrastructure/outbound/persistence/mongo-extraction-queue-adapter.js';
import { ExtractionScheduler } from '../../../../src/application/extraction-scheduler.js';
import { JobStage, JobSource, JobStatus } from '../../../../src/domain/types/job-lifecycle.js';
import { indeedEmailHtmlMany, indeedDetailHtml } from '../../../helpers/html-fixtures.js';

const { JobIngestor } = await import('../../../../src/application/ingestor.js');

const INDEED_EMAIL_HTML = indeedEmailHtmlMany([{ role: 'Backend Developer', company: 'TechCorp', url: 'https://vn.indeed.com/viewjob?jk=test123' }]);

const INDEED_DETAIL_HTML = indeedDetailHtml(
  'Backend Developer',
  'TechCorp',
  'https://vn.indeed.com/viewjob?jk=test123',
);

  describe('Extraction Pipeline (Signal 1 → queue → scheduler → Signal 2c)', () => {
  let tc: TestContainer;
  let adapter: MongoJobLifecycleAdapter;
  let eqAdapter: MongoExtractionQueueAdapter;
  let parseEvents: any[];
  let routingEvents: any[];
  let ingestor: JobIngestor;

  beforeAll(async () => {
    tc = await createTestContainer({ ns: 'c2-extraction-pipeline' });
    await tc.start();
    adapter = tc.mongoJobLifecycleAdapter;
    eqAdapter = tc.extractionQueueAdapter;

    parseEvents = [];
    routingEvents = [];

    const parseEventPort = createParseEventPort((tag, args) => parseEvents.push([tag, ...args]));

    const routingPort = createRoutingPort((tag, args) => routingEvents.push([tag, ...args]));

    ingestor = new JobIngestor(adapter, parseEventPort, routingPort, eqAdapter);
  }, 120000);

  afterAll(async () => {
    await tc.stop();
  });

  async function clearCollections() {
    await tc.storage.clearDb();
  }

  it('Signal 1 with Indeed URL defers to extraction queue (no emitGenerated)', async () => {
    await clearCollections();
    const genBefore = parseEvents.filter(([t]) => t === 'generated').length;

    await ingestor.processIngest(JobSource.BROWSER_AUTO, JobStage.PARTIAL_PARSED, INDEED_EMAIL_HTML, undefined, {
        subject: 'Indeed Job Alert - Backend Developer',
        from: 'noreply@indeed.com',
        to: 'me@test.com',
        threadId: 'thread-e2e-1',
        messageId: 'msg-e2e-1',
      }, new Date());

    const generatedEvents = parseEvents.filter(([type]) => type === 'generated');
    expect(generatedEvents.length).toBe(genBefore);
    expect(generatedEvents.length).toBe(0);

    const trashedEvents = routingEvents.filter(([type]) => type === 'trashed');
    expect(trashedEvents.length).toBe(0);

    const queueSize = await eqAdapter.size();
    expect(queueSize).toBe(1);

    const col = tc.db.collection('job_lifecycle');
    const docs = await col.find({}).toArray();
    expect(docs.length).toBeGreaterThanOrEqual(1);
    const jobDoc = docs.find((d: any) => d.role === 'Backend Developer');
    expect(jobDoc).toBeDefined();
    expect(jobDoc.stage).toBe(JobStage.PARTIAL_PARSED);
    expect(jobDoc.status).toBe(JobStatus.ENRICHING);
    expect(jobDoc.url).toContain('indeed.com/viewjob');
  });

  it('ExtractionScheduler dequeues, browser extracts, Signal 2c produces FULL_PARSED', async () => {
    await clearCollections();
    const genBefore = parseEvents.filter(([t]) => t === 'generated').length;

    const mockBrowser = {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      extract: vi.fn().mockResolvedValue({ html: INDEED_DETAIL_HTML }),
    };

    const jobLifecycleId = 'e2e-sched-1';
    const partialDoc = {
      _id: jobLifecycleId,
      raw: '<html><body>partial</body></html>',
      stage: JobStage.PARTIAL_PARSED,
      status: JobStatus.ENRICHING,
      source: JobSource.BROWSER_AUTO,
      company: 'TechCorp',
      role: 'Backend Developer',
      description: 'TypeScript backend developer',
      url: 'https://vn.indeed.com/viewjob?jk=test123',
      createdAt: new Date(),
      updatedAt: new Date(),
      stageTimestamp: new Date(),
    };
    await adapter.upsert(partialDoc as any);
    await eqAdapter.enqueue(jobLifecycleId);

    const processIngestSpy = vi.spyOn(ingestor, 'processIngest');

    const scheduler = new ExtractionScheduler(
      eqAdapter,
      mockBrowser as any,
      adapter as any,
      ingestor,
    );

    await scheduler.start();

    await vi.waitFor(() => {
      expect(mockBrowser.extract).toHaveBeenCalledWith('https://vn.indeed.com/viewjob?jk=test123');
    }, { interval: 100, timeout: 10000 });

    await vi.waitFor(() => {
      expect(processIngestSpy).toHaveBeenCalled();
    }, { interval: 100, timeout: 10000 });

    const ingestCall = processIngestSpy.mock.calls.find(
      ([source, stage]: any) => stage === JobStage.FULL_PARSED,
    );
    expect(ingestCall).toBeDefined();
    expect(ingestCall[0]).toBe(JobSource.BROWSER_AUTO);
    expect(ingestCall[2]).toBe(INDEED_DETAIL_HTML);

    await vi.waitFor(() => {
      const completedEvents = parseEvents.filter(([type]) => type === 'completed');
      expect(completedEvents.length).toBeGreaterThanOrEqual(1);
    }, { interval: 100, timeout: 10000 });

    const fullDoc = await adapter.findById(jobLifecycleId);
    expect(fullDoc).not.toBeNull();
    expect(fullDoc!.stage).toBe(JobStage.FULL_PARSED);
    expect(fullDoc!.status).toBe(JobStatus.ENRICHED);
    expect(fullDoc!.company).toBe('TechCorp');
    expect(fullDoc!.role).toBe('Backend Developer');
    expect(fullDoc!.url).toBe('https://vn.indeed.com/viewjob?jk=test123');

    await scheduler.stop();
    expect(parseEvents.filter(([t]) => t === 'generated').length).toBe(genBefore + 1);
  }, 30000);

  it('ExtractionScheduler handles empty queue without crashing', async () => {
    await clearCollections();

    const mockBrowser = {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      extract: vi.fn().mockResolvedValue({ html: '' }),
    };

    const scheduler = new ExtractionScheduler(
      eqAdapter,
      mockBrowser as any,
      adapter as any,
      { processIngest: vi.fn() } as any,
    );

    await scheduler.start();
    await new Promise(r => setTimeout(r, 1500));
    await scheduler.stop();

    expect(mockBrowser.start).toHaveBeenCalledOnce();
    expect(mockBrowser.stop).toHaveBeenCalledOnce();
  }, 15000);
});
