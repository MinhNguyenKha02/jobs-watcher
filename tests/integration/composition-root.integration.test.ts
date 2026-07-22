import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { createTestStorage } from '../helpers/create-test-storage.js';

describe('Composition root — bootstrap with real storage', () => {
  let storage: Awaited<ReturnType<typeof createTestStorage>>;
  const OLD_ENV = { ...process.env };

  beforeAll(async () => {
    storage = await createTestStorage();
    vi.mock('../../src/services/gmail.js', () => ({
      GmailService: vi.fn(() => ({ authenticate: vi.fn().mockResolvedValue(undefined) })),
    }));
    vi.mock('../../src/services/mongodb-validator.js', () => ({
      validateMongoTopology: vi.fn().mockResolvedValue(undefined),
    }));
    vi.mock('../../src/services/browser/browser-extractor.js', () => ({
      PlaywrightBrowserAdapter: vi.fn(() => ({ start: vi.fn(), stop: vi.fn() })),
    }));
    vi.mock('../../src/cli/data-listening.js', () => ({
      runDataListening: vi.fn(),
    }));
    vi.mock('../../src/services/event-webhook.js', () => ({
      EventDrivenWebhook: vi.fn(() => ({
        connect: vi.fn().mockResolvedValue(undefined),
        start: vi.fn().mockResolvedValue(undefined),
        stop: vi.fn().mockResolvedValue(undefined),
      })),
    }));
    vi.mock('../../src/bootstrap/execution-mode.js', () => ({
      detectExecutionMode: vi.fn(() => ({
        mode: 'TEST', isProduction: false, isTest: true, isFixture: false, isHeadless: false,
      })),
      initializeModeContext: vi.fn(),
    }));
    vi.mock('../../src/services/queue-metrics.js', () => ({
      metrics: { getMetrics: () => ({}) },
    }));
  });

  afterAll(async () => {
    process.env = { ...OLD_ENV };
    await storage.stop();
    vi.restoreAllMocks();
  });

  it('JobIngestor processes queue resolution against real MongoDB', async () => {
    const { default: JobIngestor } = await import('../../src/application/ingestor.js');
    const { MongoDBStorageAdapter } = await import('../../src/infrastructure/outbound/persistence/mongodb-storage-adapter.js' );
    const { JobStatus, JobStage, JobSource } = await import('../../src/domain/types/job-lifecycle.js' );

    const adapter = new MongoDBStorageAdapter({
      mongoUri: storage.uri,
      dbName: storage.dbName,
      logger: console,
    });
    await adapter.connect();

    const routingPort = {
      emitJobQueued: vi.fn(),
      emitJobTrashed: vi.fn(),
      emitRouteFailed: vi.fn(),
    };

    const ingestor = new JobIngestor(adapter, {
      parseEventPort: {
        emitJobGenerated: vi.fn(),
        emitParseCompleted: vi.fn(),
        emitParseFailed: vi.fn(),
        emitJobGeneratedFailed: vi.fn(),
      },
      routingPort,
    });

    const jobId = 'comp-root-test-queue-001';
    await adapter.upsertJobLifecycle({
      _id: jobId,
      role: 'Software Engineer',
      company: 'Test Corp',
      body: '<html>test</html>',
      source: JobSource.MANUAL,
      stage: JobStage.FULL_PARSED,
      status: JobStatus.PENDING,
      createdAt: new Date(),
      updatedAt: new Date(),
      stageTimestamp: new Date(),
    } as any);

    await ingestor.processResolutionCommand({ joblifecycleId: jobId, action: 'queue' });

    const updated = await adapter.findJobLifecycleById(jobId);
    expect(updated).toBeDefined();
    expect(updated!._id).toBe(jobId);
    expect(updated!.status).toBe(JobStatus.QUEUED);
    expect(routingPort.emitJobQueued).toHaveBeenCalledOnce();

    await adapter.disconnect();
  }, 30000);

  it('JobIngestor processes trash resolution against real MongoDB', async () => {
    const { default: JobIngestor } = await import('../../src/application/ingestor.js');
    const { MongoDBStorageAdapter } = await import('../../src/infrastructure/outbound/persistence/mongodb-storage-adapter.js' );
    const { JobStatus, JobStage, JobSource } = await import('../../src/domain/types/job-lifecycle.js' );

    const adapter = new MongoDBStorageAdapter({
      mongoUri: storage.uri,
      dbName: storage.dbName,
      logger: console,
    });
    await adapter.connect();

    const routingPort = {
      emitJobQueued: vi.fn(),
      emitJobTrashed: vi.fn(),
      emitRouteFailed: vi.fn(),
    };

    const ingestor = new JobIngestor(adapter, {
      parseEventPort: {
        emitJobGenerated: vi.fn(),
        emitParseCompleted: vi.fn(),
        emitParseFailed: vi.fn(),
        emitJobGeneratedFailed: vi.fn(),
      },
      routingPort,
    });

    const jobId = 'comp-root-test-trash-001';
    await adapter.upsertJobLifecycle({
      _id: jobId,
      role: 'DevOps Engineer',
      company: 'Cloud Inc',
      body: '<html>test</html>',
      source: JobSource.MANUAL,
      stage: JobStage.FULL_PARSED,
      status: JobStatus.PENDING,
      createdAt: new Date(),
      updatedAt: new Date(),
      stageTimestamp: new Date(),
    } as any);

    await ingestor.processResolutionCommand({ joblifecycleId: jobId, action: 'trash' });

    const updated = await adapter.findJobLifecycleById(jobId);
    expect(updated).toBeDefined();
    expect(updated!.status).toBe(JobStatus.TRASHED);
    expect(routingPort.emitJobTrashed).toHaveBeenCalledOnce();

    await adapter.disconnect();
  }, 30000);

  it('JobIngestor processes resolution with editedKVs against real MongoDB', async () => {
    const { default: JobIngestor } = await import('../../src/application/ingestor.js');
    const { MongoDBStorageAdapter } = await import('../../src/infrastructure/outbound/persistence/mongodb-storage-adapter.js' );
    const { JobStatus, JobStage, JobSource } = await import('../../src/domain/types/job-lifecycle.js' );

    const adapter = new MongoDBStorageAdapter({
      mongoUri: storage.uri,
      dbName: storage.dbName,
      logger: console,
    });
    await adapter.connect();

    const routingPort = {
      emitJobQueued: vi.fn(),
      emitJobTrashed: vi.fn(),
      emitRouteFailed: vi.fn(),
    };

    const ingestor = new JobIngestor(adapter, {
      parseEventPort: {
        emitJobGenerated: vi.fn(),
        emitParseCompleted: vi.fn(),
        emitParseFailed: vi.fn(),
        emitJobGeneratedFailed: vi.fn(),
      },
      routingPort,
    });

    const jobId = 'comp-root-test-edit-001';
    await adapter.upsertJobLifecycle({
      _id: jobId,
      role: 'Junior Developer',
      company: 'Startup Co',
      body: '<html>test</html>',
      source: JobSource.MANUAL,
      stage: JobStage.FULL_PARSED,
      status: JobStatus.PENDING,
      createdAt: new Date(),
      updatedAt: new Date(),
      stageTimestamp: new Date(),
    } as any);

    await ingestor.processResolutionCommand({
      joblifecycleId: jobId,
      action: 'queue',
      editedKVs: { role: 'Senior Developer', salary: '$5000' },
    });

    expect(routingPort.emitJobQueued).toHaveBeenCalledWith(
      expect.objectContaining({
        joblifecycleId: jobId,
        role: 'Senior Developer',
        salary: '$5000',
      }),
      expect.anything()
    );

    await adapter.disconnect();
  }, 30000);
});
