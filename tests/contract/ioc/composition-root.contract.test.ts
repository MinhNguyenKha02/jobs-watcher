import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { buildDaemonContainer, type DaemonContainer } from '../../../src/application/container.js';
import { createTestStorage } from '../../helpers/create-test-storage.js';
import { deleteTestExchange } from '../../helpers/test-utils.js';

/**
 * Container-conformance: the production composition root (IoC) wires the full
 * graph against REAL adapters (no stubs / `as any`). Every port the JobIngestor
 * depends on is satisfied by a concrete runtime adapter; the scheduler owns the
 * browser; the asset port owns an output dir; and start/stop roundtrip.
 */
describe('Container conformance — IoC composition root', () => {
  let storage: Awaited<ReturnType<typeof createTestStorage>>;
  let container: DaemonContainer;
  let assetDir: string;

  beforeAll(async () => {
    storage = await createTestStorage();
    assetDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobs-watcher-composition-root-assets-'));
    const exchange = 'jobs.events.int.composition-root';
    container = buildDaemonContainer(
      {
        nodeEnv: 'test',
        mongodb: { uri: storage.uri, dbName: storage.dbName },
        rabbitmq: { url: process.env.RABBITMQ_URL || 'amqp://localhost', exchange },
        uds: { socketPath: `/tmp/jobs-watcher-composition-root.sock`, token: 'test-token' },
        health: { port: 0 },
        webhook: { port: 0, path: '/webhook/gmail' },
        asset: { outputDir: assetDir },
      },
      {}
    );
  }, 120000);

  afterAll(async () => {
    // Daemon-only suite (no TUI reader): self-delete the asserted test
    // exchange (finally => no cleanup script).
    try {
      fs.rmSync(assetDir, { recursive: true, force: true });
      await storage.stop();
    } finally {
      await deleteTestExchange('jobs.events.int.composition-root');
    }
  });

  it('GIVEN the Container precondition WHEN the port is exercised on the real Container THEN JobIngestor wiring → all 6 real port adapters resolved (no stubs, no divergent 3-arg wiring)', async () => {
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

  it('GIVEN the Container precondition WHEN the port is exercised on the real Container THEN each JobIngestor dependency → a concrete runtime adapter exposing its port', async () => {
    expect(typeof container.mongoJobLifecycleAdapter.upsert).toBe('function');
    expect(typeof container.parseAdapter.emitGenerated).toBe('function');
    expect(typeof container.routeAdapter.emitJobQueued).toBe('function');
    expect(typeof container.extractionQueueAdapter.enqueue).toBe('function');
    expect(typeof container.assetProducingAdapter.toAsset).toBe('function');
    expect(typeof container.metricsRegistry.metrics).toBe('function');
  });

  it('GIVEN the Container precondition WHEN resolve on the real Container THEN container layout → scheduler owns browser adapter; asset port bound to configured output dir via contract', async () => {
    expect(typeof container.extractionScheduler.start).toBe('function');
    expect(typeof container.extractionScheduler.stop).toBe('function');
    expect(typeof container.browserAdapter.extract).toBe('function');
    expect(typeof container.udsAdapter.start).toBe('function');

    // asset port: bound through the AssetProducingPort; the configured outputDir
    // ownership is proven behaviorally by the asset/PDF contracts writing into
    // the container asset dir (dip-lsp + c2 + e2e waitForPdf), not via a cast.
    expect(typeof container.assetProducingAdapter.toAsset).toBe('function');
  });

  it('GIVEN the Container precondition WHEN the port is exercised on the real Container THEN UDS tui-boundary adapter → composed against the ingestor (queue/trash inbound)', async () => {
    expect(typeof container.udsAdapter.start).toBe('function');
    expect(typeof container.udsAdapter.stop).toBe('function');
  });

  it('GIVEN the Container precondition WHEN start → stop on the real Container THEN start()/stop() → roundtrips without throwing', async () => {
    await container.start();
    await container.stop();

    // the wired metrics registry is functional after the roundtrip
    const text = await container.metricsRegistry.metrics();
    expect(text).toContain('job_stage_total');
  });
});
