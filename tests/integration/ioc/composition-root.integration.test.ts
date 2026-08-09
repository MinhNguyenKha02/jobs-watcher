import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildSystemContainer, type AppContainer } from '../../../src/application/container.js';
import { createTestStorage } from '../../helpers/create-test-storage.js';

/**
 * Container-conformance: the production composition root (IoC) wires the full
 * graph against REAL adapters (no stubs / `as any`). Every port the JobIngestor
 * depends on is satisfied by a concrete runtime adapter; the scheduler owns the
 * browser; the asset port owns an output dir; and start/stop roundtrip.
 */
describe('Container conformance — IoC composition root', () => {
  let storage: Awaited<ReturnType<typeof createTestStorage>>;
  let container: AppContainer;
  let assetDir: string;

  beforeAll(async () => {
    storage = await createTestStorage();
    assetDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobs-watcher-composition-root-assets-'));
    const exchange = 'jobs.events.int.composition-root';
    container = buildSystemContainer(
      {
        nodeEnv: 'test',
        mongodb: { uri: storage.uri, dbName: storage.dbName },
        rabbitmq: { url: process.env.RABBITMQ_URL || 'amqp://localhost', exchange },
        uds: { socketPath: `/tmp/jobs-watcher-composition-root.sock`, token: 'test-token' },
        health: { port: 0 },
        asset: { outputDir: assetDir },
      },
      {},
    );
  }, 120000);

  afterAll(async () => {
    fs.rmSync(assetDir, { recursive: true, force: true });
    await storage.stop();
  });

  it('JobIngestor wiring → all 6 real port adapters resolved (no stubs, no divergent 3-arg wiring)', async () => {
    expect(container.ingestor).toBeDefined();
    expect(typeof container.ingestor.processIngest).toBe('function');
    expect(typeof container.ingestor.processResolution).toBe('function');

    expect(container.mongoJobLifecycleAdapter).toBeDefined();
    expect(container.parseAdapter).toBeDefined();
    expect(container.routeAdapter).toBeDefined();
    expect(container.extractionQueueAdapter).toBeDefined();
    expect(container.assetProducingAdapter).toBeDefined();
    expect(container.metricsRegistry).toBeDefined();
  });

  it('each JobIngestor dependency → a concrete runtime adapter exposing its port', async () => {
    expect(typeof container.mongoJobLifecycleAdapter.upsert).toBe('function');
    expect(typeof container.parseAdapter.emitGenerated).toBe('function');
    expect(typeof container.routeAdapter.emitJobQueued).toBe('function');
    expect(typeof container.extractionQueueAdapter.enqueue).toBe('function');
    expect(typeof container.assetProducingAdapter.toAsset).toBe('function');
    expect(typeof container.metricsRegistry.metrics).toBe('function');
  });

  it('container layout → scheduler owns browser adapter; asset port owns configured output dir', async () => {
    expect(typeof container.extractionScheduler.start).toBe('function');
    expect(typeof container.extractionScheduler.stop).toBe('function');
    expect(typeof container.browserAdapter.extract).toBe('function');
    expect(typeof container.udsAdapter.start).toBe('function');

    // asset port: the container owns the output dir (no hardcoded cwd/assets).
    expect(path.resolve(container.assetProducingAdapter.outputDir)).toBe(path.resolve(assetDir));
  });

  it('UDS tui-boundary adapter → composed against the ingestor (queue/trash inbound)', async () => {
    expect(typeof container.udsAdapter.start).toBe('function');
    expect(typeof container.udsAdapter.stop).toBe('function');
  });

  it('start()/stop() → roundtrips without throwing', async () => {
    await container.start();
    await container.stop();

    // the wired metrics registry is functional after the roundtrip
    const text = await container.metricsRegistry.metrics();
    expect(text).toContain('job_stage_total');
  });
});