/* eslint-disable @typescript-eslint/no-unused-vars, vitest/expect-expect */
/*
 * Path c1 — S1→S2a→S3 next s1[4] (mocked) — flat ring, s1Count 4, unified pick seam.
 * Every `it` is GIVEN s1[4] pick job-0 WHEN [c] S2a then S3 QUEUED|TRASHED + next pick job-1 · path c1
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { JobStage, JobStatus, JobSource } from '../../../src/domain/types/job-lifecycle.js';
import { setQueueMode } from '../../../src/presentation/tui/shared-tui-state.js';
import { assertPicked } from '../../helpers/assert-path.js';
import { topcvEmailHtmlMany, topcvDetailHtml } from '../../helpers/html-fixtures.js';
import { whenS1Many, whenS2a, whenQueue, whenTrash } from '../../helpers/saga.js';
import { makeStage1Partial } from '../../helpers/test-builders.js';
import {
  mockJobLifecyclePort,
  mockExtractionQueuePort,
  mockParsePort,
  mockRoutingPort,
  mockJobEventReaderPort,
  mockActionWriterPort,
  buildTestDaemonContainer,
  buildTestTuiContainer,
  type TestDaemonContainer,
  type MockTestDaemonContainer,
} from '../../helpers/test-container.js';

function s1Html4(prefix: string): string {
  return topcvEmailHtmlMany([
    { role: 'Software Engineer', company: `${prefix}Co0` },
    { role: 'Backend Engineer', company: `${prefix}Co1` },
    { role: 'Data Engineer', company: `${prefix}Co2` },
    { role: 'Automation Engineer', company: `${prefix}Co3` },
  ]);
}

describe('Path c1 — S1→S2a TopCV next s1[4] (mocked)', () => {
  let daemon: TestDaemonContainer | MockTestDaemonContainer;
  let tui: Awaited<ReturnType<typeof buildTestTuiContainer>>;
  let storage: ReturnType<typeof mockJobLifecyclePort>;
  let queue: ReturnType<typeof mockExtractionQueuePort>;
  let parsePort: ReturnType<typeof mockParsePort>;
  let routingPort: ReturnType<typeof mockRoutingPort>;

  beforeEach(async () => {
    storage = mockJobLifecyclePort();
    queue = mockExtractionQueuePort();
    parsePort = mockParsePort();
    routingPort = mockRoutingPort();
    daemon = await buildTestDaemonContainer(
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
    tui = await buildTestTuiContainer(
      { ns: 'unit-path-c1' },
      { ports: { rmqReader: mockJobEventReaderPort(), udsWriter: mockActionWriterPort() } }
    );
    setQueueMode(true);
    (tui.reader.getQueueDepth as unknown as ReturnType<typeof vi.fn>).mockReturnValue(3);
    (tui.reader.peekPending as unknown as ReturnType<typeof vi.fn>).mockReturnValue([
      's1-c1-job-1',
      's1-c1-job-2',
      's1-c1-job-3',
    ]);
    (tui.reader.getQueueModeState as unknown as ReturnType<typeof vi.fn>).mockReturnValue(true);
  });

  it('GIVEN s1[4] TopCV pick job-0 WHEN S2a TopCV htmlToText then [j] queue THEN S3 QUEUED + next pick job-1 depth 2 · path c1', async () => {
    await whenS1Many(daemon, s1Html4('C1'), 's1-c1');
    expect(storage.upsert).toHaveBeenCalledTimes(4);
    expect(parsePort.emitGenerated).toHaveBeenCalledTimes(4);
    const [genJob, genCtx] = (
      parsePort.emitGenerated as unknown as ReturnType<typeof vi.fn>
    ).mock.calls[0];
    expect(genJob).toEqual(expect.objectContaining({ _id: 's1-c1-job-0' }));
    for (const k of ['raw', 'gmailMeta', 'createdAt', 'updatedAt', 'stageTimestamp', 'stage', 'status', 'source']) {
      expect(genJob).not.toHaveProperty(k);
    }
    expect(genCtx).toEqual(
      expect.objectContaining({
        stage: JobStage.PARTIAL_PARSED,
        source: JobSource.BROWSER_AUTO,
        status: JobStatus.ENRICHING,
      })
    );
    expect(queue.enqueue).not.toHaveBeenCalled();
    assertPicked(tui, { messageId: 's1-c1', s1Count: 4, expectedIdx: 0 });

    storage.findById.mockResolvedValue(makeStage1Partial({ _id: 's1-c1-job-0' }));
    await whenS2a(daemon, topcvDetailHtml(), 's1-c1-job-0');
    expect(storage.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: 's1-c1-job-0',
        stage: JobStage.FULL_PARSED,
        status: JobStatus.ENRICHED,
      })
    );
    expect(parsePort.emitCompleted).toHaveBeenCalledTimes(1);
    const [doneJob, doneCtx] = (
      parsePort.emitCompleted as unknown as ReturnType<typeof vi.fn>
    ).mock.calls[0];
    expect(doneJob).toEqual(expect.objectContaining({ _id: 's1-c1-job-0' }));
    for (const k of ['raw', 'gmailMeta', 'createdAt', 'updatedAt', 'stageTimestamp', 'stage', 'status', 'source']) {
      expect(doneJob).not.toHaveProperty(k);
    }
    expect(doneCtx).toEqual(
      expect.objectContaining({
        stage: JobStage.FULL_PARSED,
        source: JobSource.MANUAL,
        status: JobStatus.ENRICHED,
      })
    );

    storage.findById.mockResolvedValue(
      makeStage1Partial({ _id: 's1-c1-job-0', status: JobStatus.ENRICHED })
    );
    await whenQueue(tui, 's1-c1-job-0');
    await daemon.apps.ingest.processResolution('s1-c1-job-0', 'queue');
    expect(storage.updateStage).toHaveBeenCalledWith(
      's1-c1-job-0',
      JobStage.FULL_PARSED,
      JobStatus.QUEUED
    );
    expect(routingPort.emitJobQueued).toHaveBeenCalledWith(
      's1-c1-job-0',
      expect.objectContaining({ source: JobSource.MANUAL })
    );

    (tui.reader.getQueueDepth as unknown as ReturnType<typeof vi.fn>).mockReturnValue(2);
    (tui.reader.peekPending as unknown as ReturnType<typeof vi.fn>).mockReturnValue([
      's1-c1-job-2',
      's1-c1-job-3',
    ]);
    assertPicked(tui, { messageId: 's1-c1', s1Count: 4, expectedIdx: 1 });
  });

  it('GIVEN s1[4] TopCV pick job-0 WHEN S2a TopCV then [d] trash THEN S3 TRASHED + next pick job-1 · path c1', async () => {
    (tui.reader.getQueueDepth as unknown as ReturnType<typeof vi.fn>).mockReturnValue(3);
    (tui.reader.peekPending as unknown as ReturnType<typeof vi.fn>).mockReturnValue([
      's1-c1t-job-1',
      's1-c1t-job-2',
      's1-c1t-job-3',
    ]);
    await whenS1Many(daemon, s1Html4('C1T'), 's1-c1t');
    expect(storage.upsert).toHaveBeenCalledTimes(4);
    assertPicked(tui, { messageId: 's1-c1t', s1Count: 4, expectedIdx: 0 });

    storage.findById.mockResolvedValue(makeStage1Partial({ _id: 's1-c1t-job-0' }));
    await whenS2a(daemon, topcvDetailHtml(), 's1-c1t-job-0');
    expect(parsePort.emitCompleted).toHaveBeenCalled();

    storage.findById.mockResolvedValue(
      makeStage1Partial({ _id: 's1-c1t-job-0', status: JobStatus.ENRICHED })
    );
    await whenTrash(tui, 's1-c1t-job-0');
    await daemon.apps.ingest.processResolution('s1-c1t-job-0', 'trash');
    expect(storage.updateStage).toHaveBeenCalledWith(
      's1-c1t-job-0',
      JobStage.FULL_PARSED,
      JobStatus.TRASHED
    );
    expect(routingPort.emitJobTrashed).toHaveBeenCalledWith('s1-c1t-job-0', 'operator:trash');
    (tui.reader.getQueueDepth as unknown as ReturnType<typeof vi.fn>).mockReturnValue(2);
    (tui.reader.peekPending as unknown as ReturnType<typeof vi.fn>).mockReturnValue([
      's1-c1t-job-2',
      's1-c1t-job-3',
    ]);
    assertPicked(tui, { messageId: 's1-c1t', s1Count: 4, expectedIdx: 1 });
  });

  it('GIVEN N sequential s1[4] TopCV→pick→S2a TopCV→S3 QUEUED cycles WHEN each converges THEN pending drains and dedupe ≤1 even asset · path c1 SRE', async () => {
    vi.clearAllMocks();
    (tui.reader.getQueueDepth as unknown as ReturnType<typeof vi.fn>).mockReturnValue(0);
    for (let i = 0; i < 2; i++) {
      const mid = `s1-c1-sre-${i}`;
      await whenS1Many(daemon, s1Html4(`SRE${i}`), mid);
      expect(parsePort.emitGenerated).toHaveBeenCalled();
      storage.findById.mockResolvedValue(makeStage1Partial({ _id: `${mid}-job-0` }));
      await whenS2a(daemon, topcvDetailHtml(), `${mid}-job-0`);
      storage.findById.mockResolvedValue(
        makeStage1Partial({ _id: `${mid}-job-0`, status: JobStatus.ENRICHED })
      );
      await daemon.apps.ingest.processResolution(`${mid}-job-0`, 'queue');
      expect(routingPort.emitJobQueued).toHaveBeenCalled();
      vi.clearAllMocks();
    }
    expect(tui.reader.getQueueDepth()).toBe(0);
  });
});
