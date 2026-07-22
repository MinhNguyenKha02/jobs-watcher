import { config } from './config.js';
import { initLogger, getLogger } from './infrastructure/outbound/logging/logger.js';
import { MongoJobLifecycleAdapter } from './infrastructure/outbound/persistence/mongo-job-lifecycle-adapter.js';
import { RabbitMqConnection } from './infrastructure/outbound/rabbitmq/rabbitmq-connection.js';
import { RabbitMqParseAdapter } from './infrastructure/outbound/rabbitmq/rabbitmq-parse-adapter.js';
import { RabbitMqRoutingAdapter } from './infrastructure/outbound/rabbitmq/rabbitmq-routing-adapter.js';
import { JobIngestor } from './application/ingestor.js';
import { startHealthServer } from './infrastructure/inbound/health/health-adapter.js';
import { MetricsRegistry } from './infrastructure/outbound/monitoring/metrics-registry.js';
import { SystemMonitor } from './infrastructure/outbound/monitoring/system-monitor.js';

initLogger();
const logger = getLogger();

async function main(): Promise<void> {
  logger.info('[Boot] Starting jobs-watcher', { env: config.nodeEnv });

  const mongoAdapter = new MongoJobLifecycleAdapter(config.mongodb.uri, config.mongodb.dbName);
  await mongoAdapter.connect();

  const metricsRegistry = new MetricsRegistry();
  const systemMonitor = new SystemMonitor();

  const rmq = new RabbitMqConnection({
    url: process.env.RABBITMQ_URL || 'amqp://localhost',
    exchange: process.env.RABBITMQ_EXCHANGE || 'jobs.events',
  });
  await rmq.connect();

  const parseAdapter = new RabbitMqParseAdapter(rmq);
  const routingAdapter = new RabbitMqRoutingAdapter(rmq);

  const ingestor = new JobIngestor(
    mongoAdapter,
    parseAdapter,
    routingAdapter,
  );

  startHealthServer({ port: Number(process.env.HEALTH_PORT || '9090'), metricsRegistry, systemMonitor });

  logger.info('[Boot] Startup complete');
}

main().catch((err) => {
  logger.error('[Boot] Fatal startup error', { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
