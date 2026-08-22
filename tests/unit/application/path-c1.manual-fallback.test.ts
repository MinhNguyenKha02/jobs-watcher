/*
 * Path c1 (unit, mocked test-ioc) — manual fallback ring:
 *   partial HTML → GENERATED → deep-parse enrichment (signal2a/signal2b) → [j]/[d] resolution → next pick.
 * Every `it` is GIVEN/WHEN/THEN with an S1–S4 checkpoint tag and `· path c1`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { IngestorPort } from '../../../src/application/ports/inbound/ingestor.port.js';
import { JobStage, JobStatus, JobSource } from '../../../src/domain/types/job-lifecycle.js';
import { topcvEmailHtmlMany, topcvDetailHtml } from '../../helpers/html-fixtures.js';
import { makeStage1Partial } from '../../helpers/test-builders.js';
import {
  mockJobLifecyclePort,
  mockExtractionQueuePort,
  mockParsePort,
  mockRoutingPort,
  buildTestDaemonContainer,
} from '../../helpers/test-container.js';

/** TopCV email alert (no url) — retained Signal-1 input for the manual-fallback ring. */
const topcvEmail = () =>
  topcvEmailHtmlMany([{ role: 'Junior Software Engineer', company: 'Junior Co' }]);

/** TopCV detail page — the deep-parse (signal2) input. */
const topcvDetail = () => topcvDetailHtml('Junior Software Engineer', 'Junior Co');

describe('Path c1 unit — manual fallback — partial HTML → deep parse → [j]/[d] → next (mocked test-ioc)', () => {
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
      { ns: 'unit-path-c1' },
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

  describe('(a) S1 partial ingest — BROWSER_AUTO PARTIAL_PARSED without url', () => {
    it.each(['msg-001', 'nourl-msg'] as const)(
      'GIVEN an S1 partial email without a job url (messageId %s) WHEN an ingest signal is processed THEN persists S1 partial and emits GENERATED without enqueueing (S1) · path c1',
      async (messageId) => {
        await ingestor.processIngest(
          JobSource.BROWSER_AUTO,
          JobStage.PARTIAL_PARSED,
          topcvEmail(),
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

    it('GIVEN an S1 partial email WHEN the job filter rejects the role THEN trashes without persisting (S1) · path c1', async () => {
      const html = topcvEmailHtmlMany([{ role: 'Marketing Manager', company: 'ACME Corp' }]);
      await ingestor.processIngest(
        JobSource.BROWSER_AUTO,
        JobStage.PARTIAL_PARSED,
        html,
        undefined,
        { messageId: 'reject-msg' }
      );
      expect(routingPort.emitJobTrashed).toHaveBeenCalled();
      expect(storage.upsert).not.toHaveBeenCalled();
      expect(parsePort.emitGenerated).not.toHaveBeenCalled();
    });

    it('GIVEN an S1 email with the real-alert meta block (location/salary/deadline) WHEN an ingest signal is processed THEN the persisted doc carries all s1 fields — email→job[]→upsert full-field flow (S1) · path c1', async () => {
      await ingestor.processIngest(
        JobSource.BROWSER_AUTO,
        JobStage.PARTIAL_PARSED,
        topcvEmailHtmlMany([{ role: 'Backend Developer', company: 'MetaFlow Co' }], {
          location: 'Đà Nẵng',
          salary: '12.5 - 19.5 triệu',
          deadlineDays: 29,
        }),
        undefined,
        { messageId: 'meta-flow-msg' }
      );
      expect(storage.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          role: 'Backend Developer',
          company: 'MetaFlow Co',
          location: 'Đà Nẵng',
          salary: '12.5 - 19.5 triệu',
          deadline: expect.stringContaining('29'),
          stage: JobStage.PARTIAL_PARSED,
        })
      );
      expect(parsePort.emitGenerated).toHaveBeenCalled();
    });
  });

  describe('(b) S2 manual deep-parse enrichment', () => {
    it('GIVEN an existing S1 partial job WHEN a signal2a manual FULL_PARSED ingest is processed THEN preserves s1 fields with details=htmlToText(html), FULL_PARSED/ENRICHED, emits completed (S2) · path c1', async () => {
      storage.findById.mockResolvedValue(makeStage1Partial({ _id: 'manual-job' }));
      await ingestor.processIngest(
        JobSource.MANUAL,
        JobStage.FULL_PARSED,
        topcvDetail(),
        'manual-job'
      );
      expect(storage.findById).toHaveBeenCalledWith('manual-job');
      expect(storage.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          _id: 'manual-job',
          stage: JobStage.FULL_PARSED,
          source: JobSource.MANUAL,
        })
      );
      expect(parsePort.emitCompleted).toHaveBeenCalled();
    });

    it('GIVEN a signal2a manual FULL_PARSED ingest on an already-routed job WHEN the job is QUEUED THEN the enrichment is skipped (B2 guard) (S2) · path c1', async () => {
      storage.findById.mockResolvedValue(
        makeStage1Partial({ _id: 'routed-job', status: JobStatus.QUEUED })
      );
      await ingestor.processIngest(
        JobSource.MANUAL,
        JobStage.FULL_PARSED,
        topcvDetail(),
        'routed-job'
      );
      expect(storage.findById).toHaveBeenCalledWith('routed-job');
      expect(storage.upsert).not.toHaveBeenCalled();
      expect(parsePort.emitCompleted).not.toHaveBeenCalled();
    });
  });

  describe('(c) S3 operator resolution — [j] queue with [j] guard', () => {
    it('GIVEN an S1 partial job with status ENRICHING WHEN a queue resolution is applied THEN the [j] guard rejects it — no state change, no QUEUED event (S1+S4) · path c1', async () => {
      storage.findById.mockResolvedValue(
        makeStage1Partial({ _id: 'guard-job', status: JobStatus.ENRICHING })
      );
      await ingestor.processResolution('guard-job', 'queue');
      expect(storage.updateStage).not.toHaveBeenCalled();
      expect(routingPort.emitJobQueued).not.toHaveBeenCalled();
    });

    it('GIVEN an S2 FULL_PARSED job with status ENRICHED WHEN a queue resolution is applied THEN updates stage to QUEUED and emits QUEUED (S2+S3) · path c1', async () => {
      storage.findById.mockResolvedValue(
        makeStage1Partial({ _id: 'enriched-job', status: JobStatus.ENRICHED })
      );
      await ingestor.processResolution('enriched-job', 'queue');
      expect(storage.updateStage).toHaveBeenCalledWith(
        'enriched-job',
        JobStage.FULL_PARSED,
        JobStatus.QUEUED
      );
      expect(routingPort.emitJobQueued).toHaveBeenCalledWith(
        'enriched-job',
        expect.objectContaining({ source: JobSource.MANUAL })
      );
      expect(routingPort.emitRouteFailed).not.toHaveBeenCalled();
    });
  });

  describe('(d) S3 operator resolution — [d] trash', () => {
    it('GIVEN an S1 partial job WHEN a trash resolution is applied THEN updates stage to TRASHED and emits TRASHED regardless of enrichment status (S1+S3) · path c1', async () => {
      storage.findById.mockResolvedValue(
        makeStage1Partial({ _id: 'trash-job', status: JobStatus.ENRICHING })
      );
      await ingestor.processResolution('trash-job', 'trash');
      expect(storage.updateStage).toHaveBeenCalledWith(
        'trash-job',
        JobStage.FULL_PARSED,
        JobStatus.TRASHED
      );
      expect(routingPort.emitJobTrashed).toHaveBeenCalledWith('trash-job', 'operator:trash');
    });

    it('GIVEN a queued job WHEN a trash resolution is applied THEN the [d] guard rejects it — terminal state protected (S3) · path c1', async () => {
      storage.findById.mockResolvedValue(
        makeStage1Partial({ _id: 'queued-job', status: JobStatus.QUEUED })
      );
      await ingestor.processResolution('queued-job', 'trash');
      expect(storage.updateStage).not.toHaveBeenCalled();
      expect(routingPort.emitJobTrashed).not.toHaveBeenCalled();
    });
  });

  describe('(e) ring closure — next pick', () => {
    it('GIVEN a completed S1→S2→[j] queue cycle WHEN a fresh S1 partial follows THEN the next job persists and emits GENERATED (s1→s2→s3→next pick) · path c1', async () => {
      storage.findById.mockResolvedValue(
        makeStage1Partial({ _id: 'first-job', status: JobStatus.ENRICHED })
      );
      await ingestor.processResolution('first-job', 'queue');
      expect(routingPort.emitJobQueued).toHaveBeenCalledWith(
        'first-job',
        expect.objectContaining({ source: JobSource.MANUAL })
      );

      await ingestor.processIngest(
        JobSource.BROWSER_AUTO,
        JobStage.PARTIAL_PARSED,
        topcvEmail(),
        undefined,
        { messageId: 'next-msg' }
      );
      expect(parsePort.emitGenerated).toHaveBeenCalled();
      expect(routingPort.emitRouteFailed).not.toHaveBeenCalled();
    });
  });
});
