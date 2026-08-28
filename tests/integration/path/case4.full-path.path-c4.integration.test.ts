/* eslint-disable @typescript-eslint/no-unused-vars, vitest/expect-expect, no-async-promise-executor */
/* Path c4 — S2b LinkedIn 1→S3+clear except s2b (real) — one describe 3 its s1[4] not used, direct clear, asset+saga helpers only */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

import { JobStage, JobStatus } from '../../../src/domain/types/job-lifecycle.js';
import { setQueueMode } from '../../../src/presentation/tui/shared-tui-state.js';
import { assertDirectClear } from '../../helpers/assert-path.js';
import { linkedinSduiDetailHtml } from '../../helpers/html-fixtures.js';
import { whenS2b, whenQueue, whenTrash } from '../../helpers/saga.js';
import {
  buildTestDaemonContainer,
  buildTestTuiContainer,
  type TestDaemonContainer,
  type TuiTestContainer,
} from '../../helpers/test-container.js';
import { waitFor, waitForPdfFiles } from '../../helpers/test-utils.js';

describe('Path c4 — S2b LinkedIn 1→S3+clear except s2b (real)', () => {
  let daemon: TestDaemonContainer;
  let tui: TuiTestContainer;

  beforeAll(async () => {
    daemon = await buildTestDaemonContainer({ ns: 'c4-full-path' });
    await daemon.start();
    tui = await buildTestTuiContainer({ ns: 'c4-full-path' });
    setQueueMode(false);
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
    setQueueMode(false);
  });

  it('GIVEN S2b LinkedIn 1 job [b]=direct WHEN [j] queue THEN S3 QUEUED+clear empty ipc even asset · path c4', async () => {
    const before = await daemon.mongo.raw('job_lifecycle').countDocuments({});
    await whenS2b(daemon, linkedinSduiDetailHtml('Software Engineer', 'C4Co'));
    await waitFor(() => tui.ipc.read().jobLifecycleId?.startsWith('clip-') ?? false);
    const clipId = tui.ipc.read().jobLifecycleId!;
    expect(clipId).toMatch(/^clip-/);
    const after = await daemon.mongo.raw('job_lifecycle').countDocuments({});
    expect(after).toBe(before + 1);
    await whenQueue(tui, clipId);
    await waitFor(() => tui.ipc.read().jobLifecycleId === null);
    const doc = await daemon.jobLifecycle.findById(clipId);
    expect(doc?.status).toBe(JobStatus.QUEUED);
    await waitForPdfFiles(daemon.assetDir);
    await assertDirectClear(tui, daemon, { clipId });
  }, 60000);

  it('GIVEN S2b 1 job WHEN [d] trash THEN TRASHED+clear · path c4', async () => {
    await whenS2b(daemon, linkedinSduiDetailHtml('Backend Engineer', 'C4Co2'));
    await waitFor(() => tui.ipc.read().jobLifecycleId?.startsWith('clip-') ?? false);
    const clipId = tui.ipc.read().jobLifecycleId!;
    await whenTrash(tui, clipId);
    await waitFor(() => tui.ipc.read().jobLifecycleId === null);
    const doc = await daemon.jobLifecycle.findById(clipId);
    expect(doc?.status).toBe(JobStatus.TRASHED);
    await assertDirectClear(tui, daemon, { clipId });
  }, 60000);

  it('GIVEN random S2b LinkedIn 1 singles WHEN S3 drain THEN never enqueue ipc clears even asset · path c4 SRE', async () => {
    for (let i = 0; i < 2; i++) {
      await whenS2b(daemon, linkedinSduiDetailHtml(`Automation Engineer`, `C4SRE${i}`));
      await waitFor(() => tui.ipc.read().jobLifecycleId?.startsWith('clip-') ?? false);
      const cid = tui.ipc.read().jobLifecycleId!;
      await whenQueue(tui, cid);
      await waitFor(() => tui.ipc.read().jobLifecycleId === null);
      expect(await daemon.extractQueue.size()).toBe(0);
      await tui.reader.purgeQueues();
      tui.reader.resetReader();
      tui.ipc.clear();
      await daemon.storage.clearDb();
    }
    expect(tui.reader.getQueueDepth()).toBe(0);
  }, 60000);
});
