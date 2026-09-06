/**
 * TUI IoC prune — purgeQueues aggregate — 2-container test-IoC facade.
 *
 * Two composition roots, flat writer/reader/ipc surface:
 *
 *   buildTestDaemonContainer(cfg, overrides?) →
 *     { rmq, jobLifecycle, extractQueue, browser, assetProducing,
 *       uds, webhook, mongo, assetDir, storage, apps, start, stop }
 *   buildTestTuiContainer(cfg, overrides?) →
 *     { reader, writer, ipc:{read,clear}, start, stop }
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
  health?: { port?: number };
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

/** Single harness overrides — one interface for real + mock suites. */
export interface TestDaemonContainerOverrides {
  ports?: MockPorts;
  gmail?: GmailClient;
}

/** 6-key discriminator — must stay in sync with runtime isMock (L272). */
type MockDiscriminatorKeys =
  | 'jobLifecycle'
  | 'extractionQueue'
  | 'parse'
  | 'route'
  | 'browser'
  | 'ingestor';

type IsMockOverride<T> = T extends { ports: infer P }
  ? P extends
      | { jobLifecycle: JobLifecyclePort }
      | { extractionQueue: ExtractionQueuePort }
      | { parse: ParsePort }
      | { route: RoutePort }
      | { browser: BrowserPort }
      | { ingestor: IngestorPort }
    ? true
    : false
  : false;

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
  healthPort: number;
  metricsRegistry: import('../../src/infrastructure/outbound/monitoring/metrics-registry.js').DaemonMetricsRegistry;
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
    peekPending: vi.fn(() => [] as string[]),
    getQueueModeState: vi.fn(() => true),
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
 * Single-interface harness: `overrides?: {ports?:MockPorts,gmail?}`.
 * Real mode: full mongod + namespaced RMQ + UDS; `ports.assetProducing` alone
 * substitutes the asset render seam (real mode preserved).
 * Mock mode: `ports` carries any of the 6 discriminator keys → production
 * composition root over `vi.fn()` spies, NO infra.
 */
export function buildTestDaemonContainer<
  T extends TestDaemonContainerOverrides | undefined = undefined,
>(
  cfg: BuildTestDaemonContainerOptions,
  overrides?: T
): Promise<IsMockOverride<T> extends true ? MockTestDaemonContainer : TestDaemonContainer>;
export async function buildTestDaemonContainer(
  opts: BuildTestDaemonContainerOptions,
  overrides: TestDaemonContainerOverrides = {}
): Promise<TestDaemonContainer | MockTestDaemonContainer> {
  const providedPorts = overrides.ports ?? {};
  const isMock = (
    [
      'jobLifecycle',
      'extractionQueue',
      'parse',
      'route',
      'browser',
      'ingestor',
    ] as const satisfies readonly MockDiscriminatorKeys[]
  ).some((k) => k in providedPorts);

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

    const healthPort = opts.health?.port ?? 0;
    const container = buildDaemonContainer(
      {
        nodeEnv: 'test',
        mongodb: { uri: 'mongodb://localhost/jw-unit', dbName: 'unit' },
        rabbitmq: { url: RMQ_URL, exchange },
        uds: { socketPath: socket, token },
        health: { port: healthPort },
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
      healthPort: container.healthPort,
      metricsRegistry: container.metricsRegistry,
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
    } as unknown as MockTestDaemonContainer;
  }

  // ---- real mode ----
  claimRealNs(opts.ns);
  const storage = await createTestStorage();
  const dbName = opts.mongodb?.dbName ?? storage.dbName;
  const assetDir =
    opts.asset?.outputDir ??
    fs.mkdtempSync(path.join(os.tmpdir(), `jobs-watcher-${opts.ns}-assets-`));

  const ports = { assetProducing: providedPorts.assetProducing };
  const healthPort = opts.health?.port ?? 0;
  const container = buildDaemonContainer(
    {
      nodeEnv: 'test',
      mongodb: { uri: opts.mongodb?.uri ?? storage.uri, dbName },
      rabbitmq: { url: opts.rmq?.url ?? RMQ_URL, exchange },
      uds: { socketPath: socket, token },
      health: { port: healthPort },
      asset: { outputDir: assetDir },
    },
    {
      ...(ports.assetProducing ? { ports } : {}),
      ...(overrides.gmail ? { gmail: overrides.gmail } : {}),
    }
  );

  async function start({ startScheduler }: { startScheduler?: boolean } = {}): Promise<void> {
    await container.start();
    if (startScheduler ?? opts.startScheduler) {
      // container.start already started scheduler; ensure extra start if needed (idempotent)
      try { await container.extractionScheduler.start(); } catch {}
    }
  }

  async function stop(): Promise<void> {
    try {
      await container.stop();
    } catch {
      /* best-effort */
    }
    try {
      fs.rmSync(assetDir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
    try {
      await storage.stop();
    } catch {
      /* best-effort */
    } finally {
      releaseRealNs(opts.ns);
    }
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
    healthPort: container.healthPort,
    metricsRegistry: container.metricsRegistry,
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
  } as unknown as TestDaemonContainer;
}

/* ------------------------------------------------------------------ *
 * TUI facade                                                         *
 * ------------------------------------------------------------------ */

export interface BuildTestTuiContainerOptions {
  /** Unique namespace: RMQ exchange + UDS socket path (per-file isolation). */
  ns: string;
  rmq?: { url?: string; exchange?: string };
  uds?: { socketPath?: string; token?: string };
  health?: { port?: number };
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
  metricsRegistry: import('../../src/infrastructure/outbound/monitoring/metrics-registry.js').TuiMetricsRegistry;
  healthPort: number;
  ipc: { read(): CurrentJobState; clear(): void };
  start: () => Promise<void>;
  stop: () => Promise<void>;
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
  // Per-ns IPC file: each ns gets its own TUI_SHARED_STATE_PATH so no-file-parallelism suites don't share the global /run/user/<uid>/jobs-watcher-tui-state.json file.
  // All contracts use per-ns, including tui-x-daemon pid-ts ns (no collide via ns uniqueness).
  const perNsStatePath = path.join(os.tmpdir(), `jobs-watcher-${opts.ns}-tui-state.json`);
  const prevStatePath = process.env.TUI_SHARED_STATE_PATH;
  process.env.TUI_SHARED_STATE_PATH = perNsStatePath;

  const readerPort = overrides.ports?.rmqReader;
  const writerPort = overrides.ports?.udsWriter;

  const healthPort = opts.health?.port ?? 0;
  const container = buildTuiContainer(
    {
      rmq: { url: opts.rmq?.url ?? RMQ_URL, exchange },
      uds: { socketPath: socket, token },
      ns: opts.ns,
      health: { port: healthPort },
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
    metricsRegistry: container.metricsRegistry,
    healthPort: container.healthPort,
    ipc: {
      read: () => getCurrentJob(),
      clear: () => clearCurrentJob(),
    },
    start: () => container.start(),
    stop: async () => {
      await container.stop();
      if (!isMock) releaseRealNs(`tui:${opts.ns}`);
      // Restore env and best-effort clean per-ns state file so next suite in same process doesn't read stale state.
      if (perNsStatePath) {
        if (prevStatePath === undefined) delete process.env.TUI_SHARED_STATE_PATH;
        else process.env.TUI_SHARED_STATE_PATH = prevStatePath;
        try {
          fs.rmSync(perNsStatePath, { force: true });
          fs.rmSync(`${perNsStatePath}.lock`, { force: true });
          fs.rmSync(`${perNsStatePath}.tmp`, { force: true });
        } catch {}
      }
    },
  };
}
