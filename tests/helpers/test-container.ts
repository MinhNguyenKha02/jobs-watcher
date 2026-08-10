import type { Db } from 'mongodb';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildSystemContainer,
  type AppContainer,
  type SystemContainerOverrides,
} from '../../src/application/container.js';
import type { JobLifecyclePort } from '../../src/application/ports/job-lifecycle.port.js';
import type { ExtractionQueuePort } from '../../src/application/ports/extraction-queue.port.js';
import type { AssetProducingPort } from '../../src/application/ports/asset-producing.port.js';
import type { BrowserPort } from '../../src/application/ports/browser.port.js';
import type { IngestorPort } from '../../src/application/ports/inbound/ingestor.port.js';
import type {
  WebhookAdapter,
  GmailClient,
} from '../../src/infrastructure/inbound/web/webhook-adapter.js';
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
  /** Binding-profile port overrides, passed through to the production composition root. */
  ports?: NonNullable<SystemContainerOverrides['ports']>;
  /** Gmail transport for the inbound webhook adapter (substituted in tests). */
  gmail?: GmailClient;
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
  mongoJobLifecycleAdapter: JobLifecyclePort;
  extractionQueueAdapter: ExtractionQueuePort;
  assetProducingAdapter: AssetProducingPort;
  browserAdapter: BrowserPort;
  ingestor: IngestorPort;
  webhookAdapter: WebhookAdapter;
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
  const assetDir =
    opts.assetDir ?? fs.mkdtempSync(path.join(os.tmpdir(), `jobs-watcher-${opts.ns}-assets-`));

  const container = buildSystemContainer(
    {
      nodeEnv: 'test',
      mongodb: { uri: storage.uri, dbName },
      rabbitmq: { url: RMQ_URL, exchange },
      uds: { socketPath: socket, token: 'e2e-internal-token' },
      health: { port: 0 },
      asset: { outputDir: assetDir },
    },
    {
      ports: opts.ports,
      ...(opts.gmail ? { gmail: opts.gmail } : {}),
    }
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
    try {
      await bus.teardown();
    } catch {
      /* best-effort */
    }
    if (opts.startScheduler) {
      try {
        await container.extractionScheduler.stop();
      } catch {
        /* best-effort */
      }
    }
    try {
      await container.udsAdapter.stop();
    } catch {
      /* best-effort */
    }
    try {
      await container.rmq.disconnect();
    } catch {
      /* best-effort */
    }
    try {
      await container.mongoConnector.disconnect();
    } catch {
      /* best-effort */
    }
    try {
      fs.rmSync(assetDir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
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
    webhookAdapter: container.webhookAdapter,
    start,
    stop,
  };
}
