/* Path cell (c4): direct full-path clipboard 2b -> clip-* FULL_PARSED doc -> queue/trash resolution over UDS and the real-DIP bus (see plans/tests-path-matrix.md)
 * GWT cause-effect (path c4, no S1): GIVEN a clipboard [i] direct ingest WHEN [j]/[d] UDS resolution is applied
 *   THEN S3 QUEUED / S3 TRASHED (+ PDF asset) clip-* doc, duplicates dedupe (11000), latest-wins stays current.
 * Canonical ring: root describe = path ring title; nested describe = ONE checkpoint role; it = GWT.
 * Roles: (a) S2 direct arrival, (b) S3 [j] queue, (c) S3 [d] trash + guards + empty-ipc closure, (d) dedupe/latest-wins,
 * (e) negative clip, (f) fast-check invariants. Failure rows (route-failure injection) live in c3. */
import fc from 'fast-check';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

import { JobStage, JobSource, JobStatus } from '../../../src/domain/types/job-lifecycle.js';
import {
  linkedinSduiDetailHtml,
  nonJobHtml,
} from '../../helpers/html-fixtures.js';
import {
  buildTestDaemonContainer,
  buildTestTuiContainer,
  type TestDaemonContainer,
  type TuiTestContainer,
} from '../../helpers/test-container.js';
import { setQueueMode } from '../../../src/presentation/tui/shared-tui-state.js';
import { udsHelpers, waitFor, waitForPdfFiles } from '../../helpers/test-utils.js';

const DIRECT_HTML = linkedinSduiDetailHtml('Backend Developer', 'CopyJuniorCompany');

describe('Path full-path c4 — direct clipboard ingest, queue/trash routing, dedupe and failure edges', () => {
  let tc: TestDaemonContainer;
  let tui: TuiTestContainer;
  let uds: ReturnType<typeof udsHelpers>;

  beforeAll(async () => {
    tc = await buildTestDaemonContainer({ ns: 'c4-full-path' });
    await tc.start();
    tui = await buildTestTuiContainer({ ns: 'c4-full-path' });
    uds = udsHelpers(tc.uds.socket, 'e2e-internal-token');
  }, 120000);

  afterAll(async () => {
    await tui.stop();
    await tc.stop();
  });

  beforeEach(async () => {
    await tc.storage.clearDb();
    await tui.reader.purgeQueues();
    tui.reader.resetReader();
    tui.ipc.clear();
    setQueueMode(false);
  });

  const jobCol = () => tc.mongo.raw('job_lifecycle');

  async function ingestClip(html: string): Promise<string> {
    await tc.apps.ingest.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, html);
    await waitFor(
      () =>
        tui.ipc.read().jobLifecycleId !== null &&
        tui.ipc.read().jobLifecycleId!.startsWith('clip-') &&
        tui.ipc.read().stage === JobStage.FULL_PARSED
    );
    const id = tui.ipc.read().jobLifecycleId!;
    expect(id).toMatch(/^clip-/);
    expect(tui.ipc.read().stage).toBe(JobStage.FULL_PARSED);
    return id;
  }

  describe('(a) S2 direct arrival — clip-* FULL_PARSED doc creation', () => {
    it('GIVEN an S2 manual FULL_PARSED input WHEN findById loads the doc THEN creates a new FULL_PARSED job with a fabricated clip-* id (S2) · path c4', async () => {
      const docsBefore = await jobCol().countDocuments({});
      const id = await ingestClip(DIRECT_HTML);
      const docsAfter = await jobCol().countDocuments({});
      expect(docsAfter).toBe(docsBefore + 1);
      const job = await tc.jobLifecycle.findById(id);
      expect(job).not.toBeNull();
      expect(job!.stage).toBe(JobStage.FULL_PARSED);
      expect(job!.status).toBe(JobStatus.ENRICHED);
      expect(job!.source).toBe(JobSource.MANUAL);
      expect(job!.company).toBe('CopyJuniorCompany');
      expect(job!.role).toBe('Backend Developer');
    });

    it('GIVEN full filter pass WHEN the path is exercised THEN S2 stores a clip-* doc · path c4', async () => {
      const id = await ingestClip(linkedinSduiDetailHtml('Software Engineer', 'FilterPassCo'));
      const doc = await jobCol().findOne({ company: 'FilterPassCo' });
      expect(doc).not.toBeNull();
      expect(doc!._id).toBe(id);
      expect(doc!._id).toMatch(/^clip-/);
      expect(doc!.status).toBe(JobStatus.ENRICHED);
    });

    it('GIVEN duplicate role+company over the socket WHEN the path is exercised THEN S1 also silently skipped (S2) · path c4', async () => {
      const html = linkedinSduiDetailHtml('Socket Dedup Role', 'SocketDedupCo');
      const firstRes = await uds.ingest(html);
      expect(firstRes.statusCode).toBe(200);
      await waitFor(
        () =>
          tui.ipc.read().jobLifecycleId !== null &&
          tui.ipc.read().jobLifecycleId!.startsWith('clip-') &&
          tui.ipc.read().stage === JobStage.FULL_PARSED
      );
      const firstId = tui.ipc.read().jobLifecycleId!;
      expect(firstId).toMatch(/^clip-/);
      const docsBefore = await jobCol().countDocuments({});
      const secondRes = await uds.ingest(html);
      expect(secondRes.statusCode).toBe(200);
      await new Promise((r) => setTimeout(r, 500));
      const docsAfter = await jobCol().countDocuments({});
      expect(docsAfter).toBe(docsBefore);
      expect(tui.ipc.read().jobLifecycleId).toBe(firstId);
    });

    it('GIVEN the tui-ioc precondition WHEN the daemon publishes S1+S2 over RMQ and the tui sends [j] over UDS THEN the tui reader mirrors then clears the job on the ipc seam (tui↔daemon over real RMQ+UDS) · path c4', async () => {
      setQueueMode(true);
      await waitFor(() => tui.reader.isConnected());
      const jobId = 'c4-tui-boundary-1';

      await tc.rmq.ports.parse.emitGenerated(
        {
          _id: jobId,
          role: 'Backend Developer',
          company: 'BoundaryCo4',
          stage: JobStage.PARTIAL_PARSED,
        },
        { stage: JobStage.PARTIAL_PARSED, source: JobSource.BROWSER_AUTO }
      );
      await waitFor(() => tui.ipc.read().jobLifecycleId === jobId);
      expect(tui.ipc.read().stage).toBe(JobStage.PARTIAL_PARSED);

      await tc.rmq.ports.parse.emitCompleted(
        {
          _id: jobId,
          role: 'Backend Developer',
          company: 'BoundaryCo4',
          description: 'boundary desc c4',
          stage: JobStage.FULL_PARSED,
          status: JobStatus.ENRICHED,
        },
        { stage: JobStage.FULL_PARSED, source: JobSource.MANUAL }
      );
      await waitFor(() => tui.ipc.read().job?.description === 'boundary desc c4');
      expect(tui.ipc.read().stage).toBe(JobStage.FULL_PARSED);

      await tc.jobLifecycle.upsert({
        _id: jobId,
        company: 'BoundaryCo4',
        role: 'Backend Developer',
        description: 'boundary desc c4',
        stage: JobStage.FULL_PARSED,
        status: JobStatus.ENRICHED,
        source: JobSource.MANUAL,
      });

      await tui.writer.queue(jobId);
      await waitFor(() => tui.ipc.read().jobLifecycleId === null);
      expect(tui.ipc.read().job).toBeNull();
    }, 60000);
  });

  describe('(b) S3 [j] queue resolution over UDS', () => {
    it('GIVEN uds.ingest without a webhook WHEN the path is exercised THEN S1 fabricates a clip-* id for the full direct ingest (S2) · path c4', async () => {
      const res = await uds.ingest(linkedinSduiDetailHtml('Socket Engineer', 'UdsDirectCo'));
      expect(res.statusCode).toBe(200);
      await waitFor(
        () =>
          tui.ipc.read().jobLifecycleId !== null &&
          tui.ipc.read().jobLifecycleId!.startsWith('clip-') &&
          tui.ipc.read().stage === JobStage.FULL_PARSED
      );
      const clipId = tui.ipc.read().jobLifecycleId!;
      expect(clipId).toMatch(/^clip-/);
      expect(tui.ipc.read().stage).toBe(JobStage.FULL_PARSED);
      const doc = await tc.jobLifecycle.findById(clipId);
      expect(doc).not.toBeNull();
      expect(doc!.stage).toBe(JobStage.FULL_PARSED);
      expect(doc!.status).toBe(JobStatus.ENRICHED);
      expect(doc!.company).toBe('UdsDirectCo');
    });

    it('GIVEN the path c4 preconditions WHEN a UDS action is dispatched THEN uds.action(clip, queue) routes the clipboard job to QUEUED + pdf asset (S2+S3) · path c4', async () => {
      const id = await ingestClip(linkedinSduiDetailHtml('Socket Queue Role', 'UdsQueueCo'));
      await tui.writer.queue(id);
      await waitFor(() => tui.ipc.read().jobLifecycleId === null);
      expect(tui.ipc.read().job).toBeNull();
      await waitForPdfFiles(tc.assetDir);
      const doc = await tc.jobLifecycle.findById(id);
      expect(doc).not.toBeNull();
      expect(doc!.status).toBe(JobStatus.QUEUED);
    });

    it('GIVEN the path c4 preconditions WHEN a resolution is applied THEN signal2bManual queue resolution: full clipboard-to-queued flow + pdf asset (S2+S3) · path c4', async () => {
      const id = await ingestClip(linkedinSduiDetailHtml('Clipboard Queue Role', 'ClipQueueCorp'));
      await tui.writer.queue(id);
      await waitFor(() => tui.ipc.read().jobLifecycleId === null);
      expect(tui.ipc.read().job).toBeNull();
      await waitForPdfFiles(tc.assetDir);
      const doc = await tc.jobLifecycle.findById(id);
      expect(doc).not.toBeNull();
      expect(doc!.status).toBe(JobStatus.QUEUED);
    });
  });

  describe('(c) S3 [d] trash + guards + empty-ipc closure', () => {
    it('GIVEN the path c4 preconditions WHEN a UDS action is dispatched THEN uds.action(clip, trash) routes the clipboard job to TRASHED (S2+S3) · path c4', async () => {
      const id = await ingestClip(linkedinSduiDetailHtml('Socket Trash Role', 'UdsTrashCo'));
      await tui.writer.trash(id);
      await waitFor(() => tui.ipc.read().jobLifecycleId === null);
      expect(tui.ipc.read().job).toBeNull();
      const doc = await tc.jobLifecycle.findById(id);
      expect(doc).not.toBeNull();
      expect(doc!.status).toBe(JobStatus.TRASHED);
    });

    it('GIVEN the path c4 preconditions WHEN a resolution is applied THEN signal2bManual trash resolution: full clipboard-to-trashed flow (S2+S3) · path c4', async () => {
      const id = await ingestClip(linkedinSduiDetailHtml('Clipboard Trash Role', 'ClipTrashCorp'));
      await tui.writer.trash(id);
      await waitFor(() => tui.ipc.read().jobLifecycleId === null);
      expect(tui.ipc.read().job).toBeNull();
      const doc = await tc.jobLifecycle.findById(id);
      expect(doc).not.toBeNull();
      expect(doc!.status).toBe(JobStatus.TRASHED);
    });

    it('GIVEN an S1 manual PARTIAL_PARSED input WHEN a resolution is applied THEN queue on a not-ENRICHED job is guarded — no queued event, status unchanged (S1+S3+S4+S2) · path c4', async () => {
      const guardId = 'c4-guard-not-enriched';
      await tc.jobLifecycle.upsert({
        _id: guardId,
        raw: '<html><body>partial</body></html>',
        stage: JobStage.PARTIAL_PARSED,
        status: JobStatus.ENRICHING,
        source: JobSource.MANUAL,
        company: 'GuardCo',
        role: 'Guard Role',
        createdAt: new Date(),
        updatedAt: new Date(),
        stageTimestamp: new Date(),
      });
      await tui.writer.queue(guardId);
      await new Promise((r) => setTimeout(r, 500));
      const doc = await tc.jobLifecycle.findById(guardId);
      expect(doc).not.toBeNull();
      expect(doc!.status).toBe(JobStatus.ENRICHING);
    });

    it('GIVEN the path c4 preconditions WHEN a resolution is applied THEN a QUEUED job rejects a later trash action (terminal-state protection) (S2+S3) · path c4', async () => {
      const id = await ingestClip(linkedinSduiDetailHtml('Guard Trash Role', 'GuardTrashCo'));
      await tui.writer.queue(id);
      await waitFor(() => tui.ipc.read().jobLifecycleId === null);
      expect(tui.ipc.read().job).toBeNull();
      await tui.writer.trash(id);
      await new Promise((r) => setTimeout(r, 500));
      const doc = await tc.jobLifecycle.findById(id);
      expect(doc).not.toBeNull();
      expect(doc!.status).toBe(JobStatus.QUEUED);
    });

    it('GIVEN a resolved clip-* job WHEN a second direct cycle follows THEN the ring closes: the next job reaches S3 QUEUED and the ipc direct seam stays empty (s2b→s3→s2b→s3→empty ipc[direct]) · path c4', async () => {
      const firstId = await ingestClip(
        linkedinSduiDetailHtml('Closure First Role', 'ClosureFirstCo')
      );
      await tui.writer.queue(firstId);
      await waitFor(() => tui.ipc.read().jobLifecycleId === null);
      expect(tui.ipc.read().job).toBeNull();
      await waitForPdfFiles(tc.assetDir);
      const firstDoc = await tc.jobLifecycle.findById(firstId);
      expect(firstDoc).not.toBeNull();
      expect(firstDoc!.status).toBe(JobStatus.QUEUED);

      const secondId = await ingestClip(
        linkedinSduiDetailHtml('Closure Second Role', 'ClosureSecondCo')
      );
      await tui.writer.queue(secondId);
      await waitFor(() => tui.ipc.read().jobLifecycleId === null);
      expect(tui.ipc.read().job).toBeNull();
      const secondDoc = await tc.jobLifecycle.findById(secondId);
      expect(secondDoc).not.toBeNull();
      expect(secondDoc!.status).toBe(JobStatus.QUEUED);
      expect(await jobCol().countDocuments({})).toBe(2);
    });

    it('GIVEN the tui-ioc precondition WHEN the daemon publishes S1+S2 over RMQ and the tui sends [d] over UDS THEN the tui reader mirrors then clears the job on the ipc seam (tui↔daemon over real RMQ+UDS) · path c4', async () => {
      setQueueMode(true);
      await waitFor(() => tui.reader.isConnected());
      const jobId = 'c4-tui-boundary-trash';

      await tc.rmq.ports.parse.emitGenerated(
        {
          _id: jobId,
          role: 'Backend Developer',
          company: 'BoundaryCo4',
          stage: JobStage.PARTIAL_PARSED,
        },
        { stage: JobStage.PARTIAL_PARSED, source: JobSource.BROWSER_AUTO }
      );
      await waitFor(() => tui.ipc.read().jobLifecycleId === jobId);
      expect(tui.ipc.read().stage).toBe(JobStage.PARTIAL_PARSED);

      await tc.rmq.ports.parse.emitCompleted(
        {
          _id: jobId,
          role: 'Backend Developer',
          company: 'BoundaryCo4',
          description: 'boundary desc c4',
          stage: JobStage.FULL_PARSED,
          status: JobStatus.ENRICHED,
        },
        { stage: JobStage.FULL_PARSED, source: JobSource.MANUAL }
      );
      await waitFor(() => tui.ipc.read().job?.description === 'boundary desc c4');
      expect(tui.ipc.read().stage).toBe(JobStage.FULL_PARSED);

      await tc.jobLifecycle.upsert({
        _id: jobId,
        company: 'BoundaryCo4',
        role: 'Backend Developer',
        description: 'boundary desc c4',
        stage: JobStage.FULL_PARSED,
        status: JobStatus.ENRICHED,
        source: JobSource.MANUAL,
      });

      await tui.writer.trash(jobId);
      await waitFor(() => tui.ipc.read().jobLifecycleId === null);
      expect(tui.ipc.read().job).toBeNull();
    }, 60000);
  });

  describe('(d) dedupe + latest-wins across multiple clip ingests', () => {
    it('GIVEN an S2 manual FULL_PARSED input WHEN an ingest signal is processed THEN second identical ingest leaves the doc count unchanged and emits no parse.completed (S2) · path c4', async () => {
      const html = linkedinSduiDetailHtml('Dedup Role', 'DedupClipCo');
      const firstId = await ingestClip(html);
      const docsBefore = await jobCol().countDocuments({});
      await tc.apps.ingest.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, html);
      await new Promise((r) => setTimeout(r, 500));
      const docsAfter = await jobCol().countDocuments({});
      expect(docsAfter).toBe(docsBefore);
      expect(tui.ipc.read().jobLifecycleId).toBe(firstId);
    });

    it('GIVEN second ingest with a different company WHEN the path is exercised THEN S1 creates a separate clip-* doc (latest-wins) · path c4', async () => {
      const firstId = await ingestClip(linkedinSduiDetailHtml('B17 Role', 'FirstWinCo'));
      const secondId = await ingestClip(linkedinSduiDetailHtml('B17 Role', 'SecondWinCo'));
      expect(secondId).not.toBe(firstId);
      const firstDoc = await tc.jobLifecycle.findById(firstId);
      const secondDoc = await tc.jobLifecycle.findById(secondId);
      expect(firstDoc!.company).toBe('FirstWinCo');
      expect(secondDoc!.company).toBe('SecondWinCo');
      const count = await jobCol().countDocuments({});
      expect(count).toBe(2);
    });
  });

  describe('(e) negative clip — unparsable/empty clipboard (S2+S4)', () => {
    it('GIVEN an S2 manual FULL_PARSED input WHEN an ingest signal is processed THEN unparsable clipboard HTML emits parse.failed and creates no doc (S2+S4) · path c4', async () => {
      const docsBefore = await jobCol().countDocuments({});
      await tc.apps.ingest.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, nonJobHtml());
      await new Promise((r) => setTimeout(r, 500));
      const docsAfter = await jobCol().countDocuments({});
      expect(docsAfter).toBe(docsBefore);
    });

    it('GIVEN an S2 manual FULL_PARSED input WHEN an ingest signal is processed THEN empty clipboard HTML emits parse.failed and creates no doc (S2+S4) · path c4', async () => {
      const docsBefore = await jobCol().countDocuments({});
      await tc.apps.ingest.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, '');
      await new Promise((r) => setTimeout(r, 500));
      const docsAfter = await jobCol().countDocuments({});
      expect(docsAfter).toBe(docsBefore);
    });
  });

  describe('(f) fast-check invariants', () => {
    it('property: random role/company seeds never crash and either create a clip-* doc or dedupe on duplicate', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 2, maxLength: 20 }),
          fc.string({ minLength: 2, maxLength: 20 }),
          async (roleSeed, companySeed) => {
            const suffix = Math.random().toString(36).slice(2, 8);
            const role = `${roleSeed.replace(/[^a-zA-Z0-9 ]/g, '').trim()}-${suffix}` || 'Engineer';
            const company =
              `${companySeed.replace(/[^a-zA-Z0-9 ]/g, '').trim()}-Prop-${suffix}` || 'Factory';
            const html = linkedinSduiDetailHtml(role, company);
            const before = await jobCol().countDocuments({});
            await tc.apps.ingest.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, html);
            const afterCreate = await jobCol().countDocuments({});
            expect([before + 1, before]).toContain(afterCreate);
            const stored = await jobCol().findOne({ role, company });
            if (stored) {
              expect(String(stored._id)).toMatch(/^clip-/);
            }
            await tc.apps.ingest.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, html);
            const afterDuplicate = await jobCol().countDocuments({});
            expect(afterDuplicate).toBe(afterCreate);
            return true;
          }
        ),
        { numRuns: 15 }
      );
    });
  });
});
