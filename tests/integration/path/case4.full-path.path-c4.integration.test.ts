/* Path cell (c4): direct full-path clipboard 2b -> clip-* FULL_PARSED doc -> queue/trash resolution over UDS and the real-DIP bus (see plans/tests-path-matrix.md)
 * GWT cause-effect (path c4, no S1): GIVEN a clipboard [i] direct ingest WHEN [j]/[d] UDS resolution is applied
 *   THEN S3 QUEUED / S3 TRASHED (+ PDF asset) clip-* doc, duplicates dedupe (11000), latest-wins stays current. */
import { readdirSync } from 'node:fs';

import amqplib from 'amqplib';
import fc from 'fast-check';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

import { ActionEvent } from '../../../src/domain/types/action-event.js';
import { JobStage, JobSource, JobStatus } from '../../../src/domain/types/job-lifecycle.js';
import { getCurrentJob } from '../../../src/presentation/tui/shared-tui-state.js';
import { udsHelpers } from '../../helpers/e2e-harness.js';
import {
  linkedinSduiDetailHtml,
  topcvDetailHtml,
  nonJobHtml,
} from '../../helpers/html-fixtures.js';
import type { RealDipBus } from '../../helpers/real-dip-bus.js';
import {
  buildTestDaemonContainer,
  buildTuiTestContainer,
  type TestDaemonContainer,
} from '../../helpers/test-container.js';

const DIRECT_HTML = linkedinSduiDetailHtml('Backend Developer', 'CopyJuniorCompany');

const RMQ_URL = process.env.RABBITMQ_URL || 'amqp://localhost';

async function waitFor(check: () => boolean, timeoutMs = 15000, intervalMs = 50): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms`);
}

async function purgeTuiQueues(ns: string): Promise<void> {
  const conn = await amqplib.connect(RMQ_URL);
  const ch = await conn.createChannel();
  for (const suffix of ['s1', 's2', 's3s4']) {
    try {
      await ch.assertQueue(`tui.${ns}.${suffix}`);
      await ch.purgeQueue(`tui.${ns}.${suffix}`);
    } catch {
      /* best-effort — a missing/closed queue is treated as empty */
    }
  }
  try {
    await ch.close();
  } catch {
    /* channel may already be closed by the server */
  }
  await conn.close();
}

describe('Path full-path c4 — direct clipboard ingest, queue/trash routing, dedupe and failure edges', () => {
  let tc: TestDaemonContainer;
  let realBus: RealDipBus;
  let uds: ReturnType<typeof udsHelpers>;

  beforeAll(async () => {
    tc = await buildTestDaemonContainer({ ns: 'c4-full-path' });
    await tc.start();
    realBus = tc.bus;
    uds = udsHelpers(tc.socket, 'e2e-internal-token');
  }, 120000);

  afterAll(async () => {
    await tc.stop();
  });

  beforeEach(async () => {
    await tc.storage.clearDb();
  });

  const jobCol = () => tc.db.collection('job_lifecycle');

  async function ingestClip(html: string): Promise<string> {
    const comp = await realBus.setup([ActionEvent.PARSE_COMPLETED]);
    await tc.ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, html);
    const compMsg = await comp.msg();
    const id = compMsg.job._id as string;
    expect(id).toMatch(/^clip-/);
    return id;
  }

  async function expectNoCompletedEvent(): Promise<void> {
    const comp = await realBus.setup([ActionEvent.PARSE_COMPLETED], 4000);
    let timedOut = false;
    try {
      await comp.msg();
    } catch (e) {
      timedOut = /Timeout waiting for message/.test(e instanceof Error ? e.message : String(e));
    }
    expect(timedOut).toBe(true);
  }

  function waitForPdfFiles(dir: string, timeoutMs = 20000): Promise<void> {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const poll = () => {
        try {
          const files = readdirSync(dir).filter((f) => f.endsWith('.pdf'));
          if (files.length > 0) return resolve();
        } catch {
          /* dir may not be created yet */
        }
        if (Date.now() - start > timeoutMs)
          return reject(new Error(`Timeout waiting for pdf asset in ${dir}`));
        setTimeout(poll, 250);
      };
      poll();
    });
  }

  describe('signal2bManual creates a full-parsed clip-* doc and emits parse.completed — real-DIP', () => {
    it('GIVEN an S2 manual FULL_PARSED input WHEN findById loads the doc THEN creates a new FULL_PARSED job with a fabricated clip-* id (S2) · path c4', async () => {
      const docsBefore = await jobCol().countDocuments({});
      const id = await ingestClip(DIRECT_HTML);
      const docsAfter = await jobCol().countDocuments({});
      expect(docsAfter).toBe(docsBefore + 1);
      const job = await tc.mongoJobLifecycleAdapter.findById(id);
      expect(job).not.toBeNull();
      expect(job!.stage).toBe(JobStage.FULL_PARSED);
      expect(job!.status).toBe(JobStatus.ENRICHED);
      expect(job!.source).toBe(JobSource.MANUAL);
      expect(job!.company).toBe('CopyJuniorCompany');
      expect(job!.role).toBe('Backend Developer');
    });

    it('GIVEN full filter pass WHEN the path is exercised THEN S2 stores a clip-* doc · path c4', async () => {
      const id = await ingestClip(topcvDetailHtml('Software Engineer', 'FilterPassCo'));
      const doc = await jobCol().findOne({ company: 'FilterPassCo' });
      expect(doc).not.toBeNull();
      expect(doc!._id).toBe(id);
      expect(doc!._id).toMatch(/^clip-/);
      expect(doc!.status).toBe(JobStatus.ENRICHED);
    });

    it('GIVEN an S2 manual FULL_PARSED input WHEN an ingest signal is processed THEN duplicate role+company silently skips (MongoDB 11000) and emits no second parse.completed (S2) · path c4', async () => {
      const html = linkedinSduiDetailHtml('Duplicate Role', 'DuplicateClipCo');
      await ingestClip(html);
      const docsBefore = await jobCol().countDocuments({});
      await tc.ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, html);
      await expectNoCompletedEvent();
      const docsAfter = await jobCol().countDocuments({});
      expect(docsAfter).toBe(docsBefore);
    });

    it('GIVEN duplicate role+company over the socket WHEN the path is exercised THEN S1 also silently skipped (S2) · path c4', async () => {
      const html = linkedinSduiDetailHtml('Socket Dedup Role', 'SocketDedupCo');
      const firstSetup = realBus.setup([ActionEvent.PARSE_COMPLETED]);
      const firstRes = await uds.ingest(html);
      expect(firstRes.statusCode).toBe(200);
      const firstMsg = await (await firstSetup).msg();
      expect(firstMsg.job._id).toMatch(/^clip-/);
      const docsBefore = await jobCol().countDocuments({});
      const secondRes = await uds.ingest(html);
      expect(secondRes.statusCode).toBe(200);
      await expectNoCompletedEvent();
      const docsAfter = await jobCol().countDocuments({});
      expect(docsAfter).toBe(docsBefore);
    });
  });

  describe('clipboard paste path over the real UDS socket ([b] direct ingest + [j]/[d] actions)', () => {
    it('GIVEN uds.ingest without a webhook WHEN the path is exercised THEN S1 fabricates a clip-* id for the full direct ingest (S2) · path c4', async () => {
      const comp = await realBus.setup([ActionEvent.PARSE_COMPLETED]);
      const res = await uds.ingest(linkedinSduiDetailHtml('Socket Engineer', 'UdsDirectCo'));
      expect(res.statusCode).toBe(200);
      const compMsg = await comp.msg();
      expect(compMsg.job).toBeDefined();
      expect(compMsg.job._id).toMatch(/^clip-/);
      const doc = await tc.mongoJobLifecycleAdapter.findById(compMsg.job._id);
      expect(doc).not.toBeNull();
      expect(doc!.stage).toBe(JobStage.FULL_PARSED);
      expect(doc!.status).toBe(JobStatus.ENRICHED);
      expect(doc!.company).toBe('UdsDirectCo');
    });

    it('GIVEN the path c4 preconditions WHEN a UDS action is dispatched THEN uds.action(clip, queue) routes the clipboard job to QUEUED + pdf asset (S2+S3) · path c4', async () => {
      const id = await ingestClip(linkedinSduiDetailHtml('Socket Queue Role', 'UdsQueueCo'));
      const queue = await realBus.setup([
        ActionEvent.QUEUED,
        ActionEvent.TRASHED,
        ActionEvent.ROUTE_FAILED,
      ]);
      const res = await uds.action(id, 'queue');
      expect(res.statusCode).toBe(200);
      const queueMsg = await queue.msg();
      expect(queueMsg.jobLifecycleId).toBe(id);
      await waitForPdfFiles(tc.assetDir);
      const doc = await tc.mongoJobLifecycleAdapter.findById(id);
      expect(doc).not.toBeNull();
      expect(doc!.status).toBe(JobStatus.QUEUED);
    });

    it('GIVEN the path c4 preconditions WHEN a UDS action is dispatched THEN uds.action(clip, trash) routes the clipboard job to TRASHED (S2+S3) · path c4', async () => {
      const id = await ingestClip(linkedinSduiDetailHtml('Socket Trash Role', 'UdsTrashCo'));
      const trash = await realBus.setup([
        ActionEvent.TRASHED,
        ActionEvent.ROUTE_FAILED,
        ActionEvent.PARSE_FAILED,
      ]);
      const res = await uds.action(id, 'trash');
      expect(res.statusCode).toBe(200);
      const trashMsg = await trash.msg();
      expect(trashMsg.jobLifecycleId).toBe(id);
      expect(trashMsg.reason).toBe('operator:trash');
      const doc = await tc.mongoJobLifecycleAdapter.findById(id);
      expect(doc).not.toBeNull();
      expect(doc!.status).toBe(JobStatus.TRASHED);
    });
  });

  describe('direct lifecycle completion ([i] to [j] / [d]) — Case 4', () => {
    it('GIVEN the path c4 preconditions WHEN a resolution is applied THEN signal2bManual queue resolution: full clipboard-to-queued flow + pdf asset (S2+S3) · path c4', async () => {
      const id = await ingestClip(linkedinSduiDetailHtml('Clipboard Queue Role', 'ClipQueueCorp'));
      const queue = await realBus.setup([
        ActionEvent.QUEUED,
        ActionEvent.TRASHED,
        ActionEvent.ROUTE_FAILED,
      ]);
      await tc.ingestor.processResolution(id, 'queue');
      const queueMsg = await queue.msg();
      expect(queueMsg.jobLifecycleId).toBe(id);
      await waitForPdfFiles(tc.assetDir);
      const doc = await tc.mongoJobLifecycleAdapter.findById(id);
      expect(doc).not.toBeNull();
      expect(doc!.status).toBe(JobStatus.QUEUED);
    });

    it('GIVEN the path c4 preconditions WHEN a resolution is applied THEN signal2bManual trash resolution: full clipboard-to-trashed flow (S2+S3) · path c4', async () => {
      const id = await ingestClip(linkedinSduiDetailHtml('Clipboard Trash Role', 'ClipTrashCorp'));
      const trash = await realBus.setup([
        ActionEvent.TRASHED,
        ActionEvent.ROUTE_FAILED,
        ActionEvent.PARSE_FAILED,
      ]);
      await tc.ingestor.processResolution(id, 'trash');
      const trashMsg = await trash.msg();
      expect(trashMsg.jobLifecycleId).toBe(id);
      expect(trashMsg.reason).toBe('operator:trash');
      const doc = await tc.mongoJobLifecycleAdapter.findById(id);
      expect(doc).not.toBeNull();
      expect(doc!.status).toBe(JobStatus.TRASHED);
    });
  });

  describe('resolution guards (not-ENRICHED and terminal-state protections over the real bus)', () => {
    it('GIVEN an S1 manual PARTIAL_PARSED input WHEN a resolution is applied THEN queue on a not-ENRICHED job is guarded — no queued event, status unchanged (S1+S3+S4+S2) · path c4', async () => {
      const guardId = 'c4-guard-not-enriched';
      await tc.mongoJobLifecycleAdapter.upsert({
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
      const queue = await realBus.setup([
        ActionEvent.QUEUED,
        ActionEvent.TRASHED,
        ActionEvent.ROUTE_FAILED,
      ]);
      await tc.ingestor.processResolution(guardId, 'queue');
      let noQueue = false;
      try {
        await queue.msg();
      } catch (e) {
        noQueue = /Timeout waiting for message/.test(e instanceof Error ? e.message : String(e));
      }
      expect(noQueue).toBe(true);
      const doc = await tc.mongoJobLifecycleAdapter.findById(guardId);
      expect(doc).not.toBeNull();
      expect(doc!.status).toBe(JobStatus.ENRICHING);
    });

    it('GIVEN the path c4 preconditions WHEN a resolution is applied THEN a QUEUED job rejects a later trash action (terminal-state protection) (S2+S3) · path c4', async () => {
      const id = await ingestClip(linkedinSduiDetailHtml('Guard Trash Role', 'GuardTrashCo'));
      const queue = await realBus.setup([
        ActionEvent.QUEUED,
        ActionEvent.TRASHED,
        ActionEvent.ROUTE_FAILED,
      ]);
      await tc.ingestor.processResolution(id, 'queue');
      const queueMsg = await queue.msg();
      expect(queueMsg.jobLifecycleId).toBe(id);
      const trash = await realBus.setup([ActionEvent.TRASHED, ActionEvent.PARSE_FAILED]);
      await tc.ingestor.processResolution(id, 'trash');
      let noTrash = false;
      try {
        await trash.msg();
      } catch (e) {
        noTrash = /Timeout waiting for message/.test(e instanceof Error ? e.message : String(e));
      }
      expect(noTrash).toBe(true);
      const doc = await tc.mongoJobLifecycleAdapter.findById(id);
      expect(doc).not.toBeNull();
      expect(doc!.status).toBe(JobStatus.QUEUED);
    });
  });

  describe('duplicate detection and latest-wins across multiple clip ingests', () => {
    it('GIVEN an S2 manual FULL_PARSED input WHEN an ingest signal is processed THEN second identical ingest leaves the doc count unchanged and emits no parse.completed (S2) · path c4', async () => {
      const html = linkedinSduiDetailHtml('Dedup Role', 'DedupClipCo');
      await ingestClip(html);
      const docsBefore = await jobCol().countDocuments({});
      await tc.ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, html);
      await expectNoCompletedEvent();
      const docsAfter = await jobCol().countDocuments({});
      expect(docsAfter).toBe(docsBefore);
    });

    it('GIVEN second ingest with a different company WHEN the path is exercised THEN S1 creates a separate clip-* doc (latest-wins) · path c4', async () => {
      const firstId = await ingestClip(linkedinSduiDetailHtml('B17 Role', 'FirstWinCo'));
      const secondId = await ingestClip(linkedinSduiDetailHtml('B17 Role', 'SecondWinCo'));
      expect(secondId).not.toBe(firstId);
      const firstDoc = await tc.mongoJobLifecycleAdapter.findById(firstId);
      const secondDoc = await tc.mongoJobLifecycleAdapter.findById(secondId);
      expect(firstDoc!.company).toBe('FirstWinCo');
      expect(secondDoc!.company).toBe('SecondWinCo');
      const count = await jobCol().countDocuments({});
      expect(count).toBe(2);
    });
  });

  describe('negative and failure paths (unparsable/empty clipboard, route failure injection)', () => {
    it('GIVEN an S2 manual FULL_PARSED input WHEN an ingest signal is processed THEN unparsable clipboard HTML emits parse.failed and creates no doc (S2+S4) · path c4', async () => {
      const docsBefore = await jobCol().countDocuments({});
      const fail = await realBus.setup([ActionEvent.PARSE_FAILED]);
      await tc.ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, nonJobHtml());
      const failMsg = await fail.msg();
      expect(failMsg.jobLifecycleId).toMatch(/^clip-/);
      const docsAfter = await jobCol().countDocuments({});
      expect(docsAfter).toBe(docsBefore);
    });

    it('GIVEN an S2 manual FULL_PARSED input WHEN an ingest signal is processed THEN empty clipboard HTML emits parse.failed and creates no doc (S2+S4) · path c4', async () => {
      const docsBefore = await jobCol().countDocuments({});
      const fail = await realBus.setup([ActionEvent.PARSE_FAILED]);
      await tc.ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, '');
      const failMsg = await fail.msg();
      expect(failMsg.jobLifecycleId).toMatch(/^clip-/);
      const docsAfter = await jobCol().countDocuments({});
      expect(docsAfter).toBe(docsBefore);
    });

    it('GIVEN the path c4 preconditions WHEN a resolution is applied THEN stage update failure emits route.failed, doc stays ENRICHED, mocks restored (S4+S2) · path c4', async () => {
      const id = await ingestClip(linkedinSduiDetailHtml('Route Fail Role', 'RouteFailCo'));
      const fail = await realBus.setup([ActionEvent.ROUTE_FAILED]);
      vi.spyOn(tc.mongoJobLifecycleAdapter, 'updateStage').mockRejectedValueOnce(
        new Error('DB timeout')
      );
      await tc.ingestor.processResolution(id, 'queue');
      const failMsg = await fail.msg();
      expect(failMsg.jobLifecycleId).toBe(id);
      expect(failMsg.reason).toBe('DB timeout');
      vi.restoreAllMocks();
      const doc = await tc.mongoJobLifecycleAdapter.findById(id);
      expect(doc).not.toBeNull();
      expect(doc!.status).toBe(JobStatus.ENRICHED);
    });
  });

  describe('fast-check property over direct clipboard 2b', () => {
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
            await tc.ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, html);
            const afterCreate = await jobCol().countDocuments({});
            expect([before + 1, before]).toContain(afterCreate);
            const stored = await jobCol().findOne({ role, company });
            if (stored) {
              expect(String(stored._id)).toMatch(/^clip-/);
            }
            await tc.ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, html);
            const afterDuplicate = await jobCol().countDocuments({});
            expect(afterDuplicate).toBe(afterCreate);
            return true;
          }
        ),
        { numRuns: 15 }
      );
    });
  });

  it('GIVEN the tui-ioc precondition WHEN the daemon publishes S1+S2 over RMQ and the tui sends [j] over UDS THEN the tui reader mirrors then clears the job on the ipc seam (tui↔daemon over real RMQ+UDS) · path c4', async () => {
    await purgeTuiQueues('c4-full-path');
    const tui = await buildTuiTestContainer({ ns: 'c4-full-path' });
    try {
      await waitFor(() => tui.rmqReader.isConnected());
      const jobId = 'c4-tui-boundary-1';

      await tc.container.parseAdapter.emitGenerated(
        {
          _id: jobId,
          role: 'Backend Developer',
          company: 'BoundaryCo4',
          stage: JobStage.PARTIAL_PARSED,
        },
        { stage: JobStage.PARTIAL_PARSED, source: JobSource.BROWSER_AUTO }
      );
      await waitFor(() => getCurrentJob().jobLifecycleId === jobId);
      expect(getCurrentJob().stage).toBe(JobStage.PARTIAL_PARSED);

      await tc.container.parseAdapter.emitCompleted(
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
      await waitFor(() => getCurrentJob().job?.description === 'boundary desc c4');
      expect(getCurrentJob().stage).toBe(JobStage.FULL_PARSED);

      await tc.mongoJobLifecycleAdapter.upsert({
        _id: jobId,
        company: 'BoundaryCo4',
        role: 'Backend Developer',
        description: 'boundary desc c4',
        stage: JobStage.FULL_PARSED,
        status: JobStatus.ENRICHED,
        source: JobSource.MANUAL,
      });

      await tui.udsWriter.queue(jobId);
      await waitFor(() => getCurrentJob().jobLifecycleId === null);
      expect(getCurrentJob().job).toBeNull();
    } finally {
      await tui.stop();
    }
  }, 60000);
});
