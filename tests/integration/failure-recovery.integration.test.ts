import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createTestStorage } from '../helpers/create-test-storage.js';
import { MongoJobLifecycleAdapter } from '../../src/infrastructure/outbound/persistence/mongo-job-lifecycle-adapter.js';
import { MongoExtractionQueueAdapter } from '../../src/infrastructure/outbound/persistence/mongo-extraction-queue-adapter.js';
import { ExtractionScheduler } from '../../src/application/extraction-scheduler.js';
import { JobStage, JobSource, JobStatus } from '../../src/domain/types/job-lifecycle.js';
import { MetricsRegistry } from '../../src/infrastructure/outbound/monitoring/metrics-registry.js';

const { JobIngestor } = await import('../../src/application/ingestor.js');

  describe('Failure Recovery (fallback on extraction failure)', () => {
  let storage: any;
  let adapter: MongoJobLifecycleAdapter;
  let eqAdapter: MongoExtractionQueueAdapter;
  let parseEvents: any[];
  let routingEvents: any[];
  let ingestor: JobIngestor;

  beforeAll(async () => {
    storage = await createTestStorage();
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

  async function seedJob(jobLifecycleId: string, url: string) {
    const doc = {
      _id: jobLifecycleId,
      raw: '<html><body>partial</body></html>',
      stage: JobStage.PARTIAL_PARSED,
      status: JobStatus.ENRICHING,
      source: JobSource.BROWSER_AUTO,
      company: `TestCorp-${jobLifecycleId}`,
      role: 'Backend Developer',
      description: 'TypeScript developer needed',
      url,
      createdAt: new Date(),
      updatedAt: new Date(),
      stageTimestamp: new Date(),
    };
    await adapter.upsert(doc as any);
    await eqAdapter.enqueue(jobLifecycleId);
  }

  it('browser extraction failure triggers fallback: processIngest PARTIAL_PARSED + empty + emitGenerated', async () => {
    const jobLifecycleId = 'e2e-fail-1';
    await seedJob(jobLifecycleId, 'https://example.com/fail');

    const mockBrowser = {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      extract: vi.fn().mockRejectedValue(new Error('Navigation timeout')),
    };

    const processIngestSpy = vi.spyOn(ingestor, 'processIngest');

    const genBefore = parseEvents.filter(([t]) => t === 'generated').length;

    const scheduler = new ExtractionScheduler(
      eqAdapter,
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

    await scheduler.stop();
  }, 30000);

  it('fallback with null job lifecycle logs error and does not emit', async () => {
    const jobLifecycleId = 'e2e-null-doc-1';
    await eqAdapter.enqueue(jobLifecycleId);

    const mockBrowser = {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      extract: vi.fn().mockRejectedValue(new Error('Timeout')),
    };

    const processIngestSpy = vi.fn().mockResolvedValue(undefined);

    const scheduler = new ExtractionScheduler(
      eqAdapter,
      mockBrowser as any,
      adapter as any,
      { processIngest: processIngestSpy } as any,
    );

    await scheduler.start();

    await vi.waitFor(() => {
      const fallbackCalls = processIngestSpy.mock.calls.filter(
        ([source, stage, rawPayload]: any) => stage === JobStage.PARTIAL_PARSED && rawPayload === '',
      );
      expect(fallbackCalls.length).toBeGreaterThanOrEqual(1);
    }, { interval: 100, timeout: 10000 });

    expect(mockBrowser.start).toHaveBeenCalled();
    await scheduler.stop();
    expect(mockBrowser.stop).toHaveBeenCalled();
  }, 30000);
});
