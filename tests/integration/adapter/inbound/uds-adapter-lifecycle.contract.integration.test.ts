import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { UdsAdapter } from '../../../../src/infrastructure/inbound/uds/uds-adapter.js';
import type { IngestorPort } from '../../../../src/application/ports/inbound/ingestor.port.js';
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

  it('start creates the socket file', async () => {
    adapter = new UdsAdapter(ingestorMock, { socketPath });
    expect(fs.existsSync(socketPath)).toBe(false);
    await adapter.start();
    expect(fs.existsSync(socketPath)).toBe(true);
  });

  it('stop removes the socket file', async () => {
    adapter = new UdsAdapter(ingestorMock, { socketPath });
    await adapter.start();
    expect(fs.existsSync(socketPath)).toBe(true);
    await adapter.stop();
    expect(fs.existsSync(socketPath)).toBe(false);
  });

  it('stop is safe to call twice', async () => {
    adapter = new UdsAdapter(ingestorMock, { socketPath });
    await adapter.start();
    await adapter.stop();
    await expect(adapter.stop()).resolves.toBeUndefined();
  });

  it('POST /internal/action with queue action calls processResolution', async () => {
    adapter = new UdsAdapter(ingestorMock, { socketPath });
    await adapter.start();

    const res = await postJsonOverUds(
      { socketPath, path: '/internal/action', timeoutMs: 5000 },
      { action: 'queue', jobLifecycleId: 'test-job-1' },
    );
    expect(res.statusCode).toBe(200);
    expect(ingestorMock.processResolution).toHaveBeenCalledWith('test-job-1', 'queue');
  });

  it('POST /internal/action with trash action calls processResolution', async () => {
    adapter = new UdsAdapter(ingestorMock, { socketPath });
    await adapter.start();

    const res = await postJsonOverUds(
      { socketPath, path: '/internal/action', timeoutMs: 5000 },
      { action: 'trash', jobLifecycleId: 'test-job-2' },
    );
    expect(res.statusCode).toBe(200);
    expect(ingestorMock.processResolution).toHaveBeenCalledWith('test-job-2', 'trash');
  });

  it('POST /internal/action with missing fields returns 400', async () => {
    adapter = new UdsAdapter(ingestorMock, { socketPath });
    await adapter.start();

    const res = await postJsonOverUds(
      { socketPath, path: '/internal/action', timeoutMs: 5000 },
      {},
    );
    expect(res.statusCode).toBe(400);
  });

  it('POST /internal/ingest calls processIngest with correct args', async () => {
    adapter = new UdsAdapter(ingestorMock, { socketPath });
    await adapter.start();

    const html = '<div>test payload</div>';
    const res = await postJsonOverUds(
      { socketPath, path: '/internal/ingest', timeoutMs: 5000 },
      { html },
    );
    expect(res.statusCode).toBe(200);
    expect(ingestorMock.processIngest).toHaveBeenCalledWith(
      'manual',
      'full_parsed',
      html,
      undefined,
    );
  });

  it('POST /internal/ingest?webhook=true with jobLifecycleId calls processIngest with id', async () => {
    adapter = new UdsAdapter(ingestorMock, { socketPath });
    await adapter.start();

    const html = '<div>webhook payload</div>';
    const res = await postJsonOverUds(
      { socketPath, path: '/internal/ingest?webhook=true', timeoutMs: 5000 },
      { html, jobLifecycleId: 'webhook-job-1' },
    );
    expect(res.statusCode).toBe(200);
    expect(ingestorMock.processIngest).toHaveBeenCalledWith(
      'manual',
      'full_parsed',
      html,
      'webhook-job-1',
    );
  });

  it('POST /internal/ingest with empty html returns 400', async () => {
    adapter = new UdsAdapter(ingestorMock, { socketPath });
    await adapter.start();

    const res = await postJsonOverUds(
      { socketPath, path: '/internal/ingest', timeoutMs: 5000 },
      { html: '' },
    );
    expect(res.statusCode).toBe(400);
  });

  it('unknown path returns 404', async () => {
    adapter = new UdsAdapter(ingestorMock, { socketPath });
    await adapter.start();

    const res = await postJsonOverUds(
      { socketPath, path: '/unknown/path', timeoutMs: 5000 },
      {},
    );
    expect(res.statusCode).toBe(404);
  });

  it('auth with valid token passes', async () => {
    adapter = new UdsAdapter(ingestorMock, { socketPath, token: 'secret-123' });
    await adapter.start();

    const res = await postJsonOverUds(
      { socketPath, path: '/internal/action', headers: { 'x-internal-token': 'secret-123' }, timeoutMs: 5000 },
      { action: 'queue', jobLifecycleId: 'auth-test' },
    );
    expect(res.statusCode).toBe(200);
    expect(ingestorMock.processResolution).toHaveBeenCalledWith('auth-test', 'queue');
  });

  it('auth with invalid token returns 401', async () => {
    adapter = new UdsAdapter(ingestorMock, { socketPath, token: 'secret-123' });
    await adapter.start();

    const res = await postJsonOverUds(
      { socketPath, path: '/internal/action', headers: { 'x-internal-token': 'wrong-token' }, timeoutMs: 5000 },
      { action: 'queue', jobLifecycleId: 'auth-fail' },
    );
    expect(res.statusCode).toBe(401);
  });

  it('start → stop → start works (restart lifecycle)', async () => {
    adapter = new UdsAdapter(ingestorMock, { socketPath });
    await adapter.start();
    expect(fs.existsSync(socketPath)).toBe(true);

    await adapter.stop();
    expect(fs.existsSync(socketPath)).toBe(false);

    await adapter.start();
    expect(fs.existsSync(socketPath)).toBe(true);

    const res = await postJsonOverUds(
      { socketPath, path: '/internal/action', timeoutMs: 5000 },
      { action: 'queue', jobLifecycleId: 'restart-test' },
    );
    expect(res.statusCode).toBe(200);
  });
});
