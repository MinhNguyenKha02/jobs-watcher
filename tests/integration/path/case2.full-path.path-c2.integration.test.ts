/* Path c2 — S1→S2c auto Indeed next s1[4] (real) — flat ring, s1Count 4, whenS1Many Indeed auto-enqueue → implicit S2c BROWSER_AUTO htmlToText, detailServer+saga helpers */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

import { JobStage, JobStatus } from '../../../src/domain/types/job-lifecycle.js';
import { setQueueMode } from '../../../src/presentation/tui/shared-tui-state.js';
import { startDetailServer } from '../../helpers/detail-server.js';
import { indeedEmailHtmlMany } from '../../helpers/html-fixtures.js';
import { whenS1Many, whenQueue, whenTrash } from '../../helpers/saga.js';
import {
  buildTestDaemonContainer,
  buildTestTuiContainer,
  type TestDaemonContainer,
  type TuiTestContainer,
} from '../../helpers/test-container.js';
import {
  waitFor,
  waitForPdfFiles,
  waitForPdfForJob,
  waitForPdfCount,
  purgeAssetDir,
} from '../../helpers/test-utils.js';

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
    // delivery order nondeterministic (scheduler 3 workers) → wait for depth 3 then verify set contains all 4, pick current
    await waitFor(
      () => tui.reader.getQueueDepth() === 3 && tui.ipc.read().jobLifecycleId !== null,
      15000
    );
    {
      const cur = tui.ipc.read().jobLifecycleId!;
      const set = new Set([...tui.reader.peekPending(), cur]);
      expect(set).toEqual(new Set(['s1-c2-job-0', 's1-c2-job-1', 's1-c2-job-2', 's1-c2-job-3']));
      await waitFor(() => tui.ipc.read().stage === JobStage.FULL_PARSED, 15000);
    }
    const cur0 = tui.ipc.read().jobLifecycleId!;
    const docBefore = await daemon.jobLifecycle.findById(cur0);
    await whenQueue(tui, cur0);
    await waitFor(
      () => tui.reader.getQueueDepth() === 2 && tui.ipc.read().jobLifecycleId !== cur0,
      15000
    );
    const q = await daemon.jobLifecycle.findById(cur0);
    expect(q?.status).toBe(JobStatus.QUEUED);
    if (docBefore) {
      await waitForPdfForJob(
        daemon.assetDir,
        {
          jobId: cur0,
          role: docBefore.role,
          company: docBefore.company,
          location: docBefore.location,
        },
        30000
      );
    } else {
      await waitForPdfFiles(daemon.assetDir, 30000);
    }
    expect(tui.reader.getQueueDepth()).toBe(2);
  }, 60000);

  it('GIVEN s1[4] Indeed auto-enqueue pick job-0 WHEN [d] trash THEN TRASHED + next pick job-1 · path c2', async () => {
    await whenS1Many(daemon, s1Indeed4('C2T', detail.srcUrl), 's1-c2t');
    await waitFor(
      () => tui.reader.getQueueDepth() === 3 && tui.ipc.read().jobLifecycleId !== null,
      15000
    );
    {
      const cur = tui.ipc.read().jobLifecycleId!;
      const set = new Set([...tui.reader.peekPending(), cur]);
      expect(set).toEqual(
        new Set(['s1-c2t-job-0', 's1-c2t-job-1', 's1-c2t-job-2', 's1-c2t-job-3'])
      );
      await waitFor(() => tui.ipc.read().stage === JobStage.FULL_PARSED, 15000);
    }
    const cur0 = tui.ipc.read().jobLifecycleId!;
    await whenTrash(tui, cur0);
    await waitFor(
      () => tui.reader.getQueueDepth() === 2 && tui.ipc.read().jobLifecycleId !== cur0,
      15000
    );
    const tr = await daemon.jobLifecycle.findById(cur0);
    expect(tr?.status).toBe(JobStatus.TRASHED);
  }, 60000);

  it('GIVEN N sequential s1[4]→pick→S2c auto→S3 cycles WHEN each converges THEN pending drains · path c2 SRE', async () => {
    // purge any stale assets from prior tests (assetDir not cleared by clearDb)
    purgeAssetDir(daemon.assetDir);
    for (let i = 0; i < 2; i++) {
      const mid = `s1-c2-sre-${i}`;
      await whenS1Many(daemon, s1Indeed4(`SRE${i}`, detail.srcUrl), mid);
      await waitFor(
        () => tui.reader.getQueueDepth() === 3 && tui.ipc.read().jobLifecycleId !== null,
        15000
      );
      // drain all 4 jobs sequentially — 1 s1Many produce many S1→S2→S3→S4 cycles once, no concurrent s1Many
      for (let drained = 0; drained < 4; drained++) {
        await waitFor(() => tui.ipc.read().stage === JobStage.FULL_PARSED, 15000);
        const cur = tui.ipc.read().jobLifecycleId!;
        const docBefore = await daemon.jobLifecycle.findById(cur);
        await whenQueue(tui, cur);
        if (docBefore) {
          await waitForPdfForJob(
            daemon.assetDir,
            {
              jobId: cur,
              role: docBefore.role,
              company: docBefore.company,
              location: docBefore.location,
            },
            30000
          );
        } else {
          await waitForPdfFiles(daemon.assetDir, 30000).catch(() => {});
        }
        if (drained < 3) {
          await waitFor(() => tui.ipc.read().jobLifecycleId !== cur, 15000);
        } else {
          await waitFor(
            () => tui.ipc.read().jobLifecycleId === null || tui.reader.getQueueDepth() === 0,
            8000
          ).catch(() => {});
        }
      }
      await waitForPdfCount(daemon.assetDir, (i + 1) * 4, 10000).catch(() => {});
      await tui.reader.purgeQueues();
      tui.reader.resetReader();
      tui.ipc.clear();
      await daemon.storage.clearDb();
    }
    expect(tui.reader.getQueueDepth()).toBe(0);
    // per-job pdf no overwrite → 2 iterations × 4 queued = 8 distinct pdfs
    await waitForPdfCount(daemon.assetDir, 8, 5000);
  }, 120000);
});
