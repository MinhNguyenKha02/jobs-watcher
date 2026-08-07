import { config } from './config.js';
import { initLogger, createLogger } from './infrastructure/outbound/logging/logger.js';
import { buildSystemContainer } from './application/container.js';

initLogger();
const logger = createLogger('Boot');

async function main(): Promise<void> {
  logger.info('Starting jobs-watcher', { env: config.nodeEnv });

  const app = buildSystemContainer(
    {
      nodeEnv: config.nodeEnv,
      mongodb: config.mongodb,
      rabbitmq: config.rabbitmq,
      uds: {
        socketPath: process.env.UDS_SOCKET_PATH || '/run/jobs-watcher/ingest.sock',
        token: process.env.INTERNAL_AUTH_TOKEN,
      },
      health: {
        port: Number(process.env.HEALTH_PORT || '9090'),
      },
    },
    {},
  );

  await app.start();

  logger.info('Startup complete');
}

main().catch((err) => {
  logger.error('Fatal startup error', { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
