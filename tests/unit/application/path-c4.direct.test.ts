/* eslint-disable @typescript-eslint/no-unused-vars, vitest/expect-expect */
/*
 * Path c4 — S2b→S3+clear except s2b (mocked) — direct, no s1[], single clip-*
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { JobStage, JobStatus, JobSource } from '../../../src/domain/types/job-lifecycle.js';
import { setQueueMode } from '../../../src/presentation/tui/shared-tui-state.js';
import { assertDirectClear } from '../../helpers/assert-path.js';
import { linkedinSduiDetailHtml, nonJobHtml } from '../../helpers/html-fixtures.js';
import { whenS2b, whenQueue, whenTrash } from '../../helpers/saga.js';
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

describe('Path c4 — S2b LinkedIn 1→S3+clear except s2b (mocked)', () => {
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
    tui = await buildTestTuiContainer(
      { ns: 'unit-path-c4' },
      { ports: { rmqReader: mockJobEventReaderPort(), udsWriter: mockActionWriterPort() } }
    );
    setQueueMode(false);
    (tui.reader.getQueueModeState as unknown as ReturnType<typeof vi.fn>).mockReturnValue(false);
    (tui.reader.getQueueDepth as unknown as ReturnType<typeof vi.fn>).mockReturnValue(0);
    (tui.reader.peekPending as unknown as ReturnType<typeof vi.fn>).mockReturnValue([]);
  });

  it('GIVEN S2b LinkedIn 1 job [b]=direct WHEN [j] queue THEN S3 QUEUED+clear empty ipc even asset · path c4', async () => {
    await whenS2b(daemon, linkedinSduiDetailHtml('Software Engineer', 'C4Co'));
    expect(storage.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: expect.stringMatching(/^clip-/),
        stage: JobStage.FULL_PARSED,
        status: JobStatus.ENRICHED,
      })
    );
    expect(parsePort.emitCompleted).toHaveBeenCalled();
    expect(queue.enqueue).not.toHaveBeenCalled();

    const clipId = (storage.upsert.mock.calls[0][0] as { _id: string })._id;
    storage.findById.mockResolvedValue(
      makeStage1Partial({ _id: clipId, status: JobStatus.ENRICHED })
    );
    await whenQueue(tui, clipId);
    await daemon.apps.ingest.processResolution(clipId, 'queue');
    expect(routingPort.emitJobQueued).toHaveBeenCalledWith(
      clipId,
      expect.objectContaining({ source: JobSource.MANUAL })
    );
    await assertDirectClear(tui, daemon, { clipId });
  });

  it('GIVEN S2b 1 job WHEN [d] trash THEN TRASHED+clear · path c4', async () => {
    await whenS2b(daemon, linkedinSduiDetailHtml('Backend Engineer', 'C4Co2'));
    const clipId = (storage.upsert.mock.calls[0][0] as { _id: string })._id;
    storage.findById.mockResolvedValue(
      makeStage1Partial({ _id: clipId, status: JobStatus.ENRICHED })
    );
    await whenTrash(tui, clipId);
    await daemon.apps.ingest.processResolution(clipId, 'trash');
    expect(routingPort.emitJobTrashed).toHaveBeenCalledWith(clipId, 'operator:trash');
    await assertDirectClear(tui, daemon, { clipId });
  });

  it('GIVEN random S2b LinkedIn 1 singles WHEN S3 drain THEN never enqueue ipc clears even asset · path c4 SRE', async () => {
    for (let i = 0; i < 2; i++) {
      await whenS2b(daemon, linkedinSduiDetailHtml(`Automation Engineer`, `C4SRE${i}`));
      expect(queue.enqueue).not.toHaveBeenCalled();
    }
    expect(tui.reader.getQueueDepth()).toBe(0);
  });
});
