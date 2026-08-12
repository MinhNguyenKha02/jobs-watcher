import { startHealthServer } from '../infrastructure/inbound/health/health-adapter.js';
import { UdsAdapter } from '../infrastructure/inbound/uds/uds-adapter.js';
import { WebhookAdapter, type GmailClient } from '../infrastructure/inbound/web/webhook-adapter.js';
import { AssetProducingAdapter } from '../infrastructure/outbound/asset-builder/asset-producing-adapter.js';
import { PlaywrightBrowserAdapter } from '../infrastructure/outbound/browser/browser-adapter.js';
import { GmailService } from '../infrastructure/outbound/gmail.js';
import { createLogger } from '../infrastructure/outbound/logging/logger.js';
import { MetricsRegistry } from '../infrastructure/outbound/monitoring/metrics-registry.js';
import { SystemMonitor } from '../infrastructure/outbound/monitoring/system-monitor.js';
import { MongoConnector } from '../infrastructure/outbound/persistence/mongo-connection.js';
import { MongoExtractionQueueAdapter } from '../infrastructure/outbound/persistence/mongo-extraction-queue-adapter.js';
import { MongoInitializer } from '../infrastructure/outbound/persistence/mongo-init.js';
import { MongoJobLifecycleAdapter } from '../infrastructure/outbound/persistence/mongo-job-lifecycle-adapter.js';
import { RabbitMqConnection } from '../infrastructure/outbound/rabbitmq/rabbitmq-connection.js';
import { RabbitMqParseAdapter } from '../infrastructure/outbound/rabbitmq/rabbitmq-parse-adapter.js';
import { RabbitMqRoutingAdapter } from '../infrastructure/outbound/rabbitmq/rabbitmq-route-adapter.js';
import { RabbitMqJobReader } from '../presentation/tui/components/RabbitMqJobReader.js';
import { UdsActionWriter } from '../presentation/tui/components/UdsActionWriter.js';
import { resetState } from '../presentation/tui/shared-tui-state.js';
import { ActionController } from '../presentation/tui/tui-stdin-adapter.js';
import { OpsTuiApp } from '../presentation/tui/tui-stdout-adapter.js';

import { ExtractionScheduler } from './extraction-scheduler.js';
import { JobIngestor } from './ingestor.js';
import type { AssetProducingPort } from './ports/asset-producing.port.js';
import type { BrowserPort } from './ports/browser.port.js';
import type { ExtractionQueuePort } from './ports/extraction-queue.port.js';
import type { IngestorPort } from './ports/inbound/ingestor.port.js';
import type { JobLifecyclePort } from './ports/job-lifecycle.port.js';
import type { ParsePort } from './ports/parse.port.js';
import type { RoutePort } from './ports/route.port.js';

const logger = createLogger('Container');

/**
 * Infrastructure + application wiring configuration. Mirrors the production
 * environment targets so tests can redirect infra endpoints (MongoMemoryServer,
 * namespaced RMQ exchange, temp asset dir, socket path).
 */
export interface DaemonContainerConfig {
  nodeEnv: string;
  mongodb: { uri: string; dbName: string };
  rabbitmq: { url: string; exchange: string };
  uds: { socketPath: string; token?: string };
  health: { port: number };
  asset: { outputDir: string };
}

/**
 * Runtime overrides. May replace deterministic seams (infra targets/browser
 * options) and, via `ports`, substitute an adapter slot with a test
 * implementation (mock or scripted port). A provided `ports` slot replaces
 * that adapter; an absent one composes the real production adapter. The full
 * production adapter set is always defaulted, so `src/index.ts` (no overrides)
 * is unchanged.
 */
export interface DaemonContainerOverrides {
  mongodb?: { uri?: string; dbName?: string };
  rabbitmq?: { url?: string; exchange?: string };
  uds?: { socketPath?: string; token?: string };
  health?: { port?: number };
  browser?: { headless?: boolean; timeout?: number };
  asset?: { outputDir?: string };
  /** Gmail transport for the inbound webhook adapter (substituted in tests). */
  gmail?: GmailClient;
  /** Binding profile: substitute adapter slots for tests. Absent → real adapter. */
  ports?: {
    jobLifecycle?: JobLifecyclePort;
    extractionQueue?: ExtractionQueuePort;
    parse?: ParsePort;
    route?: RoutePort;
    assetProducing?: AssetProducingPort;
    browser?: BrowserPort;
    ingestor?: IngestorPort;
  };
}

export interface DaemonContainer {
  mongoConnector: MongoConnector;
  mongoInitializer: MongoInitializer;
  metricsRegistry: MetricsRegistry;
  systemMonitor: SystemMonitor;
  rmq: RabbitMqConnection;
  parseAdapter: ParsePort;
  routeAdapter: RoutePort;
  assetProducingAdapter: AssetProducingPort;
  mongoJobLifecycleAdapter: JobLifecyclePort;
  extractionQueueAdapter: ExtractionQueuePort;
  ingestor: IngestorPort;
  browserAdapter: BrowserPort;
  extractionScheduler: ExtractionScheduler;
  udsAdapter: UdsAdapter;
  webhookAdapter: WebhookAdapter;
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

export function buildDaemonContainer(
  cfg: DaemonContainerConfig,
  overrides: DaemonContainerOverrides = {}
): DaemonContainer {
  const mongodb = { ...cfg.mongodb, ...overrides.mongodb };
  const rabbitmq = { ...cfg.rabbitmq, ...overrides.rabbitmq };
  const uds = { ...cfg.uds, ...overrides.uds };
  const health = { ...cfg.health, ...overrides.health };
  const asset = { ...cfg.asset, ...overrides.asset };

  const mongoConnector = new MongoConnector(mongodb.uri);
  const mongoInitializer = new MongoInitializer(mongoConnector.clientInstance, mongodb.dbName);

  const metricsRegistry = new MetricsRegistry();
  const systemMonitor = new SystemMonitor();

  const rmq = new RabbitMqConnection({
    url: rabbitmq.url,
    exchange: rabbitmq.exchange,
  });

  const ports = overrides.ports ?? {};

  const parseAdapter = ports.parse ?? new RabbitMqParseAdapter(rmq);
  const routeAdapter = ports.route ?? new RabbitMqRoutingAdapter(rmq);
  const assetProducingAdapter = ports.assetProducing ?? new AssetProducingAdapter(asset.outputDir);
  const mongoJobLifecycleAdapter =
    ports.jobLifecycle ?? new MongoJobLifecycleAdapter(mongoInitializer.dbInstance);
  const extractionQueueAdapter =
    ports.extractionQueue ??
    new MongoExtractionQueueAdapter(metricsRegistry, mongoInitializer.dbInstance);

  const ingestor =
    ports.ingestor ??
    new JobIngestor(
      mongoJobLifecycleAdapter,
      parseAdapter,
      routeAdapter,
      extractionQueueAdapter,
      assetProducingAdapter,
      metricsRegistry
    );

  const browserAdapter = ports.browser ?? new PlaywrightBrowserAdapter(overrides.browser);

  const extractionScheduler = new ExtractionScheduler(
    extractionQueueAdapter,
    browserAdapter,
    mongoJobLifecycleAdapter,
    ingestor,
    metricsRegistry
  );

  const udsAdapter = new UdsAdapter(ingestor, {
    socketPath: uds.socketPath,
    token: uds.token,
  });

  const webhookAdapter = new WebhookAdapter(ingestor, overrides.gmail ?? new GmailService());

  let started = false;

  async function start(): Promise<void> {
    if (started) return;
    await mongoConnector.connect();
    await mongoInitializer.init();
    await rmq.connect();
    await extractionScheduler.start();
    startHealthServer({
      port: health.port,
      metricsRegistry,
      systemMonitor,
    });
    await udsAdapter.start();
    started = true;
    logger.info('Daemon container started');
  }

  async function stop(): Promise<void> {
    if (!started) return;
    try {
      await udsAdapter.stop();
    } catch (e) {
      /* best-effort */
    }
    try {
      await extractionScheduler.stop();
    } catch (e) {
      /* best-effort */
    }
    try {
      await rmq.disconnect();
    } catch (e) {
      /* best-effort */
    }
    try {
      await mongoConnector.disconnect();
    } catch (e) {
      /* best-effort */
    }
    started = false;
    logger.info('Daemon container stopped');
  }

  return {
    mongoConnector,
    mongoInitializer,
    metricsRegistry,
    systemMonitor,
    rmq,
    parseAdapter,
    routeAdapter,
    assetProducingAdapter,
    mongoJobLifecycleAdapter,
    extractionQueueAdapter,
    ingestor,
    browserAdapter,
    extractionScheduler,
    udsAdapter,
    webhookAdapter,
    start,
    stop,
  };
}

/**
 * TUI process composition root. Mirrors the two-process wiring: the
 * action-controller process (`ActionController` + `UdsActionWriter`) and the
 * render-server process (`OpsTuiApp` + `RabbitMqJobReader`) both talking over
 * IPC — UDS req/res (`/internal/action`, `/internal/ingest`) and RMQ pub/sub
 * (`jobs.events`) — with the shared ipc file as the observable seam. Queue
 * names and the exchange are per-run so test namespaces never collide.
 */
export interface TuiContainerConfig {
  rmq: { url: string; exchange: string; s1Queue: string; s2Queue: string; s34Queue: string };
  uds: { socketPath: string; token?: string };
  pollIntervalMs?: number;
}

export interface TuiContainerOverrides {
  rmq?: Partial<TuiContainerConfig['rmq']>;
  uds?: Partial<TuiContainerConfig['uds']>;
  pollIntervalMs?: number;
  /** Binding profile: substitute reader/writer slots for tests. Absent → real adapter. */
  ports?: {
    rmqReader?: RabbitMqJobReader;
    udsWriter?: UdsActionWriter;
  };
}

export interface TuiContainer {
  udsWriter: UdsActionWriter;
  actionController: ActionController;
  rmqReader: RabbitMqJobReader;
  opsTuiApp: OpsTuiApp;
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

export function buildTuiContainer(
  cfg: TuiContainerConfig,
  overrides: TuiContainerOverrides = {}
): TuiContainer {
  const rmq = { ...cfg.rmq, ...overrides.rmq };
  const uds = { ...cfg.uds, ...overrides.uds };
  const ports = overrides.ports ?? {};

  const udsWriter = ports.udsWriter ?? new UdsActionWriter(uds.socketPath, uds.token);

  const actionController = new ActionController({
    socketPath: uds.socketPath,
    udsToken: uds.token,
  });

  const rmqReader =
    ports.rmqReader ??
    new RabbitMqJobReader(rmq.url, {
      exchange: rmq.exchange,
      s1Queue: rmq.s1Queue,
      s2Queue: rmq.s2Queue,
      s34Queue: rmq.s34Queue,
    });

  const opsTuiApp = new OpsTuiApp({
    rmqUrl: rmq.url,
    socketPath: uds.socketPath,
    udsToken: uds.token,
    pollIntervalMs: overrides.pollIntervalMs ?? cfg.pollIntervalMs,
  });

  let started = false;

  async function start(): Promise<void> {
    if (started) return;
    // Initialize the shared ipc seam so both processes read/write the same file.
    resetState();
    started = true;
    logger.info('TUI container started');
  }

  async function stop(): Promise<void> {
    if (!started) return;
    try {
      rmqReader.stop();
    } catch (e) {
      /* best-effort */
    }
    started = false;
    logger.info('TUI container stopped');
  }

  return {
    udsWriter,
    actionController,
    rmqReader,
    opsTuiApp,
    start,
    stop,
  };
}
