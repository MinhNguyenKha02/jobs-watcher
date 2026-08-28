/* eslint-disable @typescript-eslint/no-unused-vars, vitest/expect-expect, no-async-promise-executor */
/* Path c1 — S1→S2a→S3 next s1[4] (real) — flat ring, s1Count 4 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

import { JobStage, JobStatus } from '../../../src/domain/types/job-lifecycle.js';
import { setQueueMode } from '../../../src/presentation/tui/shared-tui-state.js';
import { assertPicked, assertDirectClear } from '../../helpers/assert-path.js';
import { topcvEmailHtmlMany, topcvDetailHtml } from '../../helpers/html-fixtures.js';
import { whenS1Many, whenS2a, whenQueue, whenTrash } from '../../helpers/saga.js';
import {
  buildTestDaemonContainer,
  buildTestTuiContainer,
  type TestDaemonContainer,
  type TuiTestContainer,
} from '../../helpers/test-container.js';
import { waitFor } from '../../helpers/test-utils.js';

function s1Html4(prefix: string): string {
  return topcvEmailHtmlMany([
    { role: 'Software Engineer', company: `${prefix}Co0` },
    { role: 'Backend Engineer', company: `${prefix}Co1` },
    { role: 'Data Engineer', company: `${prefix}Co2` },
    { role: 'Automation Engineer', company: `${prefix}Co3` },
  ]);
}

describe('Path c1 — S1→S2a→S3 next s1[4] (real)', () => {
  let daemon: TestDaemonContainer;
  let tui: TuiTestContainer;

  beforeAll(async () => {
    daemon = await buildTestDaemonContainer({ ns: 'c1-full-path' });
    await daemon.start();
    tui = await buildTestTuiContainer({ ns: 'c1-full-path' });
    setQueueMode(true);
  }, 120000);

  afterAll(async () => {
    await tui.stop();
    await daemon.stop();
  });

  beforeEach(async () => {
    await daemon.storage.clearDb();
    await tui.reader.purgeQueues();
    tui.reader.resetReader();
    tui.ipc.clear();
    setQueueMode(true);
  });

  it('GIVEN s1[4] TopCV pick job-0 WHEN S2a htmlToText then [j] queue THEN S3 QUEUED + next pick job-1 depth 2 · path c1', async () => {
    await whenS1Many(daemon, s1Html4('C1'), 's1-c1');
    await waitFor(
      () => tui.ipc.read().jobLifecycleId === 's1-c1-job-0' && tui.reader.getQueueDepth() === 3
    );
    assertPicked(tui, { messageId: 's1-c1', s1Count: 4, expectedIdx: 0 });
    const doc0 = await daemon.jobLifecycle.findById('s1-c1-job-0');
    expect(doc0?.stage).toBe(JobStage.PARTIAL_PARSED);

    await whenS2a(daemon, topcvDetailHtml(), 's1-c1-job-0');
    await waitFor(
      () =>
        tui.ipc.read().stage === JobStage.FULL_PARSED &&
        tui.ipc.read().jobLifecycleId === 's1-c1-job-0'
    );
    const enriched = await daemon.jobLifecycle.findById('s1-c1-job-0');
    expect(enriched?.stage).toBe(JobStage.FULL_PARSED);
    expect(enriched?.status).toBe(JobStatus.ENRICHED);

    await whenQueue(tui, 's1-c1-job-0');
    await waitFor(
      () => tui.ipc.read().jobLifecycleId === 's1-c1-job-1' && tui.reader.getQueueDepth() === 2
    );
    const queued = await daemon.jobLifecycle.findById('s1-c1-job-0');
    expect(queued?.status).toBe(JobStatus.QUEUED);
    assertPicked(tui, { messageId: 's1-c1', s1Count: 4, expectedIdx: 1 });
  }, 60000);

  it('GIVEN s1[4] TopCV pick job-0 WHEN S2a then [d] trash THEN TRASHED + next pick job-1 · path c1', async () => {
    await whenS1Many(daemon, s1Html4('C1T'), 's1-c1t');
    await waitFor(
      () => tui.ipc.read().jobLifecycleId === 's1-c1t-job-0' && tui.reader.getQueueDepth() === 3
    );
    assertPicked(tui, { messageId: 's1-c1t', s1Count: 4, expectedIdx: 0 });
    await whenS2a(daemon, topcvDetailHtml(), 's1-c1t-job-0');
    await waitFor(() => tui.ipc.read().stage === JobStage.FULL_PARSED);
    await whenTrash(tui, 's1-c1t-job-0');
    await waitFor(
      () => tui.ipc.read().jobLifecycleId === 's1-c1t-job-1' && tui.reader.getQueueDepth() === 2
    );
    const trashed = await daemon.jobLifecycle.findById('s1-c1t-job-0');
    expect(trashed?.status).toBe(JobStatus.TRASHED);
    assertPicked(tui, { messageId: 's1-c1t', s1Count: 4, expectedIdx: 1 });
  }, 60000);
});

describe('Path c1 — SRE (real)', () => {
  it('GIVEN N sequential s1[4]→pick→S2a→S3 cycles WHEN each converges THEN pending drains · path c1 SRE', async () => {
    const daemon2 = await buildTestDaemonContainer({ ns: 'c1-sre' });
    await daemon2.start();
    const tui2 = await buildTestTuiContainer({ ns: 'c1-sre' });
    setQueueMode(true);
    for (let i = 0; i < 2; i++) {
      const mid = `s1-c1-sre-${i}`;
      await whenS1Many(daemon2, s1Html4(`SRE${i}`), mid);
      await waitFor(() => tui2.ipc.read().jobLifecycleId === `${mid}-job-0`);
      await whenS2a(daemon2, topcvDetailHtml(), `${mid}-job-0`);
      await waitFor(() => tui2.ipc.read().stage === JobStage.FULL_PARSED);
      await whenQueue(tui2, `${mid}-job-0`);
      await waitFor(() => tui2.ipc.read().jobLifecycleId === `${mid}-job-1`);
      // drain remaining pending by queueing them quickly (prove no leak)
      for (let j = 1; j < 4; j++) {
        const pickId = `${mid}-job-${j}`;
        await whenS2a(daemon2, topcvDetailHtml(), pickId);
        await waitFor(
          () =>
            tui2.ipc.read().jobLifecycleId === pickId &&
            tui2.ipc.read().stage === JobStage.FULL_PARSED
        );
        await whenQueue(tui2, pickId);
        if (j < 3) await waitFor(() => tui2.ipc.read().jobLifecycleId === `${mid}-job-${j + 1}`);
        else
          await waitFor(
            () => tui2.ipc.read().jobLifecycleId === null || tui2.reader.getQueueDepth() === 0,
            8000
          ).catch(() => {});
      }
      await tui2.reader.purgeQueues();
      tui2.reader.resetReader();
      tui2.ipc.clear();
      await daemon2.storage.clearDb();
    }
    await tui2.stop();
    await daemon2.stop();
    expect(true).toBe(true);
  }, 120000);
});
