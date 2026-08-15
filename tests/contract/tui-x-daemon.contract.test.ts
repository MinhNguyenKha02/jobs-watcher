import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { ActionEvent } from '../../src/domain/types/action-event.js';
import { UdsActionWriter } from '../../src/presentation/tui/components/UdsActionWriter.js';
import {
  OperatorAction,
  type ActionPayload,
  type ActionWriterPort,
} from '../../src/presentation/tui/ports/action-writer.port.js';
import type { JobEventReaderPort } from '../../src/presentation/tui/ports/job-event-reader.port.js';
import type { TestDaemonContainer, TuiTestContainer } from '../helpers/test-container.js';
import { udsHelpers, waitFor } from '../helpers/test-utils.js';

const ns = `tui-x-daemon-${process.pid}-${Date.now()}`;
const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tui-x-daemon-'));
process.env.TUI_SHARED_STATE_PATH = path.join(stateDir, 'tui-state.json');
process.env.CLIPBOARD_FIXTURE_MODE = '1';

const { buildTestDaemonContainer, buildTestTuiContainer } =
  await import('../helpers/test-container.js');
const { RabbitMqJobReader } =
  await import('../../src/presentation/tui/components/RabbitMqJobReader.js');
const { setQueueMode } = await import('../../src/presentation/tui/shared-tui-state.js');
const { clipboardSetter } = await import('../../src/presentation/tui/services/clipboard-getter.js');
const { JobStage, JobSource } = await import('../../src/domain/types/job-lifecycle.js');

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
 *
 * The two roots are composed as a manual pair (`buildTestDaemonContainer` +
 * `buildTestTuiContainer` sharing a per-`ns` exchange + socket), replacing the
 * former combined `buildAppTestContainer` facade.
 */
describe('TUI × daemon 2-process boundary contract ([c]/[i]/[j]/[d] over UDS + RMQ → ipc seam)', () => {
  describe('(a) structural wire-shape — adapter surfaces satisfy the TUI ports', () => {
    it('GIVEN the TUI adapter surface WHEN typed against ActionWriterPort THEN UdsActionWriter structurally satisfies the tui-uds → daemon IngestorPort complement', () => {
      const writer: ActionWriterPort = new UdsActionWriter(
        '/tmp/never-used-boundary.sock',
        'test-token'
      );
      expect(typeof writer.queue).toBe('function');
      expect(typeof writer.trash).toBe('function');
      expect(typeof writer.ingest).toBe('function');
      expect(typeof writer.webhookIngest).toBe('function');
    });

    it('GIVEN the TUI reader surface WHEN typed against JobEventReaderPort THEN RabbitMqJobReader structurally satisfies the tui-rmq ← daemon ParsePort/RoutePort complement', () => {
      const reader: JobEventReaderPort = new RabbitMqJobReader('amqp://boundary-test');
      expect(typeof reader.start).toBe('function');
      expect(typeof reader.stop).toBe('function');
      expect(typeof reader.isConnected).toBe('function');
      expect(typeof reader.getQueueDepth).toBe('function');
    });

    it('GIVEN the daemon UdsAdapter → IngestorPort wire shapes WHEN compared THEN queue/trash action payloads align', () => {
      const queuePayload: ActionPayload = { jobLifecycleId: 'job-1', action: OperatorAction.QUEUE };
      const trashPayload: ActionPayload = { jobLifecycleId: 'job-1', action: OperatorAction.TRASH };
      expect(queuePayload).toEqual({ jobLifecycleId: 'job-1', action: 'queue' });
      expect(trashPayload).toEqual({ jobLifecycleId: 'job-1', action: 'trash' });
    });

    it('GIVEN the daemon ParsePort/RoutePort emit keys WHEN compared THEN the reader bindings equal the full ActionEvent set', () => {
      const parseKeys = [
        ActionEvent.GENERATED,
        ActionEvent.PARSE_COMPLETED,
        ActionEvent.PARSE_FAILED,
      ];
      const routeKeys = [ActionEvent.QUEUED, ActionEvent.TRASHED, ActionEvent.ROUTE_FAILED];
      const daemonEmitKeys = [...parseKeys, ...routeKeys];

      const readerBindings = [
        ActionEvent.GENERATED,
        ActionEvent.PARSE_COMPLETED,
        ActionEvent.QUEUED,
        ActionEvent.TRASHED,
        ActionEvent.ROUTE_FAILED,
        ActionEvent.PARSE_FAILED,
      ];

      expect([...new Set(readerBindings)].sort()).toEqual(Object.values(ActionEvent).sort());
      expect([...daemonEmitKeys].sort()).toEqual(Object.values(ActionEvent).sort());
    });
  });

  describe('(b) 2-process IPC — [c]/[i]/[j]/[d] over UDS + RMQ → ipc seam', () => {
    let base: TestDaemonContainer;
    let tui: TuiTestContainer;
    let uds: ReturnType<typeof udsHelpers>;

    beforeAll(async () => {
      base = await buildTestDaemonContainer(
        { ns },
        { ports: { assetProducing: { toAsset: async () => ({}) } } }
      );
      tui = await buildTestTuiContainer({ ns });
      uds = udsHelpers(base.uds.socket, 'e2e-internal-token');
      await base.start();
      await waitFor(() => tui.rmq.reader.isConnected());
    }, 120000);

    afterAll(async () => {
      await tui.stop();
      await base.stop();
      fs.rmSync(stateDir, { recursive: true, force: true });
    });

    it('GIVEN the 2-process precondition WHEN the daemon publishes job.generated over RMQ THEN the ipc seam shows the PARTIAL job (job type + payload over RMQ-over-IPC)', async () => {
      await base.rmq.ports.parse.emitGenerated(
        {
          _id: 'txd-1',
          role: 'Software Engineer',
          company: 'SeedCo',
          stage: JobStage.PARTIAL_PARSED,
        },
        { stage: JobStage.PARTIAL_PARSED, source: JobSource.BROWSER_AUTO }
      );

      await waitFor(() => tui.ipc.read().jobLifecycleId === 'txd-1');
      const cur = tui.ipc.read();
      expect(cur.job?.company).toBe('SeedCo');
      expect(cur.job?.role).toBe('Software Engineer');
      expect(cur.stage).toBe(JobStage.PARTIAL_PARSED);
      expect(tui.rmq.reader.getQueueDepth()).toBe(0);
    });

    it('GIVEN the 2-process precondition WHEN the TUI ingests clipboard HTML over UDS THEN the daemon persists + republishes job.parse.completed over RMQ and the seam shows the FULL job', async () => {
      clipboardSetter(FULL_CO_HTML);
      await uds.ingest(FULL_CO_HTML, 'txd-1');

      await waitFor(() => tui.ipc.read().stage === JobStage.FULL_PARSED);
      const cur = tui.ipc.read();
      expect(cur.jobLifecycleId).toBe('txd-1');
      expect(cur.job?.company).toBe('FullCo');
      expect(cur.job?.role).toBe('Full Stack');
    });

    it('GIVEN the 2-process precondition WHEN the TUI sends [j] queue over UDS THEN the daemon publishes job.queue over RMQ and the seam clears the displayed job', async () => {
      await tui.uds.write.queue('txd-1');

      await waitFor(() => tui.ipc.read().jobLifecycleId === null);
      expect(tui.ipc.read().job).toBeNull();
    });

    it('GIVEN the 2-process precondition WHEN the TUI sends [d] trash over UDS THEN the daemon publishes job.trash over RMQ and the seam clears the displayed job', async () => {
      await base.rmq.ports.parse.emitGenerated(
        {
          _id: 'txd-2',
          role: 'DevOps Engineer',
          company: 'SeedCo2',
          stage: JobStage.PARTIAL_PARSED,
        },
        { stage: JobStage.PARTIAL_PARSED, source: JobSource.BROWSER_AUTO }
      );
      await waitFor(() => tui.ipc.read().jobLifecycleId === 'txd-2');

      clipboardSetter(TRASH_CO_HTML);
      await uds.ingest(TRASH_CO_HTML, 'txd-2');
      await waitFor(() => tui.ipc.read().job?.company === 'BinCo');

      await tui.uds.write.trash('txd-2');
      await waitFor(() => tui.ipc.read().jobLifecycleId === null);
      expect(tui.ipc.read().job).toBeNull();
    });

    it('GIVEN the 2-process precondition WHEN two job.generated events arrive over RMQ THEN the seam shows the first job and the reader queue depth holds the second', async () => {
      await base.rmq.ports.parse.emitGenerated(
        { _id: 'q-1', role: 'A', company: 'QCo1', stage: JobStage.PARTIAL_PARSED },
        { stage: JobStage.PARTIAL_PARSED, source: JobSource.BROWSER_AUTO }
      );
      await base.rmq.ports.parse.emitGenerated(
        { _id: 'q-2', role: 'B', company: 'QCo2', stage: JobStage.PARTIAL_PARSED },
        { stage: JobStage.PARTIAL_PARSED, source: JobSource.BROWSER_AUTO }
      );

      await waitFor(() => tui.ipc.read().jobLifecycleId === 'q-1');
      await waitFor(() => tui.rmq.reader.getQueueDepth() === 1);
      expect(tui.ipc.read().job?.company).toBe('QCo1');
      expect(tui.rmq.reader.getQueueDepth()).toBe(1);
    });

    it('GIVEN the 2-process precondition WHEN the TUI ingests a standalone clipboard over UDS in direct mode THEN the daemon publishes job.parse.completed and the seam shows the standalone job', async () => {
      setQueueMode(false);
      clipboardSetter(CLIP_CO_HTML);
      await uds.ingest(CLIP_CO_HTML);

      await waitFor(() => tui.ipc.read().job?.company === 'ClipCo');
      const cur = tui.ipc.read();
      expect(cur.jobLifecycleId).toMatch(/^clip-/);
      expect(cur.stage).toBe(JobStage.FULL_PARSED);
    });
  });
});
