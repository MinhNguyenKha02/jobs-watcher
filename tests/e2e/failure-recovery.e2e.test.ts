import { describe, it, expect, beforeAll, afterAll, vi, afterEach } from 'vitest';
import { createTestStorage } from '../helpers/create-test-storage.js';
import { MongoDBStorageAdapter } from '../../src/infrastructure/outbound/persistence/mongodb-storage-adapter.js' ;
import { getLogger } from '../../src/infrastructure/outbound/logging/logger.js' ;
import { ExtractionScheduler } from '../../src/application/extraction-scheduler.js';
import { JobStage, JobSource, JobStatus } from '../../src/domain/types/job-lifecycle.js' ;

const logger = getLogger();
const { default: JobIngestor } = await import('../../src/application/ingestor.js');

describe('E2E3: Failure Recovery (fallback on extraction failure)', () => {
  let storage: any;
  let adapter: MongoDBStorageAdapter;
  let parseEvents: any[];
  let routingEvents: any[];
  let ingestor: JobIngestor;

  beforeAll(async () => {
    storage = await createTestStorage();
    adapter = new MongoDBStorageAdapter({
      mongoUri: storage.uri,
      dbName: storage.dbName,
      logger,
    });
    await adapter.connect();

    parseEvents = [];
    routingEvents = [];

    const parseEventPort = {
      emitJobGenerated: vi.fn((...args: any[]) => { parseEvents.push(['generated', ...args]); return Promise.resolve(); }),
      emitJobGeneratedFailed: vi.fn((...args: any[]) => { parseEvents.push(['generatedFailed', ...args]); return Promise.resolve(); }),
      emitParseCompleted: vi.fn((...args: any[]) => { parseEvents.push(['completed', ...args]); return Promise.resolve(); }),
      emitParseFailed: vi.fn((...args: any[]) => { parseEvents.push(['failed', ...args]); return Promise.resolve(); }),
    };

    const routingPort = {
      emitJobQueued: vi.fn((...args: any[]) => { routingEvents.push(['queued', ...args]); return Promise.resolve(); }),
      emitJobTrashed: vi.fn((...args: any[]) => { routingEvents.push(['trashed', ...args]); return Promise.resolve(); }),
      emitRouteFailed: vi.fn((...args: any[]) => { routingEvents.push(['failed', ...args]); return Promise.resolve(); }),
    };

    ingestor = new JobIngestor(adapter, { parseEventPort, routingPort });
  }, 120000);

  afterAll(async () => {
    await adapter.disconnect();
    await storage.stop();
  });

  async function seedJob(joblifecycleId: string, url: string) {
    const doc = {
      _id: joblifecycleId,
      raw: '<html><body>partial</body></html>',
      stage: JobStage.PARTIAL_PARSED,
      status: JobStatus.ENRICHING,
      source: JobSource.BROWSER_AUTO,
      company: `TestCorp-${joblifecycleId}`,
      role: `Junior Backend Developer ${joblifecycleId}`,
      description: 'TypeScript developer needed',
      url,
      createdAt: new Date(),
      updatedAt: new Date(),
      stageTimestamp: new Date(),
    };
    await adapter.upsertJobLifecycle(doc as any);
    const eqCol = (adapter as any).extractionQueueCollection;
    await eqCol.insertOne({
      _id: joblifecycleId,
      joblifecycleId,
      createdAt: new Date(),
    });
  }

  it('browser extraction failure triggers fallback: processIngest PARTIAL_PARSED + empty + emitJobGenerated', async () => {
    const joblifecycleId = 'e2e-fail-1';
    await seedJob(joblifecycleId, 'https://example.com/fail');

    const mockBrowser = {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      extract: vi.fn().mockRejectedValue(new Error('Navigation timeout')),
    };

    const findJobLifecycle = async (id: string) => {
      const doc = await adapter.findJobLifecycleById(id);
      return doc ? { url: doc.url } : null;
    };

    const processIngestSpy = vi.fn(async (cmd: any) => {
      await ingestor.processIngestCommand(cmd);
    });

    const genBefore = parseEvents.filter(([t]) => t === 'generated').length;

    const scheduler = new ExtractionScheduler(
      (adapter as any).extractionQueue,
      mockBrowser as any,
      processIngestSpy as any,
      findJobLifecycle,
    );

    await scheduler.start();

    await vi.waitFor(() => {
      const fallbackCalls = processIngestSpy.mock.calls.filter(
        ([cmd]: any) => cmd.stage === JobStage.PARTIAL_PARSED && cmd.rawPayload === '',
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
    expect(lastGen[1]._id).toBe(joblifecycleId);

    const doc = await adapter.findJobLifecycleById(joblifecycleId);
    expect(doc).not.toBeNull();
    expect(doc!.stage).toBe(JobStage.PARTIAL_PARSED);
    expect(doc!.status).toBe(JobStatus.ENRICHING);

    await scheduler.stop();
  }, 30000);

  it('fallback with null job lifecycle logs error and does not emit', async () => {
    const joblifecycleId = 'e2e-null-doc-1';
    const eqCol = (adapter as any).extractionQueueCollection;
    await eqCol.insertOne({
      _id: joblifecycleId,
      joblifecycleId,
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
      processIngestSpy as any,
      async (id: string) => {
        return null;
      },
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
