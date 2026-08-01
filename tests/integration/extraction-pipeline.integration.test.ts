import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createTestStorage } from '../helpers/create-test-storage.js';
import { MongoJobLifecycleAdapter } from '../../src/infrastructure/outbound/persistence/mongo-job-lifecycle-adapter.js';
import { MongoExtractionQueueAdapter } from '../../src/infrastructure/outbound/persistence/mongo-extraction-queue-adapter.js';
import { MongoInitializer } from '../../src/infrastructure/outbound/persistence/mongo-init.js';
import { ExtractionScheduler } from '../../src/application/extraction-scheduler.js';
import { JobStage, JobSource, JobStatus } from '../../src/domain/types/job-lifecycle.js';
import { MetricsRegistry } from '../../src/infrastructure/outbound/monitoring/metrics-registry.js';

const { JobIngestor } = await import('../../src/application/ingestor.js');

const INDEED_EMAIL_HTML = `<html><body>
<span class="strong-text-link">Indeed Job Alert</span>
<table>
  <tr>
    <td class="pb-24" style="padding-bottom:24px">
      <h2><a href="https://vn.indeed.com/viewjob?jk=test123">Backend Developer</a></h2>
      <table>
        <tr>
          <td style="padding:0 12px;color:#2d2d2d;font-size:14px;line-height:21px">TechCorp</td>
        </tr>
      </table>
      <div style="color:#2d2d2d">Ho Chi Minh City</div>
      <div style="padding:0;color:#767676;font-size:14px;line-height:21px">TypeScript backend developer needed for our growing engineering team</div>
      <div style="font-size:12px;line-height:18px">Just posted</div>
    </td>
  </tr>
</table>
</body></html>`;

const INDEED_DETAIL_HTML = `<html><body>
<div id="jobsearch-ViewjobHeader">
  <h1 data-testid="jobsearch-JobInfoHeader-title"><span>Backend Developer</span></h1>
  <div class="company-header">
    <div data-testid="inlineHeader-companyName">TechCorp</div>
    <div data-testid="inlineHeader-companyLocation">Ho Chi Minh City</div>
  </div>
  <div id="salaryInfoAndJobType">
    <span>$1000 - $1500 a month</span>
  </div>
</div>
<div id="jobDescriptionText" class="job-description-section">
  <p>We are looking for a Backend Developer with TypeScript experience to join our team. You will build and maintain backend services using Node.js and TypeScript.</p>
  <h2>Requirements</h2>
  <ul>
    <li>TypeScript and Node.js proficiency</li>
    <li>Experience with databases</li>
  </ul>
</div>
</body></html>`;

describe('E2E1: Extraction Pipeline (Signal 1 → queue → scheduler → Signal 2c)', () => {
  let storage: any;
  let adapter: MongoJobLifecycleAdapter;
  let eqAdapter: MongoExtractionQueueAdapter;
  let parseEvents: any[];
  let routingEvents: any[];
  let ingestor: JobIngestor;

  beforeAll(async () => {
    storage = await createTestStorage();
    const initializer = new MongoInitializer(storage.client, storage.dbName);
    await initializer.init();
    adapter = new MongoJobLifecycleAdapter(
      storage.client.db(storage.dbName),
    );
    eqAdapter = new MongoExtractionQueueAdapter(
      new MetricsRegistry(),
      storage.client.db(storage.dbName),
    );

    parseEvents = [];
    routingEvents = [];

    const parseEventPort = {
      emitGenerated: vi.fn((...args: any[]) => { parseEvents.push(['generated', ...args]); return Promise.resolve(); }),
      emitCompleted: vi.fn((...args: any[]) => { parseEvents.push(['completed', ...args]); return Promise.resolve(); }),
      emitFailed: vi.fn((...args: any[]) => { parseEvents.push(['failed', ...args]); return Promise.resolve(); }),
    };

    const routingPort = {
      emitJobQueued: vi.fn((...args: any[]) => { routingEvents.push(['queued', ...args]); return Promise.resolve(); }),
      emitJobTrashed: vi.fn((...args: any[]) => { routingEvents.push(['trashed', ...args]); return Promise.resolve(); }),
      emitRouteFailed: vi.fn((...args: any[]) => { routingEvents.push(['failed', ...args]); return Promise.resolve(); }),
    };

    ingestor = new JobIngestor(adapter, parseEventPort, routingPort, eqAdapter);
  }, 120000);

  afterAll(async () => {
    await storage.stop();
  });

  async function clearCollections() {
    const db = storage.client.db(storage.dbName);
    const cols = await db.listCollections().toArray();
    for (const col of cols) {
      await db.collection(col.name).deleteMany({});
    }
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

    const col = storage.client.db(storage.dbName).collection('job_lifecycle');
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
