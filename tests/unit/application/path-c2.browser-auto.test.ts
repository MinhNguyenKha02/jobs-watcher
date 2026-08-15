/*
 * Path c2 (unit, mocked test-ioc) — browser-auto ring:
 *   S1 with url → extraction queue → scheduler + browser full-parse (signal2c) → [j]/[d] → next pick,
 *   plus extraction-failure fallback and the REQUIRED shallow c1-fallback row.
 * Every `it` is GIVEN/WHEN/THEN with an S1–S4 checkpoint tag and `· path c2`.
 * Ingest cells run the real JobIngestor against mock ports; scheduler cells run the
 * real ExtractionScheduler against a mock ingestor so dequeue→extract wiring is asserted.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import type { IngestorPort } from '../../../src/application/ports/inbound/ingestor.port.js';
import { JobStage, JobSource } from '../../../src/domain/types/job-lifecycle.js';
import { indeedEmailHtmlMany, topcvDetailHtml } from '../../helpers/html-fixtures.js';
import { makeStage1Partial } from '../../helpers/test-builders.js';
import {
  mockJobLifecyclePort,
  mockExtractionQueuePort,
  mockParsePort,
  mockRoutingPort,
  mockBrowserPort,
  mockIngestorPort,
  buildTestDaemonContainer,
  type AppsScheduler,
} from '../../helpers/test-container.js';

async function buildContainer(overrides: { ingestor?: ReturnType<typeof mockIngestorPort> }) {
  return buildTestDaemonContainer(
    { ns: 'unit-path-c2' },
    {
      ports: {
        jobLifecycle: storage,
        extractionQueue: queue,
        parse: parsePort,
        route: routingPort,
        browser,
        ...(overrides.ingestor ? { ingestor: overrides.ingestor } : {}),
        assetProducing: { toAsset: vi.fn().mockResolvedValue({ pdfPath: '' }) },
      },
    }
  );
}

/** Indeed email alert — applystart url → enqueue to the extraction queue. */
const indeedEmail = () =>
  indeedEmailHtmlMany([
    {
      role: 'Senior Backend Engineer',
      company: 'Senior Co',
      url: 'https://vn.indeed.com/applystart?jk=abc123',
    },
  ]);

/** TopCV detail page — consumed by HtmlJobParser for signal2c (browser full-parse). */
const topcvDetail = () => topcvDetailHtml('Junior Software Engineer', 'Junior Co');

let storage: ReturnType<typeof mockJobLifecyclePort>;
let queue: ReturnType<typeof mockExtractionQueuePort>;
let parsePort: ReturnType<typeof mockParsePort>;
let routingPort: ReturnType<typeof mockRoutingPort>;
let browser: ReturnType<typeof mockBrowserPort>;

beforeEach(() => {
  storage = mockJobLifecyclePort();
  queue = mockExtractionQueuePort();
  parsePort = mockParsePort();
  routingPort = mockRoutingPort();
  browser = mockBrowserPort();
});

describe('Path c2 unit — browser-auto — S1(url) → scheduler browser full-parse → [j]/[d] → next (mocked test-ioc)', () => {
  describe('(a) S1 ingest with url — extraction queue enqueue', () => {
    let ingestor: IngestorPort;

    beforeEach(async () => {
      ingestor = (await buildContainer({})).apps.ingest;
    });

    it('GIVEN an S1 email with an Indeed applystart url WHEN an ingest signal is processed THEN persists S1 partial and enqueues to the extraction queue (S1) · path c2', async () => {
      await ingestor.processIngest(
        JobSource.BROWSER_AUTO,
        JobStage.PARTIAL_PARSED,
        indeedEmail(),
        undefined,
        { messageId: 'url-msg' }
      );
      expect(storage.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ stage: JobStage.PARTIAL_PARSED, source: JobSource.BROWSER_AUTO })
      );
      expect(queue.enqueue).toHaveBeenCalled();
      expect(parsePort.emitGenerated).not.toHaveBeenCalled();
    });

    it('GIVEN an S1 partial job WHEN only a jobLifecycleId is provided THEN falls back to signal1BrowserAutoFallback — emits GENERATED (shallow c1-fallback, S1) · path c2', async () => {
      storage.findById.mockResolvedValue(makeStage1Partial({ _id: 'existing-id' }));
      await ingestor.processIngest(
        JobSource.BROWSER_AUTO,
        JobStage.PARTIAL_PARSED,
        '',
        'existing-id'
      );
      expect(storage.findById).toHaveBeenCalledWith('existing-id');
      expect(parsePort.emitGenerated).toHaveBeenCalled();
    });
  });

  describe('(b) signal2c browser full-parse (BROWSER_AUTO FULL_PARSED)', () => {
    let ingestor: IngestorPort;

    beforeEach(async () => {
      ingestor = (await buildContainer({})).apps.ingest;
    });

    it('GIVEN a dequeued S1 job WHEN a BROWSER_AUTO FULL_PARSED signal is processed THEN merges parsed fields into FULL_PARSED/ENRICHED and emits completed (S2) · path c2', async () => {
      storage.findById.mockResolvedValue(makeStage1Partial({ _id: 'browser-job' }));
      await ingestor.processIngest(
        JobSource.BROWSER_AUTO,
        JobStage.FULL_PARSED,
        topcvDetail(),
        'browser-job'
      );
      expect(storage.findById).toHaveBeenCalledWith('browser-job');
      expect(storage.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ stage: JobStage.FULL_PARSED, source: JobSource.BROWSER_AUTO })
      );
      expect(parsePort.emitCompleted).toHaveBeenCalled();
    });
  });

  describe('(c) scheduler lifecycle', () => {
    let scheduler: AppsScheduler;

    beforeEach(async () => {
      scheduler = (await buildContainer({ ingestor: mockIngestorPort() })).apps.scheduler;
    });

    afterEach(async () => {
      await scheduler.stop();
    });

    it('GIVEN a started scheduler WHEN the scheduler starts THEN the browser starts and workers begin (S1+S2) · path c2', async () => {
      queue.dequeue.mockResolvedValue(null);
      await scheduler.start();
      expect(browser.start).toHaveBeenCalledOnce();
    });

    it('GIVEN a running scheduler WHEN the scheduler stops THEN all workers and the browser stop (S1+S2) · path c2', async () => {
      queue.dequeue.mockResolvedValue(null);
      await scheduler.start();
      await scheduler.stop();
      expect(browser.stop).toHaveBeenCalledOnce();
    });

    it('GIVEN a scheduler that was never started WHEN the scheduler stops THEN it is a no-op (S1+S2) · path c2', async () => {
      await expect(scheduler.stop()).resolves.toBeUndefined();
    });
  });

  describe('(d) scheduler dequeue → browser extraction → processIngest', () => {
    let scheduler: AppsScheduler;
    let jobIngestor: ReturnType<typeof mockIngestorPort>;

    beforeEach(async () => {
      jobIngestor = mockIngestorPort();
      scheduler = (await buildContainer({ ingestor: jobIngestor })).apps.scheduler;
    });

    afterEach(async () => {
      await scheduler.stop();
    });

    it('GIVEN a dequeued S2 job WHEN the scheduler processes it THEN finds the job lifecycle, extracts the URL, and calls processIngest with FULL_PARSED (S2) · path c2', async () => {
      storage.findById.mockResolvedValue(makeStage1Partial({ url: 'https://example.com/job' }));
      browser.extract.mockResolvedValue({ html: '<div>parsed content</div>' });
      const doc = { _id: 'job-1', jobLifecycleId: 'job-1', createdAt: new Date() };
      queue.dequeue.mockResolvedValueOnce(doc).mockResolvedValue(null);

      await scheduler.start();
      await vi.waitFor(
        () => expect(browser.extract).toHaveBeenCalledWith('https://example.com/job'),
        { interval: 50, timeout: 3000 }
      );
      await vi.waitFor(
        () =>
          expect(jobIngestor.processIngest).toHaveBeenCalledWith(
            JobSource.BROWSER_AUTO,
            JobStage.FULL_PARSED,
            '<div>parsed content</div>',
            'job-1'
          ),
        { interval: 50, timeout: 3000 }
      );
    });

    it('GIVEN an empty extraction queue WHEN the scheduler starts THEN the worker blocks on dequeue without crashing (S1) · path c2', async () => {
      queue.dequeue.mockResolvedValue(null);
      await scheduler.start();
      await vi.waitFor(() => expect(queue.dequeue).toHaveBeenCalled(), {
        interval: 50,
        timeout: 3000,
      });
    });

    it('GIVEN a dequeued job with a missing lifecycle doc WHEN the scheduler processes it THEN extraction proceeds with an empty URL (S2) · path c2', async () => {
      storage.findById.mockResolvedValue(null);
      browser.extract.mockResolvedValue({ html: '<div>ok</div>' });
      const doc = { _id: 'job-null', jobLifecycleId: 'job-null', createdAt: new Date() };
      queue.dequeue.mockResolvedValueOnce(doc).mockResolvedValue(null);

      await scheduler.start();
      await vi.waitFor(() => expect(browser.extract).toHaveBeenCalledWith(''), {
        interval: 50,
        timeout: 3000,
      });
    });

    it('GIVEN a queue dequeue that rejects WHEN the scheduler processes it THEN the worker survives and keeps draining (S1+S4) · path c2', async () => {
      queue.dequeue.mockRejectedValue(new Error('DB connection lost'));
      await scheduler.start();
      await vi.waitFor(() => expect(queue.dequeue).toHaveBeenCalled(), {
        interval: 50,
        timeout: 3000,
      });
    });
  });

  describe('(e) extraction-failure fallback', () => {
    let scheduler: AppsScheduler;
    let jobIngestor: ReturnType<typeof mockIngestorPort>;

    beforeEach(async () => {
      jobIngestor = mockIngestorPort();
      scheduler = (await buildContainer({ ingestor: jobIngestor })).apps.scheduler;
    });

    afterEach(async () => {
      await scheduler.stop();
    });

    it('GIVEN an S1 job whose browser extraction fails WHEN the scheduler processes it THEN calls processIngest with PARTIAL_PARSED and an empty payload (S1+S4) · path c2', async () => {
      storage.findById.mockResolvedValue(makeStage1Partial({ url: 'https://example.com/bad' }));
      browser.extract.mockRejectedValue(new Error('Navigation timeout'));
      const doc = { _id: 'job-fail', jobLifecycleId: 'job-fail', createdAt: new Date() };
      queue.dequeue.mockResolvedValueOnce(doc).mockResolvedValue(null);

      await scheduler.start();
      await vi.waitFor(
        () =>
          expect(jobIngestor.processIngest).toHaveBeenCalledWith(
            JobSource.BROWSER_AUTO,
            JobStage.PARTIAL_PARSED,
            '',
            'job-fail'
          ),
        { interval: 50, timeout: 3000 }
      );
    });

    it('GIVEN an S1 job whose extraction succeeds WHEN the scheduler processes it THEN calls processIngest with FULL_PARSED (S2) · path c2', async () => {
      storage.findById.mockResolvedValue(makeStage1Partial({ url: 'https://example.com/job' }));
      browser.extract.mockResolvedValue({ html: '<div>success</div>' });
      const doc = { _id: 'job-ok', jobLifecycleId: 'job-ok', createdAt: new Date() };
      queue.dequeue.mockResolvedValueOnce(doc).mockResolvedValue(null);

      await scheduler.start();
      await vi.waitFor(
        () =>
          expect(jobIngestor.processIngest).toHaveBeenCalledWith(
            JobSource.BROWSER_AUTO,
            JobStage.FULL_PARSED,
            '<div>success</div>',
            'job-ok'
          ),
        { interval: 50, timeout: 3000 }
      );
    });
  });

  describe('(f) ring closure — next pick', () => {
    let scheduler: AppsScheduler;
    let jobIngestor: ReturnType<typeof mockIngestorPort>;
    let ingestor: IngestorPort;

    beforeEach(async () => {
      jobIngestor = mockIngestorPort();
      scheduler = (await buildContainer({ ingestor: jobIngestor })).apps.scheduler;
      ingestor = (await buildContainer({})).apps.ingest;
    });

    afterEach(async () => {
      await scheduler.stop();
    });

    it('GIVEN a completed S1→S2 extraction cycle WHEN a fresh S1 with url follows THEN it enqueues and the next job drains through the scheduler (s1→s2→s3→next pick) · path c2', async () => {
      storage.findById.mockResolvedValue(makeStage1Partial({ _id: 'cycle-job' }));
      browser.extract.mockResolvedValue({ html: '<div>next</div>' });
      const doc = { _id: 'next-1', jobLifecycleId: 'next-1', createdAt: new Date() };
      queue.dequeue.mockResolvedValueOnce(doc).mockResolvedValue(null);

      await scheduler.start();
      await vi.waitFor(() => expect(jobIngestor.processIngest).toHaveBeenCalled(), {
        interval: 50,
        timeout: 3000,
      });

      await ingestor.processIngest(
        JobSource.BROWSER_AUTO,
        JobStage.PARTIAL_PARSED,
        indeedEmail(),
        undefined,
        { messageId: 'next-msg' }
      );
      expect(queue.enqueue).toHaveBeenCalled();
      expect(routingPort.emitRouteFailed).not.toHaveBeenCalled();
    });
  });
});
