import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { createTestStorage } from '../helpers/create-test-storage.js';

describe('Composition root — bootstrap with real storage', () => {
  let storage: Awaited<ReturnType<typeof createTestStorage>>;
  const OLD_ENV = { ...process.env };

  beforeAll(async () => {
    storage = await createTestStorage();
    vi.mock('../../src/infrastructure/outbound/gmail.js', () => ({
      GmailService: vi.fn(() => ({ authenticate: vi.fn().mockResolvedValue(undefined) })),
    }));
    vi.mock('../../src/infrastructure/outbound/browser/browser-extractor.js', () => ({
      PlaywrightBrowserAdapter: vi.fn(() => ({ start: vi.fn(), stop: vi.fn() })),
    }));
    vi.mock('../../src/infrastructure/inbound/web/webhook-adapter.js', () => ({
      WebhookAdapter: vi.fn(() => ({
        start: vi.fn().mockResolvedValue(undefined),
        stop: vi.fn().mockResolvedValue(undefined),
      })),
    }));
  });

  afterAll(async () => {
    process.env = { ...OLD_ENV };
    await storage.stop();
    vi.restoreAllMocks();
  });

  it('JobIngestor processes queue resolution against real MongoDB', async () => {
    const { JobIngestor } = await import('../../src/application/ingestor.js');
    const { MongoJobLifecycleAdapter } = await import('../../src/infrastructure/outbound/persistence/mongo-job-lifecycle-adapter.js' );
    const { JobStatus, JobStage, JobSource } = await import('../../src/domain/types/job-lifecycle.js' );

    const adapter = new MongoJobLifecycleAdapter(
      storage.uri,
      storage.dbName,
    );
    await adapter.connect();

    const parseEventPort = {
      emitGenerated: vi.fn(),
      emitCompleted: vi.fn(),
      emitFailed: vi.fn(),
    };
    const routingPort = {
      emitJobQueued: vi.fn(),
      emitJobTrashed: vi.fn(),
      emitRouteFailed: vi.fn(),
    };

    const ingestor = new JobIngestor(adapter, parseEventPort, routingPort);

    const jobId = 'comp-root-test-queue-001';
    await adapter.upsert({
      _id: jobId,
      role: 'Software Engineer',
      company: 'Test Corp',
      body: '<html>test</html>',
      source: JobSource.MANUAL,
      stage: JobStage.FULL_PARSED,
      status: JobStatus.ENRICHED,
      createdAt: new Date(),
      updatedAt: new Date(),
      stageTimestamp: new Date(),
    } as any);

    await ingestor.processResolutionCommand({ jobLifecycleId: jobId, action: 'queue' });

    const updated = await adapter.findById(jobId);
    expect(updated).toBeDefined();
    expect(updated!._id).toBe(jobId);
    expect(updated!.status).toBe(JobStatus.QUEUED);
    expect(routingPort.emitJobQueued).toHaveBeenCalledOnce();

    await adapter.disconnect();
  }, 30000);

  it('JobIngestor processes trash resolution against real MongoDB', async () => {
    const { JobIngestor } = await import('../../src/application/ingestor.js');
    const { MongoJobLifecycleAdapter } = await import('../../src/infrastructure/outbound/persistence/mongo-job-lifecycle-adapter.js' );
    const { JobStatus, JobStage, JobSource } = await import('../../src/domain/types/job-lifecycle.js' );

    const adapter = new MongoJobLifecycleAdapter(
      storage.uri,
      storage.dbName,
    );
    await adapter.connect();

    const parseEventPort = {
      emitGenerated: vi.fn(),
      emitCompleted: vi.fn(),
      emitFailed: vi.fn(),
    };
    const routingPort = {
      emitJobQueued: vi.fn(),
      emitJobTrashed: vi.fn(),
      emitRouteFailed: vi.fn(),
    };

    const ingestor = new JobIngestor(adapter, parseEventPort, routingPort);

    const jobId = 'comp-root-test-trash-001';
    await adapter.upsert({
      _id: jobId,
      role: 'DevOps Engineer',
      company: 'Cloud Inc',
      body: '<html>test</html>',
      source: JobSource.MANUAL,
      stage: JobStage.FULL_PARSED,
      status: JobStatus.ENRICHED,
      createdAt: new Date(),
      updatedAt: new Date(),
      stageTimestamp: new Date(),
    } as any);

    await ingestor.processResolutionCommand({ jobLifecycleId: jobId, action: 'trash' });

    const updated = await adapter.findById(jobId);
    expect(updated).toBeDefined();
    expect(updated!.status).toBe(JobStatus.TRASHED);
    expect(routingPort.emitJobTrashed).toHaveBeenCalledOnce();

    await adapter.disconnect();
  }, 30000);

  it('JobIngestor processes resolution with editedKVs against real MongoDB', async () => {
    const { JobIngestor } = await import('../../src/application/ingestor.js');
    const { MongoJobLifecycleAdapter } = await import('../../src/infrastructure/outbound/persistence/mongo-job-lifecycle-adapter.js' );
    const { JobStatus, JobStage, JobSource } = await import('../../src/domain/types/job-lifecycle.js' );

    const adapter = new MongoJobLifecycleAdapter(
      storage.uri,
      storage.dbName,
    );
    await adapter.connect();

    const parseEventPort = {
      emitGenerated: vi.fn(),
      emitCompleted: vi.fn(),
      emitFailed: vi.fn(),
    };
    const routingPort = {
      emitJobQueued: vi.fn(),
      emitJobTrashed: vi.fn(),
      emitRouteFailed: vi.fn(),
    };

    const ingestor = new JobIngestor(adapter, parseEventPort, routingPort);

    const jobId = 'comp-root-test-edit-001';
    await adapter.upsert({
      _id: jobId,
      role: 'Junior Developer',
      company: 'Startup Co',
      body: '<html>test</html>',
      source: JobSource.MANUAL,
      stage: JobStage.FULL_PARSED,
      status: JobStatus.ENRICHED,
      createdAt: new Date(),
      updatedAt: new Date(),
      stageTimestamp: new Date(),
    } as any);

    await ingestor.processResolutionCommand({
      jobLifecycleId: jobId,
      action: 'queue',
      editedKVs: { role: 'Senior Developer', salary: '$5000' },
    });

    expect(routingPort.emitJobQueued).toHaveBeenCalledWith(
      expect.objectContaining({
        jobLifecycleId: jobId,
        role: 'Senior Developer',
        salary: '$5000',
      }),
      expect.anything()
    );

    await adapter.disconnect();
  }, 30000);
});
