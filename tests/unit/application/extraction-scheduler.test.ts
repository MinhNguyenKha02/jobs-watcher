import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ExtractionScheduler } from '../../../src/application/extraction-scheduler.js';
import { JobSource, JobStage } from '../../../src/domain/types/job-lifecycle.js' ;

function createMockQueue() {
  return {
    dequeue: vi.fn<any[], Promise<{ _id: string; jobLifecycleId: string; createdAt: Date } | null>>(),
    enqueue: vi.fn(),
    size: vi.fn().mockResolvedValue(0),
    onEnqueue: vi.fn(),
  };
}

function createMockBrowser() {
  return {
    start: vi.fn<any[], Promise<void>>(),
    stop: vi.fn<any[], Promise<void>>(),
    extract: vi.fn<any[], Promise<{ html: string }>>(),
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

describe('ExtractionScheduler', () => {
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

  describe('start / stop lifecycle', () => {
    it('starts the browser and begins workers', async () => {
      queue.dequeue.mockResolvedValue(null);
      await scheduler.start();
      expect(browser.start).toHaveBeenCalledOnce();
    });

    it('stops all workers and browser', async () => {
      queue.dequeue.mockResolvedValue(null);
      await scheduler.start();
      await scheduler.stop();
      expect(browser.stop).toHaveBeenCalledOnce();
    });

    it('survives stop without start (no-op)', async () => {
      await expect(scheduler.stop()).resolves.toBeUndefined();
    });
  });

  describe('worker dequeues and processes jobs', () => {
    beforeEach(async () => {
      browser.extract.mockResolvedValue({ html: '<div>parsed content</div>' });
    });

    it('dequeues a job, finds job lifecycle, extracts URL, and calls processIngest with FULL_PARSED', async () => {
      jobLifecyclePort.findById.mockResolvedValue({ url: 'https://example.com/job' });
      const doc = { _id: 'job-1', jobLifecycleId: 'job-1', createdAt: new Date() };

      queue.dequeue
        .mockResolvedValueOnce(doc)
        .mockResolvedValue(null);

      await scheduler.start();
      await vi.waitFor(() => {
        expect(queue.dequeue).toHaveBeenCalled();
      }, { interval: 50, timeout: 3000 });

      await vi.waitFor(() => {
        expect(jobLifecyclePort.findById).toHaveBeenCalledWith('job-1');
      }, { interval: 50, timeout: 3000 });

      await vi.waitFor(() => {
        expect(browser.extract).toHaveBeenCalledWith('https://example.com/job');
      }, { interval: 50, timeout: 3000 });

      await vi.waitFor(() => {
        expect(jobIngestor.processIngest).toHaveBeenCalledWith(
          JobSource.BROWSER_AUTO,
          JobStage.FULL_PARSED,
          '<div>parsed content</div>',
          'job-1',
        );
      }, { interval: 50, timeout: 3000 });
    });

    it('handles empty queue by blocking worker (no crash)', async () => {
      queue.dequeue.mockResolvedValue(null);
      await scheduler.start();
      await vi.waitFor(() => {
        expect(queue.dequeue).toHaveBeenCalled();
      }, { interval: 50, timeout: 3000 });
    });

    it('handles extraction failure by calling processIngest with PARTIAL_PARSED', async () => {
      jobLifecyclePort.findById.mockResolvedValue({ url: 'https://example.com/bad' });
      browser.extract.mockRejectedValue(new Error('Timeout'));
      const doc = { _id: 'job-fail', jobLifecycleId: 'job-fail', createdAt: new Date() };

      queue.dequeue
        .mockResolvedValueOnce(doc)
        .mockResolvedValue(null);

      await scheduler.start();
      await vi.waitFor(() => {
        expect(jobIngestor.processIngest).toHaveBeenCalledWith(
          JobSource.BROWSER_AUTO,
          JobStage.PARTIAL_PARSED,
          '',
          'job-fail',
        );
      }, { interval: 50, timeout: 3000 });
    });

    it('handles findById returning null by using empty URL', async () => {
      jobLifecyclePort.findById.mockResolvedValue(null);
      browser.extract.mockRejectedValue(new Error('empty-url'));
      const doc = { _id: 'job-null', jobLifecycleId: 'job-null', createdAt: new Date() };

      queue.dequeue
        .mockResolvedValueOnce(doc)
        .mockResolvedValue(null);

      await scheduler.start();
      await vi.waitFor(() => {
        expect(browser.extract).toHaveBeenCalledWith('');
      }, { interval: 50, timeout: 3000 });
    });

    it('worker error does not crash scheduler (continues working)', async () => {
      queue.dequeue.mockRejectedValue(new Error('DB connection lost'));

      await scheduler.start();
      await vi.waitFor(() => {
        expect(queue.dequeue).toHaveBeenCalled();
      }, { interval: 50, timeout: 3000 });
    });

    it('browser extraction success calls processIngest with BROWSER_AUTO FULL_PARSED', async () => {
      jobLifecyclePort.findById.mockResolvedValue({ url: 'https://example.com/job' });
      browser.extract.mockResolvedValue({ html: '<div>success</div>' });
      const doc = { _id: 'job-success', jobLifecycleId: 'job-success', createdAt: new Date() };

      queue.dequeue
        .mockResolvedValueOnce(doc)
        .mockResolvedValue(null);

      await scheduler.start();
      await vi.waitFor(() => {
        expect(jobIngestor.processIngest).toHaveBeenCalledWith(
          JobSource.BROWSER_AUTO,
          JobStage.FULL_PARSED,
          '<div>success</div>',
          'job-success',
        );
      }, { interval: 50, timeout: 3000 });
    });

    it('browser extraction failure calls processIngest with BROWSER_AUTO PARTIAL_PARSED and empty payload', async () => {
      jobLifecyclePort.findById.mockResolvedValue({ url: 'https://example.com/bad' });
      browser.extract.mockRejectedValue(new Error('Navigation timeout'));
      const doc = { _id: 'job-fail-2', jobLifecycleId: 'job-fail-2', createdAt: new Date() };

      queue.dequeue
        .mockResolvedValueOnce(doc)
        .mockResolvedValue(null);

      await scheduler.start();
      await vi.waitFor(() => {
        expect(jobIngestor.processIngest).toHaveBeenCalledWith(
          JobSource.BROWSER_AUTO,
          JobStage.PARTIAL_PARSED,
          '',
          'job-fail-2',
        );
      }, { interval: 50, timeout: 3000 });
    });
  });
});
