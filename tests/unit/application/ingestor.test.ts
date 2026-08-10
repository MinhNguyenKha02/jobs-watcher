/*
 * Cause→effect decision rows for JobIngestor (unit, IoC-mock ports, dummy ports in-proc):
 *   GIVEN an S1 partial ingest WHEN signal1/signal2 is processed THEN GENERATED / enqueue-defer / filter-trash;
 *   GIVEN an S2 doc WHEN resolution (queue|trash) is applied THEN QUEUED / TRASHED / ROUTE_FAILED guard + retry budget.
 *   Path attribution: arrows in titles mark the c1/c2 cause→effect arc they belong to.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildSystemContainer } from '../../../src/application/container.js';
import { JobStage, JobStatus, JobSource } from '../../../src/domain/types/job-lifecycle.js';
import type { IngestorPort } from '../../../src/application/ports/inbound/ingestor.port.js';
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
  let ingestor: IngestorPort;
  let storage: ReturnType<typeof mockPort>;
  let queue: ReturnType<typeof mockQueue>;
  let parsePort: ReturnType<typeof mockParsePort>;
  let routingPort: ReturnType<typeof mockRoutingPort>;

  beforeEach(() => {
    storage = mockPort();
    queue = mockQueue();
    parsePort = mockParsePort();
    routingPort = mockRoutingPort();
    // Unit decision rows resolve the SUT through the production composition
    // root with an explicit binding profile (mock ports at IoC). No start() is
    // called, so the graph is infra-free: app decisions only, never infra.
    const container = buildSystemContainer(
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
          jobLifecycle: storage,
          extractionQueue: queue,
          parse: parsePort,
          route: routingPort,
          assetProducing: { toAsset: vi.fn().mockResolvedValue({ pdfPath: '' }) },
        },
      }
    );
    ingestor = container.ingestor;
  });

  describe('processIngest — BROWSER_AUTO PARTIAL_PARSED', () => {
    it.each(['msg-001', 'nourl-msg'] as const)(
      'GIVEN no url (messageId %s) WHEN an ingest signal is processed THEN persists S1 partial and emits GENERATED without enqueueing (S1)',
      async (messageId) => {
        await ingestor.processIngest(
          JobSource.BROWSER_AUTO,
          JobStage.PARTIAL_PARSED,
          makeTopCvEmailHtml(),
          undefined,
          { messageId }
        );
        expect(storage.upsert).toHaveBeenCalledWith(
          expect.objectContaining({
            stage: JobStage.PARTIAL_PARSED,
            source: JobSource.BROWSER_AUTO,
          })
        );
        expect(parsePort.emitGenerated).toHaveBeenCalled();
        expect(queue.enqueue).not.toHaveBeenCalled();
      }
    );

    it('GIVEN only jobLifecycleId WHEN an ingest signal is processed THEN falls back to signal1BrowserAutoFallback (S1)', async () => {
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
    it('GIVEN extracted job has a url WHEN an ingest signal is processed THEN enqueues (S1)', async () => {
      await ingestor.processIngest(
        JobSource.BROWSER_AUTO,
        JobStage.PARTIAL_PARSED,
        makeIndeedEmailHtml(),
        undefined,
        { messageId: 'url-msg' }
      );
      expect(storage.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ stage: JobStage.PARTIAL_PARSED, source: JobSource.BROWSER_AUTO })
      );
      expect(queue.enqueue).toHaveBeenCalled();
      expect(parsePort.emitGenerated).not.toHaveBeenCalled();
    });
  });

  describe('Filter rejection', () => {
    it('GIVEN filter rejects WHEN an ingest signal is processed THEN trashes job (S1)', async () => {
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
    it('GIVEN an S1 partial job WHEN an ingest signal is processed THEN parses HTML and emits completed (S2)', async () => {
      storage.findById.mockResolvedValue(makeStage1Partial({ _id: 'browser-job' }));
      await ingestor.processIngest(
        JobSource.BROWSER_AUTO,
        JobStage.FULL_PARSED,
        makeTopCvDetailHtml(),
        'browser-job'
      );
      expect(storage.findById).toHaveBeenCalledWith('browser-job');
      expect(storage.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ stage: JobStage.FULL_PARSED, source: JobSource.BROWSER_AUTO })
      );
      expect(parsePort.emitCompleted).toHaveBeenCalled();
    });
  });

  describe('processIngest — MANUAL FULL_PARSED', () => {
    it('GIVEN an S1 partial job WHEN an ingest signal is processed THEN signal2aManual with jobLifecycleId processes successfully (S2)', async () => {
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

    it('GIVEN an S2 full-parse job WHEN an ingest signal is processed THEN signal2bManual without jobLifecycleId treats as clipboard ingest (S2)', async () => {
      await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, makeTopCvDetailHtml());
      expect(storage.upsert).toHaveBeenCalled();
      expect(parsePort.emitCompleted).toHaveBeenCalled();
    });
  });

  describe('processResolution — [j] guard', () => {
    it('GIVEN status !== ENRICHED WHEN a resolution is applied THEN rejects queue (S1)', async () => {
      storage.findById.mockResolvedValue(
        makeStage1Partial({ _id: 'guard-job', status: JobStatus.ENRICHING })
      );
      await ingestor.processResolution('guard-job', 'queue');
      expect(storage.updateStage).not.toHaveBeenCalled();
      expect(routingPort.emitJobQueued).not.toHaveBeenCalled();
    });

    it('GIVEN status === ENRICHED WHEN a resolution is applied THEN accepts queue (S2)', async () => {
      storage.findById.mockResolvedValue(
        makeStage1Partial({ _id: 'enriched-job', status: JobStatus.ENRICHED })
      );
      await ingestor.processResolution('enriched-job', 'queue');
      expect(storage.updateStage).toHaveBeenCalled();
      expect(routingPort.emitJobQueued).toHaveBeenCalled();
    });

    it('GIVEN an S1 partial job WHEN a resolution is applied THEN trash passes through regardless of status (S1)', async () => {
      storage.findById.mockResolvedValue(
        makeStage1Partial({ _id: 'trash-job', status: JobStatus.ENRICHING })
      );
      await ingestor.processResolution('trash-job', 'trash');
      expect(storage.updateStage).toHaveBeenCalled();
      expect(routingPort.emitJobTrashed).toHaveBeenCalled();
    });
  });

  describe('dedup (E11000)', () => {
    it('GIVEN an S1 partial job WHEN an ingest signal is processed THEN trashes duplicates and does not emit generated (S1)', async () => {
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

    it('GIVEN an S2 full-parse job WHEN an ingest signal is processed THEN propagates non-11000 upsert errors instead of swallowing them (S2)', async () => {
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
    it('GIVEN resolve a missing job WHEN a resolution is applied THEN 5 findById probes then ROUTE_FAILED emitted', async () => {
      storage.findById.mockResolvedValue(null);
      await ingestor.processResolution('missing-job', 'queue');

      expect(storage.findById).toHaveBeenCalledTimes(5);
      expect(routingPort.emitRouteFailed).toHaveBeenCalledWith(
        'missing-job',
        'No existing job lifecycle found'
      );
      expect(routingPort.emitJobQueued).not.toHaveBeenCalled();
    });

    it('GIVEN resolve an existing ENRICHED job WHEN a resolution is applied THEN single findById, updateStage to QUEUED, QUEUED emitted (S2+S3)', async () => {
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
