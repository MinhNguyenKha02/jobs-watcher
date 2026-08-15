/*
 * Path c4 (unit, mocked test-ioc) — direct [i] clipboard ring:
 *   clipboard ingest (signal2bManual) → clip-* FULL_PARSED → [j]/[d] resolution → empty ipc[direct] next cycle,
 *   owning dedupe / latest-wins / negative-clip cells.
 * Every `it` is GIVEN/WHEN/THEN with an S2–S4 checkpoint tag and `· path c4`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { IngestorPort } from '../../../src/application/ports/inbound/ingestor.port.js';
import { JobStage, JobStatus, JobSource } from '../../../src/domain/types/job-lifecycle.js';
import { nonJobHtml, topcvDetailHtml } from '../../helpers/html-fixtures.js';
import { makeStage1Partial } from '../../helpers/test-builders.js';
import {
  mockJobLifecyclePort,
  mockExtractionQueuePort,
  mockParsePort,
  mockRoutingPort,
  buildTestDaemonContainer,
} from '../../helpers/test-container.js';

/** TopCV detail page — consumed by HtmlJobParser for signal2b (clipboard direct ingest). */
const topcvDetail = () => topcvDetailHtml('Junior Software Engineer', 'Junior Co');

describe('Path c4 unit — direct [i] clipboard → clip-* doc → [j]/[d] → empty ipc[direct] next cycle (mocked test-ioc)', () => {
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
      { ns: 'unit-path-c4' },
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

  describe('(a) direct [i] clipboard ingest — signal2bManual', () => {
    it('GIVEN a clipboard detail-page HTML WHEN a MANUAL FULL_PARSED ingest without jobLifecycleId is processed THEN persists a clip-* FULL_PARSED doc and emits completed (S2) · path c4', async () => {
      await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, topcvDetail());
      expect(storage.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          stage: JobStage.FULL_PARSED,
          status: JobStatus.ENRICHED,
          source: JobSource.MANUAL,
          _id: expect.stringMatching(/^clip-/),
        })
      );
      expect(parsePort.emitCompleted).toHaveBeenCalled();
    });

    it('GIVEN a clipboard detail-page HTML WHEN a duplicate role+company is upserted THEN the duplicate is skipped without emitting completed (dedupe, S2) · path c4', async () => {
      storage.upsert.mockRejectedValueOnce({ code: 11000 });
      await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, topcvDetail());
      expect(storage.upsert).toHaveBeenCalled();
      expect(parsePort.emitCompleted).not.toHaveBeenCalled();
    });

    it('GIVEN two clipboard ingests with different companies WHEN each is processed THEN each creates its own clip-* doc (latest-wins, S2) · path c4', async () => {
      const a = topcvDetailHtml('Junior Software Engineer', 'First Co');
      const b = topcvDetailHtml('Junior Software Engineer', 'Second Co');
      await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, a);
      await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, b);
      expect(storage.upsert).toHaveBeenCalledTimes(2);
      expect(parsePort.emitCompleted).toHaveBeenCalledTimes(2);
    });
  });

  describe('(b) negative clipboard — S2 → PARSE_FAILED', () => {
    it('GIVEN an unparsable clipboard payload WHEN a MANUAL FULL_PARSED ingest is processed THEN emits PARSE_FAILED and creates no doc (S2+S4) · path c4', async () => {
      await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, nonJobHtml());
      expect(parsePort.emitFailed).toHaveBeenCalledWith(
        expect.stringMatching(/^clip-/),
        expect.objectContaining({ stage: JobStage.FULL_PARSED })
      );
      expect(storage.upsert).not.toHaveBeenCalled();
    });

    it('GIVEN an empty clipboard payload WHEN a MANUAL FULL_PARSED ingest is processed THEN emits PARSE_FAILED and creates no doc (S2+S4) · path c4', async () => {
      await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, '');
      expect(parsePort.emitFailed).toHaveBeenCalledWith(
        expect.stringMatching(/^clip-/),
        expect.objectContaining({ error: 'HTML parse failed' })
      );
      expect(storage.upsert).not.toHaveBeenCalled();
    });
  });

  describe('(c) [j]/[d] resolution guards on the direct ring', () => {
    it('GIVEN a clip-* job that is not ENRICHED WHEN a queue resolution is applied THEN the [j] guard rejects it — no QUEUED event (S3+S4) · path c4', async () => {
      storage.findById.mockResolvedValue(
        makeStage1Partial({ _id: 'clip-guard', status: JobStatus.ENRICHING })
      );
      await ingestor.processResolution('clip-guard', 'queue');
      expect(storage.updateStage).not.toHaveBeenCalled();
      expect(routingPort.emitJobQueued).not.toHaveBeenCalled();
    });

    it('GIVEN a QUEUED clip-* job WHEN a trash resolution is applied THEN the [d] guard rejects the terminal state (S3+S4) · path c4', async () => {
      storage.findById.mockResolvedValue(
        makeStage1Partial({ _id: 'clip-queued', status: JobStatus.QUEUED })
      );
      await ingestor.processResolution('clip-queued', 'trash');
      expect(storage.updateStage).not.toHaveBeenCalled();
      expect(routingPort.emitJobTrashed).not.toHaveBeenCalled();
    });
  });

  describe('(d) direct [i] resolution — S2 → S3', () => {
    it('GIVEN an ENRICHED clip-* job WHEN a queue resolution is applied THEN updates stage to QUEUED and emits QUEUED (S2+S3) · path c4', async () => {
      storage.findById.mockResolvedValue(
        makeStage1Partial({ _id: 'clip-ok', status: JobStatus.ENRICHED })
      );
      await ingestor.processResolution('clip-ok', 'queue');
      expect(storage.updateStage).toHaveBeenCalledWith(
        'clip-ok',
        JobStage.FULL_PARSED,
        JobStatus.QUEUED
      );
      expect(routingPort.emitJobQueued).toHaveBeenCalledWith(
        'clip-ok',
        expect.objectContaining({ source: JobSource.MANUAL })
      );
    });

    it('GIVEN an ENRICHED clip-* job WHEN a trash resolution is applied THEN updates stage to TRASHED and emits TRASHED (S2+S3) · path c4', async () => {
      storage.findById.mockResolvedValue(
        makeStage1Partial({ _id: 'clip-trash', status: JobStatus.ENRICHED })
      );
      await ingestor.processResolution('clip-trash', 'trash');
      expect(storage.updateStage).toHaveBeenCalledWith(
        'clip-trash',
        JobStage.FULL_PARSED,
        JobStatus.TRASHED
      );
      expect(routingPort.emitJobTrashed).toHaveBeenCalledWith('clip-trash', 'operator:trash');
    });
  });

  describe('(e) ring closure — empty ipc[direct]', () => {
    it('GIVEN a completed clip-* → [j] → QUEUED cycle WHEN a fresh direct clipboard ingest follows THEN the next job creates a fresh clip-* doc and the ipc seam stays empty (s2b→s3→s2b→s3→empty ipc[direct]) · path c4', async () => {
      storage.findById.mockResolvedValue(
        makeStage1Partial({ _id: 'clip-first', status: JobStatus.ENRICHED })
      );
      await ingestor.processResolution('clip-first', 'queue');
      expect(routingPort.emitJobQueued).toHaveBeenCalled();

      await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, topcvDetail());
      expect(storage.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ _id: expect.stringMatching(/^clip-/) })
      );
      expect(parsePort.emitCompleted).toHaveBeenCalled();
      expect(queue.enqueue).not.toHaveBeenCalled();
    });
  });
});
