import fs from 'node:fs';
import path from 'node:path';

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

import { ProfileInfoRetriever } from '../../../src/domain/profile/index.js';
import { JobStage, JobSource, JobStatus } from '../../../src/domain/types/job-lifecycle.js';
import {
  buildTestDaemonContainer,
  buildTestTuiContainer,
  type TestDaemonContainer,
  type TuiTestContainer,
} from '../../helpers/test-container.js';
import { waitFor } from '../../helpers/test-utils.js';

/**
 * DIP/LSP conformance: each application port is bound in the production
 * composition root to a concrete runtime adapter. Every test here resolves a
 * port through the container and drives a REAL behavior through it (storage
 * roundtrip, FIFO queue, RMQ publish/receive, PDF render). No mocks, no
 * port-fakes — this is the behavioral substitutability proof underpinning the
 * IoC wiring that `composition-root.integration.test.ts` asserts structurally.
 */
describe('DIP/LSP conformance — production-resolved port adapters are behaviorally substitutable', () => {
  let daemon: TestDaemonContainer;
  let tui: TuiTestContainer;

  beforeAll(async () => {
    daemon = await buildTestDaemonContainer({ ns: 'dip-conformance', startScheduler: false });
    await daemon.start();
    // Queue-content assertions below own the extraction queue: stop the
    // production scheduler (auto-started by container.start()) so its
    // onEnqueue-woken workers cannot steal test items mid-assert.
    await daemon.apps.scheduler.stop();
    tui = await buildTestTuiContainer({ ns: 'dip-conformance' });
  }, 120000);

  afterAll(async () => {
    // Per-suite cycle teardown: stops first, then self-deletes the 4
    // namespaced queues + test exchange (finally => no cleanup script).
    try {
      await tui.stop();
      await daemon.stop();
    } finally {
      await tui.reader.deleteQueues();
    }
  });

  beforeEach(async () => {
    await daemon.storage.clearDb();
    await tui.reader.purgeQueues();
    tui.reader.resetReader();
    tui.ipc.clear();
  });

  it('GIVEN the DIP precondition WHEN upsert → findById → updateStage on the real DIP THEN job-lifecycle port: upsert → findById → updateStage roundtrip through the mongo adapter (S2+S1+S3)', async () => {
    const port = daemon.jobLifecycle;
    const doc = {
      _id: 'dip-storage-1',
      raw: '<html>dip</html>',
      stage: JobStage.PARTIAL_PARSED,
      status: JobStatus.ENRICHING,
      source: JobSource.BROWSER_AUTO,
      company: 'DipCo',
      role: 'Dev',
      createdAt: new Date(),
      updatedAt: new Date(),
      stageTimestamp: new Date(),
    };
    await port.upsert(doc);
    const found = await port.findById('dip-storage-1');
    expect(found).not.toBeNull();
    expect(found!.company).toBe('DipCo');

    await port.updateStage('dip-storage-1', JobStage.FULL_PARSED, JobStatus.QUEUED);
    const updated = await port.findById('dip-storage-1');
    expect(updated!.status).toBe(JobStatus.QUEUED);
  });

  it('GIVEN the DIP precondition WHEN enqueue → size → dequeue on the real DIP THEN extraction-queue port: enqueue → size → FIFO dequeue through the mongo adapter', async () => {
    const port = daemon.extractQueue;
    await port.enqueue('dip-q-1');
    await port.enqueue('dip-q-2');
    expect(await port.size()).toBe(2);
    expect((await port.dequeue())?._id).toBe('dip-q-1');
    expect((await port.dequeue())?._id).toBe('dip-q-2');
  });

  it('GIVEN the DIP precondition WHEN the port is exercised on the real DIP THEN parse port: emitGenerated publishes a GENERATED action reachable over real RMQ', async () => {
    const port = daemon.rmq.ports.parse;

    await port.emitGenerated(
      {
        _id: 'dip-gen-1',
        role: 'Engineer',
        company: 'GenCo',
        stage: JobStage.PARTIAL_PARSED,
        status: JobStatus.ENRICHING,
        source: JobSource.BROWSER_AUTO,
      },
      { stage: JobStage.PARTIAL_PARSED, source: JobSource.BROWSER_AUTO }
    );

    await waitFor(() => tui.ipc.read().jobLifecycleId === 'dip-gen-1');
    const cur = tui.ipc.read();
    expect(cur.jobLifecycleId).toBe('dip-gen-1');
    expect(cur.job?.company).toBe('GenCo');
    expect(cur.stage).toBe(JobStage.PARTIAL_PARSED);
  }, 20000);

  it('GIVEN the DIP precondition WHEN the port is exercised on the real DIP THEN route port: emitJobQueued publishes a QUEUED action reachable over real RMQ', async () => {
    await daemon.jobLifecycle.upsert({
      _id: 'dip-route-1',
      company: 'RouteCo',
      role: 'Engineer',
      stage: JobStage.FULL_PARSED,
      status: JobStatus.ENRICHED,
      source: JobSource.MANUAL,
      raw: '<html>dip-route</html>',
      createdAt: new Date(),
      updatedAt: new Date(),
      stageTimestamp: new Date(),
    });
    await daemon.rmq.ports.parse.emitGenerated(
      {
        _id: 'dip-route-1',
        role: 'Engineer',
        company: 'RouteCo',
        stage: JobStage.PARTIAL_PARSED,
        status: JobStatus.ENRICHING,
        source: JobSource.BROWSER_AUTO,
      },
      { stage: JobStage.PARTIAL_PARSED, source: JobSource.BROWSER_AUTO }
    );
    await waitFor(() => tui.ipc.read().jobLifecycleId === 'dip-route-1');

    await tui.writer.queue('dip-route-1');

    await waitFor(() => tui.ipc.read().jobLifecycleId === null);
    expect(tui.ipc.read().job).toBeNull();
    const doc = await daemon.jobLifecycle.findById('dip-route-1');
    expect(doc?.status).toBe(JobStatus.QUEUED);
  }, 20000);

  it('GIVEN the DIP precondition WHEN the port is exercised on the real DIP THEN ingestor composition: missing-job resolution emits ROUTE_FAILED over real RMQ', async () => {
    await daemon.rmq.ports.parse.emitGenerated(
      {
        _id: 'dip-missing',
        role: 'Engineer',
        company: 'MissCo',
        stage: JobStage.PARTIAL_PARSED,
        status: JobStatus.ENRICHING,
        source: JobSource.BROWSER_AUTO,
      },
      { stage: JobStage.PARTIAL_PARSED, source: JobSource.BROWSER_AUTO }
    );
    await waitFor(() => tui.ipc.read().jobLifecycleId === 'dip-missing');

    await daemon.apps.ingest.processResolution('dip-missing', 'queue');

    await waitFor(() => tui.ipc.read().jobLifecycleId === null);
    expect(tui.ipc.read().job).toBeNull();
  }, 20000);

  it('GIVEN the DIP precondition WHEN the port is exercised on the real DIP THEN asset port: toAsset resolves a PDF into the container-configured temp dir → real chromium render', async () => {
    const retriever = new ProfileInfoRetriever();
    await retriever.init();
    const text =
      'Role: Platform Engineer\nCompany: LspCo\nDescription: Node.js, Go\nRequirements: Kubernetes, Terraform';
    const resolved = retriever.resolve(retriever.retrieve(text));

    const result = await daemon.assetProducing.toAsset(resolved);

    expect(result).toBeDefined();
    expect(result.pdfPath).toBeDefined();
    const pdfPath = result.pdfPath as string;
    expect(fs.existsSync(pdfPath)).toBe(true);
    expect(path.dirname(pdfPath)).toMatch(path.resolve(daemon.assetDir));
  }, 60000);
});
