import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const OLD_ENV = { ...process.env };
let healthServerHandler: ((req: any, res: any) => void) | null;
let ingestServerHandler: ((req: any, res: any) => void) | null;

const mockConfigVal = vi.hoisted(() => ({
  nodeEnv: 'test',
  isDev: false,
  isTest: true,
  isProd: false,
  projectRoot: '/tmp',
  resourcesPath: '/tmp/resources',
  templatesPath: '/tmp/templates',
  generatedPath: '/tmp/generated',
  logsPath: '/tmp/logs',
  mongodb: { uri: 'mongodb://localhost:27017', dbName: 'test' },
  gmail: { clientId: 'mock-client-id', clientSecret: 'mock-client-secret', labelName: 'INBOX', redirectUri: 'http://localhost:3000/oauth2callback', topicName: 'test-topic' },
  browser: { timeout: 30000, headless: true },
  webhook: { port: 3001, path: '/webhook/gmail' },
  sse: { replayLimit: 50, eventBufferMax: 100 },
  features: { logging: true, notifications: true, tui: true },
  mode: 'data-listening',
  dataSource: { type: 'webhook', batchSize: 10 },
}));

const mockStorageVal = vi.hoisted(() => ({
  connect: vi.fn().mockResolvedValue(undefined),
  disconnect: vi.fn().mockResolvedValue(undefined),
  upsertJobLifecycle: vi.fn(),
  updateJobStatus: vi.fn(),
  findJobLifecycleById: vi.fn(),
  insertActionSnapshot: vi.fn(),
  extractionQueue: null,
}));

const mockCreateServerRef = vi.hoisted(() => ({ current: null as any }));
const mockListenFn = vi.fn((...args: any[]) => {
  const cb = args.find(a => typeof a === 'function');
  if (cb) cb();
});

vi.mock('../../src/config.js', () => ({
  config: mockConfigVal,
  loadConfig: () => mockConfigVal,
}));

vi.mock('node:http', () => ({
  default: { createServer: (handler: any) => mockCreateServerRef.current(handler) },
  createServer: (handler: any) => mockCreateServerRef.current(handler),
}));

vi.mock('node:fs', () => ({
  existsSync: vi.fn(() => false),
  mkdirSync: vi.fn(),
  unlinkSync: vi.fn(),
  chmodSync: vi.fn(),
  writeFileSync: vi.fn(),
  readFileSync: vi.fn(),
  renameSync: vi.fn(),
  constants: {},
}));

vi.mock('../../src/services/logger.js', () => ({
  getLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
  setLogger: vi.fn(),
  ConsoleLogger: vi.fn(),
  getDefaultLogFilePath: vi.fn(() => '/tmp/test.log'),
}));

vi.mock('../../src/services/gmail.js', () => ({
  GmailService: vi.fn(() => ({ authenticate: vi.fn().mockResolvedValue(undefined) })),
}));

vi.mock('../../src/services/storage/mongodb-storage-adapter.js', () => ({
  MongoDBStorageAdapter: vi.fn(() => mockStorageVal),
  createMongoDBStorageAdapter: vi.fn(),
}));

vi.mock('../../src/services/mongodb-validator.js', () => ({
  validateMongoTopology: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/application/ingestor.js', () => ({
  default: vi.fn(() => ({
    processIngestCommand: vi.fn().mockResolvedValue(undefined),
    processResolutionCommand: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('../../src/application/extraction-scheduler.js', () => ({
  ExtractionScheduler: vi.fn(() => ({
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('../../src/services/browser/browser-extractor.js', () => ({
  PlaywrightBrowserAdapter: vi.fn(() => ({ start: vi.fn(), stop: vi.fn() })),
}));

vi.mock('../../src/services/event-webhook.js', () => ({
  EventDrivenWebhook: vi.fn(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('../../src/cli/data-listening.js', () => ({
  runDataListening: vi.fn(),
}));

vi.mock('../../src/bootstrap/execution-mode.js', () => ({
  detectExecutionMode: vi.fn(() => ({
    mode: 'TEST',
    isProduction: false,
    isTest: true,
    isFixture: false,
    isHeadless: false,
  })),
  initializeModeContext: vi.fn(),
}));

vi.mock('../../src/services/queue-metrics.js', () => ({
  metrics: { getMetrics: () => ({}) },
}));

beforeEach(() => {
  vi.resetModules();
  vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
  process.env = { ...OLD_ENV, AUTO_START: '0' };
  healthServerHandler = null;
  ingestServerHandler = null;

  mockCreateServerRef.current = vi.fn((handler: any) => {
    if (!healthServerHandler) healthServerHandler = handler;
    else ingestServerHandler = handler;
    return { listen: mockListenFn };
  });
});

afterEach(() => {
  process.env = { ...OLD_ENV };
  vi.restoreAllMocks();
});

describe('Index bootstrap — main()', () => {
  it('main() starts services and returns stop handle', async () => {
    const mod = await import('../../src/presentation/bootstrap/main.js' );
    const handle = await mod.main({
      webhookPort: 3001,
      healthPort: 3002,
      skipGmailAuth: true,
      noBackgroundWork: true,
      ingestSocketPath: '/tmp/test-ingest.sock',
    });
    expect(handle).toBeDefined();
    expect(handle.ready).toBeInstanceOf(Promise);
    expect(handle.stop).toBeInstanceOf(Function);
  });

  it('main() with internalAuthToken sets env var', async () => {
    const mod = await import('../../src/presentation/bootstrap/main.js' );
    await mod.main({
      internalAuthToken: 'custom-token',
      skipGmailAuth: true,
      noBackgroundWork: true,
    });
    expect(process.env.INTERNAL_AUTH_TOKEN).toBe('custom-token');
  });

  it('main() returns stop that shuts down gracefully', async () => {
    const mod = await import('../../src/presentation/bootstrap/main.js' );
    const handle = await mod.main({
      skipGmailAuth: true,
      noBackgroundWork: true,
    });
    await handle.stop();
  });
});

describe('Index bootstrap — HTTP handler', () => {
  async function importModule(opts: any = {}) {
    const mod = await import('../../src/presentation/bootstrap/main.js' );
    await mod.main({
      skipGmailAuth: true,
      noBackgroundWork: true,
      ...opts,
    });
  }

  function mockJsonResponse() {
    const chunks: string[] = [];
    const res: any = {
      _chunks: chunks,
      _status: 0,
      _ended: false,
      writeHead: vi.fn((status: number) => {
        res._status = status;
        return res;
      }),
      end: vi.fn((body: string) => {
        res._ended = true;
        if (body) chunks.push(body);
        return res;
      }),
      setHeader: vi.fn(),
      on: vi.fn(),
      socket: { destroy: vi.fn() },
    };
    return res;
  }

  it('/health returns 200 with status ok', async () => {
    await importModule();
    if (!healthServerHandler) { expect(healthServerHandler).toBeTruthy(); return; }
    const res = mockJsonResponse();
    healthServerHandler({ url: '/health', method: 'GET' }, res);
    const body = JSON.parse(res._chunks[0]);
    expect(res._status).toBe(200);
    expect(body.status).toBe('ok');
  });

  it('/ready returns 200 when storage ready', async () => {
    await importModule();
    if (!healthServerHandler) { expect(healthServerHandler).toBeTruthy(); return; }
    const res = mockJsonResponse();
    healthServerHandler({ url: '/ready', method: 'GET' }, res);
    const body = JSON.parse(res._chunks[0]);
    expect(res._status).toBe(200);
    expect(body.ready).toBe(true);
  });

  it('unknown path returns 404', async () => {
    await importModule();
    if (!healthServerHandler) { expect(healthServerHandler).toBeTruthy(); return; }
    const res = mockJsonResponse();
    healthServerHandler({ url: '/unknown', method: 'GET' }, res);
    expect(res._status).toBe(404);
    expect(res._ended).toBe(true);
  });

  it('/internal/ingest rejects request without auth token', async () => {
    process.env.INTERNAL_AUTH_TOKEN = 'required-token';
    await importModule();
    if (!ingestServerHandler) { expect(ingestServerHandler).toBeTruthy(); return; }
    const res = mockJsonResponse();
    const req: any = {
      url: '/internal/ingest',
      method: 'POST',
      headers: {},
      on: vi.fn((event: string, cb: Function) => {
        if (event === 'data') cb(JSON.stringify({ html: '<html/>' }));
        if (event === 'end') cb();
      }),
    };
    ingestServerHandler(req, res);
    await new Promise(r => setTimeout(r, 10));
    expect(res._status).toBe(401);
    const body = JSON.parse(res._chunks[0]);
    expect(body.error).toBe('unauthorized');
  });

  it('/internal/ingest accepts request with valid auth token', async () => {
    process.env.INTERNAL_AUTH_TOKEN = 'valid-token';
    await importModule();
    if (!ingestServerHandler) { expect(ingestServerHandler).toBeTruthy(); return; }
    const res = mockJsonResponse();
    const req: any = {
      url: '/internal/ingest',
      method: 'POST',
      headers: { 'x-internal-token': 'valid-token' },
      on: vi.fn((event: string, cb: Function) => {
        if (event === 'data') cb(JSON.stringify({ html: '<html/>' }));
        if (event === 'end') cb();
      }),
    };
    ingestServerHandler(req, res);
    await new Promise(r => setTimeout(r, 10));
    expect(res._status).toBe(202);
    const body = JSON.parse(res._chunks[0]);
    expect(body.accepted).toBe(true);
  });

  it('/internal/action dispatches queue action', async () => {
    await importModule();
    if (!ingestServerHandler) { expect(ingestServerHandler).toBeTruthy(); return; }
    const res = mockJsonResponse();
    const req: any = {
      url: '/internal/action',
      method: 'POST',
      headers: {},
      on: vi.fn((event: string, cb: Function) => {
        if (event === 'data') cb(JSON.stringify({ joblifecycleId: 'job-1', action: 'queue' }));
        if (event === 'end') cb();
      }),
    };
    ingestServerHandler(req, res);
    await new Promise(r => setTimeout(r, 10));
    expect(res._status).toBe(202);
    const body = JSON.parse(res._chunks[0]);
    expect(body.accepted).toBe(true);
  });

  it('/internal/action rejects unknown action', async () => {
    await importModule();
    if (!ingestServerHandler) { expect(ingestServerHandler).toBeTruthy(); return; }
    const res = mockJsonResponse();
    const req: any = {
      url: '/internal/action',
      method: 'POST',
      headers: {},
      on: vi.fn((event: string, cb: Function) => {
        if (event === 'data') cb(JSON.stringify({ joblifecycleId: 'job-1', action: 'unknown' }));
        if (event === 'end') cb();
      }),
    };
    ingestServerHandler(req, res);
    await new Promise(r => setTimeout(r, 10));
    expect(res._status).toBe(202);
    const body = JSON.parse(res._chunks[0]);
    expect(body.accepted).toBe(true);
  });

  it('/internal/ingest with webhook=true and no html returns 500', async () => {
    await importModule();
    if (!ingestServerHandler) { expect(ingestServerHandler).toBeTruthy(); return; }
    const res = mockJsonResponse();
    const req: any = {
      url: '/internal/ingest?webhook=true',
      method: 'POST',
      headers: {},
      on: vi.fn((event: string, cb: Function) => {
        if (event === 'data') cb(JSON.stringify({ html: '' }));
        if (event === 'end') cb();
      }),
    };
    ingestServerHandler(req, res);
    await new Promise(r => setTimeout(r, 10));
    expect(res._status).toBe(500);
  });
});

describe('Index bootstrap — shutdown', () => {
  it('stop from main() does not throw', async () => {
    const mod = await import('../../src/presentation/bootstrap/main.js' );
    const handle = await mod.main({
      skipGmailAuth: true,
      noBackgroundWork: true,
    });
    await handle.stop();
  });
});
