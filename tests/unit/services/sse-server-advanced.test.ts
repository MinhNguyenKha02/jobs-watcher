import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockEventBus = vi.hoisted(() => ({
  on: vi.fn(),
  removeListener: vi.fn(),
  emit: vi.fn(),
}));

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

const mockMongoClient = vi.hoisted(() => ({
  connect: vi.fn().mockResolvedValue(undefined),
  close: vi.fn().mockResolvedValue(undefined),
  db: vi.fn(() => ({
    collection: vi.fn(() => ({
      find: vi.fn(() => ({
        sort: vi.fn(() => ({
          limit: vi.fn(() => ({
            toArray: vi.fn().mockResolvedValue([]),
          })),
        })),
      })),
      watch: vi.fn(() => ({
        on: vi.fn(),
        close: vi.fn(),
      })),
    })),
  })),
}));

vi.mock('../../../src/services/event-bus.js', () => ({
  eventBus: mockEventBus,
}));

vi.mock('../../../src/services/logger.js', () => ({
  getLogger: () => mockLogger,
}));

vi.mock('mongodb', () => ({
  MongoClient: vi.fn(() => mockMongoClient),
}));

vi.mock('../../../src/config.js', () => ({
  config: {
    mongodb: { uri: 'mongodb://localhost:27017', dbName: 'test' },
    sse: { eventBufferMax: 100, replayLimit: 50 },
    gmail: { clientId: 'test', clientSecret: 'test', labelName: 'INBOX' },
    browser: { headless: true, timeout: 30000 },
    webhook: { port: 3001 },
    features: { logging: true },
  },
}));

vi.mock('lru-cache', () => {
  const LRUCache = vi.fn(() => ({
    set: vi.fn(),
    get: vi.fn(),
    has: vi.fn(),
    entries: vi.fn(() => []),
    size: 0,
  }));
  return { default: LRUCache };
});

vi.mock('../../../src/services/queue-metrics.js', () => ({
  metrics: { getMetrics: () => ({ enqueued: 0, dequeued: 0 }) },
}));

describe('SSE server advanced — attachSse', () => {
  let mockApp: any;
  let mockReq: any;
  let mockRes: any;
  let attachSse: any;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();

    mockReq = {
      url: '/events',
      query: {},
      header: vi.fn(),
      on: vi.fn(),
    };

    mockRes = {
      setHeader: vi.fn(),
      writeHead: vi.fn(),
      status: vi.fn(() => mockRes),
      contentType: vi.fn(() => mockRes),
      send: vi.fn(),
      write: vi.fn(),
      end: vi.fn(),
      flushHeaders: vi.fn(),
      on: vi.fn(),
    };

    mockApp = {
      get: vi.fn(),
    };

    const mod = await import('../../../src/infrastructure/outbound/sse-server.js' );
    attachSse = mod.attachSse;
  });

  it('registers GET /events route on app', () => {
    attachSse(mockApp);
    expect(mockApp.get).toHaveBeenCalledWith('/events', expect.any(Function));
  });

  it('sends 401 when auth token mismatches', async () => {
    process.env.INTERNAL_AUTH_TOKEN = 'secret-token';
    mockReq.query = { token: 'wrong-token' };
    mockRes.status.mockReturnValue(mockRes);
    mockRes.contentType.mockReturnValue(mockRes);

    attachSse(mockApp);
    const routeHandler = mockApp.get.mock.calls[0][1];
    await routeHandler(mockReq, mockRes);

    expect(mockRes.status).toHaveBeenCalledWith(401);
    expect(mockRes.send).toHaveBeenCalledWith('Unauthorized');
    delete process.env.INTERNAL_AUTH_TOKEN;
  });

  it('sets SSE headers on authorized connection', async () => {
    delete process.env.INTERNAL_AUTH_TOKEN;
    mockRes.flushHeaders = vi.fn();

    attachSse(mockApp);
    const routeHandler = mockApp.get.mock.calls[0][1];
    await routeHandler(mockReq, mockRes);

    expect(mockRes.setHeader).toHaveBeenCalledWith('Content-Type', 'text/event-stream; charset=utf-8');
    expect(mockRes.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-cache, no-transform');
    expect(mockRes.setHeader).toHaveBeenCalledWith('Connection', 'keep-alive');
  });

  it('sends ready event on connect', async () => {
    attachSse(mockApp);
    const routeHandler = mockApp.get.mock.calls[0][1];
    await routeHandler(mockReq, mockRes);

    expect(mockRes.write).toHaveBeenCalledWith(
      expect.stringContaining('event: ready'),
    );
    expect(mockRes.write).toHaveBeenCalledWith(
      expect.stringContaining('"ok":true'),
    );
  });

  it('sends queue.metrics on connect', async () => {
    attachSse(mockApp);
    const routeHandler = mockApp.get.mock.calls[0][1];
    await routeHandler(mockReq, mockRes);

    expect(mockRes.write).toHaveBeenCalledWith(
      expect.stringContaining('event: queue.metrics'),
    );
  });

  it('registers eventBus listeners for all signal events', async () => {
    attachSse(mockApp);
    const routeHandler = mockApp.get.mock.calls[0][1];
    await routeHandler(mockReq, mockRes);

    const expectedEvents = [
      'job.generated',
      'job.processed',
      'job.parse.completed',
      'job.parse.failed',
      'job.route.queued',
      'job.route.trashed',
      'job.route.failed',
    ];
    for (const evt of expectedEvents) {
      expect(mockEventBus.on).toHaveBeenCalledWith(evt, expect.any(Function));
    }
  });

  it('sends heartbeat every 15s', async () => {
    vi.useFakeTimers();
    attachSse(mockApp);
    const routeHandler = mockApp.get.mock.calls[0][1];
    await routeHandler(mockReq, mockRes);

    mockRes.write.mockClear();
    vi.advanceTimersByTime(15000);

    expect(mockRes.write).toHaveBeenCalledWith(': heartbeat\n\n');
    vi.useRealTimers();
  });

  it('registers cleanup on req close', async () => {
    let closeHandler: Function = () => {};
    mockReq.on = vi.fn((event: string, handler: any) => {
      if (event === 'close') closeHandler = handler;
    });

    attachSse(mockApp);
    const routeHandler = mockApp.get.mock.calls[0][1];
    await routeHandler(mockReq, mockRes);

    expect(mockReq.on).toHaveBeenCalledWith('close', expect.any(Function));

    closeHandler();
    const expectedEvents = [
      'job.generated',
      'job.processed',
      'job.parse.completed',
      'job.parse.failed',
      'job.route.queued',
      'job.route.trashed',
      'job.route.failed',
    ];
    for (const evt of expectedEvents) {
      expect(mockEventBus.removeListener).toHaveBeenCalledWith(evt, expect.any(Function));
    }
  });

  it('replays buffered events on connect', async () => {
    attachSse(mockApp);
    const routeHandler = mockApp.get.mock.calls[0][1];
    await routeHandler(mockReq, mockRes);

    expect(mockRes.write).toHaveBeenCalledWith(expect.stringContaining('event: ready'));
  });

  it('handles client disconnect during replay gracefully', async () => {
    mockRes.write = vi.fn(() => { throw new Error('Client disconnected'); });
    mockRes.end = vi.fn();
    mockReq.on = vi.fn((event: string, cb: Function) => {
      if (event === 'close') cb();
    });

    attachSse(mockApp);
    const routeHandler = mockApp.get.mock.calls[0][1];
    await routeHandler(mockReq, mockRes);

    expect(mockRes.end).toHaveBeenCalled();
  });

  describe('auth via Authorization header', () => {
    it('accepts Bearer token via Authorization header', async () => {
      process.env.INTERNAL_AUTH_TOKEN = 'bearer-token';
      mockReq.header = vi.fn((name: string) => {
        if (name === 'authorization') return 'Bearer bearer-token';
        return undefined;
      });

      attachSse(mockApp);
      const routeHandler = mockApp.get.mock.calls[0][1];
      await routeHandler(mockReq, mockRes);

      expect(mockRes.setHeader).toHaveBeenCalled();
      delete process.env.INTERNAL_AUTH_TOKEN;
    });

    it('rejects wrong Bearer token via Authorization header', async () => {
      process.env.INTERNAL_AUTH_TOKEN = 'real-token';
      mockReq.header = vi.fn((name: string) => {
        if (name === 'authorization') return 'Bearer wrong-token';
        return undefined;
      });
      mockRes.status.mockReturnValue(mockRes);
      mockRes.contentType.mockReturnValue(mockRes);

      attachSse(mockApp);
      const routeHandler = mockApp.get.mock.calls[0][1];
      await routeHandler(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      delete process.env.INTERNAL_AUTH_TOKEN;
    });
  });

  describe('auth via opts.internalAuthToken', () => {
    it('uses opts.internalAuthToken when env var not set', async () => {
      delete process.env.INTERNAL_AUTH_TOKEN;
      mockReq.query = { token: 'opts-token' };

      attachSse(mockApp, { internalAuthToken: 'opts-token' });
      const routeHandler = mockApp.get.mock.calls[0][1];
      await routeHandler(mockReq, mockRes);

      expect(mockRes.setHeader).toHaveBeenCalled();
    });

    it('rejects when opts.internalAuthToken does not match', async () => {
      delete process.env.INTERNAL_AUTH_TOKEN;
      mockReq.query = { token: 'wrong' };
      mockRes.status.mockReturnValue(mockRes);
      mockRes.contentType.mockReturnValue(mockRes);

      attachSse(mockApp, { internalAuthToken: 'expected-token' });
      const routeHandler = mockApp.get.mock.calls[0][1];
      await routeHandler(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(401);
    });
  });
});
