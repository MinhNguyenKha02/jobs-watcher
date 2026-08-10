import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createTestContainer, type TestContainer } from '../../helpers/test-container.js';
import { ProfileInfoRetriever } from '../../../src/domain/profile/index.js';
import { JobStage, JobSource, JobStatus } from '../../../src/domain/types/job-lifecycle.js';
import { ActionEvent } from '../../../src/domain/types/action-event.js';

/**
 * DIP/LSP conformance: each application port is bound in the production
 * composition root to a concrete runtime adapter. Every test here resolves a
 * port through the container and drives a REAL behavior through it (storage
 * roundtrip, FIFO queue, RMQ publish/receive, PDF render). No mocks, no
 * port-fakes — this is the behavioral substitutability proof underpinning the
 * IoC wiring that `composition-root.integration.test.ts` asserts structurally.
 */
describe('DIP/LSP conformance — production-resolved port adapters are behaviorally substitutable', () => {
  let tc: TestContainer;

  beforeAll(async () => {
    tc = await createTestContainer({ ns: 'dip-conformance', startScheduler: false });
    await tc.start();
  }, 120000);

  afterAll(async () => {
    await tc.stop();
  });

  it('job-lifecycle port: upsert → findById → updateStage roundtrip through the mongo adapter', async () => {
    const port = tc.container.mongoJobLifecycleAdapter;
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

  it('extraction-queue port: enqueue → size → FIFO dequeue through the mongo adapter', async () => {
    const port = tc.container.extractionQueueAdapter;
    await port.enqueue('dip-q-1');
    await port.enqueue('dip-q-2');
    expect(await port.size()).toBe(2);
    expect((await port.dequeue())?._id).toBe('dip-q-1');
    expect((await port.dequeue())?._id).toBe('dip-q-2');
  });

  it('parse port: emitGenerated publishes a GENERATED action reachable over real RMQ', async () => {
    const bus = tc.bus;
    const handle = await bus.setup([ActionEvent.GENERATED]);
    const port = tc.container.parseAdapter;

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

    const msg = await handle.msg();
    expect(msg._id).toBe('dip-gen-1');
    expect(msg.company).toBe('GenCo');
  }, 20000);

  it('route port: emitJobQueued publishes a QUEUED action reachable over real RMQ', async () => {
    const bus = tc.bus;
    const handle = await bus.setup([ActionEvent.QUEUED]);
    const port = tc.container.routeAdapter;

    await port.emitJobQueued('dip-route-1', { source: JobSource.MANUAL });

    const msg = await handle.msg();
    expect(msg.jobLifecycleId).toBe('dip-route-1');
  }, 20000);

  it('ingestor composition: missing-job resolution emits ROUTE_FAILED over real RMQ', async () => {
    const bus = tc.bus;
    const handle = await bus.setup([ActionEvent.ROUTE_FAILED]);

    await tc.ingestor.processResolution('dip-missing', 'queue');

    const msg = await handle.msg();
    expect(msg.jobLifecycleId).toBe('dip-missing');
    expect(msg.reason).toContain('No existing job lifecycle');
  }, 20000);

  it('asset port: toAsset resolves a PDF into the container-configured temp dir → real chromium render', async () => {
    const retriever = new ProfileInfoRetriever();
    await retriever.init();
    const text =
      'Role: Platform Engineer\nCompany: LspCo\nDescription: Node.js, Go\nRequirements: Kubernetes, Terraform';
    const resolved = retriever.resolve(retriever.retrieve(text));

    const result = await tc.container.assetProducingAdapter.toAsset(resolved);

    expect(result).toBeDefined();
    expect(result.pdfPath).toBeDefined();
    const pdfPath = result.pdfPath as string;
    expect(fs.existsSync(pdfPath)).toBe(true);
    expect(path.dirname(pdfPath)).toMatch(path.resolve(tc.assetDir));
  }, 60000);
});
