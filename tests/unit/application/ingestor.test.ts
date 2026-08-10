import { describe, it, expect, vi, beforeEach } from 'vitest';
import { JobIngestor } from '../../../src/application/ingestor.js';
import { JobStage, JobStatus, JobSource } from '../../../src/domain/types/job-lifecycle.js';
import { MetricsRegistry } from '../../../src/infrastructure/outbound/monitoring/metrics-registry.js';
import { Registry } from 'prom-client';
import { makeStage1Partial } from '../../helpers/test-builders.js';

function mockPort() {
  return {
    upsert: vi.fn(),
    updateStage: vi.fn(),
    findById: vi.fn(),
  };
}

function mockQueue() {
  return {
    enqueue: vi.fn(),
    dequeue: vi.fn(),
    size: vi.fn(),
    onEnqueue: vi.fn(),
  };
}

function mockParsePort() {
  return {
    emitGenerated: vi.fn(),
    emitCompleted: vi.fn(),
    emitFailed: vi.fn(),
  };
}

function mockRoutingPort() {
  return {
    emitJobQueued: vi.fn(),
    emitJobTrashed: vi.fn(),
    emitRouteFailed: vi.fn(),
  };
}

/**
 * Email-alert HTML formats — consumed by JobExtractionService.extractAllJobs()
 * for PARTIAL_PARSED (signal1) path.
 */

/** TopCV email-alert — no url → emitGenerated */
function makeTopCvEmailHtml(): string {
  return (
    '<div class="topcv-job-list">' +
    '<a class="job-item-link" href="">' +
    '<div class="job-item"><div class="body">' +
    '<div class="title"><span>Junior Software Engineer</span></div>' +
    '<div class="company"><span>Junior Co</span></div>' +
    '<div class="meta-job"><div class="item text-primary"><b>$100k</b></div></div>' +
    '</div></div>' +
    '</a></div>'
  );
}

/** Indeed email-alert — has applystart url → enqueue */
function makeIndeedEmailHtml(): string {
  return (
    '<html><body>Indeed Job Alert' +
    '<table><tr><td class="pb-24">' +
    '<h2><a href="https://vn.indeed.com/applystart?jk=abc123">Senior Backend Engineer</a></h2>' +
    '<div style="color:#2d2d2d">Senior Co</div>' +
    '</td></tr></table>' +
    '</body></html>'
  );
}

/** TopCV email-alert — non-software role → filter rejects */
function makeNonSoftwareEmailHtml(): string {
  return (
    '<div class="topcv-job-list">' +
    '<a class="job-item-link" href="">' +
    '<div class="job-item"><div class="body">' +
    '<div class="title"><span>Marketing Manager</span></div>' +
    '<div class="company"><span>ACME Corp</span></div>' +
    '</div></div>' +
    '</a></div>'
  );
}

/**
 * Detail-page HTML formats — consumed by HtmlJobParser.parseJobFromHtml()
 * for FULL_PARSED (signal2) path.
 */

function makeTopCvDetailHtml(): string {
  return (
    '<div class="job-detail__info--title"><h1>Junior Software Engineer</h1></div>' +
    '<div class="company-name-label"><a class="name">Junior Co</a></div>' +
    '<div class="section-salary"><div class="job-detail__info--section-content-value">$100k</div></div>'
  );
}

describe('JobIngestor', () => {
  let ingestor: JobIngestor;
  let storage: ReturnType<typeof mockPort>;
  let queue: ReturnType<typeof mockQueue>;
  let parsePort: ReturnType<typeof mockParsePort>;
  let routingPort: ReturnType<typeof mockRoutingPort>;

  beforeEach(() => {
    storage = mockPort();
    queue = mockQueue();
    parsePort = mockParsePort();
    routingPort = mockRoutingPort();
    ingestor = new JobIngestor(
      storage,
      parsePort,
      routingPort,
      queue,
      { toAsset: vi.fn().mockResolvedValue({ pdfPath: '' }) },
      new MetricsRegistry(new Registry())
    );
  });

  describe('processIngest — BROWSER_AUTO PARTIAL_PARSED', () => {
    it('calls emitGenerated when rawPayload is provided (no url)', async () => {
      await ingestor.processIngest(
        JobSource.BROWSER_AUTO,
        JobStage.PARTIAL_PARSED,
        makeTopCvEmailHtml(),
        undefined,
        { messageId: 'msg-001' }
      );
      expect(storage.upsert).toHaveBeenCalled();
      expect(parsePort.emitGenerated).toHaveBeenCalled();
      expect(queue.enqueue).not.toHaveBeenCalled();
    });

    it('falls back to signal1BrowserAutoFallback when only jobLifecycleId', async () => {
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

  describe('Case A: job has url → enqueue to extraction queue', () => {
    it('enqueues when extracted job has a url', async () => {
      await ingestor.processIngest(
        JobSource.BROWSER_AUTO,
        JobStage.PARTIAL_PARSED,
        makeIndeedEmailHtml(),
        undefined,
        { messageId: 'url-msg' }
      );
      expect(storage.upsert).toHaveBeenCalled();
      expect(queue.enqueue).toHaveBeenCalled();
      expect(parsePort.emitGenerated).not.toHaveBeenCalled();
    });
  });

  describe('Case B: job has no url → emitGenerated only', () => {
    it('emits generated when no url', async () => {
      await ingestor.processIngest(
        JobSource.BROWSER_AUTO,
        JobStage.PARTIAL_PARSED,
        makeTopCvEmailHtml(),
        undefined,
        { messageId: 'nourl-msg' }
      );
      expect(storage.upsert).toHaveBeenCalled();
      expect(parsePort.emitGenerated).toHaveBeenCalled();
      expect(queue.enqueue).not.toHaveBeenCalled();
    });
  });

  describe('Filter rejection', () => {
    it('trashes job when filter rejects', async () => {
      await ingestor.processIngest(
        JobSource.BROWSER_AUTO,
        JobStage.PARTIAL_PARSED,
        makeNonSoftwareEmailHtml(),
        undefined,
        { messageId: 'nonjob-msg' }
      );
      expect(routingPort.emitJobTrashed).toHaveBeenCalled();
      expect(storage.upsert).not.toHaveBeenCalled();
    });
  });

  describe('processIngest — BROWSER_AUTO FULL_PARSED (signal2c)', () => {
    it('parses HTML and emits completed', async () => {
      storage.findById.mockResolvedValue(makeStage1Partial({ _id: 'browser-job' }));
      await ingestor.processIngest(
        JobSource.BROWSER_AUTO,
        JobStage.FULL_PARSED,
        makeTopCvDetailHtml(),
        'browser-job'
      );
      expect(storage.findById).toHaveBeenCalledWith('browser-job');
      expect(storage.upsert).toHaveBeenCalled();
      expect(parsePort.emitCompleted).toHaveBeenCalled();
    });
  });

  describe('processIngest — MANUAL FULL_PARSED', () => {
    it('signal2aManual with jobLifecycleId processes successfully', async () => {
      storage.findById.mockResolvedValue(makeStage1Partial({ _id: 'manual-job' }));
      await ingestor.processIngest(
        JobSource.MANUAL,
        JobStage.FULL_PARSED,
        makeTopCvDetailHtml(),
        'manual-job'
      );
      expect(storage.findById).toHaveBeenCalledWith('manual-job');
      expect(storage.upsert).toHaveBeenCalled();
      expect(parsePort.emitCompleted).toHaveBeenCalled();
    });

    it('signal2bManual without jobLifecycleId treats as clipboard ingest', async () => {
      await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, makeTopCvDetailHtml());
      expect(storage.upsert).toHaveBeenCalled();
      expect(parsePort.emitCompleted).toHaveBeenCalled();
    });
  });

  describe('processResolution — [j] guard', () => {
    it('rejects queue when status !== ENRICHED', async () => {
      storage.findById.mockResolvedValue(
        makeStage1Partial({ _id: 'guard-job', status: JobStatus.ENRICHING })
      );
      await ingestor.processResolution('guard-job', 'queue');
      expect(storage.updateStage).not.toHaveBeenCalled();
      expect(routingPort.emitJobQueued).not.toHaveBeenCalled();
    });

    it('accepts queue when status === ENRICHED', async () => {
      storage.findById.mockResolvedValue(
        makeStage1Partial({ _id: 'enriched-job', status: JobStatus.ENRICHED })
      );
      await ingestor.processResolution('enriched-job', 'queue');
      expect(storage.updateStage).toHaveBeenCalled();
      expect(routingPort.emitJobQueued).toHaveBeenCalled();
    });

    it('trash passes through regardless of status', async () => {
      storage.findById.mockResolvedValue(
        makeStage1Partial({ _id: 'trash-job', status: JobStatus.ENRICHING })
      );
      await ingestor.processResolution('trash-job', 'trash');
      expect(storage.updateStage).toHaveBeenCalled();
      expect(routingPort.emitJobTrashed).toHaveBeenCalled();
    });
  });

  describe('dedup (E11000)', () => {
    it('trashes duplicates and does not emit generated', async () => {
      storage.upsert.mockRejectedValue({ code: 11000 });
      await ingestor.processIngest(
        JobSource.BROWSER_AUTO,
        JobStage.PARTIAL_PARSED,
        makeTopCvEmailHtml(),
        undefined,
        { messageId: 'dedup-msg' }
      );
      expect(routingPort.emitJobTrashed).toHaveBeenCalled();
    });

    it('propagates non-11000 upsert errors instead of swallowing them', async () => {
      storage.upsert.mockRejectedValueOnce(Object.assign(new Error('Disk full'), { code: 9000 }));
      await expect(
        ingestor.processIngest(
          JobSource.MANUAL,
          JobStage.FULL_PARSED,
          makeTopCvDetailHtml(),
          undefined
        )
      ).rejects.toThrow('Disk full');
    });
  });

  describe('processResolution — queryWithRetry budget (cause→effect, maxRetries=5)', () => {
    it('cause: resolve a missing job → effect: 5 findById probes then ROUTE_FAILED emitted', async () => {
      storage.findById.mockResolvedValue(null);
      await ingestor.processResolution('missing-job', 'queue');

      expect(storage.findById).toHaveBeenCalledTimes(5);
      expect(routingPort.emitRouteFailed).toHaveBeenCalledWith(
        'missing-job',
        'No existing job lifecycle found'
      );
      expect(routingPort.emitJobQueued).not.toHaveBeenCalled();
    });

    it('cause: resolve an existing ENRICHED job → effect: single findById, updateStage to QUEUED, QUEUED emitted', async () => {
      storage.findById.mockResolvedValue(
        makeStage1Partial({ _id: 'job-ok', status: JobStatus.ENRICHED })
      );
      await ingestor.processResolution('job-ok', 'queue');

      expect(storage.findById).toHaveBeenCalledTimes(1);
      expect(storage.updateStage).toHaveBeenCalledWith(
        'job-ok',
        JobStage.FULL_PARSED,
        JobStatus.QUEUED
      );
      expect(routingPort.emitJobQueued).toHaveBeenCalledWith(
        'job-ok',
        expect.objectContaining({ source: JobSource.MANUAL })
      );
      expect(routingPort.emitRouteFailed).not.toHaveBeenCalled();
    });
  });
});
