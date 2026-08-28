/* eslint-disable @typescript-eslint/no-unused-vars, vitest/expect-expect, no-async-promise-executor */
/*
 * Path c2 — S1→S2c auto→S3 next s1[4] (mocked) — flat ring, s1Count 4, whenS1Many only
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { JobStatus } from '../../../src/domain/types/job-lifecycle.js';
import { setQueueMode } from '../../../src/presentation/tui/shared-tui-state.js';
import { assertPicked } from '../../helpers/assert-path.js';
import { indeedEmailHtmlMany, indeedDetailHtml } from '../../helpers/html-fixtures.js';
import { whenS1Many, whenQueue, whenTrash } from '../../helpers/saga.js';
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

function s1Indeed4(prefix: string): string {
  return indeedEmailHtmlMany([
    {
      role: 'Software Engineer',
      company: `${prefix}Co0`,
      url: `https://vn.indeed.com/rc/clk/dl?jk=${prefix}0`,
    },
    {
      role: 'Backend Engineer',
      company: `${prefix}Co1`,
      url: `https://vn.indeed.com/viewjob?jk=${prefix}1`,
    },
    {
      role: 'Data Engineer',
      company: `${prefix}Co2`,
      url: `https://vn.indeed.com/rc/clk/dl?jk=${prefix}2`,
    },
    {
      role: 'Automation Engineer',
      company: `${prefix}Co3`,
      url: `https://vn.indeed.com/viewjob?jk=${prefix}3`,
    },
  ]);
}

describe('Path c2 — S1→S2c auto Indeed next s1[4] (mocked)', () => {
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

    // mock scheduler queue with in-memory FIFO + onEnqueue wake
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
      { ns: 'unit-path-c2' },
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
      { ns: 'unit-path-c2' },
      { ports: { rmqReader: mockJobEventReaderPort(), udsWriter: mockActionWriterPort() } }
    );
    setQueueMode(true);
    (tui.reader.getQueueDepth as unknown as ReturnType<typeof vi.fn>).mockReturnValue(3);
    (tui.reader.peekPending as unknown as ReturnType<typeof vi.fn>).mockReturnValue([
      's1-c2-job-1',
      's1-c2-job-2',
      's1-c2-job-3',
    ]);
    (tui.reader.getQueueModeState as unknown as ReturnType<typeof vi.fn>).mockReturnValue(true);
  });

  it('GIVEN s1[4] Indeed auto-enqueue pick job-0 WHEN [j] queue THEN S3 QUEUED + next pick job-1 · path c2', async () => {
    await daemon.apps.scheduler.start();
    await whenS1Many(daemon, s1Indeed4('C2'), 's1-c2');
    expect(storage.upsert).toHaveBeenCalledTimes(4);
    expect(queue.enqueue).toHaveBeenCalledTimes(4);
    assertPicked(tui, { messageId: 's1-c2', s1Count: 4, expectedIdx: 0 });

    await vi.waitUntil(
      () => (parsePort.emitCompleted as unknown as ReturnType<typeof vi.fn>).mock.calls.length > 0,
      {
        timeout: 15000,
        interval: 50,
      }
    );
    expect(parsePort.emitCompleted).toHaveBeenCalled();
    await daemon.apps.scheduler.stop();

    (storage.findById as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeStage1Partial({ _id: 's1-c2-job-0', status: JobStatus.ENRICHED })
    );
    await whenQueue(tui, 's1-c2-job-0');
    await daemon.apps.ingest.processResolution('s1-c2-job-0', 'queue');
    expect(routingPort.emitJobQueued).toHaveBeenCalled();
    (tui.reader.getQueueDepth as unknown as ReturnType<typeof vi.fn>).mockReturnValue(2);
    (tui.reader.peekPending as unknown as ReturnType<typeof vi.fn>).mockReturnValue([
      's1-c2-job-2',
      's1-c2-job-3',
    ]);
    assertPicked(tui, { messageId: 's1-c2', s1Count: 4, expectedIdx: 1 });
  });

  it('GIVEN s1[4] Indeed auto-enqueue pick job-0 WHEN [d] trash THEN TRASHED + next pick job-1 · path c2', async () => {
    (tui.reader.getQueueDepth as unknown as ReturnType<typeof vi.fn>).mockReturnValue(3);
    (tui.reader.peekPending as unknown as ReturnType<typeof vi.fn>).mockReturnValue([
      's1-c2t-job-1',
      's1-c2t-job-2',
      's1-c2t-job-3',
    ]);
    await daemon.apps.scheduler.start();
    await whenS1Many(daemon, s1Indeed4('C2T'), 's1-c2t');
    assertPicked(tui, { messageId: 's1-c2t', s1Count: 4, expectedIdx: 0 });
    await vi.waitUntil(
      () => (parsePort.emitCompleted as unknown as ReturnType<typeof vi.fn>).mock.calls.length > 0,
      {
        timeout: 15000,
        interval: 50,
      }
    );
    await daemon.apps.scheduler.stop();
    (storage.findById as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeStage1Partial({ _id: 's1-c2t-job-0', status: JobStatus.ENRICHED })
    );
    await whenTrash(tui, 's1-c2t-job-0');
    await daemon.apps.ingest.processResolution('s1-c2t-job-0', 'trash');
    expect(routingPort.emitJobTrashed).toHaveBeenCalledWith('s1-c2t-job-0', 'operator:trash');
    (tui.reader.getQueueDepth as unknown as ReturnType<typeof vi.fn>).mockReturnValue(2);
    (tui.reader.peekPending as unknown as ReturnType<typeof vi.fn>).mockReturnValue([
      's1-c2t-job-2',
      's1-c2t-job-3',
    ]);
    assertPicked(tui, { messageId: 's1-c2t', s1Count: 4, expectedIdx: 1 });
  });

  it('GIVEN scheduler idle WHEN start/stop THEN browser lifecycle · path c2 SRE', async () => {
    (queue.dequeue as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const scheduler = daemon.apps.scheduler;
    await scheduler.start();
    expect(browser.start).toHaveBeenCalledTimes(1);
    await scheduler.stop();
    expect(browser.stop).toHaveBeenCalledTimes(1);
  });
});
