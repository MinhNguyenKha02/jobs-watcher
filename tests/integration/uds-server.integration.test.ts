import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { createTestStorage } from '../helpers/create-test-storage.js';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import type { Server } from 'node:http';

describe('UDS Server Integration', () => {
  let storage: Awaited<ReturnType<typeof createTestStorage>>;
  let socketPath: string;
  let server: Server;
  let ingestorMock: { processIngest: ReturnType<typeof vi.fn>; processResolution: ReturnType<typeof vi.fn> };

  function createHandler(req: http.IncomingMessage, res: http.ServerResponse) {
    const INTERNAL_TOKEN = process.env.INTERNAL_AUTH_TOKEN || '';
    const token = (req.headers['x-internal-token'] || '') as string;

    if (INTERNAL_TOKEN && token !== INTERNAL_TOKEN) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }

    if (req.method === 'POST' && req.url?.startsWith('/internal/ingest')) {
      let body = '';
      req.on('data', (c: any) => { body += c; });
      req.on('end', async () => {
        try {
          const url = new URL(req.url || '/internal/ingest', 'http://localhost');
          const isWebhook = url.searchParams.get('webhook') === 'true';
          const job = JSON.parse(body || '{}');
          const htmlPayload = typeof job.html === 'string' ? job.html : '';
          if (isWebhook && !htmlPayload.trim()) {
            throw new Error('Webhook stage 2 ingest requires html');
          }
          const { JobSource, JobStage } = await import('../../src/domain/types/job-lifecycle.js' );
          await ingestorMock.processIngest(
            JobSource.MANUAL,
            JobStage.FULL_PARSED,
            htmlPayload,
            job.jobLifecycleId || undefined,
            {
              subject: (job.subject as string) || '',
              from: (job.from as string) || '',
              to: (job.to as string) || '',
              threadId: (job.threadId as string) || '',
            },
          );
          res.writeHead(202, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ accepted: true }));
        } catch (err: any) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message || String(err) }));
        }
      });
      return;
    }

    if (req.method === 'POST' && req.url === '/internal/action') {
      let body = '';
      req.on('data', (c: any) => { body += c; });
      req.on('end', async () => {
        try {
          const parsed = JSON.parse(body || '{}');
          const jobLifecycleId = String(parsed?.jobLifecycleId ?? '');
          const action = (parsed?.action || 'queue') as 'queue' | 'trash';
          await ingestorMock.processResolution(jobLifecycleId, action);
          res.writeHead(202, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ accepted: true }));
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'bad_request' }));
        }
      });
      return;
    }

    res.writeHead(404);
    res.end();
  }

  function postJson(url: string, data: any, token?: string): Promise<http.IncomingMessage> {
    return new Promise((resolve, reject) => {
      const body = JSON.stringify(data);
      const options: http.RequestOptions = {
        socketPath,
        path: url,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          ...(token ? { 'x-internal-token': token } : {}),
        },
      };
      const req = http.request(options, (res) => {
        resolve(res);
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }

  async function collectBody(res: http.IncomingMessage): Promise<string> {
    const chunks: Buffer[] = [];
    for await (const chunk of res) {
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString('utf-8');
  }

  beforeAll(async () => {
    storage = await createTestStorage();
    socketPath = path.join(os.tmpdir(), `uds-test-${Date.now()}.sock`);

    ingestorMock = {
      processIngest: vi.fn().mockResolvedValue(undefined),
      processResolution: vi.fn().mockResolvedValue(undefined),
    };

    if (fs.existsSync(socketPath)) fs.unlinkSync(socketPath);

    server = http.createServer(createHandler);
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(socketPath, resolve);
    });
  });

  afterAll(async () => {
    try {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    } catch {}
    try { if (fs.existsSync(socketPath)) fs.unlinkSync(socketPath); } catch {}
    await storage.stop();
  });

  describe('POST /internal/ingest', () => {
    it('accepts valid ingest request and forwards to ingestor', async () => {
      const res = await postJson('/internal/ingest', { html: '<html><body>job content</body></html>' });
      expect(res.statusCode).toBe(202);
      const body = JSON.parse(await collectBody(res));
      expect(body.accepted).toBe(true);
      expect(ingestorMock.processIngest).toHaveBeenCalledOnce();
    });

    it('accepts webhook ingest with html', async () => {
      const res = await postJson('/internal/ingest?webhook=true', { html: '<html><body>job</body></html>' });
      expect(res.statusCode).toBe(202);
    });

    it('rejects webhook ingest without html', async () => {
      const res = await postJson('/internal/ingest?webhook=true', { html: '' });
      expect(res.statusCode).toBe(500);
      const body = JSON.parse(await collectBody(res));
      expect(body.error).toContain('requires html');
    });

    it('accepts ingest with jobLifecycleId', async () => {
      const res = await postJson('/internal/ingest', { html: '<html/>', jobLifecycleId: 'existing-job-1' });
      expect(res.statusCode).toBe(202);
    });
  });

  describe('POST /internal/action', () => {
    it('accepts queue action', async () => {
      const res = await postJson('/internal/action', { jobLifecycleId: 'job-1', action: 'queue' });
      expect(res.statusCode).toBe(202);
      const body = JSON.parse(await collectBody(res));
      expect(body.accepted).toBe(true);
      expect(ingestorMock.processResolution).toHaveBeenCalledWith('job-1', 'queue');
    });

    it('accepts trash action', async () => {
      const res = await postJson('/internal/action', { jobLifecycleId: 'job-2', action: 'trash' });
      expect(res.statusCode).toBe(202);
    });

    it('accepts action with editedKVs', async () => {
      const res = await postJson('/internal/action', {
        jobLifecycleId: 'job-3',
        action: 'queue',
        editedKVs: { role: 'Updated Role', salary: '$2000' },
      });
      expect(res.statusCode).toBe(202);
      expect(ingestorMock.processResolution).toHaveBeenCalledWith('job-3', 'queue');
    });

    it('handles missing jobLifecycleId', async () => {
      const res = await postJson('/internal/action', { action: 'queue' });
      expect(res.statusCode).toBe(202);
      expect(ingestorMock.processResolution).toHaveBeenCalledWith('', 'queue');
    });
  });

  describe('POST /internal/ingest — auth', () => {
    it('rejects requests without token when token is set', async () => {
      process.env.INTERNAL_AUTH_TOKEN = 'secret-123';
      const res = await postJson('/internal/ingest', { html: '<html/>' });
      expect(res.statusCode).toBe(401);
      const body = JSON.parse(await collectBody(res));
      expect(body.error).toBe('unauthorized');
      delete process.env.INTERNAL_AUTH_TOKEN;
    });

    it('accepts requests with correct token', async () => {
      process.env.INTERNAL_AUTH_TOKEN = 'secret-123';
      const res = await postJson('/internal/ingest', { html: '<html/>' }, 'secret-123');
      expect(res.statusCode).toBe(202);
      delete process.env.INTERNAL_AUTH_TOKEN;
    });

    it('rejects requests with wrong token', async () => {
      process.env.INTERNAL_AUTH_TOKEN = 'real-token';
      const res = await postJson('/internal/ingest', { html: '<html/>' }, 'wrong-token');
      expect(res.statusCode).toBe(401);
      delete process.env.INTERNAL_AUTH_TOKEN;
    });
  });

  describe('non-existent routes', () => {
    it('returns 404 for unknown path', async () => {
      const res = await postJson('/internal/unknown', {});
      expect(res.statusCode).toBe(404);
    });
  });

  describe('edge cases', () => {
    it('handles empty JSON body', async () => {
      const res = await postJson('/internal/ingest', {});
      expect(res.statusCode).toBe(202);
    });

    it('handles invalid JSON body gracefully', async () => {
      const res = await new Promise<http.IncomingMessage>((resolve, reject) => {
        const body = 'not-json';
        const options: http.RequestOptions = {
          socketPath,
          path: '/internal/ingest',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
          },
        };
        const req = http.request(options, resolve);
        req.on('error', reject);
        req.write(body);
        req.end();
      });
      expect(res.statusCode).toBe(500);
    });

    it('handles GET request to /internal/ingest (wrong method)', async () => {
      const res = await new Promise<http.IncomingMessage>((resolve, reject) => {
        const options: http.RequestOptions = {
          socketPath,
          path: '/internal/ingest',
          method: 'GET',
        };
        const req = http.request(options, resolve);
        req.on('error', reject);
        req.end();
      });
      expect(res.statusCode).toBe(404);
    });

    it('handles concurrent requests', async () => {
      const payloads = [
        { html: '<html>job1</html>', jobLifecycleId: 'concurrent-1' },
        { html: '<html>job2</html>', jobLifecycleId: 'concurrent-2' },
        { html: '<html>job3</html>', jobLifecycleId: 'concurrent-3' },
      ];
      const results = await Promise.all(payloads.map(p => postJson('/internal/ingest', p)));
      results.forEach(res => expect(res.statusCode).toBe(202));
    });

    it('handles chunked body via multiple data events', async () => {
      const res = await new Promise<http.IncomingMessage>((resolve, reject) => {
        const chunks = ['{"html":', '"<html>', 'chunked', '</html>', '"}'];
        const fullBody = chunks.join('');
        const options: http.RequestOptions = {
          socketPath,
          path: '/internal/ingest',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(fullBody),
          },
        };
        const req = http.request(options, resolve);
        req.on('error', reject);
        // Write in chunks to simulate network fragmentation
        for (const chunk of chunks) {
          req.write(chunk);
        }
        req.end();
      });
      expect(res.statusCode).toBe(202);
      const body = JSON.parse(await collectBody(res));
      expect(body.accepted).toBe(true);
    });
  });
});
