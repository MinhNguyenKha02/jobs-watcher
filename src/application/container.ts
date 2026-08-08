import { MongoInitializer } from '../infrastructure/outbound/persistence/mongo-init.js';
import { MongoConnector } from '../infrastructure/outbound/persistence/mongo-connection.js';
import { MongoJobLifecycleAdapter } from '../infrastructure/outbound/persistence/mongo-job-lifecycle-adapter.js';
import { MongoExtractionQueueAdapter } from '../infrastructure/outbound/persistence/mongo-extraction-queue-adapter.js';
import { RabbitMqConnection } from '../infrastructure/outbound/rabbitmq/rabbitmq-connection.js';
import { RabbitMqParseAdapter } from '../infrastructure/outbound/rabbitmq/rabbitmq-parse-adapter.js';
import { RabbitMqRoutingAdapter } from '../infrastructure/outbound/rabbitmq/rabbitmq-route-adapter.js';
import { JobIngestor } from './ingestor.js';
import { UdsAdapter } from '../infrastructure/inbound/uds/uds-adapter.js';
import { startHealthServer } from '../infrastructure/inbound/health/health-adapter.js';
import { MetricsRegistry } from '../infrastructure/outbound/monitoring/metrics-registry.js';
import { SystemMonitor } from '../infrastructure/outbound/monitoring/system-monitor.js';
import { AssetProducingAdapter } from '../infrastructure/outbound/asset-builder/asset-producing-adapter.js';
import { ExtractionScheduler } from './extraction-scheduler.js';
import { PlaywrightBrowserAdapter } from '../infrastructure/outbound/browser/browser-adapter.js';
import { createLogger } from '../infrastructure/outbound/logging/logger.js';

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
 * options) but NEVER omit an adapter — the full production adapter set is
 * always composed.
 */
export interface SystemContainerOverrides {
  mongodb?: { uri?: string; dbName?: string };
  rabbitmq?: { url?: string; exchange?: string };
  uds?: { socketPath?: string; token?: string };
  health?: { port?: number };
  browser?: { headless?: boolean; timeout?: number };
  asset?: { outputDir?: string };
}

export interface AppContainer {
  mongoConnector: MongoConnector;
  mongoInitializer: MongoInitializer;
  metricsRegistry: MetricsRegistry;
  systemMonitor: SystemMonitor;
  rmq: RabbitMqConnection;
  parseAdapter: RabbitMqParseAdapter;
  routeAdapter: RabbitMqRoutingAdapter;
  assetProducingAdapter: AssetProducingAdapter;
  mongoJobLifecycleAdapter: MongoJobLifecycleAdapter;
  extractionQueueAdapter: MongoExtractionQueueAdapter;
  ingestor: JobIngestor;
  browserAdapter: PlaywrightBrowserAdapter;
  extractionScheduler: ExtractionScheduler;
  udsAdapter: UdsAdapter;
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

export function buildSystemContainer(
  cfg: SystemContainerConfig,
  overrides: SystemContainerOverrides = {},
): AppContainer {
  const mongodb = { ...cfg.mongodb, ...overrides.mongodb };
  const rabbitmq = { ...cfg.rabbitmq, ...overrides.rabbitmq };
  const uds = { ...cfg.uds, ...overrides.uds };
  const health = { ...cfg.health, ...overrides.health };
  const asset = { ...cfg.asset, ...overrides.asset };

  const mongoConnector = new MongoConnector(mongodb.uri);
  const mongoInitializer = new MongoInitializer(
    mongoConnector.clientInstance,
    mongodb.dbName,
  );

  const metricsRegistry = new MetricsRegistry();
  const systemMonitor = new SystemMonitor();

  const rmq = new RabbitMqConnection({
    url: rabbitmq.url,
    exchange: rabbitmq.exchange,
  });

  const parseAdapter = new RabbitMqParseAdapter(rmq);
  const routeAdapter = new RabbitMqRoutingAdapter(rmq);
  const assetProducingAdapter = new AssetProducingAdapter(asset.outputDir);
  const mongoJobLifecycleAdapter = new MongoJobLifecycleAdapter(mongoInitializer.dbInstance);
  const extractionQueueAdapter = new MongoExtractionQueueAdapter(
    metricsRegistry,
    mongoInitializer.dbInstance,
  );

  const ingestor = new JobIngestor(
    mongoJobLifecycleAdapter,
    parseAdapter,
    routeAdapter,
    extractionQueueAdapter,
    assetProducingAdapter,
    metricsRegistry,
  );

  const browserAdapter = new PlaywrightBrowserAdapter(overrides.browser);

  const extractionScheduler = new ExtractionScheduler(
    extractionQueueAdapter,
    browserAdapter,
    mongoJobLifecycleAdapter,
    ingestor,
    metricsRegistry,
  );

  const udsAdapter = new UdsAdapter(ingestor, {
    socketPath: uds.socketPath,
    token: uds.token,
  });

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
    try { await udsAdapter.stop(); } catch (e) { /* best-effort */ }
    try { await extractionScheduler.stop(); } catch (e) { /* best-effort */ }
    try { await rmq.disconnect(); } catch (e) { /* best-effort */ }
    try { await mongoConnector.disconnect(); } catch (e) { /* best-effort */ }
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
    start,
    stop,
  };
}