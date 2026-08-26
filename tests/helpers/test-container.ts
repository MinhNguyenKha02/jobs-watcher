/**
 * TUI IoC prune — purgeQueues aggregate — 2-container test-IoC facade.
 *
 * Two composition roots, flat writer/reader/ipc surface:
 *
 *   buildTestDaemonContainer(cfg, overrides?) →
 *     { rmq, jobLifecycle, extractQueue, browser, assetProducing,
 *       uds, webhook, mongo, assetDir, storage, apps, start, stop }
 *   buildTestTuiContainer(cfg, overrides?) →
 *     { reader, writer, ipc:{read,clear}, start, stop } + deprecated aliases
 *
 * The 2nd arg `{ports}` selects mock mode (vi.fn() spies; NO infra).
 * Real mode uses mongod + namespaced `jobs.events.int.<ns>` + UDS socket.
 * TUI asserts via durable reader → ipc file seam (no rmq.consume).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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
import type { UdsAdapter } from '../../src/infrastructure/inbound/uds/uds-adapter.js';
import type {
  WebhookAdapter,
  GmailClient,
} from '../../src/infrastructure/inbound/web/webhook-adapter.js';
import { postJsonOverUds } from '../../src/infrastructure/utils/uds-http.js';
import type { ActionWriterPort } from '../../src/presentation/tui/ports/action-writer.port.js';
import type { JobEventReaderPort } from '../../src/presentation/tui/ports/job-event-reader.port.js';
import {
  clearCurrentJob,
  getCurrentJob,
  type CurrentJobState,
} from '../../src/presentation/tui/shared-tui-state.js';

import { createTestStorage } from './create-test-storage.js';

const RMQ_URL = process.env.RABBITMQ_URL || 'amqp://localhost';

/**
 * G7 fail-fast (real-mode only): two LIVE harnesses sharing a namespace means
 * shared exchange/socket/db — the symptom is cross-suite message theft.
 * Tracks active count; released on facade stop(). Mock-mode rebuilds (per-cell
 * `beforeEach`) are unaffected.
 */
const activeNs = new Map<string, number>();
function claimRealNs(ns: string): void {
  const n = activeNs.get(ns) ?? 0;
  if (n > 0) {
    throw new Error(
      `test-container: namespace "${ns}" already has ${n} live real-mode harness(es) — unique per-file ns required`
    );
  }
  activeNs.set(ns, n + 1);
}
function releaseRealNs(ns: string): void {
  const n = activeNs.get(ns) ?? 0;
  if (n <= 1) activeNs.delete(ns);
  else activeNs.set(ns, n - 1);
}

/** @deprecated rmq.consume removed — assert via ipc.read() downstream of durable reader */
export type ConsumedJob = any;
/** @deprecated consume target removed — use ipc seam */
export type ConsumeTarget = 's1' | 's2' | 's34' | string[];
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
    purgeQueues: vi.fn(async () => {}),
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
  claimRealNs(opts.ns);
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
    releaseRealNs(opts.ns);
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
  reader: JobEventReaderPort;
  writer: ActionWriterPort;
  ipc: { read(): CurrentJobState; clear(): void };
  start: () => Promise<void>;
  stop: () => Promise<void>;
  /** @deprecated use `reader` */
  rmq: { reader: JobEventReaderPort };
  /** @deprecated use `writer` */
  uds: { write: ActionWriterPort };
  /** @deprecated use container directly; kept for compatibility */
  app: TuiContainer;
}

/**
 * TUI-process harness through the TUI composition root. Real mode: shares the
 * per-`ns` exchange + socket with the daemon harness; reader auto-started via
 * `container.start()` (durable 4 queues). Mock mode (`{ports}` overrides
 * reader/writer): no RMQ/UDS — ipc seam remains the real shared state file.
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
  if (!isMock) claimRealNs(`tui:${opts.ns}`);

  const readerPort = overrides.ports?.rmqReader;
  const writerPort = overrides.ports?.udsWriter;

  const container = buildTuiContainer(
    {
      rmq: { url: opts.rmq?.url ?? RMQ_URL, exchange },
      uds: { socketPath: socket, token },
      ns: opts.ns,
    },
    {
      ...(readerPort ? { ports: { rmqReader: readerPort } } : {}),
      ...(writerPort ? { ports: { udsWriter: writerPort } } : {}),
    }
  );

  if (!isMock) {
    await container.start();
  }

  // TUI→daemon action-writer seam (60s timeout for [j] pdf render).
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

  const reader = (readerPort ?? container.reader) as JobEventReaderPort;
  const writer = (writerPort ?? facadeUdsWriter()) as ActionWriterPort;

  return {
    ns: opts.ns,
    reader,
    writer,
    ipc: {
      read: () => getCurrentJob(),
      clear: () => clearCurrentJob(),
    },
    // deprecated aliases
    get rmq() {
      return { reader };
    },
    get uds() {
      return { write: writer };
    },
    app: container,
    start: () => container.start(),
    stop: async () => {
      await container.stop();
      if (!isMock) releaseRealNs(`tui:${opts.ns}`);
    },
  };
}
