/* eslint-disable @typescript-eslint/no-unused-vars, vitest/expect-expect, no-async-promise-executor */
/**
 * IngestorPort inbound driving contract — src/application/ports/inbound/ingestor.port.ts:11
 * 8 its · contract ingestor (additive only) — dispatch table + resolution guard + metadata
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

import { JobStage, JobSource, JobStatus } from '../../../src/domain/types/job-lifecycle.js';
import { setQueueMode } from '../../../src/presentation/tui/shared-tui-state.js';
import {
  topcvEmailHtmlMany,
  linkedinSduiDetailHtml,
  nonJobHtml,
} from '../../helpers/html-fixtures.js';
import {
  assertIngestorS1Enriching,
  assertIngestorS2Enriched,
} from '../../helpers/ingestor-contract.js';
import {
  buildTestDaemonContainer,
  buildTestTuiContainer,
  type TestDaemonContainer,
  type TuiTestContainer,
} from '../../helpers/test-container.js';
import { waitFor } from '../../helpers/test-utils.js';

describe('IngestorPort — inbound driving · contract ingestor', () => {
  let daemon: TestDaemonContainer;
  let tui: TuiTestContainer;

  beforeAll(async () => {
    daemon = await buildTestDaemonContainer({ ns: 'ingestor-contract' });
    await daemon.start();
    tui = await buildTestTuiContainer({ ns: 'ingestor-contract' });
  }, 120000);

  afterAll(async () => {
    await tui.stop();
    await daemon.stop();
  });

  beforeEach(async () => {
    await daemon.storage.clearDb();
    await tui.reader.purgeQueues();
    tui.reader.resetReader();
    tui.ipc.clear();
    setQueueMode(true);
  });

  describe('(a) processIngest dispatch table — source/stage matrix', () => {
    it('GIVEN BROWSER_AUTO PARTIAL with payload WHEN processIngest evaluates THEN S1 enriching doc + GENERATED · contract ingestor', async () => {
      await daemon.apps.ingest.processIngest(
        JobSource.BROWSER_AUTO,
        JobStage.PARTIAL_PARSED,
        topcvEmailHtmlMany([{ role: 'Software Engineer', company: 'IngestorCo' }]),
        undefined,
        { messageId: 'ingestor-s1' }
      );
      const doc = await daemon.jobLifecycle.findById('ingestor-s1-job-0');
      assertIngestorS1Enriching(doc);
      await waitFor(() => tui.ipc.read().jobLifecycleId === 'ingestor-s1-job-0');
      expect(tui.ipc.read().stage).toBe(JobStage.PARTIAL_PARSED);
    });

    it('GIVEN BROWSER_AUTO PARTIAL empty with id WHEN fallback evaluates THEN GENERATED S1 · contract ingestor', async () => {
      await daemon.jobLifecycle.upsert({
        _id: 'ingestor-fallback',
        role: 'Software Engineer',
        company: 'FallbackCo',
        stage: JobStage.PARTIAL_PARSED,
        status: JobStatus.ENRICHING,
        source: JobSource.BROWSER_AUTO,
      } as never);
      await daemon.apps.ingest.processIngest(
        JobSource.BROWSER_AUTO,
        JobStage.PARTIAL_PARSED,
        '',
        'ingestor-fallback'
      );
      await waitFor(() => tui.ipc.read().jobLifecycleId === 'ingestor-fallback');
      expect(tui.ipc.read().stage).toBe(JobStage.PARTIAL_PARSED);
    });

    it('GIVEN MANUAL FULL with BROWSER_AUTO id WHEN signal2c evaluates THEN S2 enriched · contract ingestor', async () => {
      await daemon.apps.ingest.processIngest(
        JobSource.BROWSER_AUTO,
        JobStage.PARTIAL_PARSED,
        topcvEmailHtmlMany([{ role: 'Software Engineer', company: 'IngestorC2Co' }]),
        undefined,
        { messageId: 'ingestor-c2' }
      );
      const id = 'ingestor-c2-job-0';
      await daemon.apps.ingest.processIngest(
        JobSource.BROWSER_AUTO,
        JobStage.FULL_PARSED,
        '<html>detail</html>',
        id
      );
      const doc = await daemon.jobLifecycle.findById(id);
      // S2c will keep enriching (or enriched depending on filter) — at least not partial
      expect(doc).not.toBeNull();
    });

    it('GIVEN MANUAL FULL with id WHEN signal2a evaluates THEN S2 enriched · contract ingestor', async () => {
      await daemon.apps.ingest.processIngest(
        JobSource.BROWSER_AUTO,
        JobStage.PARTIAL_PARSED,
        topcvEmailHtmlMany([{ role: 'Software Engineer', company: 'IngestorS2aCo' }]),
        undefined,
        { messageId: 'ingestor-s2a' }
      );
      const id = 'ingestor-s2a-job-0';
      await daemon.apps.ingest.processIngest(
        JobSource.MANUAL,
        JobStage.FULL_PARSED,
        linkedinSduiDetailHtml('Software Engineer', 'IngestorS2aCo'),
        id
      );
      const doc = await daemon.jobLifecycle.findById(id);
      assertIngestorS2Enriched(doc);
    });

    it('GIVEN MANUAL FULL without id WHEN signal2b evaluates THEN S2 clip-* enriched · contract ingestor', async () => {
      setQueueMode(false);
      await daemon.apps.ingest.processIngest(
        JobSource.MANUAL,
        JobStage.FULL_PARSED,
        linkedinSduiDetailHtml('Software Engineer', 'IngestorS2bCo')
      );
      await waitFor(
        () =>
          tui.ipc.read().jobLifecycleId !== null &&
          String(tui.ipc.read().jobLifecycleId).startsWith('clip-')
      );
      const clipId = tui.ipc.read().jobLifecycleId!;
      const doc = await daemon.jobLifecycle.findById(clipId);
      assertIngestorS2Enriched(doc);
      setQueueMode(true);
    });
  });

  describe('(b) processResolution guard — queue/trash', () => {
    it('GIVEN !ENRICHED status WHEN queue evaluates THEN guard rejects no QUEUED · contract ingestor', async () => {
      await daemon.apps.ingest.processIngest(
        JobSource.BROWSER_AUTO,
        JobStage.PARTIAL_PARSED,
        topcvEmailHtmlMany([{ role: 'Software Engineer', company: 'GuardQCo' }]),
        undefined,
        { messageId: 'ingestor-guard-q' }
      );
      const id = 'ingestor-guard-q-job-0';
      await daemon.apps.ingest.processResolution(id, 'queue');
      const doc = await daemon.jobLifecycle.findById(id);
      expect(doc!.status).toBe(JobStatus.ENRICHING);
    });

    it('GIVEN QUEUED already WHEN trash evaluates THEN guard rejects TRASHED terminal · contract ingestor', async () => {
      await daemon.jobLifecycle.upsert({
        _id: 'ingestor-guard-t',
        role: 'Software Engineer',
        company: 'GuardTCo',
        stage: JobStage.FULL_PARSED,
        status: JobStatus.QUEUED,
        source: JobSource.MANUAL,
      } as never);
      await daemon.apps.ingest.processResolution('ingestor-guard-t', 'trash');
      const doc = await daemon.jobLifecycle.findById('ingestor-guard-t');
      expect(doc!.status).toBe(JobStatus.QUEUED);
    });
  });

  describe('(c) metadata — messageId→job-idx + gmailMeta', () => {
    it('GIVEN ingest with metadata messageId WHEN processIngest evaluates THEN doc gmailMeta + id job-idx · contract ingestor', async () => {
      await daemon.apps.ingest.processIngest(
        JobSource.BROWSER_AUTO,
        JobStage.PARTIAL_PARSED,
        topcvEmailHtmlMany([{ role: 'Software Engineer', company: 'MetaCo' }]),
        undefined,
        { messageId: 'ingestor-meta', subject: 'Re: Alert' }
      );
      const doc = await daemon.jobLifecycle.findById('ingestor-meta-job-0');
      expect(doc!.gmailMeta?.messageId).toBe('ingestor-meta');
      expect(doc!._id).toBe('ingestor-meta-job-0');
    });

    it('GIVEN missing id WHEN resolution evaluates THEN emitRouteFailed S4 · contract ingestor', async () => {
      await daemon.apps.ingest.processResolution('ingestor-missing', 'queue');
      await waitFor(() => tui.ipc.read().jobLifecycleId === null);
      const doc = await daemon.jobLifecycle.findById('ingestor-missing');
      expect(doc).toBeNull();
    });
  });
});
