import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import type { AppTestContainer } from '../../helpers/test-container.js';

const ns = `tui-x-daemon-${process.pid}-${Date.now()}`;
const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tui-x-daemon-'));
process.env.TUI_SHARED_STATE_PATH = path.join(stateDir, 'tui-state.json');
process.env.CLIPBOARD_FIXTURE_MODE = '1';

const { buildAppTestContainer } = await import('../../helpers/test-container.js');
const { getCurrentJob, setQueueMode } =
  await import('../../../src/presentation/tui/shared-tui-state.js');
const { clipboardSetter } =
  await import('../../../src/presentation/tui/services/clipboard-getter.js');
const { JobStage, JobSource } = await import('../../../src/domain/types/job-lifecycle.js');

const FULL_CO_HTML = `<div class="job-detail__info--title"><h1>Full Stack</h1></div>
<div class="company-name-label"><a class="name">FullCo</a></div>
<h3>Mô tả công việc</h3>
<div class="job-description__item--content">TypeScript and Node.js developer</div>`;

const TRASH_CO_HTML = `<div class="job-detail__info--title"><h1>DevOps Engineer</h1></div>
<div class="company-name-label"><a class="name">BinCo</a></div>
<h3>Mô tả công việc</h3>
<div class="job-description__item--content">CI/CD pipelines</div>`;

const CLIP_CO_HTML = `<div class="job-detail__info--title"><h1>Data Engineer</h1></div>
<div class="company-name-label"><a class="name">ClipCo</a></div>
<h3>Mô tả công việc</h3>
<div class="job-description__item--content">ETL pipelines</div>`;

async function waitFor(check: () => boolean, timeoutMs = 15000, intervalMs = 50): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms`);
}

/**
 * TUI × daemon 2-process boundary contract.
 *
 * The daemon and TUI composition roots are wired over real IPC only:
 *   - RMQ over IPC: job type (routing key) + job payload travel on
 *     `jobs.events.int.<ns>` (`job.generated` / `job.parse.completed`) from the
 *     daemon's real outbound adapters to the TUI `RabbitMqJobReader`.
 *   - UDS over IPC: `/internal/action` (queue/trash) + `/internal/ingest`
 *     (clipboard) carry operator intent via the TUI `UdsActionWriter`.
 * Assertions observe the shared ipc file seam (`getCurrentJob`) and the reader
 * queue (`getQueueDepth`) only — no in-memory payload handoffs. The asset
 * producing slot is substituted (not a boundary port) so the [j] resolution
 * does not trigger the heavyweight profile-artifact build.
 */
describe('TUI × daemon 2-process boundary ([c]/[i]/[j]/[d] over UDS + RMQ → ipc seam)', () => {
  let app: AppTestContainer;

  beforeAll(async () => {
    app = await buildAppTestContainer({
      ns,
      ports: { assetProducing: { toAsset: async () => ({}) } },
    });
    await app.start();
    await waitFor(() => app.tui.rmqReader.isConnected());
  }, 120000);

  afterAll(async () => {
    await app.tui.stop();
    await app.stop();
    fs.rmSync(stateDir, { recursive: true, force: true });
  });

  it('GIVEN the 2-process precondition WHEN the daemon publishes job.generated over RMQ THEN the ipc seam shows the PARTIAL job (job type + payload over RMQ-over-IPC)', async () => {
    await app.container.parseAdapter.emitGenerated(
      {
        _id: 'txd-1',
        role: 'Software Engineer',
        company: 'SeedCo',
        stage: JobStage.PARTIAL_PARSED,
      },
      { stage: JobStage.PARTIAL_PARSED, source: JobSource.BROWSER_AUTO }
    );

    await waitFor(() => getCurrentJob().jobLifecycleId === 'txd-1');
    const cur = getCurrentJob();
    expect(cur.job?.company).toBe('SeedCo');
    expect(cur.job?.role).toBe('Software Engineer');
    expect(cur.stage).toBe(JobStage.PARTIAL_PARSED);
    expect(app.tui.rmqReader.getQueueDepth()).toBe(0);
  });

  it('GIVEN the 2-process precondition WHEN the TUI ingests clipboard HTML over UDS THEN the daemon persists + republishes job.parse.completed over RMQ and the seam shows the FULL job', async () => {
    clipboardSetter(FULL_CO_HTML);
    await app.tui.udsWriter.webhookIngest('txd-1');

    await waitFor(() => getCurrentJob().stage === JobStage.FULL_PARSED);
    const cur = getCurrentJob();
    expect(cur.jobLifecycleId).toBe('txd-1');
    expect(cur.job?.company).toBe('FullCo');
    expect(cur.job?.role).toBe('Full Stack');
  });

  it('GIVEN the 2-process precondition WHEN the TUI sends [j] queue over UDS THEN the daemon publishes job.queue over RMQ and the seam clears the displayed job', async () => {
    await app.tui.udsWriter.queue('txd-1');

    await waitFor(() => getCurrentJob().jobLifecycleId === null);
    expect(getCurrentJob().job).toBeNull();
  });

  it('GIVEN the 2-process precondition WHEN the TUI sends [d] trash over UDS THEN the daemon publishes job.trash over RMQ and the seam clears the displayed job', async () => {
    await app.container.parseAdapter.emitGenerated(
      {
        _id: 'txd-2',
        role: 'DevOps Engineer',
        company: 'SeedCo2',
        stage: JobStage.PARTIAL_PARSED,
      },
      { stage: JobStage.PARTIAL_PARSED, source: JobSource.BROWSER_AUTO }
    );
    await waitFor(() => getCurrentJob().jobLifecycleId === 'txd-2');

    clipboardSetter(TRASH_CO_HTML);
    await app.tui.udsWriter.webhookIngest('txd-2');
    await waitFor(() => getCurrentJob().job?.company === 'BinCo');

    await app.tui.udsWriter.trash('txd-2');
    await waitFor(() => getCurrentJob().jobLifecycleId === null);
    expect(getCurrentJob().job).toBeNull();
  });

  it('GIVEN the 2-process precondition WHEN two job.generated events arrive over RMQ THEN the seam shows the first job and the reader queue depth holds the second', async () => {
    await app.container.parseAdapter.emitGenerated(
      { _id: 'q-1', role: 'A', company: 'QCo1', stage: JobStage.PARTIAL_PARSED },
      { stage: JobStage.PARTIAL_PARSED, source: JobSource.BROWSER_AUTO }
    );
    await app.container.parseAdapter.emitGenerated(
      { _id: 'q-2', role: 'B', company: 'QCo2', stage: JobStage.PARTIAL_PARSED },
      { stage: JobStage.PARTIAL_PARSED, source: JobSource.BROWSER_AUTO }
    );

    await waitFor(() => getCurrentJob().jobLifecycleId === 'q-1');
    await waitFor(() => app.tui.rmqReader.getQueueDepth() === 1);
    expect(getCurrentJob().job?.company).toBe('QCo1');
    expect(app.tui.rmqReader.getQueueDepth()).toBe(1);
  });

  it('GIVEN the 2-process precondition WHEN the TUI ingests a standalone clipboard over UDS in direct mode THEN the daemon publishes job.parse.completed and the seam shows the standalone job', async () => {
    setQueueMode(false);
    clipboardSetter(CLIP_CO_HTML);
    await app.tui.udsWriter.webhookIngest();

    await waitFor(() => getCurrentJob().job?.company === 'ClipCo');
    const cur = getCurrentJob();
    expect(cur.jobLifecycleId).toMatch(/^clip-/);
    expect(cur.stage).toBe(JobStage.FULL_PARSED);
  });
});
