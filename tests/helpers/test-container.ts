/**
 * Solid-Files Rework v2 — canonical 2-container test-IoC facade.
 *
 * Two composition roots, each exposing a **perfect, consolidated** surface:
 *
 *   buildTestDaemonContainer(cfg, overrides?) →
 *     { rmq, jobLifecycle, extractQueue, browser, assetProducing,
 *       uds, webhook, mongo, assetDir, storage, apps, start, stop }
 *   buildTestTuiContainer(cfg, overrides?) →
 *     { rmq: { consume, reader }, uds: { write }, ipc: { path, read, clear },
 *       app, start, stop }
 *
 * The 2nd arg `{ports}` selects mock mode (production composition root, all
 * infra ports scripted with `vi.fn()` spies; NO Mongo/RMQ/UDS ever touched).
 * Absent (or carrying only the real-mode `assetProducing` seam) → real mode
 * (full mongod + namespaced live RMQ exchange + UDS socket, real adapters).
 * Publication is proven via `daemon.rmq.ports.parse|route` (spies or
 * real) and the consumer leg `tui.rmq.consume` (fresh exclusive queue, ack).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import amqplib, { type Channel } from 'amqplib';
import type { Collection } from 'mongodb';
import { vi } from 'vitest';

import {
  buildTuiContainer,
  buildDaemonContainer,
  type TuiContainer,
  type DaemonContainerOverrides,
} from '../../src/application/container.js';
import type { AssetProducingPort } from '../../src/application/ports/asset-producing.port.js';
import type { BrowserPort } from '../../src/application/ports/browser.port.js';
import type { ExtractionQueuePort } from '../../src/application/ports/extraction-queue.port.js';
import type { IngestorPort } from '../../src/application/ports/inbound/ingestor.port.js';
import type { JobLifecyclePort } from '../../src/application/ports/job-lifecycle.port.js';
import type { ParsePort } from '../../src/application/ports/parse.port.js';
import type { RoutePort } from '../../src/application/ports/route.port.js';
import { ActionEvent } from '../../src/domain/types/action-event.js';
import type { UdsAdapter } from '../../src/infrastructure/inbound/uds/uds-adapter.js';
import type {
  WebhookAdapter,
  GmailClient,
} from '../../src/infrastructure/inbound/web/webhook-adapter.js';
import { postJsonOverUds } from '../../src/infrastructure/utils/uds-http.js';
import type { RabbitMqJobReader } from '../../src/presentation/tui/components/RabbitMqJobReader.js';
import type { ActionWriterPort } from '../../src/presentation/tui/ports/action-writer.port.js';
import type { JobEventReaderPort } from '../../src/presentation/tui/ports/job-event-reader.port.js';
import {
  clearCurrentJob,
  getCurrentJob,
  type CurrentJobState,
} from '../../src/presentation/tui/shared-tui-state.js';

import { createTestStorage } from './create-test-storage.js';

const RMQ_URL = process.env.RABBITMQ_URL || 'amqp://localhost';

/** Shared consumed payload shape (mirrors what the real RabbitMqJobReader reads). */
export type ConsumedJob = any;

const ROLE_KEYS: Record<'s1' | 's2' | 's34', ActionEvent[]> = {
  s1: [ActionEvent.GENERATED],
  s2: [ActionEvent.PARSE_COMPLETED],
  s34: [
    ActionEvent.QUEUED,
    ActionEvent.TRASHED,
    ActionEvent.ROUTE_FAILED,
    ActionEvent.PARSE_FAILED,
  ],
};

export type ConsumeTarget = 's1' | 's2' | 's34' | ActionEvent[];
export type TestStorage = Awaited<ReturnType<typeof createTestStorage>>;
/** Structural scheduler surface the facade exposes under `apps.scheduler`. */
export type AppsScheduler = { start: () => Promise<void>; stop: () => Promise<void> };

export interface BuildTestDaemonContainerOptions {
  /** Unique namespace: RMQ exchange + UDS socket path (per-file isolation). */
  ns: string;
  /** Also start the extraction scheduler (+ Playwright browser) on start(). Default false. */
  startScheduler?: boolean;
  rmq?: { url?: string; exchange?: string };
  uds?: { socketPath?: string; token?: string };
  mongodb?: { uri?: string; dbName?: string };
  asset?: { outputDir?: string };
}

/**
 * Real-mode overrides. `ports.assetProducing` substitutes the heavyweight
 * profile-artifact render (an external seam, not a boundary port) — permitted
 * in real mode so [j] resolution never needs chromium in boundary tests.
 * `gmail` substitutes the inbound webhook transport.
 */
export interface TestDaemonContainerRealOverrides {
  ports?: { assetProducing?: AssetProducingPort };
  gmail?: GmailClient;
}

/** Mock-mode port set (LSP: each spy satisfies the app/dev port interface). */
export interface MockPorts {
  jobLifecycle?: JobLifecyclePort;
  extractionQueue?: ExtractionQueuePort;
  parse?: ParsePort;
  route?: RoutePort;
  browser?: BrowserPort;
  assetProducing?: AssetProducingPort;
  ingestor?: IngestorPort;
}

interface TestDaemonContainerShared {
  ns: string;
  rmq: { exchange: string; ports: { parse: ParsePort; route: RoutePort } };
  jobLifecycle: JobLifecyclePort;
  extractQueue: ExtractionQueuePort;
  browser: BrowserPort;
  assetProducing: AssetProducingPort;
  uds: { socket: string; adapter: UdsAdapter };
  webhook: { adapter: WebhookAdapter };
  assetDir: string;
  apps: {
    ingest: {
      processIngest: IngestorPort['processIngest'];
      processResolution: IngestorPort['processResolution'];
    };
    scheduler: AppsScheduler;
  };
  start: (opts?: { startScheduler?: boolean }) => Promise<void>;
  stop: () => Promise<void>;
}

/** Real / integration harness container — real mongod, RMQ exchange, UDS. */
export interface TestDaemonContainer extends TestDaemonContainerShared {
  storage: TestStorage;
  mongo: {
    jobLifecycle: JobLifecyclePort;
    extractionQueue: ExtractionQueuePort;
    raw: (col: string) => Collection;
  };
}

/**
 * Mock / unit harness container — production root over scripted ports. No
 * storage, no database; `mongo.raw` is real-mode only.
 */
export interface MockTestDaemonContainer extends TestDaemonContainerShared {
  mongo: {
    jobLifecycle: JobLifecyclePort;
    extractionQueue: ExtractionQueuePort;
    raw: (col: string) => never;
  };
}

/* ------------------------------------------------------------------ *
 * Mock app/dev port builders — folded into the facade (P0.6 deletion:  *
 * tests/helpers/mock-app-ports.ts). Each satisfies its port interface. *
 * ------------------------------------------------------------------ */

/**
 * Mock port builders. Return type is the `vi.fn()`-backed spy surface (unit
 * tests configure/assert via `ReturnType<typeof mockX>`); each `satisfies` its
 * explicit src port interface (LSP compiler-enforced).
 */
export function mockJobLifecyclePort() {
  return {
    upsert: vi.fn(),
    updateStage: vi.fn(),
    findById: vi.fn(),
  } satisfies JobLifecyclePort;
}

export function mockExtractionQueuePort() {
  return {
    enqueue: vi.fn(),
    dequeue: vi.fn(),
    size: vi.fn().mockResolvedValue(0),
    onEnqueue: vi.fn(),
  } satisfies ExtractionQueuePort;
}

export function mockParsePort() {
  return {
    emitGenerated: vi.fn(),
    emitCompleted: vi.fn(),
    emitFailed: vi.fn(),
  } satisfies ParsePort;
}

export function mockRoutingPort() {
  return {
    emitJobQueued: vi.fn(),
    emitJobTrashed: vi.fn(),
    emitRouteFailed: vi.fn(),
  } satisfies RoutePort;
}

export function mockBrowserPort() {
  return {
    start: vi.fn<any[], Promise<void>>(),
    stop: vi.fn<any[], Promise<void>>(),
    extract: vi.fn<any[], Promise<{ html: string }>>(),
  } satisfies BrowserPort;
}

export function mockAssetProducingPort() {
  return {
    toAsset: vi.fn<any[], Promise<{ pdfPath?: string }>>(),
  } satisfies AssetProducingPort;
}

export function mockIngestorPort() {
  return {
    processIngest: vi.fn<any[], Promise<void>>(),
    processResolution: vi.fn<any[], Promise<void>>(),
  } satisfies IngestorPort;
}

export function mockJobEventReaderPort() {
  return {
    start: vi.fn<any[], Promise<void>>(),
    stop: vi.fn(),
    isConnected: vi.fn(() => false),
    getQueueDepth: vi.fn(() => 0),
    resetReader: vi.fn(),
  } satisfies JobEventReaderPort;
}

export function mockActionWriterPort() {
  return {
    queue: vi.fn<any[], Promise<void>>(),
    trash: vi.fn<any[], Promise<void>>(),
    ingest: vi.fn<any[], Promise<void>>(),
    webhookIngest: vi.fn<any[], Promise<string>>(),
  } satisfies ActionWriterPort;
}

/* ------------------------------------------------------------------ *
 * Daemon facade                                                      *
 * ------------------------------------------------------------------ */

/**
 * Real mode: full mongod + namespaced real RMQ exchange + UDS socket, all
 * production adapters. `{ overrides.ports.assetProducing }` alone substitutes
 * the asset render seam (real mode is preserved).
 *
 * Mock mode (`overrides.ports` carries app ports): production composition root
 * over `vi.fn()`-backed ports, NO infra ever touched — `start`/`stop` are
 * no-ops on infra; the app layer (JobIngestor/ExtractionScheduler) is real and
 * immediately usable.
 */
export function buildTestDaemonContainer(
  cfg: BuildTestDaemonContainerOptions
): Promise<TestDaemonContainer>;
export function buildTestDaemonContainer(
  cfg: BuildTestDaemonContainerOptions,
  overrides: TestDaemonContainerRealOverrides
): Promise<TestDaemonContainer>;
export function buildTestDaemonContainer(
  cfg: BuildTestDaemonContainerOptions,
  overrides: { ports: MockPorts }
): Promise<MockTestDaemonContainer>;
export async function buildTestDaemonContainer(
  opts: BuildTestDaemonContainerOptions,
  overrides: (TestDaemonContainerRealOverrides | { ports: MockPorts }) & {
    gmail?: GmailClient;
  } = {}
): Promise<TestDaemonContainer | MockTestDaemonContainer> {
  const providedPorts = (overrides as { ports?: MockPorts }).ports ?? {};
  const isMock = ['jobLifecycle', 'extractionQueue', 'parse', 'route', 'browser', 'ingestor'].some(
    (k) => k in providedPorts
  );

  const exchange = opts.rmq?.exchange ?? `jobs.events.int.${opts.ns}`;
  const socket = opts.uds?.socketPath ?? `/tmp/jobs-watcher-${opts.ns}.sock`;
  const token = opts.uds?.token ?? 'e2e-internal-token';

  if (isMock) {
    const ports: NonNullable<DaemonContainerOverrides['ports']> = {
      jobLifecycle: providedPorts.jobLifecycle ?? mockJobLifecyclePort(),
      extractionQueue: providedPorts.extractionQueue ?? mockExtractionQueuePort(),
      parse: providedPorts.parse ?? mockParsePort(),
      route: providedPorts.route ?? mockRoutingPort(),
      browser: providedPorts.browser ?? mockBrowserPort(),
      assetProducing: providedPorts.assetProducing ?? mockAssetProducingPort(),
      ...(providedPorts.ingestor ? { ingestor: providedPorts.ingestor } : {}),
    };

    const container = buildDaemonContainer(
      {
        nodeEnv: 'test',
        mongodb: { uri: 'mongodb://localhost/jw-unit', dbName: 'unit' },
        rabbitmq: { url: RMQ_URL, exchange },
        uds: { socketPath: socket, token },
        health: { port: 0 },
        asset: { outputDir: '/tmp/jobs-watcher-unit-assets' },
      },
      { ports }
    );

    const adapterMembers = {
      ns: opts.ns,
      rmq: {
        exchange,
        ports: { parse: container.parseAdapter, route: container.routeAdapter },
      },
      jobLifecycle: container.mongoJobLifecycleAdapter,
      extractQueue: container.extractionQueueAdapter,
      browser: container.browserAdapter,
      assetProducing: container.assetProducingAdapter,
      uds: { socket, adapter: container.udsAdapter },
      webhook: { adapter: container.webhookAdapter },
      assetDir: opts.asset?.outputDir ?? '/tmp/jobs-watcher-unit-assets',
      apps: {
        ingest: {
          processIngest: container.ingestor.processIngest.bind(container.ingestor),
          processResolution: container.ingestor.processResolution.bind(container.ingestor),
        },
        scheduler: {
          start: () => container.extractionScheduler.start(),
          stop: () => container.extractionScheduler.stop(),
        },
      },
      start: async ({ startScheduler }: { startScheduler?: boolean } = {}) => {
        if (startScheduler ?? opts.startScheduler) {
          await container.extractionScheduler.start();
        }
      },
      stop: async () => {
        try {
          await container.extractionScheduler.stop();
        } catch {
          /* best-effort */
        }
      },
    };

    const mock = { ...adapterMembers };
    return {
      ...mock,
      mongo: {
        jobLifecycle: container.mongoJobLifecycleAdapter,
        extractionQueue: container.extractionQueueAdapter,
        raw: (): never => {
          throw new Error('daemon.mongo.raw is real-mode only');
        },
      },
    } satisfies MockTestDaemonContainer;
  }

  // ---- real mode ----
  const storage = await createTestStorage();
  const dbName = opts.mongodb?.dbName ?? storage.dbName;
  const assetDir =
    opts.asset?.outputDir ??
    fs.mkdtempSync(path.join(os.tmpdir(), `jobs-watcher-${opts.ns}-assets-`));

  const ports = { assetProducing: providedPorts.assetProducing };
  const container = buildDaemonContainer(
    {
      nodeEnv: 'test',
      mongodb: { uri: opts.mongodb?.uri ?? storage.uri, dbName },
      rabbitmq: { url: opts.rmq?.url ?? RMQ_URL, exchange },
      uds: { socketPath: socket, token },
      health: { port: 0 },
      asset: { outputDir: assetDir },
    },
    {
      ...(ports.assetProducing ? { ports } : {}),
      ...(overrides.gmail ? { gmail: overrides.gmail } : {}),
    }
  );

  async function start({ startScheduler }: { startScheduler?: boolean } = {}): Promise<void> {
    await container.mongoConnector.connect();
    await container.mongoInitializer.init();
    await container.rmq.connect();
    if (startScheduler ?? opts.startScheduler) {
      await container.extractionScheduler.start();
    }
    await container.udsAdapter.start();
  }

  async function stop(): Promise<void> {
    try {
      if (opts.startScheduler) {
        await container.extractionScheduler.stop();
      }
    } catch {
      /* best-effort */
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
    rmq: {
      exchange,
      ports: { parse: container.parseAdapter, route: container.routeAdapter },
    },
    jobLifecycle: container.mongoJobLifecycleAdapter,
    extractQueue: container.extractionQueueAdapter,
    browser: container.browserAdapter,
    assetProducing: container.assetProducingAdapter,
    uds: { socket, adapter: container.udsAdapter },
    webhook: { adapter: container.webhookAdapter },
    mongo: {
      jobLifecycle: container.mongoJobLifecycleAdapter,
      extractionQueue: container.extractionQueueAdapter,
      raw: (col: string): Collection => storage.client.db(dbName).collection(col),
    },
    assetDir,
    storage,
    apps: {
      ingest: {
        processIngest: container.ingestor.processIngest.bind(container.ingestor),
        processResolution: container.ingestor.processResolution.bind(container.ingestor),
      },
      scheduler: {
        start: () => container.extractionScheduler.start(),
        stop: () => container.extractionScheduler.stop(),
      },
    },
    start,
    stop,
  } satisfies TestDaemonContainer;
}

/* ------------------------------------------------------------------ *
 * TUI facade                                                         *
 * ------------------------------------------------------------------ */

export interface BuildTestTuiContainerOptions {
  /** Unique namespace: RMQ exchange + UDS socket path (per-file isolation). */
  ns: string;
  rmq?: { url?: string; exchange?: string };
  uds?: { socketPath?: string; token?: string };
}

/** Mock-mode tui port overrides (reader/writer scripted with spies). */
export interface TuiPortOverrides {
  rmqReader?: JobEventReaderPort;
  udsWriter?: ActionWriterPort;
}

export interface TuiTestContainer {
  ns: string;
  rmq: {
    /**
     * Bind a fresh exclusive queue to the given routing keys (role shorthand
     * or explicit key set) and resolve with the first matching real payload
     * (acked / removed). Call BEFORE triggering; await the returned promise
     * AFTER. Kills the bind-vs-publish race via a channel established at build.
     */
    consume(target: ConsumeTarget, timeoutMs?: number): Promise<ConsumedJob>;
    reader: JobEventReaderPort;
  };
  uds: { write: ActionWriterPort };
  ipc: { path: string; read(): CurrentJobState; clear(): void };
  app: TuiContainer;
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

/**
 * TUI-process harness through the TUI composition root. Real mode: shares the
 * per-`ns` exchange + socket with the daemon harness; reader started at build.
 * Mock mode (`{ports}` overrides reader/writer): no RMQ/UDS — `consume`
 * rejects (no real exchange); ipc seam remains the real shared state file.
 */
export function buildTestTuiContainer(cfg: BuildTestTuiContainerOptions): Promise<TuiTestContainer>;
export function buildTestTuiContainer(
  cfg: BuildTestTuiContainerOptions,
  overrides: { ports: TuiPortOverrides }
): Promise<TuiTestContainer>;
export async function buildTestTuiContainer(
  opts: BuildTestTuiContainerOptions,
  overrides: { ports?: TuiPortOverrides } = {}
): Promise<TuiTestContainer> {
  const exchange = opts.rmq?.exchange ?? `jobs.events.int.${opts.ns}`;
  const socket = opts.uds?.socketPath ?? `/tmp/jobs-watcher-${opts.ns}.sock`;
  const token = opts.uds?.token ?? 'e2e-internal-token';
  const isMock = Boolean(overrides.ports);

  const readerPort = overrides.ports?.rmqReader;
  const writerPort = overrides.ports?.udsWriter;

  const container = buildTuiContainer(
    {
      rmq: {
        url: opts.rmq?.url ?? RMQ_URL,
        exchange,
        s1Queue: `tui.${opts.ns}.s1`,
        s2Queue: `tui.${opts.ns}.s2`,
        s34Queue: `tui.${opts.ns}.s3s4`,
      },
      uds: { socketPath: socket, token },
    },
    {
      ...(readerPort ? { ports: { rmqReader: readerPort as unknown as RabbitMqJobReader } } : {}),
      ...(writerPort && !isMock
        ? {}
        : writerPort
          ? { ports: { udsWriter: writerPort as unknown as never } }
          : {}),
    }
  );

  if (!isMock) {
    // Purge leftover queues so a fresh reader never drains stale-run messages.
    try {
      const purgeConn = await amqplib.connect(opts.rmq?.url ?? RMQ_URL);
      const purgeCh = await purgeConn.createChannel();
      for (const suffix of ['s1', 's2', 's3s4']) {
        try {
          await purgeCh.assertQueue(`tui.${opts.ns}.${suffix}`);
          await purgeCh.purgeQueue(`tui.${opts.ns}.${suffix}`);
        } catch {
          /* best-effort */
        }
      }
      await purgeCh.close();
      await purgeConn.close();
    } catch {
      /* best-effort — RMQ may be unavailable in this run */
    }
    await container.start();
    await container.rmqReader.start();
  }

  // Consumer leg: a dedicated connection/channel with ONE pre-bound durable
  // queue per role (s1/s2/s34), wired at build. Each `consume` call registers a
  // FIFO waiter on the role queue and a drain consumer resolves the oldest
  // waiter — binds happen at build (long before any publish), so the
  // bind-vs-publish race is eliminated deterministically: a published message
  // always routes into the pre-bound queue and waits for its waiter.
  let consumeConn: Awaited<ReturnType<typeof amqplib.connect>> | null = null;
  let consumeCh: Channel | null = null;

  async function ensureConsumerChannel(): Promise<Channel> {
    if (!consumeCh) {
      consumeConn = await amqplib.connect(opts.rmq?.url ?? RMQ_URL);
      consumeCh = await consumeConn.createChannel();
      await consumeCh.assertExchange(exchange, 'topic', { durable: true });
    }
    return consumeCh;
  }

  const CONSUME_ROLES = ['s1', 's2', 's34'] as const;
  const CONSUME_QUEUE = (role: string) => `tui.${opts.ns}.consume.${role}`;

  interface ConsumeWaiter {
    resolve: (v: ConsumedJob) => void;
    timer: ReturnType<typeof setTimeout>;
    cancelled: boolean;
  }
  const pending: Record<string, ConsumeWaiter[]> = { s1: [], s2: [], s34: [] };

  async function startRoleConsumers(): Promise<void> {
    const ch = await ensureConsumerChannel();
    for (const role of CONSUME_ROLES) {
      const queue = CONSUME_QUEUE(role);
      await ch.assertQueue(queue, { durable: false });
      await ch.purgeQueue(queue).catch(() => {});
      for (const key of ROLE_KEYS[role]) {
        await ch.bindQueue(queue, exchange, key);
      }
      ch.consume(
        queue,
        (msg) => {
          if (!msg) return;
          const waiter = pending[role].shift();
          if (waiter) {
            clearTimeout(waiter.timer);
            if (waiter.cancelled) {
              ch.ack(msg);
              return;
            }
            ch.ack(msg);
            waiter.resolve(JSON.parse(msg.content.toString()));
          } else {
            ch.ack(msg);
          }
        },
        { noAck: false }
      );
    }
  }

  if (!isMock) {
    await startRoleConsumers();
  }

  /** Map a consume target to its role queue (single-role subset) or null. */
  function roleForTarget(target: ConsumeTarget): (typeof CONSUME_ROLES)[number] | null {
    if (typeof target === 'string') return target;
    const matches = CONSUME_ROLES.filter(
      (role) =>
        target.length > 0 && target.every((k) => (ROLE_KEYS[role] as ActionEvent[]).includes(k))
    );
    return matches.length === 1 ? matches[0] : null;
  }

  /** Fresh-exclusive-queue fallback for cross-role key arrays (racy; path suites use roles). */
  async function consumeFresh(target: ActionEvent[], timeoutMs: number): Promise<ConsumedJob> {
    const ch = await ensureConsumerChannel();
    const { queue } = await ch.assertQueue('', { exclusive: true });
    for (const key of target) {
      await ch.bindQueue(queue, exchange, key);
    }
    return new Promise<ConsumedJob>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Timeout waiting for message on ${exchange}:${target.join('|')}`)),
        timeoutMs
      );
      ch.consume(
        queue,
        (msg) => {
          if (msg) {
            clearTimeout(timer);
            ch.ack(msg);
            void ch.deleteQueue(queue).catch(() => {});
            resolve(JSON.parse(msg.content.toString()));
          }
        },
        { noAck: false }
      );
    });
  }

  const consume = (target: ConsumeTarget, timeoutMs = 10000): Promise<ConsumedJob> => {
    if (isMock) {
      throw new Error('tui.rmq.consume requires real mode (no RMQ in mock-mode tui)');
    }
    const role = roleForTarget(target);
    if (!role) {
      return consumeFresh(target as ActionEvent[], timeoutMs);
    }
    const keys = typeof target === 'string' ? ROLE_KEYS[target] : (target as ActionEvent[]);
    return new Promise<ConsumedJob>((resolve, reject) => {
      const waiter: ConsumeWaiter = { resolve, timer: undefined as never, cancelled: false };
      waiter.timer = setTimeout(() => {
        const idx = pending[role].indexOf(waiter);
        if (idx !== -1) {
          pending[role].splice(idx, 1);
        }
        reject(new Error(`Timeout waiting for message on ${exchange}:${keys.join('|')}`));
      }, timeoutMs);
      pending[role].push(waiter);
    });
  };

  // TUI→daemon action-writer seam. Uses the raw UDS HTTP wire with a generous
  // timeout: real-mode resolution renders the PDF before responding, which
  // exceeds the prod UdsActionWriter's 10s client timeout.
  const facadeUdsWriter = (): ActionWriterPort => {
    const post = (path: string, body: unknown) =>
      postJsonOverUds(
        {
          socketPath: socket,
          path,
          method: 'POST',
          headers: token ? { 'x-internal-token': token } : {},
          timeoutMs: 60000,
        },
        body
      );
    const check = (res: { statusCode: number; body: string }, label: string): void => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        throw new Error(`${label} failed: ${res.statusCode} ${res.body}`);
      }
    };
    return {
      queue: async (jobLifecycleId) =>
        check(await post('/internal/action', { jobLifecycleId, action: 'queue' }), 'Action'),
      trash: async (jobLifecycleId) =>
        check(await post('/internal/action', { jobLifecycleId, action: 'trash' }), 'Action'),
      ingest: async (html) =>
        check(await post('/internal/ingest', { webhook: false, html }), 'Ingest'),
      webhookIngest: async (jobLifecycleId) => {
        check(
          await post('/internal/ingest?webhook=true', jobLifecycleId ? { jobLifecycleId } : {}),
          'Webhook ingest'
        );
        return '';
      },
    };
  };

  return {
    ns: opts.ns,
    rmq: { consume, reader: readerPort ?? container.rmqReader },
    uds: { write: (writerPort ?? facadeUdsWriter()) as unknown as ActionWriterPort },
    ipc: {
      path: process.env.TUI_SHARED_STATE_PATH ?? '',
      read: () => getCurrentJob(),
      clear: () => clearCurrentJob(),
    },
    app: container,
    start: () => container.start(),
    stop: async () => {
      container.stop();
      if (consumeCh) {
        try {
          await consumeCh.close();
        } catch {
          /* best-effort */
        }
      }
      if (consumeConn) {
        try {
          await consumeConn.close();
        } catch {
          /* best-effort */
        }
      }
    },
  };
}
