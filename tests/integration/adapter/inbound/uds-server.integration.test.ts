import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { UdsAdapter } from '../../../../src/infrastructure/inbound/uds/uds-adapter.js';
import type { IngestorPort } from '../../../../src/application/ports/inbound/ingestor.port.js';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const TOKEN = 'secret-123';

function postJson(socketPath: string, url: string, data: unknown, token?: string): Promise<http.IncomingMessage> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const options: http.RequestOptions = {
      socketPath,
      path: url,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        ...(token !== undefined ? { 'x-internal-token': token } : {}),
      },
    };
    const req = http.request(options, (res) => { resolve(res); });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function sendRaw(socketPath: string, url: string, method: string, body: string, headers?: Record<string, string>): Promise<http.IncomingMessage> {
  return new Promise((resolve, reject) => {
    const options: http.RequestOptions = {
      socketPath,
      path: url,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}),
        ...headers,
      },
    };
    const req = http.request(options, (res) => resolve(res));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function collectBody(res: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of res) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf-8');
}

describe('UDS Server Integration', () => {
  let socketPath: string;
  let adapter: UdsAdapter;
  let ingestorMock: { processIngest: ReturnType<typeof vi.fn>; processResolution: ReturnType<typeof vi.fn> };

  beforeAll(async () => {
    socketPath = path.join(os.tmpdir(), `uds-test-${Date.now()}.sock`);
    try { if (fs.existsSync(socketPath)) fs.unlinkSync(socketPath); } catch {}

    ingestorMock = {
      processIngest: vi.fn().mockResolvedValue(undefined),
      processResolution: vi.fn().mockResolvedValue(undefined),
    };

    adapter = new UdsAdapter(ingestorMock as unknown as IngestorPort, { socketPath, token: TOKEN });
    await adapter.start();
  });

  afterAll(async () => {
    await adapter.stop();
    try { if (fs.existsSync(socketPath)) fs.unlinkSync(socketPath); } catch {}
  });

  describe('POST /internal/ingest', () => {
    it('accepts valid ingest request and forwards to ingestor', async () => {
      const res = await postJson(socketPath, '/internal/ingest', { html: '<html><body>job content</body></html>' }, TOKEN);
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(await collectBody(res));
      expect(body.status).toBe('ok');
      expect(ingestorMock.processIngest).toHaveBeenCalledOnce();
    });

    it('accepts webhook ingest with html', async () => {
      const res = await postJson(socketPath, '/internal/ingest?webhook=true', { html: '<html><body>job</body></html>' }, TOKEN);
      expect(res.statusCode).toBe(200);
    });

    it('rejects webhook ingest without html', async () => {
      const res = await postJson(socketPath, '/internal/ingest?webhook=true', { html: '' }, TOKEN);
      expect(res.statusCode).toBe(400);
      const body = JSON.parse(await collectBody(res));
      expect(body.error).toBe('Empty html payload');
    });

    it('accepts ingest with jobLifecycleId', async () => {
      const res = await postJson(socketPath, '/internal/ingest', { html: '<html/>', jobLifecycleId: 'existing-job-1' }, TOKEN);
      expect(res.statusCode).toBe(200);
    });
  });

  describe('POST /internal/action', () => {
    it('accepts queue action', async () => {
      const res = await postJson(socketPath, '/internal/action', { jobLifecycleId: 'job-1', action: 'queue' }, TOKEN);
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(await collectBody(res));
      expect(body.status).toBe('ok');
      expect(ingestorMock.processResolution).toHaveBeenCalledWith('job-1', 'queue');
    });

    it('accepts trash action', async () => {
      const res = await postJson(socketPath, '/internal/action', { jobLifecycleId: 'job-2', action: 'trash' }, TOKEN);
      expect(res.statusCode).toBe(200);
    });

    it('accepts action with editedKVs', async () => {
      const res = await postJson(socketPath, '/internal/action', {
        jobLifecycleId: 'job-3',
        action: 'queue',
        editedKVs: { role: 'Updated Role', salary: '$2000' },
      }, TOKEN);
      expect(res.statusCode).toBe(200);
      expect(ingestorMock.processResolution).toHaveBeenCalledWith('job-3', 'queue');
    });

    it('rejects action missing jobLifecycleId', async () => {
      const res = await postJson(socketPath, '/internal/action', { action: 'queue' }, TOKEN);
      expect(res.statusCode).toBe(400);
      const body = JSON.parse(await collectBody(res));
      expect(body.error).toBe('Missing jobLifecycleId or action');
    });
  });

  describe('POST /internal/ingest — auth', () => {
    it('rejects requests without token', async () => {
      const res = await postJson(socketPath, '/internal/ingest', { html: '<html/>' });
      expect(res.statusCode).toBe(401);
      const body = JSON.parse(await collectBody(res));
      expect(body.error).toBe('Unauthorized');
    });

    it('accepts requests with correct token', async () => {
      const res = await postJson(socketPath, '/internal/ingest', { html: '<html/>' }, TOKEN);
      expect(res.statusCode).toBe(200);
    });

    it('rejects requests with wrong token', async () => {
      const res = await postJson(socketPath, '/internal/ingest', { html: '<html/>' }, 'wrong-token');
      expect(res.statusCode).toBe(401);
    });
  });

  describe('non-existent routes', () => {
    it('returns 404 for unknown path', async () => {
      const res = await postJson(socketPath, '/internal/unknown', {}, TOKEN);
      expect(res.statusCode).toBe(404);
    });
  });

  describe('edge cases', () => {
    it('handles empty JSON body', async () => {
      const res = await postJson(socketPath, '/internal/ingest', {}, TOKEN);
      expect(res.statusCode).toBe(400);
    });

    it('handles invalid JSON body gracefully', async () => {
      const res = await sendRaw(socketPath, '/internal/ingest', 'POST', 'not-json', { 'x-internal-token': TOKEN });
      expect(res.statusCode).toBe(500);
    });

    it('handles GET request to /internal/ingest (wrong method)', async () => {
      const res = await sendRaw(socketPath, '/internal/ingest', 'GET', '', { 'x-internal-token': TOKEN });
      expect(res.statusCode).toBe(404);
    });

    it('handles concurrent requests', async () => {
      const payloads = [
        { html: '<html>job1</html>', jobLifecycleId: 'concurrent-1' },
        { html: '<html>job2</html>', jobLifecycleId: 'concurrent-2' },
        { html: '<html>job3</html>', jobLifecycleId: 'concurrent-3' },
      ];
      const results = await Promise.all(payloads.map(p => postJson(socketPath, '/internal/ingest', p, TOKEN)));
      results.forEach(res => expect(res.statusCode).toBe(200));
    });

    it('handles chunked body via multiple data events', async () => {
      const chunks = ['{"html":', '"<html>', 'chunked', '</html>', '"}'];
      const fullBody = chunks.join('');
      const res = await new Promise<http.IncomingMessage>((resolve, reject) => {
        const options: http.RequestOptions = {
          socketPath,
          path: '/internal/ingest',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(fullBody),
            'x-internal-token': TOKEN,
          },
        };
        const req = http.request(options, resolve);
        req.on('error', reject);
        for (const chunk of chunks) req.write(chunk);
        req.end();
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(await collectBody(res));
      expect(body.status).toBe('ok');
    });
  });
});
