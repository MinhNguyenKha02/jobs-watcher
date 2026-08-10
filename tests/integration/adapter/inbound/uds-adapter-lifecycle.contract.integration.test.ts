import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { buildSystemContainer } from '../../../../src/application/container.js';
import type { IngestorPort } from '../../../../src/application/ports/inbound/ingestor.port.js';
import type { UdsAdapter } from '../../../../src/infrastructure/inbound/uds/uds-adapter.js';
import { postJsonOverUds } from '../../../../src/infrastructure/utils/uds-http.js';

describe('UdsAdapter — lifecycle integration', { timeout: 15000 }, () => {
  let socketDir: string;
  let socketPath: string;
  let ingestorMock: IngestorPort;
  let adapter: UdsAdapter;

  beforeAll(async () => {
    socketDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uds-test-'));
    socketPath = path.join(socketDir, 'ingest.sock');
    ingestorMock = {
      processIngest: vi.fn().mockResolvedValue(undefined),
      processResolution: vi.fn().mockResolvedValue(undefined),
    };
  });

  afterAll(async () => {
    fs.rmSync(socketDir, { recursive: true, force: true });
  });

  afterEach(async () => {
    await adapter.stop().catch(() => {});
  });

  /** Resolve the real UdsAdapter through the production composition root (port-seam). */
  function boot(socket: string, token?: string): UdsAdapter {
    const container = buildSystemContainer(
      {
        nodeEnv: 'test',
        mongodb: { uri: 'mongodb://localhost/jw-uds', dbName: 'unit' },
        rabbitmq: {
          url: process.env.RABBITMQ_URL || 'amqp://localhost',
          exchange: 'jobs.events.ct',
        },
        uds: { socketPath: socket, token },
        health: { port: 0 },
        asset: { outputDir: '/tmp/jobs-watcher-uds-assets' },
      },
      { ports: { ingestor: ingestorMock } }
    );
    return container.udsAdapter;
  }

  it('GIVEN the UdsAdapter precondition WHEN start on the real UdsAdapter THEN start creates the socket file', async () => {
    adapter = boot(socketPath);
    expect(fs.existsSync(socketPath)).toBe(false);
    await adapter.start();
    expect(fs.existsSync(socketPath)).toBe(true);
  });

  it('GIVEN the UdsAdapter precondition WHEN start → stop on the real UdsAdapter THEN stop removes the socket file', async () => {
    adapter = boot(socketPath);
    await adapter.start();
    expect(fs.existsSync(socketPath)).toBe(true);
    await adapter.stop();
    expect(fs.existsSync(socketPath)).toBe(false);
  });

  it('GIVEN the UdsAdapter precondition WHEN start → stop on the real UdsAdapter THEN stop is safe to call twice', async () => {
    adapter = boot(socketPath);
    await adapter.start();
    await adapter.stop();
    await expect(adapter.stop()).resolves.toBeUndefined();
  });

  it('GIVEN the UdsAdapter precondition WHEN start on the real UdsAdapter THEN POST /internal/action with queue action calls processResolution', async () => {
    adapter = boot(socketPath);
    await adapter.start();

    const res = await postJsonOverUds(
      { socketPath, path: '/internal/action', timeoutMs: 5000 },
      { action: 'queue', jobLifecycleId: 'test-job-1' }
    );
    expect(res.statusCode).toBe(200);
    expect(ingestorMock.processResolution).toHaveBeenCalledWith('test-job-1', 'queue');
  });

  it('GIVEN the UdsAdapter precondition WHEN start on the real UdsAdapter THEN POST /internal/action with trash action calls processResolution', async () => {
    adapter = boot(socketPath);
    await adapter.start();

    const res = await postJsonOverUds(
      { socketPath, path: '/internal/action', timeoutMs: 5000 },
      { action: 'trash', jobLifecycleId: 'test-job-2' }
    );
    expect(res.statusCode).toBe(200);
    expect(ingestorMock.processResolution).toHaveBeenCalledWith('test-job-2', 'trash');
  });

  it('GIVEN the UdsAdapter precondition WHEN start on the real UdsAdapter THEN POST /internal/action with missing fields returns 400', async () => {
    adapter = boot(socketPath);
    await adapter.start();

    const res = await postJsonOverUds(
      { socketPath, path: '/internal/action', timeoutMs: 5000 },
      {}
    );
    expect(res.statusCode).toBe(400);
  });

  it('GIVEN the UdsAdapter precondition WHEN start on the real UdsAdapter THEN POST /internal/ingest calls processIngest with correct args (S2)', async () => {
    adapter = boot(socketPath);
    await adapter.start();

    const html = '<div>test payload</div>';
    const res = await postJsonOverUds(
      { socketPath, path: '/internal/ingest', timeoutMs: 5000 },
      { html }
    );
    expect(res.statusCode).toBe(200);
    expect(ingestorMock.processIngest).toHaveBeenCalledWith(
      'manual',
      'full_parsed',
      html,
      undefined
    );
  });

  it('GIVEN the UdsAdapter precondition WHEN start on the real UdsAdapter THEN POST /internal/ingest?webhook=true with jobLifecycleId calls processIngest with id (S2)', async () => {
    adapter = boot(socketPath);
    await adapter.start();

    const html = '<div>webhook payload</div>';
    const res = await postJsonOverUds(
      { socketPath, path: '/internal/ingest?webhook=true', timeoutMs: 5000 },
      { html, jobLifecycleId: 'webhook-job-1' }
    );
    expect(res.statusCode).toBe(200);
    expect(ingestorMock.processIngest).toHaveBeenCalledWith(
      'manual',
      'full_parsed',
      html,
      'webhook-job-1'
    );
  });

  it('GIVEN the UdsAdapter precondition WHEN start on the real UdsAdapter THEN POST /internal/ingest with empty html returns 400', async () => {
    adapter = boot(socketPath);
    await adapter.start();

    const res = await postJsonOverUds(
      { socketPath, path: '/internal/ingest', timeoutMs: 5000 },
      { html: '' }
    );
    expect(res.statusCode).toBe(400);
  });

  it('GIVEN the UdsAdapter precondition WHEN start on the real UdsAdapter THEN unknown path returns 404', async () => {
    adapter = boot(socketPath);
    await adapter.start();

    const res = await postJsonOverUds({ socketPath, path: '/unknown/path', timeoutMs: 5000 }, {});
    expect(res.statusCode).toBe(404);
  });

  it('GIVEN the UdsAdapter precondition WHEN start on the real UdsAdapter THEN auth with valid token passes', async () => {
    adapter = boot(socketPath, 'secret-123');
    await adapter.start();

    const res = await postJsonOverUds(
      {
        socketPath,
        path: '/internal/action',
        headers: { 'x-internal-token': 'secret-123' },
        timeoutMs: 5000,
      },
      { action: 'queue', jobLifecycleId: 'auth-test' }
    );
    expect(res.statusCode).toBe(200);
    expect(ingestorMock.processResolution).toHaveBeenCalledWith('auth-test', 'queue');
  });

  it('GIVEN the UdsAdapter precondition WHEN start on the real UdsAdapter THEN auth with invalid token returns 401', async () => {
    adapter = boot(socketPath, 'secret-123');
    await adapter.start();

    const res = await postJsonOverUds(
      {
        socketPath,
        path: '/internal/action',
        headers: { 'x-internal-token': 'wrong-token' },
        timeoutMs: 5000,
      },
      { action: 'queue', jobLifecycleId: 'auth-fail' }
    );
    expect(res.statusCode).toBe(401);
  });

  it('GIVEN the UdsAdapter precondition WHEN start → stop on the real UdsAdapter THEN start → stop → start works (restart lifecycle)', async () => {
    adapter = boot(socketPath);
    await adapter.start();
    expect(fs.existsSync(socketPath)).toBe(true);

    await adapter.stop();
    expect(fs.existsSync(socketPath)).toBe(false);

    await adapter.start();
    expect(fs.existsSync(socketPath)).toBe(true);

    const res = await postJsonOverUds(
      { socketPath, path: '/internal/action', timeoutMs: 5000 },
      { action: 'queue', jobLifecycleId: 'restart-test' }
    );
    expect(res.statusCode).toBe(200);
  });
});
