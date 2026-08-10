import { MongoInitializer } from '../infrastructure/outbound/persistence/mongo-init.js';
import { MongoConnector } from '../infrastructure/outbound/persistence/mongo-connection.js';
import { MongoJobLifecycleAdapter } from '../infrastructure/outbound/persistence/mongo-job-lifecycle-adapter.js';
import { MongoExtractionQueueAdapter } from '../infrastructure/outbound/persistence/mongo-extraction-queue-adapter.js';
import { RabbitMqConnection } from '../infrastructure/outbound/rabbitmq/rabbitmq-connection.js';
import { RabbitMqParseAdapter } from '../infrastructure/outbound/rabbitmq/rabbitmq-parse-adapter.js';
import { RabbitMqRoutingAdapter } from '../infrastructure/outbound/rabbitmq/rabbitmq-route-adapter.js';
import { JobIngestor } from './ingestor.js';
import { UdsAdapter } from '../infrastructure/inbound/uds/uds-adapter.js';
import { WebhookAdapter, type GmailClient } from '../infrastructure/inbound/web/webhook-adapter.js';
import { GmailService } from '../infrastructure/outbound/gmail.js';
import { startHealthServer } from '../infrastructure/inbound/health/health-adapter.js';
import { MetricsRegistry } from '../infrastructure/outbound/monitoring/metrics-registry.js';
import { SystemMonitor } from '../infrastructure/outbound/monitoring/system-monitor.js';
import { AssetProducingAdapter } from '../infrastructure/outbound/asset-builder/asset-producing-adapter.js';
import { ExtractionScheduler } from './extraction-scheduler.js';
import { PlaywrightBrowserAdapter } from '../infrastructure/outbound/browser/browser-adapter.js';
import { createLogger } from '../infrastructure/outbound/logging/logger.js';
import type { JobLifecyclePort } from './ports/job-lifecycle.port.js';
import type { ExtractionQueuePort } from './ports/extraction-queue.port.js';
import type { ParsePort } from './ports/parse.port.js';
import type { RoutePort } from './ports/route.port.js';
import type { AssetProducingPort } from './ports/asset-producing.port.js';
import type { BrowserPort } from './ports/browser.port.js';
import type { IngestorPort } from './ports/inbound/ingestor.port.js';

const logger = createLogger('Container');

/**
 * Infrastructure + application wiring configuration. Mirrors the production
 * environment targets so tests can redirect infra endpoints (MongoMemoryServer,
 * namespaced RMQ exchange, temp asset dir, socket path).
 */
export interface SystemContainerConfig {
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
export interface SystemContainerOverrides {
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

export interface AppContainer {
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

export function buildSystemContainer(
  cfg: SystemContainerConfig,
  overrides: SystemContainerOverrides = {}
): AppContainer {
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
    logger.info('System container started');
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
    logger.info('System container stopped');
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
