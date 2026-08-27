/*
 * Path c4 — S2b→S3+clear except s2b (mocked) — direct, no s1[], single clip-*
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { JobStage, JobStatus, JobSource } from '../../../src/domain/types/job-lifecycle.js';
import { linkedinSduiDetailHtml, nonJobHtml } from '../../helpers/html-fixtures.js';
import { makeStage1Partial } from '../../helpers/test-builders.js';
import { assertDirectClear } from '../../helpers/assert-path.js';
import { whenS2b, whenQueue, whenTrash } from '../../helpers/saga.js';
import {
  mockJobLifecyclePort,
  mockExtractionQueuePort,
  mockParsePort,
  mockRoutingPort,
  mockJobEventReaderPort,
  mockActionWriterPort,
  buildTestDaemonContainer,
  buildTestTuiContainer,
} from '../../helpers/test-container.js';
import { setQueueMode } from '../../../src/presentation/tui/shared-tui-state.js';

describe('Path c4 — S2b→S3+clear except s2b (mocked)', () => {
  let daemon: Awaited<ReturnType<typeof buildTestDaemonContainer>>;
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
      { ports: { jobLifecycle: storage, extractionQueue: queue, parse: parsePort, route: routingPort, assetProducing: { toAsset: vi.fn().mockResolvedValue({ pdfPath: '' }) } } }
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

  it('GIVEN S2b LinkedIn 1 job [b]=direct WHEN [j] queue THEN S3 QUEUED+clear empty ipc · path c4', async () => {
    await whenS2b(daemon, linkedinSduiDetailHtml('Software Engineer', 'C4Co'));
    expect(storage.upsert).toHaveBeenCalledWith(expect.objectContaining({ _id: expect.stringMatching(/^clip-/), stage: JobStage.FULL_PARSED, status: JobStatus.ENRICHED }));
    expect(parsePort.emitCompleted).toHaveBeenCalled();
    expect(queue.enqueue).not.toHaveBeenCalled();

    const clipId = (storage.upsert.mock.calls[0][0] as { _id: string })._id;
    // make findById return ENRICHED for queue
    storage.findById.mockResolvedValue(makeStage1Partial({ _id: clipId, status: JobStatus.ENRICHED }));
    await whenQueue(tui, clipId);
    await daemon.apps.ingest.processResolution(clipId, 'queue');
    expect(routingPort.emitJobQueued).toHaveBeenCalledWith(clipId, expect.objectContaining({ source: JobSource.MANUAL }));
    assertDirectClear(tui, daemon, { clipId });
  });

  it('GIVEN S2b 1 job WHEN [d] trash THEN TRASHED+clear · path c4', async () => {
    await whenS2b(daemon, linkedinSduiDetailHtml('Backend Engineer', 'C4Co2'));
    const clipId = (storage.upsert.mock.calls[0][0] as { _id: string })._id;
    storage.findById.mockResolvedValue(makeStage1Partial({ _id: clipId, status: JobStatus.ENRICHED }));
    await whenTrash(tui, clipId);
    await daemon.apps.ingest.processResolution(clipId, 'trash');
    expect(routingPort.emitJobTrashed).toHaveBeenCalledWith(clipId, 'operator:trash');
    assertDirectClear(tui, daemon, { clipId });
  });
});

describe('Path c4 — SRE (mocked)', () => {
  it('GIVEN random S2b singles WHEN S3 drain THEN never enqueue ipc clears · path c4 SRE', async () => {
    const s = mockJobLifecyclePort();
    const q = mockExtractionQueuePort();
    const p = mockParsePort();
    const r = mockRoutingPort();
    const d = await buildTestDaemonContainer({ ns: 'unit-path-c4-sre' }, { ports: { jobLifecycle: s, extractionQueue: q, parse: p, route: r, assetProducing: { toAsset: vi.fn().mockResolvedValue({ pdfPath: '' }) } } });
    const t = await buildTestTuiContainer({ ns: 'unit-path-c4-sre' }, { ports: { rmqReader: mockJobEventReaderPort(), udsWriter: mockActionWriterPort() } });
    setQueueMode(false);
    for (let i = 0; i < 2; i++) {
      await whenS2b(d, linkedinSduiDetailHtml(`Role${i}`, `C4SRE${i}`));
      expect(q.enqueue).not.toHaveBeenCalled();
    }
    expect(t.reader.getQueueDepth()).toBe(0);
  });
});
