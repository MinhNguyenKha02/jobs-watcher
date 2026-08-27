/*
 * Path c2 — S1→S2c→S3 next s1[4] (mocked) — flat ring, s1Count 4
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { JobStage, JobStatus, JobSource } from '../../../src/domain/types/job-lifecycle.js';
import { indeedEmailHtmlMany, indeedDetailHtml } from '../../helpers/html-fixtures.js';
import { makeStage1Partial } from '../../helpers/test-builders.js';
import { assertPicked } from '../../helpers/assert-path.js';
import { whenS1Many, whenQueue, whenTrash } from '../../helpers/saga.js';
import {
  mockJobLifecyclePort,
  mockExtractionQueuePort,
  mockParsePort,
  mockRoutingPort,
  mockBrowserPort,
  mockIngestorPort,
  mockJobEventReaderPort,
  mockActionWriterPort,
  buildTestDaemonContainer,
  buildTestTuiContainer,
} from '../../helpers/test-container.js';
import { setQueueMode } from '../../../src/presentation/tui/shared-tui-state.js';

function s1Indeed4(prefix: string): string {
  return indeedEmailHtmlMany([
    { role: 'Software Engineer', company: `${prefix}Co0`, url: `https://vn.indeed.com/rc/clk/dl?jk=${prefix}0` },
    { role: 'Backend Engineer', company: `${prefix}Co1`, url: `https://vn.indeed.com/viewjob?jk=${prefix}1` },
    { role: 'Data Engineer', company: `${prefix}Co2`, url: `https://vn.indeed.com/rc/clk/dl?jk=${prefix}2` },
    { role: 'Automation Engineer', company: `${prefix}Co3`, url: `https://vn.indeed.com/viewjob?jk=${prefix}3` },
  ]);
}

describe('Path c2 — S1→S2c→S3 next s1[4] (mocked)', () => {
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
    (tui.reader.peekPending as unknown as ReturnType<typeof vi.fn>).mockReturnValue(['s1-c2-job-1', 's1-c2-job-2', 's1-c2-job-3']);
    (tui.reader.getQueueModeState as unknown as ReturnType<typeof vi.fn>).mockReturnValue(true);
  });

  it('GIVEN s1[4] Indeed pick job-0 url WHEN scheduler S2c then [j] queue THEN S3 QUEUED + next pick job-1 · path c2', async () => {
    await whenS1Many(daemon, s1Indeed4('C2'), 's1-c2');
    expect(storage.upsert).toHaveBeenCalledTimes(4);
    expect(queue.enqueue).toHaveBeenCalledTimes(4);
    assertPicked(tui, { messageId: 's1-c2', s1Count: 4, expectedIdx: 0 });

    storage.findById.mockResolvedValue(makeStage1Partial({ _id: 's1-c2-job-0', url: 'https://vn.indeed.com/viewjob?jk=1' }));
    await daemon.apps.ingest.processIngest(JobSource.BROWSER_AUTO, JobStage.FULL_PARSED, indeedDetailHtml(), 's1-c2-job-0');
    expect(parsePort.emitCompleted).toHaveBeenCalled();

    storage.findById.mockResolvedValue(makeStage1Partial({ _id: 's1-c2-job-0', status: JobStatus.ENRICHED }));
    await whenQueue(tui, 's1-c2-job-0');
    await daemon.apps.ingest.processResolution('s1-c2-job-0', 'queue');
    expect(routingPort.emitJobQueued).toHaveBeenCalled();
    assertPicked(tui, { messageId: 's1-c2', s1Count: 4, expectedIdx: 1 });
  });

  it('GIVEN s1[4] Indeed pick job-0 WHEN S2c then [d] trash THEN TRASHED + next pick job-1 · path c2', async () => {
    await whenS1Many(daemon, s1Indeed4('C2T'), 's1-c2t');
    assertPicked(tui, { messageId: 's1-c2', s1Count: 4, expectedIdx: 0 });
    storage.findById.mockResolvedValue(makeStage1Partial({ _id: 's1-c2t-job-0', url: 'https://vn.indeed.com/viewjob?jk=1' }));
    await daemon.apps.ingest.processIngest(JobSource.BROWSER_AUTO, JobStage.FULL_PARSED, indeedDetailHtml(), 's1-c2t-job-0');
    storage.findById.mockResolvedValue(makeStage1Partial({ _id: 's1-c2t-job-0', status: JobStatus.ENRICHED }));
    await whenTrash(tui, 's1-c2t-job-0');
    await daemon.apps.ingest.processResolution('s1-c2t-job-0', 'trash');
    expect(routingPort.emitJobTrashed).toHaveBeenCalledWith('s1-c2t-job-0', 'operator:trash');
    assertPicked(tui, { messageId: 's1-c2', s1Count: 4, expectedIdx: 1 });
  });
});

describe('Path c2 — SRE (mocked)', () => {
  it('GIVEN N concurrent s1[4] enqueues WHEN S2c drain THEN queue 0 ENRICHED · path c2 SRE', async () => {
    const storage2 = mockJobLifecyclePort();
    const queue2 = mockExtractionQueuePort();
    queue2.dequeue.mockResolvedValue(null);
    const browser2 = mockBrowserPort();
    browser2.start.mockResolvedValue(undefined);
    browser2.stop.mockResolvedValue(undefined);
    const ingestorMock = mockIngestorPort();
    const daemon2 = await buildTestDaemonContainer(
      { ns: 'unit-path-c2-sre' },
      { ports: { jobLifecycle: storage2, extractionQueue: queue2, parse: mockParsePort(), route: mockRoutingPort(), browser: browser2, ingestor: ingestorMock, assetProducing: { toAsset: vi.fn().mockResolvedValue({ pdfPath: '' }) } } }
    );
    const scheduler = daemon2.apps.scheduler;
    await scheduler.start();
    expect(browser2.start).toHaveBeenCalledTimes(1);
    await scheduler.stop();
    expect(browser2.stop).toHaveBeenCalledTimes(1);
  });
});
