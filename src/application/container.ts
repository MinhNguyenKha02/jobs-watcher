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
import {
  clearCurrentJob,
  getCurrentJob,
  resetState,
  type CurrentJobState,
} from '../presentation/tui/shared-tui-state.js';
import type { ActionWriterPort } from '../presentation/tui/ports/action-writer.port.js';
import type { JobEventReaderPort } from '../presentation/tui/ports/job-event-reader.port.js';

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
 * TUI process composition root. Flat writer/reader/ipc surface; durable queues derived
 * from `ns` (`tui.<ns>.s1/s2/s2direct/s3s4`). Auto-starts reader on `start()`.
 * `rmq.consume` ephemeral helper deleted — asserts go via `ipc` file seam.
 */
export interface TuiContainerConfig {
  rmq: { url: string; exchange: string };
  uds: { socketPath: string; token?: string };
  ns?: string;
}

export interface TuiContainerOverrides {
  rmq?: Partial<TuiContainerConfig['rmq']>;
  uds?: Partial<TuiContainerConfig['uds']>;
  ns?: string;
  /** Binding profile: substitute reader/writer slots for tests. Absent → real adapter. */
  ports?: {
    rmqReader?: JobEventReaderPort;
    udsWriter?: ActionWriterPort;
  };
}

export interface TuiContainer {
  writer: ActionWriterPort;
  reader: JobEventReaderPort;
  ipc: { read(): CurrentJobState; clear(): void };
  start: () => Promise<void>;
  stop: () => Promise<void>;
  /** @deprecated use `writer` */
  udsWriter: ActionWriterPort;
  /** @deprecated use `reader` */
  rmqReader: JobEventReaderPort;
}

export function buildTuiContainer(
  cfg: TuiContainerConfig,
  overrides: TuiContainerOverrides = {}
): TuiContainer {
  const rmq = { ...cfg.rmq, ...overrides.rmq };
  const uds = { ...cfg.uds, ...overrides.uds };
  const ns = overrides.ns ?? cfg.ns;
  const ports = overrides.ports ?? {};

  const s1Queue = ns ? `tui.${ns}.s1` : 'tui.s1';
  const s2Queue = ns ? `tui.${ns}.s2` : 'tui.s2';
  const s2DirectQueue = ns ? `tui.${ns}.s2direct` : 'tui.s2direct';
  const s34Queue = ns ? `tui.${ns}.s3s4` : 'tui.s3s4';

  const writer = (ports.udsWriter as ActionWriterPort) ?? new UdsActionWriter(uds.socketPath, uds.token);

  const reader =
    (ports.rmqReader as JobEventReaderPort) ??
    new RabbitMqJobReader(rmq.url, {
      exchange: rmq.exchange,
      s1Queue,
      s2Queue,
      s2DirectQueue,
      s34Queue,
    });

  const ipc = { read: getCurrentJob, clear: clearCurrentJob };

  let started = false;

  async function start(): Promise<void> {
    if (started) return;
    resetState();
    await reader.start();
    started = true;
    logger.info('TUI container started');
  }

  async function stop(): Promise<void> {
    if (!started) return;
    try {
      reader.stop();
    } catch (e) {
      /* best-effort */
    }
    started = false;
    logger.info('TUI container stopped');
  }

  return {
    writer,
    reader,
    ipc,
    get udsWriter() {
      return writer;
    },
    get rmqReader() {
      return reader;
    },
    start,
    stop,
  };
}
