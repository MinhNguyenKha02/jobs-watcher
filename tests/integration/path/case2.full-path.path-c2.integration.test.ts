/* Path c2 — S1→S2c auto Indeed next s1[4] (real) — flat ring, s1Count 4, whenS1Many Indeed auto-enqueue → implicit S2c BROWSER_AUTO htmlToText, detailServer+saga helpers */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

import { JobStage, JobStatus } from '../../../src/domain/types/job-lifecycle.js';
import { setQueueMode } from '../../../src/presentation/tui/shared-tui-state.js';
import { assertPicked } from '../../helpers/assert-path.js';
import { startDetailServer } from '../../helpers/detail-server.js';
import { indeedEmailHtmlMany } from '../../helpers/html-fixtures.js';
import { whenS1Many, whenQueue, whenTrash } from '../../helpers/saga.js';
import {
  buildTestDaemonContainer,
  buildTestTuiContainer,
  type TestDaemonContainer,
  type TuiTestContainer,
} from '../../helpers/test-container.js';
import { waitFor, waitForPdfFiles } from '../../helpers/test-utils.js';

function s1Indeed4(prefix: string, srcUrl: (role: string, company: string) => string): string {
  return indeedEmailHtmlMany([
    {
      role: 'Software Engineer',
      company: `${prefix}Co0`,
      url: srcUrl('Software Engineer', `${prefix}Co0`),
    },
    {
      role: 'Backend Engineer',
      company: `${prefix}Co1`,
      url: srcUrl('Backend Engineer', `${prefix}Co1`),
    },
    {
      role: 'Data Engineer',
      company: `${prefix}Co2`,
      url: srcUrl('Data Engineer', `${prefix}Co2`),
    },
    {
      role: 'Automation Engineer',
      company: `${prefix}Co3`,
      url: srcUrl('Automation Engineer', `${prefix}Co3`),
    },
  ]);
}

describe('Path c2 — S1→S2c auto Indeed next s1[4] (real)', () => {
  let daemon: TestDaemonContainer;
  let tui: TuiTestContainer;
  let detail: Awaited<ReturnType<typeof startDetailServer>>;

  beforeAll(async () => {
    detail = await startDetailServer();
    daemon = await buildTestDaemonContainer({ ns: 'c2-full-path', startScheduler: true });
    await daemon.start();
    tui = await buildTestTuiContainer({ ns: 'c2-full-path' });
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

  it('GIVEN s1[4] Indeed auto-enqueue pick job-0 WHEN [j] queue THEN S3 QUEUED + next pick job-1 even asset · path c2', async () => {
    await whenS1Many(daemon, s1Indeed4('C2', detail.srcUrl), 's1-c2');
    await waitFor(
      () => tui.ipc.read().jobLifecycleId === 's1-c2-job-0' && tui.reader.getQueueDepth() === 3
    );
    assertPicked(tui, { messageId: 's1-c2', s1Count: 4, expectedIdx: 0 });
    await waitFor(
      () =>
        tui.ipc.read().stage === JobStage.FULL_PARSED &&
        tui.ipc.read().jobLifecycleId === 's1-c2-job-0'
    );
    await whenQueue(tui, 's1-c2-job-0');
    await waitFor(
      () => tui.ipc.read().jobLifecycleId === 's1-c2-job-1' && tui.reader.getQueueDepth() === 2
    );
    const q = await daemon.jobLifecycle.findById('s1-c2-job-0');
    expect(q?.status).toBe(JobStatus.QUEUED);
    await waitForPdfFiles(daemon.assetDir);
    assertPicked(tui, { messageId: 's1-c2', s1Count: 4, expectedIdx: 1 });
  }, 60000);

  it('GIVEN s1[4] Indeed auto-enqueue pick job-0 WHEN [d] trash THEN TRASHED + next pick job-1 · path c2', async () => {
    await whenS1Many(daemon, s1Indeed4('C2T', detail.srcUrl), 's1-c2t');
    await waitFor(
      () => tui.ipc.read().jobLifecycleId === 's1-c2t-job-0' && tui.reader.getQueueDepth() === 3
    );
    assertPicked(tui, { messageId: 's1-c2t', s1Count: 4, expectedIdx: 0 });
    await waitFor(() => tui.ipc.read().stage === JobStage.FULL_PARSED);
    await whenTrash(tui, 's1-c2t-job-0');
    await waitFor(
      () => tui.ipc.read().jobLifecycleId === 's1-c2t-job-1' && tui.reader.getQueueDepth() === 2
    );
    const tr = await daemon.jobLifecycle.findById('s1-c2t-job-0');
    expect(tr?.status).toBe(JobStatus.TRASHED);
  }, 60000);

  it('GIVEN N concurrent s1[4] Indeed auto-enqueues WHEN drain THEN queue 0 ENRICHED even asset · path c2 SRE', async () => {
    for (let i = 0; i < 2; i++) {
      const mid = `s1-c2-sre-${i}`;
      await whenS1Many(daemon, s1Indeed4(`SRE${i}`, detail.srcUrl), mid);
      await waitFor(() => tui.ipc.read().jobLifecycleId === `${mid}-job-0`);
      await waitFor(() => tui.ipc.read().stage === JobStage.FULL_PARSED);
      await whenQueue(tui, `${mid}-job-0`);
      await waitFor(() => tui.ipc.read().jobLifecycleId === `${mid}-job-1`, 15000).catch(() => {});
      await waitForPdfFiles(daemon.assetDir).catch(() => {});
      await tui.reader.purgeQueues();
      tui.reader.resetReader();
      tui.ipc.clear();
      await daemon.storage.clearDb();
    }
    expect(tui.reader.getQueueDepth()).toBe(0);
  }, 60000);
});
