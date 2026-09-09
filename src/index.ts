import { buildDaemonContainer } from './application/container.js';
import { config } from './config.js';
import { initLogger, createLogger } from './infrastructure/outbound/logging/logger.js';

initLogger();
const logger = createLogger('Boot');

async function main(): Promise<void> {
  logger.info('Starting jobs-watcher', { env: config.nodeEnv });

  const app = buildDaemonContainer(
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
      webhook: {
        port: Number(process.env.WEBHOOK_PORT || '3000'),
        path: process.env.WEBHOOK_PATH || '/webhook/gmail',
      },
      asset: {
        outputDir: process.env.ASSET_OUTPUT_DIR || config.assetPath || './assets',
      },
    },
    {}
  );

  await app.start();

  logger.info('Startup complete');

  process.on('SIGTERM', () => {
    app.stop().then(() => process.exit(0));
  });
  process.on('SIGINT', () => {
    app.stop().then(() => process.exit(0));
  });
}

main().catch((err) => {
  logger.error('Fatal startup error', { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
