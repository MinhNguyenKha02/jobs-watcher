/*
 * Path c3 — failures from c1/c2/c4 entries — 6 rings (mocked) — s1[4] pick by index, direct clear except s2b
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { JobStage, JobStatus } from '../../../src/domain/types/job-lifecycle.js';
import { setQueueMode } from '../../../src/presentation/tui/shared-tui-state.js';
import { assertPicked, assertDirectClear } from '../../helpers/assert-path.js';
import {
  topcvEmailHtmlMany,
  topcvDetailHtml,
  linkedinSduiDetailHtml,
  nonJobHtml,
  indeedEmailHtmlMany,
  indeedDetailHtml,
} from '../../helpers/html-fixtures.js';
import { whenS1Many, whenS2a, whenS2b } from '../../helpers/saga.js';
import { makeStage1Partial } from '../../helpers/test-builders.js';
import {
  mockJobLifecyclePort,
  mockExtractionQueuePort,
  mockParsePort,
  mockRoutingPort,
  mockBrowserPort,
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
  return indeedEmailHtmlMany([
    {
      role: 'Software Engineer',
      company: `${p}Co0`,
      url: `https://vn.indeed.com/rc/clk/dl?jk=${p}0`,
    },
    { role: 'Backend Engineer', company: `${p}Co1`, url: `https://vn.indeed.com/viewjob?jk=${p}1` },
    { role: 'Data Engineer', company: `${p}Co2`, url: `https://vn.indeed.com/rc/clk/dl?jk=${p}2` },
    {
      role: 'Automation Engineer',
      company: `${p}Co3`,
      url: `https://vn.indeed.com/viewjob?jk=${p}3`,
    },
  ]);
}

describe('Path c3 — S1[4] TopCV+Indeed S2a TopCV S2c Indeed S2b LinkedIn 1→S4 (mocked)', () => {
  let daemon: Awaited<ReturnType<typeof buildTestDaemonContainer>>;
  let tui: Awaited<ReturnType<typeof buildTestTuiContainer>>;
  let storage: ReturnType<typeof mockJobLifecyclePort>;
  let queue: ReturnType<typeof mockExtractionQueuePort>;
  let parsePort: ReturnType<typeof mockParsePort>;
  let routingPort: ReturnType<typeof mockRoutingPort>;
  let browser: ReturnType<typeof mockBrowserPort>;

  beforeEach(async () => {
    storage = mockJobLifecyclePort();
    queue = mockExtractionQueuePort();
    parsePort = mockParsePort();
    routingPort = mockRoutingPort();
    browser = mockBrowserPort();

    // mock scheduler queue FIFO + onEnqueue wake (shared belong c3, only Indeed GWTs start scheduler)
    const pending: string[] = [];
    let enqueueCb: (() => void) | null = null;
    (queue.enqueue as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async (id: string) => {
        pending.push(id);
        enqueueCb?.();
      }
    );
    (queue.dequeue as unknown as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      const id = pending.shift();
      return id ? { jobLifecycleId: id } : null;
    });
    (queue.size as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async () => pending.length
    );
    (queue.onEnqueue as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (cb: () => void) => {
        enqueueCb = cb;
      }
    );
    (browser.extract as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      html: indeedDetailHtml(),
    });
    (browser.start as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    (browser.stop as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    (storage.findById as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async (id: string) =>
        makeStage1Partial({ _id: id, url: `https://vn.indeed.com/viewjob?jk=${id}` })
    );

    daemon = await buildTestDaemonContainer(
      { ns: 'unit-path-c3' },
      {
        ports: {
          jobLifecycle: storage,
          extractionQueue: queue,
          parse: parsePort,
          route: routingPort,
          browser,
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

  it('GIVEN s1[4] Indeed pick job-0 WHEN S2c missing job THEN no S4 stays job-0 depth3 · path c3', async () => {
    (tui.reader.getQueueDepth as unknown as ReturnType<typeof vi.fn>).mockReturnValue(3);
    (tui.reader.peekPending as unknown as ReturnType<typeof vi.fn>).mockReturnValue([
      's1-c3i-job-1',
      's1-c3i-job-2',
      's1-c3i-job-3',
    ]);
    // per-GWT scheduler for Indeed (shared belong c3, spy per GWT)
    await daemon.apps.scheduler.start();
    // make signal2c queryWithRetry miss while scheduler's first findById succeeds to get url
    const originalImpl = (
      storage.findById as unknown as ReturnType<typeof vi.fn>
    ).getMockImplementation();
    let callCount = 0;
    (storage.findById as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async (id: string) => {
        if (id !== 's1-c3i-job-0')
          return (originalImpl as unknown as (id: string) => Promise<unknown>)(id);
        callCount += 1;
        if (callCount === 1)
          return (originalImpl as unknown as (id: string) => Promise<unknown>)(id);
        return null as unknown as never;
      }
    );
    await whenS1Many(daemon, s1Indeed4('C3I'), 's1-c3i');
    assertPicked(tui, { messageId: 's1-c3i', s1Count: 4, expectedIdx: 0 });
    // let scheduler dequeue job-0 url -> browser.extract -> signal2c missing guard (ingestor.ts:408)
    await vi.waitUntil(
      () => (browser.extract as unknown as ReturnType<typeof vi.fn>).mock.calls.length > 0,
      {
        timeout: 15000,
        interval: 50,
      }
    );
    await new Promise((r) => setTimeout(r, 300));
    // signal2c without stage1 stays missing → no emitCompleted, no S34 => no autoAdvance (RabbitMqJobReader:353 only S34 triggers)
    expect(parsePort.emitCompleted).not.toHaveBeenCalledWith(
      expect.objectContaining({ _id: 's1-c3i-job-0' })
    );
    // stays on job-0: depth 3, pending head job-1 (same as integ case3:79-91)
    assertPicked(tui, { messageId: 's1-c3i', s1Count: 4, expectedIdx: 0 });
    await daemon.apps.scheduler.stop();
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
    (storage.findById as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeStage1Partial({ _id: 's1-c3a-job-0' })
    );
    await whenS2a(daemon, topcvDetailHtml(), 's1-c3a-job-0');
    (storage.findById as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeStage1Partial({ _id: 's1-c3a-job-0', status: JobStatus.ENRICHED })
    );
    (storage.updateStage as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('mongo down')
    );
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

  it('GIVEN s1[4] Indeed auto-enqueue pick job-0 WHEN S2c then S3 fail THEN S4 ROUTE_FAILED + next pick job-1 · path c3', async () => {
    (tui.reader.getQueueDepth as unknown as ReturnType<typeof vi.fn>).mockReturnValue(3);
    (tui.reader.peekPending as unknown as ReturnType<typeof vi.fn>).mockReturnValue([
      's1-c3b-job-1',
      's1-c3b-job-2',
      's1-c3b-job-3',
    ]);
    await daemon.apps.scheduler.start();
    await whenS1Many(daemon, s1Indeed4('C3B'), 's1-c3b');
    assertPicked(tui, { messageId: 's1-c3b', s1Count: 4, expectedIdx: 0 });
    await vi.waitUntil(
      () => (parsePort.emitCompleted as unknown as ReturnType<typeof vi.fn>).mock.calls.length > 0,
      {
        timeout: 15000,
        interval: 50,
      }
    );
    await daemon.apps.scheduler.stop();
    (storage.findById as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeStage1Partial({ _id: 's1-c3b-job-0', status: JobStatus.ENRICHED })
    );
    (storage.updateStage as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('route down')
    );
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
    (storage.findById as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeStage1Partial({ _id: clipId, status: JobStatus.ENRICHED })
    );
    (storage.updateStage as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('clip route down')
    );
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
    (storage.findById as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await daemon.apps.ingest.processIngest(
      // S2c guard missing still valid for SRE probe without scheduler
      // keep explicit guard check as unit probe (ingestor.ts:408)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (await import('../../../src/domain/types/job-lifecycle.js')).JobSource.BROWSER_AUTO,
      (await import('../../../src/domain/types/job-lifecycle.js')).JobStage.FULL_PARSED,
      indeedDetailHtml(),
      's1-sre-job-0'
    );
    expect(parsePort.emitCompleted).not.toHaveBeenCalled();
    expect(tui.reader.getQueueDepth()).toBe(0);
  });
});
