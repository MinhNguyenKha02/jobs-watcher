import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ExtractionScheduler } from '../../../../src/application/extraction-scheduler.js';
import { JobSource, JobStage } from '../../../../src/domain/types/job-lifecycle.js';

function createMockQueue() {
  return {
    dequeue: vi.fn(),
    enqueue: vi.fn(),
    size: vi.fn().mockResolvedValue(0),
    onEnqueue: vi.fn(),
  };
}

function createMockBrowser() {
  return {
    start: vi.fn(),
    stop: vi.fn(),
    extract: vi.fn(),
  };
}

function createMockJobLifecyclePort() {
  return {
    findById: vi.fn(),
    upsert: vi.fn(),
    updateStage: vi.fn(),
  };
}

function createMockIngestor() {
  return {
    processIngest: vi.fn(),
    processResolution: vi.fn(),
  };
}

function makeJobDoc(n: number) {
  return { _id: `exhaust-${n}`, jobLifecycleId: `exhaust-${n}`, url: `https://example.com/job-${n}`, createdAt: new Date() };
}

describe('PRC-003 — ExtractionScheduler exhaustion, fairness, backpressure', () => {
  let queue: ReturnType<typeof createMockQueue>;
  let browser: ReturnType<typeof createMockBrowser>;
  let jobLifecyclePort: ReturnType<typeof createMockJobLifecyclePort>;
  let ingestor: ReturnType<typeof createMockIngestor>;
  let scheduler: ExtractionScheduler;

  beforeEach(() => {
    queue = createMockQueue();
    browser = createMockBrowser();
    jobLifecyclePort = createMockJobLifecyclePort();
    ingestor = createMockIngestor();
    scheduler = new ExtractionScheduler(queue as any, browser as any, jobLifecyclePort as any, ingestor as any);
  });

  afterEach(async () => {
    await scheduler.stop();
  });

  it('exhausts the queue to empty with 3 concurrent workers', async () => {
    const N = 9;
    browser.extract.mockResolvedValue({ html: '<div>ok</div>' });
    jobLifecyclePort.findById.mockImplementation(async (id: string) => ({ _id: id, url: 'https://example.com/job', createdAt: new Date() }));
    let dequeued = 0;
    queue.dequeue.mockImplementation(() => {
      if (dequeued < N) return Promise.resolve(makeJobDoc(dequeued++));
      return Promise.resolve(null);
    });

    await scheduler.start();
    await vi.waitFor(() => {
      expect(ingestor.processIngest).toHaveBeenCalledTimes(N);
      expect(dequeued).toBe(N);
    }, { interval: 50, timeout: 8000 });

    await scheduler.stop();
    expect(queue.dequeue).toHaveBeenCalled();
    const extra = dequeued - N;
    expect(extra).toBeLessThanOrEqual(0);
  }, 15000);

  it('drains all remaining items after mid-stream extraction errors', async () => {
    const N = 6;
    browser.extract
      .mockRejectedValueOnce(new Error('crash-1'))
      .mockRejectedValueOnce(new Error('crash-2'))
      .mockResolvedValue({ html: '<div>ok</div>' });
    jobLifecyclePort.findById.mockImplementation(async (id: string) => ({ _id: id, url: 'https://example.com/job', createdAt: new Date() }));
    let dequeued = 0;
    queue.dequeue.mockImplementation(() => {
      if (dequeued < N) return Promise.resolve(makeJobDoc(dequeued++));
      return Promise.resolve(null);
    });

    await scheduler.start();
    await vi.waitFor(() => {
      expect(ingestor.processIngest).toHaveBeenCalledTimes(N);
    }, { interval: 50, timeout: 8000 });
  }, 15000);

  it('wakes an idle waiter when enqueue fires (backpressure re-arm)', async () => {
    browser.extract.mockResolvedValue({ html: '<div>ok</div>' });
    jobLifecyclePort.findById.mockImplementation(async (id: string) => ({ _id: id, url: 'https://example.com/job', createdAt: new Date() }));

    let offered = 0;
    queue.dequeue.mockImplementation(() => {
      if (offered < 2) return Promise.resolve(makeJobDoc(offered++));
      return Promise.resolve(null);
    });
    queue.size.mockResolvedValue(0);

    await scheduler.start();

    const onEnqueueCb = queue.onEnqueue.mock.calls[0]?.[0] as (() => void) | undefined;
    expect(onEnqueueCb).toBeTypeOf('function');

    queue.dequeue.mockImplementation(() => {
      if (offered < 3) return Promise.resolve(makeJobDoc(offered++));
      return Promise.resolve(null);
    });

    onEnqueueCb?.();
    await vi.waitFor(() => {
      expect(ingestor.processIngest).toHaveBeenCalledTimes(3);
    }, { interval: 50, timeout: 8000 });
  }, 15000);

  it('per-worker fairness: every dequeued job is ingested exactly once (no double-process)', async () => {
    const N = 5;
    browser.extract.mockResolvedValue({ html: '<div>ok</div>' });
    jobLifecyclePort.findById.mockImplementation(async (id: string) => ({ _id: id, url: 'https://example.com/job', createdAt: new Date() }));
    let dequeued = 0;
    queue.dequeue.mockImplementation(() => {
      if (dequeued < N) return Promise.resolve(makeJobDoc(dequeued++));
      return Promise.resolve(null);
    });

    await scheduler.start();
    await vi.waitFor(() => {
      expect(ingestor.processIngest).toHaveBeenCalledTimes(N);
    }, { interval: 50, timeout: 8000 });

    const ids = ingestor.processIngest.mock.calls.map((c) => c[3]);
    expect(ids.length).toBe(N);
    expect(new Set(ids).size).toBe(N);
  }, 15000);

  it('extraction failure falls back to PARTIAL_PARSED empty payload via processIngest (s1 TUI-visible)', async () => {
    browser.extract.mockRejectedValue(new Error('goto timeout'));
    jobLifecyclePort.findById.mockResolvedValue({ _id: 'fallback-1', url: 'https://example.com/job', createdAt: new Date() });
    let offered = 0;
    queue.dequeue.mockImplementation(() => {
      if (offered < 1) return Promise.resolve(makeJobDoc(offered++));
      return Promise.resolve(null);
    });

    await scheduler.start();
    await vi.waitFor(() => {
      expect(ingestor.processIngest).toHaveBeenCalledWith(
        JobSource.BROWSER_AUTO,
        JobStage.PARTIAL_PARSED,
        '',
        'exhaust-0',
      );
    }, { interval: 50, timeout: 8000 });
  }, 15000);

  it('successful extraction passes FULL_PARSED html payload to ingestor', async () => {
    browser.extract.mockResolvedValue({ html: '<div class="job-detail__info--title"><h1>Software Engineer</h1></div>' });
    jobLifecyclePort.findById.mockResolvedValue({ _id: 'success-1', url: 'https://example.com/job', createdAt: new Date() });
    let offered = 0;
    queue.dequeue.mockImplementation(() => {
      if (offered < 1) return Promise.resolve(makeJobDoc(offered++));
      return Promise.resolve(null);
    });

    await scheduler.start();
    await vi.waitFor(() => {
      expect(ingestor.processIngest).toHaveBeenCalledWith(
        JobSource.BROWSER_AUTO,
        JobStage.FULL_PARSED,
        expect.stringContaining('job-detail'),
        'exhaust-0',
      );
    }, { interval: 50, timeout: 8000 });
  }, 15000);
});
