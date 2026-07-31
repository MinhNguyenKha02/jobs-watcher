import { config } from './config.js';
import { initLogger, createLogger } from './infrastructure/outbound/logging/logger.js';

import { MongoInitializer } from './infrastructure/outbound/persistence/mongo-init.js';
import { MongoConnector } from './infrastructure/outbound/persistence/mongo-connection.js';
import { MongoJobLifecycleAdapter } from './infrastructure/outbound/persistence/mongo-job-lifecycle-adapter.js';
import { MongoExtractionQueueAdapter } from './infrastructure/outbound/persistence/mongo-extraction-queue-adapter.js';
import { RabbitMqConnection } from './infrastructure/outbound/rabbitmq/rabbitmq-connection.js';
import { RabbitMqParseAdapter } from './infrastructure/outbound/rabbitmq/rabbitmq-parse-adapter.js';
import { RabbitMqRoutingAdapter } from './infrastructure/outbound/rabbitmq/rabbitmq-route-adapter.js';
import { JobIngestor } from './application/ingestor.js';
import { UdsAdapter } from './infrastructure/inbound/uds/uds-adapter.js';
import { startHealthServer } from './infrastructure/inbound/health/health-adapter.js';
import { MetricsRegistry } from './infrastructure/outbound/monitoring/metrics-registry.js';
import { SystemMonitor } from './infrastructure/outbound/monitoring/system-monitor.js';
import { AssetProducingAdapter } from './infrastructure/outbound/asset-builder/asset-producing-adapter.js';
import { ExtractionScheduler } from './application/extraction-scheduler.js';
import { PlaywrightBrowserAdapter } from './infrastructure/outbound/browser/browser-adapter.js';

initLogger();
const logger = createLogger('Boot');

async function main(): Promise<void> {
  logger.info('Starting jobs-watcher', { env: config.nodeEnv });

  const mongoConnector = new MongoConnector(config.mongodb.uri);
  await mongoConnector.connect();

  const mongoInitializer = new MongoInitializer(mongoConnector.clientInstance, config.mongodb.dbName);
  await mongoInitializer.init();
  
  const metricsRegistry = new MetricsRegistry();
  const systemMonitor = new SystemMonitor();
  
  const rmq = new RabbitMqConnection({
    url: config.rabbitmq.url,
    exchange: config.rabbitmq.exchange,
  });
  await rmq.connect();
  
  const parseAdapter = new RabbitMqParseAdapter(rmq);
  const routeAdapter = new RabbitMqRoutingAdapter(rmq);
  const assetProducingAdapter = new AssetProducingAdapter();
  const mongoJobLifecycleAdapter = new MongoJobLifecycleAdapter(mongoInitializer.dbInstance);
  const extractionQueueAdapter = new MongoExtractionQueueAdapter(metricsRegistry, mongoInitializer.dbInstance);

  const ingestor = new JobIngestor(
    mongoJobLifecycleAdapter,
    parseAdapter,
    routeAdapter,
    extractionQueueAdapter,
    assetProducingAdapter,
    metricsRegistry,
  );

  const browserAdapter = new PlaywrightBrowserAdapter();

  const extractionScheduler = new ExtractionScheduler(
    extractionQueueAdapter,
    browserAdapter,
    mongoJobLifecycleAdapter,
    ingestor,
    metricsRegistry,
  );
  await extractionScheduler.start();
  startHealthServer({ port: Number(process.env.HEALTH_PORT || '9090'), metricsRegistry, systemMonitor });

  const udsAdapter = new UdsAdapter(ingestor, {
    socketPath: process.env.UDS_SOCKET_PATH || '/run/jobs-watcher/ingest.sock',
    token: process.env.INTERNAL_AUTH_TOKEN,
  });
  await udsAdapter.start();

  logger.info('Startup complete');
}

main().catch((err) => {
  logger.error('Fatal startup error', { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
