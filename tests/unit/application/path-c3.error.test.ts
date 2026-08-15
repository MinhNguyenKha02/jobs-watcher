/*
 * Path c3 (unit, mocked test-ioc) — error sagas ring:
 *   parse-failure → PARSE_FAILED, route-failure → ROUTE_FAILED, retry budget + error propagation → S4 → next valid recovers.
 * Every `it` is GIVEN/WHEN/THEN with an S1–S4 checkpoint tag and `· path c3`.
 *
 * Injection semantics: each failure is a deterministic, single-shot, guard-style
 * invariant at the checkpoint where the ring MUST break (pending the saga
 * ingestor's job_lifecycle write, its findById probe, or a duplicated upsert).
 * The break is expected and ensured: the invoking error propagates as the S4
 * reason (never swallowed), and the asset-producer downstream consumer is never
 * reached (emitJobQueued/emitJobTrashed do not fire on the failed path).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { IngestorPort } from '../../../src/application/ports/inbound/ingestor.port.js';
import { JobStage, JobStatus, JobSource } from '../../../src/domain/types/job-lifecycle.js';
import { nonJobHtml, topcvDetailHtml, topcvEmailHtmlMany } from '../../helpers/html-fixtures.js';
import { makeStage1Partial } from '../../helpers/test-builders.js';
import {
  mockJobLifecyclePort,
  mockExtractionQueuePort,
  mockParsePort,
  mockRoutingPort,
  buildTestDaemonContainer,
} from '../../helpers/test-container.js';

describe('Path c3 unit — error sagas — parse-failure → PARSE_FAILED, route-failure → ROUTE_FAILED → next valid recovers (mocked test-ioc)', () => {
  let ingestor: IngestorPort;
  let storage: ReturnType<typeof mockJobLifecyclePort>;
  let queue: ReturnType<typeof mockExtractionQueuePort>;
  let parsePort: ReturnType<typeof mockParsePort>;
  let routingPort: ReturnType<typeof mockRoutingPort>;

  beforeEach(async () => {
    storage = mockJobLifecyclePort();
    queue = mockExtractionQueuePort();
    parsePort = mockParsePort();
    routingPort = mockRoutingPort();
    const mockedDaemon = await buildTestDaemonContainer(
      { ns: 'unit-path-c3' },
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
    ingestor = mockedDaemon.apps.ingest;
  });

  describe('(a) parse-failure saga — S2 → PARSE_FAILED', () => {
    it('GIVEN an S2 full-parse job with unparsable HTML WHEN an ingest signal is processed THEN emits PARSE_FAILED and the job stays ENRICHING (S2+S4) · path c3', async () => {
      storage.findById.mockResolvedValue(makeStage1Partial({ _id: 'parse-bad' }));
      await ingestor.processIngest(
        JobSource.BROWSER_AUTO,
        JobStage.FULL_PARSED,
        nonJobHtml(),
        'parse-bad'
      );
      expect(parsePort.emitFailed).toHaveBeenCalledWith(
        'parse-bad',
        expect.objectContaining({ stage: JobStage.FULL_PARSED })
      );
      expect(storage.upsert).not.toHaveBeenCalled();
    });

    it('GIVEN an empty FULL_PARSED payload WHEN a manual ingest signal is processed THEN emits PARSE_FAILED with an Empty HTML payload reason (S2+S4) · path c3', async () => {
      await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, '', 'empty-1');
      expect(parsePort.emitFailed).toHaveBeenCalledWith(
        'empty-1',
        expect.objectContaining({ error: 'Empty HTML payload' })
      );
      expect(storage.upsert).not.toHaveBeenCalled();
    });
  });

  describe('(b) route-failure saga — S3 → ROUTE_FAILED', () => {
    it('GIVEN a resolution on a missing job WHEN a queue resolution is applied THEN 5 findById probes then ROUTE_FAILED is emitted (S4) · path c3', async () => {
      storage.findById.mockResolvedValue(null);
      await ingestor.processResolution('missing-job', 'queue');
      expect(storage.findById).toHaveBeenCalledTimes(5);
      expect(routingPort.emitRouteFailed).toHaveBeenCalledWith(
        'missing-job',
        'No existing job lifecycle found'
      );
      expect(routingPort.emitJobQueued).not.toHaveBeenCalled();
    });

    it('GIVEN an ENRICHED job WHEN a resolution write fails THEN ROUTE_FAILED is emitted with the propagating reason (S4) · path c3', async () => {
      storage.findById.mockResolvedValue(
        makeStage1Partial({ _id: 'route-bad', status: JobStatus.ENRICHED })
      );
      storage.updateStage.mockRejectedValue(new Error('mongo down'));
      await ingestor.processResolution('route-bad', 'queue');
      expect(routingPort.emitRouteFailed).toHaveBeenCalledWith('route-bad', 'mongo down');
      expect(routingPort.emitJobQueued).not.toHaveBeenCalled();
    });
  });

  describe('(c) error propagation', () => {
    it('GIVEN a non-duplicate upsert failure WHEN an S2 ingest signal is processed THEN the error propagates instead of being swallowed (S2+S4) · path c3', async () => {
      storage.upsert.mockRejectedValueOnce(Object.assign(new Error('Disk full'), { code: 9000 }));
      await expect(
        ingestor.processIngest(
          JobSource.MANUAL,
          JobStage.FULL_PARSED,
          topcvDetailHtml('Software Engineer', 'ACME'),
          undefined
        )
      ).rejects.toThrow('Disk full');
    });

    it('GIVEN a duplicate role+company upsert failure WHEN an S1 ingest signal is processed THEN the duplicate is skipped via trash without throwing (S1+S4) · path c3', async () => {
      storage.upsert.mockRejectedValue({ code: 11000 });
      await ingestor.processIngest(
        JobSource.BROWSER_AUTO,
        JobStage.PARTIAL_PARSED,
        topcvEmailHtmlMany([{ role: 'Junior Software Engineer', company: 'Junior Co' }]),
        undefined,
        { messageId: 'dup-msg' }
      );
      expect(routingPort.emitJobTrashed).toHaveBeenCalled();
    });
  });

  describe('(d) ring closure — S4 → S1 recovery', () => {
    it('GIVEN a completed S2 parse-failure saga WHEN a fresh valid S1 follows THEN the next job persists and emits GENERATED (s4→s1→s2) · path c3', async () => {
      await ingestor.processIngest(
        JobSource.BROWSER_AUTO,
        JobStage.FULL_PARSED,
        nonJobHtml(),
        'bad-1'
      );
      expect(parsePort.emitFailed).toHaveBeenCalled();

      await ingestor.processIngest(
        JobSource.BROWSER_AUTO,
        JobStage.PARTIAL_PARSED,
        topcvEmailHtmlMany([{ role: 'Junior Software Engineer', company: 'Junior Co' }]),
        undefined,
        { messageId: 'recover-msg' }
      );
      expect(parsePort.emitGenerated).toHaveBeenCalled();
      expect(storage.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ stage: JobStage.PARTIAL_PARSED })
      );
    });
  });
});
