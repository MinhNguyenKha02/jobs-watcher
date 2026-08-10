import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { buildSystemContainer } from '../../../../src/application/container.js';
import type { IngestorPort } from '../../../../src/application/ports/inbound/ingestor.port.js';
import type { UdsAdapter } from '../../../../src/infrastructure/inbound/uds/uds-adapter.js';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const TOKEN = 'secret-123';

function postJson(
  socketPath: string,
  url: string,
  data: unknown,
  token?: string
): Promise<http.IncomingMessage> {
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
    const req = http.request(options, (res) => {
      resolve(res);
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function sendRaw(
  socketPath: string,
  url: string,
  method: string,
  body: string,
  headers?: Record<string, string>
): Promise<http.IncomingMessage> {
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
  let ingestorMock: IngestorPort;

  beforeAll(async () => {
    socketPath = path.join(os.tmpdir(), `uds-test-${Date.now()}.sock`);
    try {
      if (fs.existsSync(socketPath)) fs.unlinkSync(socketPath);
    } catch {}

    ingestorMock = {
      processIngest: vi.fn().mockResolvedValue(undefined),
      processResolution: vi.fn().mockResolvedValue(undefined),
    };

    // Resolve the real UdsAdapter through the production composition root
    // (port-seam: scripted ingestor + UDS bind).
    adapter = buildSystemContainer(
      {
        nodeEnv: 'test',
        mongodb: { uri: 'mongodb://localhost/jw-uds', dbName: 'unit' },
        rabbitmq: {
          url: process.env.RABBITMQ_URL || 'amqp://localhost',
          exchange: 'jobs.events.ct',
        },
        uds: { socketPath, token: TOKEN },
        health: { port: 0 },
        asset: { outputDir: '/tmp/jobs-watcher-uds-assets' },
      },
      { ports: { ingestor: ingestorMock } }
    ).udsAdapter;
    await adapter.start();
  });

  afterAll(async () => {
    await adapter.stop();
    try {
      if (fs.existsSync(socketPath)) fs.unlinkSync(socketPath);
    } catch {}
  });

  describe('POST /internal/ingest', () => {
    it('GIVEN the UDS precondition WHEN the port is exercised on the real UDS THEN accepts valid ingest request and forwards to ingestor', async () => {
      const res = await postJson(
        socketPath,
        '/internal/ingest',
        { html: '<html><body>job content</body></html>' },
        TOKEN
      );
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(await collectBody(res));
      expect(body.status).toBe('ok');
      expect(ingestorMock.processIngest).toHaveBeenCalledOnce();
    });

    it('GIVEN the UDS precondition WHEN the port is exercised on the real UDS THEN accepts webhook ingest with html', async () => {
      const res = await postJson(
        socketPath,
        '/internal/ingest?webhook=true',
        { html: '<html><body>job</body></html>' },
        TOKEN
      );
      expect(res.statusCode).toBe(200);
    });

    it('GIVEN the UDS precondition WHEN the port is exercised on the real UDS THEN rejects webhook ingest without html', async () => {
      const res = await postJson(socketPath, '/internal/ingest?webhook=true', { html: '' }, TOKEN);
      expect(res.statusCode).toBe(400);
      const body = JSON.parse(await collectBody(res));
      expect(body.error).toBe('Empty html payload');
    });

    it('GIVEN the UDS precondition WHEN the port is exercised on the real UDS THEN accepts ingest with jobLifecycleId', async () => {
      const res = await postJson(
        socketPath,
        '/internal/ingest',
        { html: '<html/>', jobLifecycleId: 'existing-job-1' },
        TOKEN
      );
      expect(res.statusCode).toBe(200);
    });
  });

  describe('POST /internal/action', () => {
    it('GIVEN the UDS precondition WHEN the port is exercised on the real UDS THEN accepts queue action', async () => {
      const res = await postJson(
        socketPath,
        '/internal/action',
        { jobLifecycleId: 'job-1', action: 'queue' },
        TOKEN
      );
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(await collectBody(res));
      expect(body.status).toBe('ok');
      expect(ingestorMock.processResolution).toHaveBeenCalledWith('job-1', 'queue');
    });

    it('GIVEN the UDS precondition WHEN the port is exercised on the real UDS THEN accepts trash action', async () => {
      const res = await postJson(
        socketPath,
        '/internal/action',
        { jobLifecycleId: 'job-2', action: 'trash' },
        TOKEN
      );
      expect(res.statusCode).toBe(200);
    });

    it('GIVEN the UDS precondition WHEN the port is exercised on the real UDS THEN accepts action with editedKVs', async () => {
      const res = await postJson(
        socketPath,
        '/internal/action',
        {
          jobLifecycleId: 'job-3',
          action: 'queue',
          editedKVs: { role: 'Updated Role', salary: '$2000' },
        },
        TOKEN
      );
      expect(res.statusCode).toBe(200);
      expect(ingestorMock.processResolution).toHaveBeenCalledWith('job-3', 'queue');
    });

    it('GIVEN the UDS precondition WHEN the port is exercised on the real UDS THEN rejects action missing jobLifecycleId', async () => {
      const res = await postJson(socketPath, '/internal/action', { action: 'queue' }, TOKEN);
      expect(res.statusCode).toBe(400);
      const body = JSON.parse(await collectBody(res));
      expect(body.error).toBe('Missing jobLifecycleId or action');
    });
  });

  describe('POST /internal/ingest — auth', () => {
    it('GIVEN the UDS precondition WHEN the port is exercised on the real UDS THEN rejects requests without token', async () => {
      const res = await postJson(socketPath, '/internal/ingest', { html: '<html/>' });
      expect(res.statusCode).toBe(401);
      const body = JSON.parse(await collectBody(res));
      expect(body.error).toBe('Unauthorized');
    });

    it('GIVEN the UDS precondition WHEN the port is exercised on the real UDS THEN accepts requests with correct token', async () => {
      const res = await postJson(socketPath, '/internal/ingest', { html: '<html/>' }, TOKEN);
      expect(res.statusCode).toBe(200);
    });

    it('GIVEN the UDS precondition WHEN the port is exercised on the real UDS THEN rejects requests with wrong token', async () => {
      const res = await postJson(
        socketPath,
        '/internal/ingest',
        { html: '<html/>' },
        'wrong-token'
      );
      expect(res.statusCode).toBe(401);
    });
  });

  describe('non-existent routes', () => {
    it('GIVEN the UDS precondition WHEN the port is exercised on the real UDS THEN returns 404 for unknown path', async () => {
      const res = await postJson(socketPath, '/internal/unknown', {}, TOKEN);
      expect(res.statusCode).toBe(404);
    });
  });

  describe('edge cases', () => {
    it('GIVEN the UDS precondition WHEN the port is exercised on the real UDS THEN handles empty JSON body', async () => {
      const res = await postJson(socketPath, '/internal/ingest', {}, TOKEN);
      expect(res.statusCode).toBe(400);
    });

    it('GIVEN the UDS precondition WHEN the port is exercised on the real UDS THEN handles invalid JSON body gracefully', async () => {
      const res = await sendRaw(socketPath, '/internal/ingest', 'POST', 'not-json', {
        'x-internal-token': TOKEN,
      });
      expect(res.statusCode).toBe(500);
    });

    it('GIVEN the UDS precondition WHEN the port is exercised on the real UDS THEN handles GET request to /internal/ingest (wrong method)', async () => {
      const res = await sendRaw(socketPath, '/internal/ingest', 'GET', '', {
        'x-internal-token': TOKEN,
      });
      expect(res.statusCode).toBe(404);
    });

    it('GIVEN the UDS precondition WHEN the port is exercised on the real UDS THEN handles concurrent requests', async () => {
      const payloads = [
        { html: '<html>job1</html>', jobLifecycleId: 'concurrent-1' },
        { html: '<html>job2</html>', jobLifecycleId: 'concurrent-2' },
        { html: '<html>job3</html>', jobLifecycleId: 'concurrent-3' },
      ];
      const results = await Promise.all(
        payloads.map((p) => postJson(socketPath, '/internal/ingest', p, TOKEN))
      );
      results.forEach((res) => expect(res.statusCode).toBe(200));
    });

    it('GIVEN the UDS precondition WHEN the port is exercised on the real UDS THEN handles chunked body via multiple data events', async () => {
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
