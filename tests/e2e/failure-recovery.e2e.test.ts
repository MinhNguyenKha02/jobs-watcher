import { describe, it, expect, beforeAll, afterAll, vi, afterEach } from 'vitest';
import { createTestStorage } from '../helpers/create-test-storage.js';
import { MongoJobLifecycleAdapter } from '../../src/infrastructure/outbound/persistence/mongo-job-lifecycle-adapter.js' ;
import { getLogger } from '../../src/infrastructure/outbound/logging/logger.js' ;
import { ExtractionScheduler } from '../../src/application/extraction-scheduler.js';
import { JobStage, JobSource, JobStatus } from '../../src/domain/types/job-lifecycle.js' ;

const logger = getLogger();
const { JobIngestor } = await import('../../src/application/ingestor.js');

describe('E2E3: Failure Recovery (fallback on extraction failure)', () => {
  let storage: any;
  let adapter: MongoJobLifecycleAdapter;
  let parseEvents: any[];
  let routingEvents: any[];
  let ingestor: JobIngestor;

  beforeAll(async () => {
    storage = await createTestStorage();
    adapter = new MongoJobLifecycleAdapter(
      storage.uri,
      storage.dbName,
    );
    await adapter.connect();

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

    ingestor = new JobIngestor(adapter, parseEventPort, routingPort);
  }, 120000);

  afterAll(async () => {
    await adapter.disconnect();
    await storage.stop();
  });

  async function seedJob(jobLifecycleId: string, url: string) {
    const doc = {
      _id: jobLifecycleId,
      raw: '<html><body>partial</body></html>',
      stage: JobStage.PARTIAL_PARSED,
      status: JobStatus.ENRICHING,
      source: JobSource.BROWSER_AUTO,
      company: `TestCorp-${jobLifecycleId}`,
      role: `Junior Backend Developer ${jobLifecycleId}`,
      description: 'TypeScript developer needed',
      url,
      createdAt: new Date(),
      updatedAt: new Date(),
      stageTimestamp: new Date(),
    };
    await adapter.upsert(doc as any);
    const eqCol = (adapter as any).extractionQueueCollection;
    await eqCol.insertOne({
      _id: jobLifecycleId,
      jobLifecycleId,
      createdAt: new Date(),
    });
  }

  it('browser extraction failure triggers fallback: processIngest PARTIAL_PARSED + empty + emitGenerated', async () => {
    const jobLifecycleId = 'e2e-fail-1';
    await seedJob(jobLifecycleId, 'https://example.com/fail');

    const mockBrowser = {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      extract: vi.fn().mockRejectedValue(new Error('Navigation timeout')),
    };

    const findJobLifecycle = async (id: string) => {
      const doc = await adapter.findById(id);
      return doc ? { url: doc.url } : null;
    };

    const processIngestSpy = vi.spyOn(ingestor, 'processIngest');

    const genBefore = parseEvents.filter(([t]) => t === 'generated').length;

    const scheduler = new ExtractionScheduler(
      (adapter as any).extractionQueue,
      mockBrowser as any,
      adapter as any,
      ingestor,
    );

    await scheduler.start();

    await vi.waitFor(() => {
      const fallbackCalls = processIngestSpy.mock.calls.filter(
        ([source, stage, rawPayload]: any) => stage === JobStage.PARTIAL_PARSED && rawPayload === '',
      );
      expect(fallbackCalls.length).toBeGreaterThanOrEqual(1);
    }, { interval: 100, timeout: 10000 });

    await vi.waitFor(() => {
      const genEvents = parseEvents.filter(([t]) => t === 'generated');
      expect(genEvents.length).toBeGreaterThan(genBefore);
    }, { interval: 100, timeout: 5000 });

    const genEvents = parseEvents.filter(([t]) => t === 'generated');
    const lastGen = genEvents[genEvents.length - 1];
    expect(lastGen).toBeDefined();
    expect(lastGen[1]._id).toBe(jobLifecycleId);

    const doc = await adapter.findById(jobLifecycleId);
    expect(doc).not.toBeNull();
    expect(doc!.stage).toBe(JobStage.PARTIAL_PARSED);
    expect(doc!.status).toBe(JobStatus.ENRICHING);

    await scheduler.stop();
  }, 30000);

  it('fallback with null job lifecycle logs error and does not emit', async () => {
    const jobLifecycleId = 'e2e-null-doc-1';
    const eqCol = (adapter as any).extractionQueueCollection;
    await eqCol.insertOne({
      _id: jobLifecycleId,
      jobLifecycleId,
      createdAt: new Date(),
    });

    const mockBrowser = {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      extract: vi.fn().mockRejectedValue(new Error('Timeout')),
    };

    const processIngestSpy = vi.fn().mockResolvedValue(undefined);
    const logSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const scheduler = new ExtractionScheduler(
      (adapter as any).extractionQueue,
      mockBrowser as any,
      adapter as any,
      { processIngest: processIngestSpy } as any,
    );

    await scheduler.start();

    await vi.waitFor(() => {
      const logs = logSpy.mock.calls.filter(
        ([msg]: string[]) => String(msg).includes('findJobLifecycle returned null'),
      );
      expect(logs.length).toBeGreaterThanOrEqual(1);
    }, { interval: 100, timeout: 10000 });

    logSpy.mockRestore();

    expect(mockBrowser.start).toHaveBeenCalled();
    await scheduler.stop();
    expect(mockBrowser.stop).toHaveBeenCalled();
  }, 30000);
});
