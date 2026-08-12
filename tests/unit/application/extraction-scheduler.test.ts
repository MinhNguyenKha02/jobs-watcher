/*
 * Cause→effect rows for ExtractionScheduler (unit, IoC-mock ports, path c2):
 *   GIVEN an enqueued partial (S1) WHEN the worker dequeues → finds the doc → browser.extract
 *   THEN processIngest(S2 FULL_PARSED) on success, or PARTIAL_PARSED fallback on failure — queue keeps draining.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { buildDaemonContainer } from '../../../src/application/container.js';
import type { ExtractionScheduler } from '../../../src/application/extraction-scheduler.js';
import { JobSource, JobStage } from '../../../src/domain/types/job-lifecycle.js';

function createMockQueue() {
  return {
    dequeue: vi.fn<
      any[],
      Promise<{ _id: string; jobLifecycleId: string; createdAt: Date } | null>
    >(),
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
    // Resolve SUT through the production composition root with an explicit
    // binding profile (extractionQueue/browser/jobLifecycle/ingestor fakes at
    // IoC). No start() is called, so the graph is infra-free.
    scheduler = buildDaemonContainer(
      {
        nodeEnv: 'test',
        mongodb: { uri: 'mongodb://localhost/jw-unit', dbName: 'unit' },
        rabbitmq: {
          url: process.env.RABBITMQ_URL || 'amqp://localhost',
          exchange: 'jobs.events.unit',
        },
        uds: { socketPath: '/tmp/jobs-watcher-unit.sock', token: 'unit-token' },
        health: { port: 0 },
        asset: { outputDir: '/tmp/jobs-watcher-unit-assets' },
      },
      {
        ports: {
          extractionQueue: queue,
          browser,
          jobLifecycle: jobLifecyclePort,
          ingestor: jobIngestor,
        },
      }
    ).extractionScheduler;
  });

  afterEach(async () => {
    await scheduler.stop();
  });

  describe('start / stop lifecycle', () => {
    it('GIVEN start / stop lifecycle WHEN the scheduler starts THEN starts the browser and begins workers · path c2', async () => {
      queue.dequeue.mockResolvedValue(null);
      await scheduler.start();
      expect(browser.start).toHaveBeenCalledOnce();
    });

    it('GIVEN start / stop lifecycle WHEN the scheduler starts → the scheduler stops THEN stops all workers and browser · path c2', async () => {
      queue.dequeue.mockResolvedValue(null);
      await scheduler.start();
      await scheduler.stop();
      expect(browser.stop).toHaveBeenCalledOnce();
    });

    it('GIVEN start / stop lifecycle WHEN the scheduler stops THEN survives stop without start (no-op) · path c2', async () => {
      await expect(scheduler.stop()).resolves.toBeUndefined();
    });
  });

  describe('worker dequeues and processes jobs', () => {
    beforeEach(async () => {
      browser.extract.mockResolvedValue({ html: '<div>parsed content</div>' });
    });

    it('GIVEN an S2 full-parse job WHEN the scheduler starts THEN dequeues a job, finds job lifecycle, extracts URL, and calls processIngest with FULL_PARSED (S2) · path c2', async () => {
      jobLifecyclePort.findById.mockResolvedValue({ url: 'https://example.com/job' });
      const doc = { _id: 'job-1', jobLifecycleId: 'job-1', createdAt: new Date() };

      queue.dequeue.mockResolvedValueOnce(doc).mockResolvedValue(null);

      await scheduler.start();
      await vi.waitFor(
        () => {
          expect(queue.dequeue).toHaveBeenCalled();
        },
        { interval: 50, timeout: 3000 }
      );

      await vi.waitFor(
        () => {
          expect(jobLifecyclePort.findById).toHaveBeenCalledWith('job-1');
        },
        { interval: 50, timeout: 3000 }
      );

      await vi.waitFor(
        () => {
          expect(browser.extract).toHaveBeenCalledWith('https://example.com/job');
        },
        { interval: 50, timeout: 3000 }
      );

      await vi.waitFor(
        () => {
          expect(jobIngestor.processIngest).toHaveBeenCalledWith(
            JobSource.BROWSER_AUTO,
            JobStage.FULL_PARSED,
            '<div>parsed content</div>',
            'job-1'
          );
        },
        { interval: 50, timeout: 3000 }
      );
    });

    it('GIVEN worker dequeues and processes jobs WHEN the scheduler starts THEN handles empty queue by blocking worker (no crash) · path c2', async () => {
      queue.dequeue.mockResolvedValue(null);
      await scheduler.start();
      await vi.waitFor(
        () => {
          expect(queue.dequeue).toHaveBeenCalled();
        },
        { interval: 50, timeout: 3000 }
      );
    });

    it('GIVEN an S1 partial job WHEN the scheduler starts THEN handles extraction failure by calling processIngest with PARTIAL_PARSED (S1) · path c2', async () => {
      jobLifecyclePort.findById.mockResolvedValue({ url: 'https://example.com/bad' });
      browser.extract.mockRejectedValue(new Error('Timeout'));
      const doc = { _id: 'job-fail', jobLifecycleId: 'job-fail', createdAt: new Date() };

      queue.dequeue.mockResolvedValueOnce(doc).mockResolvedValue(null);

      await scheduler.start();
      await vi.waitFor(
        () => {
          expect(jobIngestor.processIngest).toHaveBeenCalledWith(
            JobSource.BROWSER_AUTO,
            JobStage.PARTIAL_PARSED,
            '',
            'job-fail'
          );
        },
        { interval: 50, timeout: 3000 }
      );
    });

    it('GIVEN worker dequeues and processes jobs WHEN the scheduler starts THEN handles findById returning null by using empty URL · path c2', async () => {
      jobLifecyclePort.findById.mockResolvedValue(null);
      browser.extract.mockRejectedValue(new Error('empty-url'));
      const doc = { _id: 'job-null', jobLifecycleId: 'job-null', createdAt: new Date() };

      queue.dequeue.mockResolvedValueOnce(doc).mockResolvedValue(null);

      await scheduler.start();
      await vi.waitFor(
        () => {
          expect(browser.extract).toHaveBeenCalledWith('');
        },
        { interval: 50, timeout: 3000 }
      );
    });

    it('GIVEN worker dequeues and processes jobs WHEN the scheduler starts THEN worker error does not crash scheduler (continues working) · path c2', async () => {
      queue.dequeue.mockRejectedValue(new Error('DB connection lost'));

      await scheduler.start();
      await vi.waitFor(
        () => {
          expect(queue.dequeue).toHaveBeenCalled();
        },
        { interval: 50, timeout: 3000 }
      );
    });

    it('GIVEN an S2 full-parse job WHEN the scheduler starts THEN browser extraction success calls processIngest with BROWSER_AUTO FULL_PARSED (S2) · path c2', async () => {
      jobLifecyclePort.findById.mockResolvedValue({ url: 'https://example.com/job' });
      browser.extract.mockResolvedValue({ html: '<div>success</div>' });
      const doc = { _id: 'job-success', jobLifecycleId: 'job-success', createdAt: new Date() };

      queue.dequeue.mockResolvedValueOnce(doc).mockResolvedValue(null);

      await scheduler.start();
      await vi.waitFor(
        () => {
          expect(jobIngestor.processIngest).toHaveBeenCalledWith(
            JobSource.BROWSER_AUTO,
            JobStage.FULL_PARSED,
            '<div>success</div>',
            'job-success'
          );
        },
        { interval: 50, timeout: 3000 }
      );
    });

    it('GIVEN an S1 partial job WHEN the scheduler starts THEN browser extraction failure calls processIngest with BROWSER_AUTO PARTIAL_PARSED and empty payload (S1) · path c2', async () => {
      jobLifecyclePort.findById.mockResolvedValue({ url: 'https://example.com/bad' });
      browser.extract.mockRejectedValue(new Error('Navigation timeout'));
      const doc = { _id: 'job-fail-2', jobLifecycleId: 'job-fail-2', createdAt: new Date() };

      queue.dequeue.mockResolvedValueOnce(doc).mockResolvedValue(null);

      await scheduler.start();
      await vi.waitFor(
        () => {
          expect(jobIngestor.processIngest).toHaveBeenCalledWith(
            JobSource.BROWSER_AUTO,
            JobStage.PARTIAL_PARSED,
            '',
            'job-fail-2'
          );
        },
        { interval: 50, timeout: 3000 }
      );
    });
  });
});
