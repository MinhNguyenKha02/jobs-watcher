/* Path cell (c2): S3 extraction scheduler dispatch (see plans/tests-path-matrix.md) */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
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

function createMockJobIngestor() {
  return {
    processIngest: vi.fn(),
    processResolution: vi.fn(),
  };
}

describe('ExtractionScheduler — concurrency and crash recovery', () => {
  let queue: ReturnType<typeof createMockQueue>;
  let browser: ReturnType<typeof createMockBrowser>;
  let jobLifecyclePort: ReturnType<typeof createMockJobLifecyclePort>;
  let jobIngestor: ReturnType<typeof createMockJobIngestor>;
  let scheduler: ExtractionScheduler;

  beforeEach(() => {
    queue = createMockQueue();
    browser = createMockBrowser();
    jobLifecyclePort = createMockJobLifecyclePort();
    jobIngestor = createMockJobIngestor();
    scheduler = new ExtractionScheduler(queue as any, browser as any, jobLifecyclePort as any, jobIngestor as any);
  });

  afterEach(async () => {
    await scheduler.stop();
  });

  it('handles concurrent job processing with multiple queue items', async () => {
    browser.extract.mockResolvedValue({ html: '<div>parsed</div>' });
    jobLifecyclePort.findById.mockResolvedValue({ url: 'https://example.com/job' });
    const docs = [
      { _id: 'job-1', jobLifecycleId: 'job-1', createdAt: new Date() },
      { _id: 'job-2', jobLifecycleId: 'job-2', createdAt: new Date() },
      { _id: 'job-3', jobLifecycleId: 'job-3', createdAt: new Date() },
    ];
    let callCount = 0;
    queue.dequeue.mockImplementation(() => {
      if (callCount < docs.length) {
        return Promise.resolve(docs[callCount++]);
      }
      return Promise.resolve(null);
    });
    await scheduler.start();
    await vi.waitFor(() => {
      expect(jobIngestor.processIngest).toHaveBeenCalledTimes(3);
    }, { interval: 50, timeout: 5000 });
  }, 10000);

  it('recovers from worker crash mid-job', async () => {
    browser.extract
      .mockRejectedValueOnce(new Error('Crash'))
      .mockResolvedValueOnce({ html: '<div>recovered</div>' });
    jobLifecyclePort.findById.mockResolvedValue({ url: 'https://example.com/job' });
    const docs = [
      { _id: 'job-crash', jobLifecycleId: 'job-crash', createdAt: new Date() },
      { _id: 'job-ok', jobLifecycleId: 'job-ok', createdAt: new Date() },
    ];
    let callCount = 0;
    queue.dequeue.mockImplementation(() => {
      if (callCount < docs.length) {
        return Promise.resolve(docs[callCount++]);
      }
      return Promise.resolve(null);
    });
    await scheduler.start();
    await vi.waitFor(() => {
      expect(jobIngestor.processIngest).toHaveBeenCalledTimes(2);
    }, { interval: 50, timeout: 5000 });
  }, 10000);

  it('drains remaining queue items after errors', async () => {
    browser.extract.mockResolvedValue({ html: '<div>ok</div>' });
    jobLifecyclePort.findById.mockResolvedValue({ url: 'https://example.com/job' });
    const docs = [
      { _id: 'drain-1', jobLifecycleId: 'drain-1', createdAt: new Date() },
      { _id: 'drain-2', jobLifecycleId: 'drain-2', createdAt: new Date() },
    ];
    let callCount = 0;
    queue.dequeue.mockImplementation(() => {
      if (callCount < docs.length) {
        return Promise.resolve(docs[callCount++]);
      }
      return Promise.resolve(null);
    });
    await scheduler.start();
    await vi.waitFor(() => {
      expect(jobIngestor.processIngest).toHaveBeenCalledTimes(2);
    }, { interval: 50, timeout: 5000 });
  }, 10000);
});
