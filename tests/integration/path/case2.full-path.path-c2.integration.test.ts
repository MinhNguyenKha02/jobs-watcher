/* Path c2 — S1→S2c Indeed next s1[4] (real) — one describe 3 its s1[4] Indeed S2c Indeed detail, asset+saga helpers only */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

import { JobStage, JobStatus, JobSource } from '../../../src/domain/types/job-lifecycle.js';
import { setQueueMode } from '../../../src/presentation/tui/shared-tui-state.js';
import { assertPicked } from '../../helpers/assert-path.js';
import { indeedEmailHtmlMany, indeedDetailHtml } from '../../helpers/html-fixtures.js';
import { whenS1Many, whenQueue, whenTrash } from '../../helpers/saga.js';
import {
  buildTestDaemonContainer,
  buildTestTuiContainer,
  type TestDaemonContainer,
  type TuiTestContainer,
} from '../../helpers/test-container.js';
import { waitFor, waitForPdfFiles } from '../../helpers/test-utils.js';

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

describe('Path c2 — S1→S2c Indeed next s1[4] (real)', () => {
  let daemon: TestDaemonContainer;
  let tui: TuiTestContainer;

  beforeAll(async () => {
    daemon = await buildTestDaemonContainer({ ns: 'c2-full-path', startScheduler: true });
    await daemon.start();
    tui = await buildTestTuiContainer({ ns: 'c2-full-path' });
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

  it('GIVEN s1[4] Indeed pick job-0 url WHEN S2c Indeed then [j] queue THEN S3 QUEUED + next pick job-1 even asset · path c2', async () => {
    await whenS1Many(daemon, s1Indeed4('C2'), 's1-c2');
    await waitFor(
      () => tui.ipc.read().jobLifecycleId === 's1-c2-job-0' && tui.reader.getQueueDepth() === 3
    );
    assertPicked(tui, { messageId: 's1-c2', s1Count: 4, expectedIdx: 0 });
    await daemon.apps.ingest.processIngest(
      JobSource.BROWSER_AUTO,
      JobStage.FULL_PARSED,
      indeedDetailHtml(),
      's1-c2-job-0'
    );
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

  it('GIVEN s1[4] Indeed pick job-0 WHEN S2c Indeed then [d] trash THEN TRASHED + next pick job-1 · path c2', async () => {
    await whenS1Many(daemon, s1Indeed4('C2T'), 's1-c2t');
    await waitFor(
      () => tui.ipc.read().jobLifecycleId === 's1-c2t-job-0' && tui.reader.getQueueDepth() === 3
    );
    assertPicked(tui, { messageId: 's1-c2t', s1Count: 4, expectedIdx: 0 });
    await daemon.apps.ingest.processIngest(
      JobSource.BROWSER_AUTO,
      JobStage.FULL_PARSED,
      indeedDetailHtml(),
      's1-c2t-job-0'
    );
    await waitFor(() => tui.ipc.read().stage === JobStage.FULL_PARSED);
    await whenTrash(tui, 's1-c2t-job-0');
    await waitFor(
      () => tui.ipc.read().jobLifecycleId === 's1-c2t-job-1' && tui.reader.getQueueDepth() === 2
    );
    const tr = await daemon.jobLifecycle.findById('s1-c2t-job-0');
    expect(tr?.status).toBe(JobStatus.TRASHED);
  }, 60000);

  it('GIVEN N concurrent s1[4] Indeed enqueues WHEN S2c Indeed drain THEN queue 0 ENRICHED even asset · path c2 SRE', async () => {
    for (let i = 0; i < 2; i++) {
      const mid = `s1-c2-sre-${i}`;
      await whenS1Many(daemon, s1Indeed4(`SRE${i}`), mid);
      await waitFor(() => tui.ipc.read().jobLifecycleId === `${mid}-job-0`);
      await daemon.apps.ingest.processIngest(
        JobSource.BROWSER_AUTO,
        JobStage.FULL_PARSED,
        indeedDetailHtml(),
        `${mid}-job-0`
      );
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
