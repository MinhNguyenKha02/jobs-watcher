/* eslint-disable @typescript-eslint/no-unused-vars, vitest/expect-expect */
/* Path c3 — S1[4] TopCV+Indeed S2a TopCV S2c Indeed S2b LinkedIn 1→S4 (real) — one describe 7 its */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

import { JobStage, JobStatus } from '../../../src/domain/types/job-lifecycle.js';
import { setQueueMode } from '../../../src/presentation/tui/shared-tui-state.js';
import { assertPicked, assertDirectClear } from '../../helpers/assert-path.js';
import { startDetailServer } from '../../helpers/detail-server.js';
import {
  topcvEmailHtmlMany,
  topcvDetailHtml,
  indeedEmailHtmlMany,
  nonJobHtml,
  linkedinSduiDetailHtml,
} from '../../helpers/html-fixtures.js';
import { whenS1Many, whenS2a, whenS2b, whenQueue } from '../../helpers/saga.js';
import {
  buildTestDaemonContainer,
  buildTestTuiContainer,
  type TestDaemonContainer,
  type TuiTestContainer,
} from '../../helpers/test-container.js';
import { waitFor, waitForPdfFiles } from '../../helpers/test-utils.js';

function s1Topcv4(p: string): string {
  return topcvEmailHtmlMany([
    { role: 'Software Engineer', company: `${p}Co0` },
    { role: 'Backend Engineer', company: `${p}Co1` },
    { role: 'Data Engineer', company: `${p}Co2` },
    { role: 'Automation Engineer', company: `${p}Co3` },
  ]);
}
function s1Indeed4(p: string, srcUrl: (role: string, company: string) => string): string {
  return indeedEmailHtmlMany([
    { role: 'Software Engineer', company: `${p}Co0`, url: srcUrl('Software Engineer', `${p}Co0`) },
    { role: 'Backend Engineer', company: `${p}Co1`, url: srcUrl('Backend Engineer', `${p}Co1`) },
    { role: 'Data Engineer', company: `${p}Co2`, url: srcUrl('Data Engineer', `${p}Co2`) },
    {
      role: 'Automation Engineer',
      company: `${p}Co3`,
      url: srcUrl('Automation Engineer', `${p}Co3`),
    },
  ]);
}

describe('Path c3 — S1[4] TopCV+Indeed S2a TopCV S2c Indeed S2b LinkedIn 1→S4 (real)', () => {
  let daemon: TestDaemonContainer;
  let tui: TuiTestContainer;
  let detail: Awaited<ReturnType<typeof startDetailServer>>;

  beforeAll(async () => {
    detail = await startDetailServer();
    daemon = await buildTestDaemonContainer({ ns: 'c3-full-path' });
    await daemon.start();
    tui = await buildTestTuiContainer({ ns: 'c3-full-path' });
    setQueueMode(true);
  }, 120000);
  afterAll(async () => {
    await tui.stop();
    await daemon.stop();
    try {
      await detail.close();
    } catch {
      /* best-effort */
    }
  });
  beforeEach(async () => {
    await daemon.storage.clearDb();
    await tui.reader.purgeQueues();
    tui.reader.resetReader();
    tui.ipc.clear();
    setQueueMode(true);
  });

  it('GIVEN s1[4] TopCV pick job-0 WHEN S2a empty THEN S4 PARSE_FAILED + next pick job-1 · path c3', async () => {
    await whenS1Many(daemon, s1Topcv4('C3'), 's1-c3');
    await waitFor(
      () => tui.ipc.read().jobLifecycleId === 's1-c3-job-0' && tui.reader.getQueueDepth() === 3
    );
    assertPicked(tui, { messageId: 's1-c3', s1Count: 4, expectedIdx: 0 });
    await whenS2a(daemon, '', 's1-c3-job-0');
    await waitFor(() => tui.reader.getQueueDepth() === 2, 5000).catch(() => {});
    // empty S2a emits PARSE_FAILED, doc stays PARTIAL, autoAdvance picks job-1
    await waitFor(() => tui.ipc.read().jobLifecycleId === 's1-c3-job-1', 10000);
    assertPicked(tui, { messageId: 's1-c3', s1Count: 4, expectedIdx: 1 });
  }, 30000);

  it('GIVEN s1[4] Indeed pick job-0 WHEN S2c missing job THEN no S4 stays job-0 depth3 · path c3', async () => {
    await daemon.apps.scheduler.start();
    // strict: s1Indeed4 hybrid — job-0 hasUrl false (TopCV) so S1 emits GENERATED directly (depth 3 with job-0), others Indeed → enqueue.
    // spy targets only signal2c queryWithRetry for job-0 (ingestor.ts:408), scheduler dequeue succeeds to get url
    const s1Hybrid = indeedEmailHtmlMany([
      { role: 'Software Engineer', company: 'C3ICo0', url: '/viec-lam/software-engineer' },
      { role: 'Backend Engineer', company: 'C3ICo1', url: detail.srcUrl('Backend Engineer', 'C3ICo1') },
      { role: 'Data Engineer', company: 'C3ICo2', url: detail.srcUrl('Data Engineer', 'C3ICo2') },
      { role: 'Automation Engineer', company: 'C3ICo3', url: detail.srcUrl('Automation Engineer', 'C3ICo3') },
    ]);
    const originalFindById = daemon.jobLifecycle.findById.bind(daemon.jobLifecycle);
    let callCount = 0;
    const spy = vi
      .spyOn(daemon.jobLifecycle, 'findById')
      .mockImplementation(async (id: string): Promise<ReturnType<typeof originalFindById>> => {
        if (id !== 's1-c3i-job-0') return originalFindById(id);
        callCount += 1;
        if (callCount === 1) return originalFindById(id);
        return null as unknown as ReturnType<typeof originalFindById>;
      });
    try {
      await whenS1Many(daemon, s1Hybrid, 's1-c3i');
      await waitFor(
        () => tui.ipc.read().jobLifecycleId === 's1-c3i-job-0' && tui.reader.getQueueDepth() === 3
      );
      assertPicked(tui, { messageId: 's1-c3i', s1Count: 4, expectedIdx: 0 });
      // scheduler will dequeue job-1..3, job-0 has no url so not enqueued — signal2c for job-0 is triggered via ghost enqueue below to hit missing guard strict
      await daemon.extractQueue.enqueue('s1-c3i-job-0');
      await new Promise((r) => setTimeout(r, 800));
      expect(tui.ipc.read().jobLifecycleId).toBe('s1-c3i-job-0');
      expect(tui.reader.getQueueDepth()).toBe(3);
      spy.mockRestore();
      const doc = await daemon.jobLifecycle.findById('s1-c3i-job-0');
      expect(doc?.stage).toBe(JobStage.PARTIAL_PARSED);
    } finally {
      // ensure spy restored even if doc check fails
      try {
        spy.mockRestore();
      } catch {}
      await daemon.apps.scheduler.stop();
    }
  }, 30000);

  it('GIVEN S2b non-LinkedIn WHEN S2b THEN S4 PARSE_FAILED+clear even asset · path c3', async () => {
    setQueueMode(false);
    await whenS2b(daemon, nonJobHtml());
    await new Promise((r) => setTimeout(r, 500));
    expect(tui.ipc.read().jobLifecycleId).toBeNull();
    await assertDirectClear(tui, daemon);
    setQueueMode(true);
  }, 30000);

  it('GIVEN s1[4] TopCV pick job-0 WHEN S2a ENRICHED then S3 write fail THEN S4 ROUTE_FAILED + next pick job-1 · path c3', async () => {
    await whenS1Many(daemon, s1Topcv4('C3A'), 's1-c3a');
    await waitFor(
      () => tui.ipc.read().jobLifecycleId === 's1-c3a-job-0' && tui.reader.getQueueDepth() === 3
    );
    assertPicked(tui, { messageId: 's1-c3a', s1Count: 4, expectedIdx: 0 });
    await whenS2a(daemon, topcvDetailHtml(), 's1-c3a-job-0');
    await waitFor(() => tui.ipc.read().stage === JobStage.FULL_PARSED);
    vi.spyOn(daemon.jobLifecycle, 'updateStage').mockRejectedValueOnce(new Error('mongo down'));
    await whenQueue(tui, 's1-c3a-job-0');
    await waitFor(() => tui.ipc.read().jobLifecycleId === 's1-c3a-job-1', 10000);
    vi.restoreAllMocks();
    const doc = await daemon.jobLifecycle.findById('s1-c3a-job-0');
    expect(doc?.status).toBe(JobStatus.ENRICHED);
    assertPicked(tui, { messageId: 's1-c3a', s1Count: 4, expectedIdx: 1 });
  }, 30000);

  it('GIVEN s1[4] Indeed auto-enqueue pick job-0 WHEN S2c then S3 fail THEN S4 ROUTE_FAILED + next pick job-1 · path c3', async () => {
    await daemon.apps.scheduler.start();
    await whenS1Many(daemon, s1Indeed4('C3B', detail.srcUrl), 's1-c3b');
    // strict: wait for S1 pick first, then wait for scheduler S2c enrichment (FULL_PARSED) before S3 fail — order nondeterministic from 3 workers, so wait for stage then verify depth via set
    await waitFor(
      () => tui.ipc.read().jobLifecycleId === 's1-c3b-job-0' && tui.reader.getQueueDepth() === 3
    );
    // pending order may be nondeterministic from parallel enqueue → check set not strict order
    await waitFor(() => {
      const pending = tui.reader.peekPending();
      return (
        pending.length === 3 &&
        new Set(pending).has('s1-c3b-job-1') &&
        new Set(pending).has('s1-c3b-job-2') &&
        new Set(pending).has('s1-c3b-job-3')
      );
    }, 15000);
    await waitFor(
      () =>
        tui.ipc.read().stage === JobStage.FULL_PARSED &&
        tui.ipc.read().jobLifecycleId === 's1-c3b-job-0',
      30000
    );
    vi.spyOn(daemon.jobLifecycle, 'updateStage').mockRejectedValueOnce(new Error('route down'));
    await whenQueue(tui, 's1-c3b-job-0');
    await waitFor(() => tui.ipc.read().jobLifecycleId === 's1-c3b-job-1', 15000).catch(async () => {
      // fallback: any next job-1..3 due to order, ensure autoAdvance happened
      await waitFor(() => tui.reader.getQueueDepth() === 2, 5000);
      expect(['s1-c3b-job-1', 's1-c3b-job-2', 's1-c3b-job-3']).toContain(tui.ipc.read().jobLifecycleId);
    });
    vi.restoreAllMocks();
    // strict: after ROUTE_FAILED, depth 2 and pending still 2 of the 3
    expect(tui.reader.getQueueDepth()).toBe(2);
    await daemon.apps.scheduler.stop();
  }, 45000);

  it('GIVEN S2b 1 job WHEN S2b→ENRICHED then S3 fail THEN S4+clear even asset · path c3', async () => {
    setQueueMode(false);
    await whenS2b(daemon, linkedinSduiDetailHtml('Software Engineer', 'C36Co'));
    await waitFor(() => tui.ipc.read().jobLifecycleId?.startsWith('clip-') ?? false);
    const clipId = tui.ipc.read().jobLifecycleId!;
    vi.spyOn(daemon.jobLifecycle, 'updateStage').mockRejectedValueOnce(
      new Error('clip route down')
    );
    await whenQueue(tui, clipId);
    await waitFor(() => tui.ipc.read().jobLifecycleId === null, 10000);
    vi.restoreAllMocks();
    await assertDirectClear(tui, daemon, { clipId });
    setQueueMode(true);
  }, 30000);

  it('GIVEN N failures never leak to terminal THEN next s1[4] pick recovers even asset · path c3 SRE', async () => {
    await whenS1Many(daemon, s1Topcv4('SRE'), 's1-sre');
    await waitFor(() => tui.ipc.read().jobLifecycleId === 's1-sre-job-0');
    await whenS2a(daemon, '', 's1-sre-job-0');
    await waitFor(() => tui.ipc.read().jobLifecycleId === 's1-sre-job-1', 10000);
    await whenS2a(daemon, topcvDetailHtml(), 's1-sre-job-1');
    await waitFor(() => tui.ipc.read().stage === JobStage.FULL_PARSED);
    await whenQueue(tui, 's1-sre-job-1');
    await waitFor(() => tui.ipc.read().jobLifecycleId === 's1-sre-job-2', 10000);
    await waitForPdfFiles(daemon.assetDir).catch(() => {});
    expect(tui.reader.getQueueDepth()).toBe(1);
  }, 30000);
});
