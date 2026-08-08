import type { Db } from 'mongodb';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildSystemContainer,
  type AppContainer,
} from '../../src/application/container.js';
import type { JobIngestor } from '../../src/application/ingestor.js';
import type { MongoJobLifecycleAdapter } from '../../src/infrastructure/outbound/persistence/mongo-job-lifecycle-adapter.js';
import type { MongoExtractionQueueAdapter } from '../../src/infrastructure/outbound/persistence/mongo-extraction-queue-adapter.js';
import type { AssetProducingAdapter } from '../../src/infrastructure/outbound/asset-builder/asset-producing-adapter.js';
import type { PlaywrightBrowserAdapter } from '../../src/infrastructure/outbound/browser/browser-adapter.js';
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
  /** Asset output dir for the real AssetProducingAdapter. Defaults to a temp dir. */
  assetDir?: string;
}

export interface TestContainer {
  ns: string;
  storage: Awaited<ReturnType<typeof createTestStorage>>;
  container: AppContainer;
  bus: RealDipBus;
  exchange: string;
  socket: string;
  assetDir: string;
  db: Db;
  mongoJobLifecycleAdapter: MongoJobLifecycleAdapter;
  extractionQueueAdapter: MongoExtractionQueueAdapter;
  assetProducingAdapter: AssetProducingAdapter;
  browserAdapter: PlaywrightBrowserAdapter;
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
  const socket = `/tmp/jobs-watcher-${opts.ns}.sock`;
const assetDir = opts.assetDir ?? fs.mkdtempSync(path.join(os.tmpdir(), `jobs-watcher-${opts.ns}-assets-`));

  const container = buildSystemContainer(
    {
      nodeEnv: 'test',
      mongodb: { uri: storage.uri, dbName },
      rabbitmq: { url: RMQ_URL, exchange },
      uds: { socketPath: socket, token: 'e2e-internal-token' },
      health: { port: 0 },
      asset: { outputDir: assetDir },
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
    await container.udsAdapter.start();
  }

  async function stop(): Promise<void> {
    try { await bus.teardown(); } catch { /* best-effort */ }
    if (opts.startScheduler) {
      try { await container.extractionScheduler.stop(); } catch { /* best-effort */ }
    }
    try { await container.udsAdapter.stop(); } catch { /* best-effort */ }
    try { await container.rmq.disconnect(); } catch { /* best-effort */ }
    try { await container.mongoConnector.disconnect(); } catch { /* best-effort */ }
    try { fs.rmSync(assetDir, { recursive: true, force: true }); } catch { /* best-effort */ }
    await storage.stop();
  }

  return {
    ns: opts.ns,
    storage,
    container,
    bus,
    exchange,
    socket,
    assetDir,
    db: storage.client.db(dbName),
    mongoJobLifecycleAdapter: container.mongoJobLifecycleAdapter,
    extractionQueueAdapter: container.extractionQueueAdapter,
    assetProducingAdapter: container.assetProducingAdapter,
    browserAdapter: container.browserAdapter,
    ingestor: container.ingestor,
    start,
    stop,
  };
}