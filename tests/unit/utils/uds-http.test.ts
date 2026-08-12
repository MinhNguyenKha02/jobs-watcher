import http from 'node:http';

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

let mockReq: any;
let mockResponses: Array<{ statusCode: number; body: string }>;

const { postJsonOverUds } = await import('../../../src/infrastructure/utils/uds-http.js');

function spyHttpRequest() {
  vi.spyOn(http, 'request').mockImplementation((_opts: any, cb: any) => {
    const res = mockResponses.shift()!;
    setTimeout(() => {
      cb({
        statusCode: res.statusCode,
        on: (event: string, handler: any) => {
          if (event === 'data') handler(Buffer.from(res.body));
          if (event === 'end') handler();
        },
      });
    }, 10);
    return mockReq as any;
  });
}

describe('uds-http', () => {
  const SOCKET_PATH = '/tmp/test-uds.sock';

  beforeEach(() => {
    vi.useFakeTimers();
    mockReq = {
      on: vi.fn(),
      write: vi.fn(),
      end: vi.fn(),
      setTimeout: vi.fn(),
      destroy: vi.fn(),
    };
    mockResponses = [];
    spyHttpRequest();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('GIVEN uds WHEN mockResponses.push THEN sends POST request to correct socket path and endpoint', async () => {
    mockResponses.push({ statusCode: 200, body: '{}' });
    const promise = postJsonOverUds(
      { socketPath: SOCKET_PATH, path: '/internal/ingest' },
      { html: '<div>job</div>' }
    );
    await vi.advanceTimersByTimeAsync(20);

    const opts = (http.request as any).mock.calls[0][0];
    expect(opts.socketPath).toBe(SOCKET_PATH);
    expect(opts.path).toBe('/internal/ingest');
    expect(opts.method).toBe('POST');
    await promise;
  });

  it('GIVEN uds WHEN mockResponses.push THEN sets Content-Type and Content-Length headers', async () => {
    mockResponses.push({ statusCode: 200, body: '{}' });
    const promise = postJsonOverUds({ socketPath: SOCKET_PATH, path: '/test' }, { key: 'value' });
    await vi.advanceTimersByTimeAsync(20);

    const opts = (http.request as any).mock.calls[0][0];
    expect(opts.headers['Content-Type']).toBe('application/json');
    expect(Number(opts.headers['Content-Length'])).toBeGreaterThan(0);
    await promise;
  });

  it('GIVEN uds WHEN mockResponses.push THEN merges custom headers', async () => {
    mockResponses.push({ statusCode: 200, body: '{}' });
    const promise = postJsonOverUds(
      { socketPath: SOCKET_PATH, path: '/test', headers: { 'x-custom': 'val' } },
      {}
    );
    await vi.advanceTimersByTimeAsync(20);

    const opts = (http.request as any).mock.calls[0][0];
    expect(opts.headers['x-custom']).toBe('val');
    await promise;
  });

  it('GIVEN uds WHEN mockResponses.push THEN serializes object body to JSON', async () => {
    mockResponses.push({ statusCode: 200, body: '{}' });
    const promise = postJsonOverUds({ socketPath: SOCKET_PATH, path: '/test' }, { hello: 'world' });
    await vi.advanceTimersByTimeAsync(20);

    expect(mockReq.write).toHaveBeenCalledWith('{"hello":"world"}');
    await promise;
  });

  it('GIVEN uds WHEN mockResponses.push THEN writes string body directly', async () => {
    mockResponses.push({ statusCode: 200, body: '{}' });
    const promise = postJsonOverUds({ socketPath: SOCKET_PATH, path: '/test' }, 'raw string');
    await vi.advanceTimersByTimeAsync(20);

    expect(mockReq.write).toHaveBeenCalledWith('raw string');
    await promise;
  });

  it('GIVEN uds WHEN mockResponses.push THEN returns statusCode and body on success', async () => {
    mockResponses.push({ statusCode: 200, body: '{"ok":true}' });
    const promise = postJsonOverUds({ socketPath: SOCKET_PATH, path: '/test' }, {});
    await vi.advanceTimersByTimeAsync(20);

    const result = await promise;
    expect(result.statusCode).toBe(200);
    expect(result.body).toBe('{"ok":true}');
  });

  it('GIVEN uds WHEN vi.restoreAllMocks THEN rejects on request error', async () => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    let errorHandler: ((...args: any[]) => void) | undefined;
    vi.spyOn(http, 'request').mockImplementation((_opts: any, _cb: any) => {
      process.nextTick(() => {
        const calls = mockReq.on.mock.calls as Array<[string, (...args: any[]) => void]>;
        const found = calls.find(([ev]) => ev === 'error');
        if (found) errorHandler = found[1];
        if (errorHandler) errorHandler(new Error('connection refused'));
      });
      return mockReq as any;
    });

    const promise = postJsonOverUds({ socketPath: SOCKET_PATH, path: '/test' }, {});
    await expect(promise).rejects.toThrow('connection refused');
  });

  it('GIVEN uds WHEN mockResponses.push THEN handles timeout option', async () => {
    mockResponses.push({ statusCode: 200, body: '{}' });
    const promise = postJsonOverUds(
      { socketPath: SOCKET_PATH, path: '/test', timeoutMs: 5000 },
      {}
    );
    await vi.advanceTimersByTimeAsync(20);

    expect(mockReq.setTimeout).toHaveBeenCalledWith(5000, expect.any(Function));
    await promise;
  });
});
