import type { Db } from 'mongodb';
import {
  buildSystemContainer,
  type AppContainer,
} from '../../src/application/container.js';
import type { JobIngestor } from '../../src/application/ingestor.js';
import type { MongoJobLifecycleAdapter } from '../../src/infrastructure/outbound/persistence/mongo-job-lifecycle-adapter.js';
import type { MongoExtractionQueueAdapter } from '../../src/infrastructure/outbound/persistence/mongo-extraction-queue-adapter.js';
import { createTestStorage } from './create-test-storage.js';
import { createRealDipBus, type RealDipBus } from './real-dip-bus.js';

const RMQ_URL = process.env.RABBITMQ_URL || 'amqp://localhost';

export interface TestContainerOptions {
  /** Unique namespace for the RMQ exchange + UDS socket path (per-file isolation). */
  ns: string;
  dbName?: string;
  rmqExchange?: string;
  /** Also start the extraction scheduler (+ Playwright browser). Default false. */
  startScheduler?: boolean;
  /** Also start the UDS adapter (binds a unix socket). Default false. */
  startUds?: boolean;
}

export interface TestContainer {
  ns: string;
  storage: Awaited<ReturnType<typeof createTestStorage>>;
  container: AppContainer;
  bus: RealDipBus;
  exchange: string;
  db: Db;
  mongoJobLifecycleAdapter: MongoJobLifecycleAdapter;
  extractionQueueAdapter: MongoExtractionQueueAdapter;
  ingestor: JobIngestor;
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

/**
 * Application-integration harness driven through the production composition
 * root (IoC). Boots the real system container against MongoMemoryServer + a
 * namespaced live RMQ exchange, and exposes the orchestration boundary so
 * tests assert at the app-integration-via-DIP level with real adapters.
 */
export async function createTestContainer(opts: TestContainerOptions): Promise<TestContainer> {
  const storage = await createTestStorage();
  const dbName = opts.dbName ?? storage.dbName;
  const exchange = opts.rmqExchange ?? `jobs.events.int.${opts.ns}`;
  const socketPath = `/tmp/jobs-watcher-${opts.ns}.sock`;

  const container = buildSystemContainer(
    {
      nodeEnv: 'test',
      mongodb: { uri: storage.uri, dbName },
      rabbitmq: { url: RMQ_URL, exchange },
      uds: { socketPath, token: 'e2e-internal-token' },
      health: { port: 0 },
    },
    {},
  );

  const bus = await createRealDipBus(exchange);

  async function start(): Promise<void> {
    await container.mongoConnector.connect();
    await container.mongoInitializer.init();
    await container.rmq.connect();
    if (opts.startScheduler) {
      await container.extractionScheduler.start();
    }
    if (opts.startUds) {
      await container.udsAdapter.start();
    }
  }

  async function stop(): Promise<void> {
    try { await bus.teardown(); } catch { /* best-effort */ }
    if (opts.startScheduler) {
      try { await container.extractionScheduler.stop(); } catch { /* best-effort */ }
    }
    if (opts.startUds) {
      try { await container.udsAdapter.stop(); } catch { /* best-effort */ }
    }
    try { await container.rmq.disconnect(); } catch { /* best-effort */ }
    try { await container.mongoConnector.disconnect(); } catch { /* best-effort */ }
    await storage.stop();
  }

  return {
    ns: opts.ns,
    storage,
    container,
    bus,
    exchange,
    db: storage.client.db(dbName),
    mongoJobLifecycleAdapter: container.mongoJobLifecycleAdapter,
    extractionQueueAdapter: container.extractionQueueAdapter,
    ingestor: container.ingestor,
    start,
    stop,
  };
}