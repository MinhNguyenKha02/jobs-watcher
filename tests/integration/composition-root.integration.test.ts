import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { MongoClient } from 'mongodb';

describe('Composition root — DI wiring verification', () => {
  let client: MongoClient;
  let dbName: string;

  beforeAll(async () => {
    const { createTestStorage } = await import('../helpers/create-test-storage.js');
    const storage = await createTestStorage();
    client = storage.client;
    dbName = storage.dbName;
  }, 120000);

  afterAll(async () => {
    await client.close();
  });

  it('MongoJobLifecycleAdapter wires with Mongo Db and provides correct port methods', async () => {
    const { MongoJobLifecycleAdapter } = await import('../../src/infrastructure/outbound/persistence/mongo-job-lifecycle-adapter.js');
    const adapter = new MongoJobLifecycleAdapter(client.db(dbName));

    expect(typeof adapter.upsert).toBe('function');
    expect(typeof adapter.updateStage).toBe('function');
    expect(typeof adapter.findById).toBe('function');
  });

  it('JobIngestor wires with all 6 port adapters without throwing', async () => {
    const { MongoJobLifecycleAdapter } = await import('../../src/infrastructure/outbound/persistence/mongo-job-lifecycle-adapter.js');
    const { MetricsRegistry } = await import('../../src/infrastructure/outbound/monitoring/metrics-registry.js');
    const { Registry } = await import('prom-client');
    const { JobIngestor } = await import('../../src/application/ingestor.js');

    const adapter = new MongoJobLifecycleAdapter(client.db(dbName));
    const metrics = new MetricsRegistry(new Registry());
    const ingestor = new JobIngestor(
      adapter,
      { emitGenerated: vi.fn(), emitCompleted: vi.fn(), emitFailed: vi.fn() },
      { emitJobQueued: vi.fn(), emitJobTrashed: vi.fn(), emitRouteFailed: vi.fn() },
      { enqueue: vi.fn(), dequeue: vi.fn(), size: vi.fn(), onEnqueue: vi.fn() },
      { toAsset: vi.fn() },
      metrics,
    );

    expect(ingestor).toBeDefined();
    expect(typeof ingestor.processIngest).toBe('function');
    expect(typeof ingestor.processResolution).toBe('function');
  });

  it('AssetProducingAdapter wires without constructor dependencies', async () => {
    const { AssetProducingAdapter } = await import('../../src/infrastructure/outbound/asset-builder/asset-producing-adapter.js');
    const adapter = new AssetProducingAdapter();

    expect(adapter).toBeDefined();
    expect(typeof adapter.toAsset).toBe('function');
    expect(typeof (adapter as any).toPdf).toBe('function');
  });

  it('ExtractionScheduler wires with all port adapters without throwing', async () => {
    const { ExtractionScheduler } = await import('../../src/application/extraction-scheduler.js');

    const scheduler = new ExtractionScheduler(
      { enqueue: vi.fn(), dequeue: vi.fn(), size: vi.fn(), onEnqueue: vi.fn() },
      { start: vi.fn(), extract: vi.fn(), stop: vi.fn() },
      { upsert: vi.fn(), updateStage: vi.fn(), findById: vi.fn() },
      { processIngest: vi.fn(), processResolution: vi.fn() },
    );

    expect(scheduler).toBeDefined();
    expect(typeof scheduler.start).toBe('function');
    expect(typeof scheduler.stop).toBe('function');
  });

  it('UdsAdapter wires with IngestorPort and config without throwing', async () => {
    const { UdsAdapter } = await import('../../src/infrastructure/inbound/uds/uds-adapter.js');

    const ingestorMock = { processIngest: vi.fn(), processResolution: vi.fn() };
    const adapter = new UdsAdapter(ingestorMock, { port: '/tmp/test-uds.sock' });

    expect(adapter).toBeDefined();
    expect(typeof (adapter as any).start).toBe('function');
  });

  it('WebhookAdapter wires with IngestorPort and required dependencies', async () => {
    const { WebhookAdapter } = await import('../../src/infrastructure/inbound/web/webhook-adapter.js');

    const ingestorMock = { processIngest: vi.fn(), processResolution: vi.fn() };
    const gmailMock = { authenticate: vi.fn() };
    const adapter = new WebhookAdapter(ingestorMock, gmailMock as any);

    expect(adapter).toBeDefined();
    expect(typeof (adapter as any).start).toBe('function');
  });
});
