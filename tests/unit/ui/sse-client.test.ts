import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

let esInstance: any;

vi.mock('eventsource', () => {
  function MockEventSource(this: any, url: string) {
    esInstance = this;
    this.url = url;
    this.readyState = 0;
    this.close = vi.fn();
    this.addEventListener = vi.fn();
    this.onopen = null;
    this.onmessage = null;
    this.onerror = null;
  }
  MockEventSource.CONNECTING = 0;
  MockEventSource.OPEN = 1;
  MockEventSource.CLOSED = 2;
  return { default: MockEventSource };
});

const { default: startSseClient } = await import('../../../src/presentation/tui/sse-client.js' );

describe('sse-client', () => {
  const BASE_URL = 'http://localhost:3000/events';
  const TOKEN = 'test-token';

  let callbacks: any;
  let handle: { close: () => void };

  beforeEach(() => {
    vi.useFakeTimers();
    callbacks = {
      onOpen: vi.fn(),
      onMessage: vi.fn(),
      onError: vi.fn(),
      onClose: vi.fn(),
    };
    handle = startSseClient(BASE_URL, TOKEN, callbacks);
  });

  afterEach(() => {
    try { handle.close(); } catch {}
    vi.useRealTimers();
  });

  it('connects with token in URL query param', () => {
    expect(esInstance.url).toBe(`${BASE_URL}?token=${encodeURIComponent(TOKEN)}`);
  });

  it('connects without token', () => {
    vi.clearAllMocks();
    const noTokenHandle = startSseClient(BASE_URL, undefined, callbacks);
    expect(esInstance.url).toBe(BASE_URL);
    noTokenHandle.close();
  });

  it('calls onOpen when connection opens', () => {
    esInstance.readyState = 1;
    esInstance.onopen();
    expect(callbacks.onOpen).toHaveBeenCalled();
  });

  it('parses SSE event data and calls onMessage', () => {
    const eventCallback = esInstance.addEventListener.mock.calls.find(
      (c: any[]) => c[0] === 'job.generated'
    );

    eventCallback[1]({
      data: JSON.stringify({ joblifecycleId: 'job-1', company: 'Acme' }),
    });

    expect(callbacks.onMessage).toHaveBeenCalledWith({
      type: 'job.generated',
      payload: { joblifecycleId: 'job-1', company: 'Acme' },
    });
  });

  it('falls back to raw string when event data is not valid JSON', () => {
    const eventCallback = esInstance.addEventListener.mock.calls.find(
      (c: any[]) => c[0] === 'job.generated'
    );

    eventCallback[1]({ data: 'not-json' });

    expect(callbacks.onMessage).toHaveBeenCalledWith({
      type: 'job.generated',
      payload: 'not-json',
    });
  });

  it('calls onError after 3s connection timeout', () => {
    esInstance.readyState = 0;

    esInstance.onerror({ message: 'timeout' });
    expect(callbacks.onError).not.toHaveBeenCalled();

    vi.advanceTimersByTime(3000);

    expect(callbacks.onError).toHaveBeenCalled();
  });

  it('calls onError immediately for non-connecting errors', () => {
    esInstance.readyState = 2;

    esInstance.onerror({ message: 'closed' });

    expect(callbacks.onError).toHaveBeenCalled();
  });

  it('close clears timeout and closes EventSource', () => {
    handle.close();
    expect(esInstance.close).toHaveBeenCalled();
  });

  it('registers event listeners for all 6 SSE event types', () => {
    const registeredTypes = esInstance.addEventListener.mock.calls.map((c: any[]) => c[0]);
    expect(registeredTypes).toContain('job.generated');
    expect(registeredTypes).toContain('job.parse.completed');
    expect(registeredTypes).toContain('job.parse.failed');
    expect(registeredTypes).toContain('job.route.queued');
    expect(registeredTypes).toContain('job.route.trashed');
    expect(registeredTypes).toContain('job.route.failed');
  });
});
