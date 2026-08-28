/*
 * Path c3 — failures from c1/c2/c4 entries — 6 rings (mocked) — s1[4] pick by index, direct clear except s2b
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { JobStage, JobStatus, JobSource } from '../../../src/domain/types/job-lifecycle.js';
import { setQueueMode } from '../../../src/presentation/tui/shared-tui-state.js';
import { assertPicked, assertDirectClear } from '../../helpers/assert-path.js';
import {
  topcvEmailHtmlMany,
  topcvDetailHtml,
  linkedinSduiDetailHtml,
  nonJobHtml,
  indeedDetailHtml,
} from '../../helpers/html-fixtures.js';
import { whenS1Many, whenS2a, whenS2b } from '../../helpers/saga.js';
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
} from '../../helpers/test-container.js';

function s1Topcv4(p: string): string {
  return topcvEmailHtmlMany([
    { role: 'Software Engineer', company: `${p}Co0` },
    { role: 'Backend Engineer', company: `${p}Co1` },
    { role: 'Data Engineer', company: `${p}Co2` },
    { role: 'Automation Engineer', company: `${p}Co3` },
  ]);
}
function s1Indeed4(p: string): string {
  return topcvEmailHtmlMany([
    { role: 'Software Engineer', company: `${p}Co0` },
    { role: 'Backend Engineer', company: `${p}Co1` },
    { role: 'Data Engineer', company: `${p}Co2` },
    { role: 'Automation Engineer', company: `${p}Co3` },
  ]);
}

describe('Path c3 — S1[4] TopCV+Indeed S2a TopCV S2c Indeed S2b LinkedIn 1→S4 (mocked)', () => {
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
    tui = await buildTestTuiContainer(
      { ns: 'unit-path-c3' },
      { ports: { rmqReader: mockJobEventReaderPort(), udsWriter: mockActionWriterPort() } }
    );
    setQueueMode(true);
    (tui.reader.getQueueDepth as unknown as ReturnType<typeof vi.fn>).mockReturnValue(3);
    (tui.reader.peekPending as unknown as ReturnType<typeof vi.fn>).mockReturnValue([
      's1-c3-job-1',
      's1-c3-job-2',
      's1-c3-job-3',
    ]);
    (tui.reader.getQueueModeState as unknown as ReturnType<typeof vi.fn>).mockReturnValue(true);
  });

  it('GIVEN s1[4] TopCV pick job-0 WHEN S2a empty THEN S4 PARSE_FAILED + next pick job-1 · path c3', async () => {
    await whenS1Many(daemon, s1Topcv4('C3'), 's1-c3');
    assertPicked(tui, { messageId: 's1-c3', s1Count: 4, expectedIdx: 0 });
    await whenS2a(daemon, '', 's1-c3-job-0');
    expect(parsePort.emitFailed).toHaveBeenCalledWith(
      's1-c3-job-0',
      expect.objectContaining({ error: 'Empty HTML payload' })
    );
    expect(storage.upsert).not.toHaveBeenCalledWith(
      expect.objectContaining({ _id: 's1-c3-job-0', stage: JobStage.FULL_PARSED })
    );
    (tui.reader.getQueueDepth as unknown as ReturnType<typeof vi.fn>).mockReturnValue(2);
    (tui.reader.peekPending as unknown as ReturnType<typeof vi.fn>).mockReturnValue([
      's1-c3-job-2',
      's1-c3-job-3',
    ]);
    assertPicked(tui, { messageId: 's1-c3', s1Count: 4, expectedIdx: 1 });
    // recovery next s1[4] would be new whenS1Many('next-c3-1',4) → QUEUED — proved via SRE, not here to keep it single-ring
  });

  it('GIVEN s1[4] Indeed pick job-0 WHEN S2c missing id THEN no S4 stays job-0 depth3 · path c3', async () => {
    (tui.reader.getQueueDepth as unknown as ReturnType<typeof vi.fn>).mockReturnValue(3);
    (tui.reader.peekPending as unknown as ReturnType<typeof vi.fn>).mockReturnValue([
      's1-c3i-job-1',
      's1-c3i-job-2',
      's1-c3i-job-3',
    ]);
    await whenS1Many(daemon, s1Indeed4('C3I'), 's1-c3i');
    assertPicked(tui, { messageId: 's1-c3i', s1Count: 4, expectedIdx: 0 });
    storage.findById.mockResolvedValue(null);
    await daemon.apps.ingest.processIngest(
      JobSource.BROWSER_AUTO,
      JobStage.FULL_PARSED,
      indeedDetailHtml(),
      's1-c3i-job-0'
    );
    // signal2c without stage1 stays ENRICHING miss → no upsert, no emitCompleted, no S34 => no autoAdvance (RabbitMqJobReader:353 only S34 triggers)
    expect(parsePort.emitCompleted).not.toHaveBeenCalled();
    // stays on job-0: depth 3, pending head job-1 (same as integ case3:79-91)
    assertPicked(tui, { messageId: 's1-c3i', s1Count: 4, expectedIdx: 0 });
  });

  it('GIVEN S2b non-LinkedIn WHEN S2b THEN S4 PARSE_FAILED+clear · path c3', async () => {
    setQueueMode(false);
    (tui.reader.getQueueModeState as unknown as ReturnType<typeof vi.fn>).mockReturnValue(false);
    (tui.reader.getQueueDepth as unknown as ReturnType<typeof vi.fn>).mockReturnValue(0);
    (tui.reader.peekPending as unknown as ReturnType<typeof vi.fn>).mockReturnValue([]);
    await whenS2b(daemon, nonJobHtml());
    expect(parsePort.emitFailed).toHaveBeenCalledWith(
      expect.stringMatching(/^clip-/),
      expect.objectContaining({ stage: JobStage.FULL_PARSED })
    );
    expect(storage.upsert).not.toHaveBeenCalled();
    await assertDirectClear(tui, daemon);
    setQueueMode(true);
  });

  it('GIVEN s1[4] TopCV pick job-0 WHEN S2a ENRICHED then S3 write fail THEN S4 ROUTE_FAILED + next pick job-1 · path c3', async () => {
    (tui.reader.getQueueDepth as unknown as ReturnType<typeof vi.fn>).mockReturnValue(3);
    (tui.reader.peekPending as unknown as ReturnType<typeof vi.fn>).mockReturnValue([
      's1-c3a-job-1',
      's1-c3a-job-2',
      's1-c3a-job-3',
    ]);
    await whenS1Many(daemon, s1Topcv4('C3A'), 's1-c3a');
    assertPicked(tui, { messageId: 's1-c3a', s1Count: 4, expectedIdx: 0 });
    storage.findById.mockResolvedValue(makeStage1Partial({ _id: 's1-c3a-job-0' }));
    await whenS2a(daemon, topcvDetailHtml(), 's1-c3a-job-0');
    storage.findById.mockResolvedValue(
      makeStage1Partial({ _id: 's1-c3a-job-0', status: JobStatus.ENRICHED })
    );
    storage.updateStage.mockRejectedValue(new Error('mongo down'));
    await daemon.apps.ingest.processResolution('s1-c3a-job-0', 'queue');
    expect(routingPort.emitRouteFailed).toHaveBeenCalledWith('s1-c3a-job-0', 'mongo down');
    expect(routingPort.emitJobQueued).not.toHaveBeenCalled();
    (tui.reader.getQueueDepth as unknown as ReturnType<typeof vi.fn>).mockReturnValue(2);
    (tui.reader.peekPending as unknown as ReturnType<typeof vi.fn>).mockReturnValue([
      's1-c3a-job-2',
      's1-c3a-job-3',
    ]);
    assertPicked(tui, { messageId: 's1-c3a', s1Count: 4, expectedIdx: 1 });
  });

  it('GIVEN s1[4] Indeed pick job-0 WHEN S2c then S3 fail THEN S4 + next pick job-1 · path c3', async () => {
    (tui.reader.getQueueDepth as unknown as ReturnType<typeof vi.fn>).mockReturnValue(3);
    (tui.reader.peekPending as unknown as ReturnType<typeof vi.fn>).mockReturnValue([
      's1-c3b-job-1',
      's1-c3b-job-2',
      's1-c3b-job-3',
    ]);
    await whenS1Many(daemon, s1Indeed4('C3B'), 's1-c3b');
    assertPicked(tui, { messageId: 's1-c3b', s1Count: 4, expectedIdx: 0 });
    storage.findById.mockResolvedValue(makeStage1Partial({ _id: 's1-c3b-job-0' }));
    await daemon.apps.ingest.processIngest(
      JobSource.BROWSER_AUTO,
      JobStage.FULL_PARSED,
      indeedDetailHtml(),
      's1-c3b-job-0'
    );
    storage.findById.mockResolvedValue(
      makeStage1Partial({ _id: 's1-c3b-job-0', status: JobStatus.ENRICHED })
    );
    storage.updateStage.mockRejectedValue(new Error('route down'));
    await daemon.apps.ingest.processResolution('s1-c3b-job-0', 'queue');
    expect(routingPort.emitRouteFailed).toHaveBeenCalled();
    (tui.reader.getQueueDepth as unknown as ReturnType<typeof vi.fn>).mockReturnValue(2);
    (tui.reader.peekPending as unknown as ReturnType<typeof vi.fn>).mockReturnValue([
      's1-c3b-job-2',
      's1-c3b-job-3',
    ]);
    assertPicked(tui, { messageId: 's1-c3b', s1Count: 4, expectedIdx: 1 });
  });

  it('GIVEN S2b 1 job WHEN S2b→ENRICHED then S3 fail THEN S4+clear · path c3', async () => {
    setQueueMode(false);
    (tui.reader.getQueueModeState as unknown as ReturnType<typeof vi.fn>).mockReturnValue(false);
    (tui.reader.getQueueDepth as unknown as ReturnType<typeof vi.fn>).mockReturnValue(0);
    (tui.reader.peekPending as unknown as ReturnType<typeof vi.fn>).mockReturnValue([]);
    tui.ipc.clear();
    await whenS2b(daemon, linkedinSduiDetailHtml('Software Engineer', 'C36Co'));
    const clipId = (storage.upsert.mock.calls[0][0] as { _id: string })._id;
    storage.findById.mockResolvedValue(
      makeStage1Partial({ _id: clipId, status: JobStatus.ENRICHED })
    );
    storage.updateStage.mockRejectedValue(new Error('clip route down'));
    await daemon.apps.ingest.processResolution(clipId, 'queue');
    expect(routingPort.emitRouteFailed).toHaveBeenCalledWith(clipId, 'clip route down');
    await assertDirectClear(tui, daemon, { clipId });
    setQueueMode(true);
  });

  it('GIVEN N failures never leak to terminal THEN next s1[4] pick recovers even asset · path c3 SRE', async () => {
    vi.clearAllMocks();
    (tui.reader.getQueueDepth as unknown as ReturnType<typeof vi.fn>).mockReturnValue(0);
    await whenS1Many(daemon, s1Topcv4('SRE'), 's1-sre');
    expect(parsePort.emitGenerated).toHaveBeenCalled();
    storage.findById.mockResolvedValue(null);
    await daemon.apps.ingest.processIngest(
      JobSource.BROWSER_AUTO,
      JobStage.FULL_PARSED,
      indeedDetailHtml(),
      's1-sre-job-0'
    );
    expect(parsePort.emitCompleted).not.toHaveBeenCalled();
    expect(tui.reader.getQueueDepth()).toBe(0);
  });
});
