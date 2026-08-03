import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { UdsAdapter } from '../../../../src/infrastructure/inbound/uds/uds-adapter.js';
import type { IngestorPort } from '../../../../src/application/ports/inbound/ingestor.port.js';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const TOKEN = 'boundary-secret';

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

describe('Boundary failures at adapter boundaries', () => {
  let socketPath: string;
  let adapter: UdsAdapter;
  let ingestorMock: { processIngest: ReturnType<typeof vi.fn>; processResolution: ReturnType<typeof vi.fn> };

  beforeAll(async () => {
    socketPath = path.join(os.tmpdir(), `boundary-test-${Date.now()}.sock`);
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

  describe('malformed payloads', () => {
    it('returns 500 for invalid JSON on /internal/ingest', async () => {
      const res = await sendRaw(socketPath, '/internal/ingest', 'POST', 'not-json-at-all', { 'x-internal-token': TOKEN });
      expect(res.statusCode).toBe(500);
      const body = JSON.parse(await collectBody(res));
      expect(body.error).toBe('Internal server error');
    });

    it('returns 500 for invalid JSON on /internal/action', async () => {
      const res = await sendRaw(socketPath, '/internal/action', 'POST', '{invalid json!!!}', { 'x-internal-token': TOKEN });
      expect(res.statusCode).toBe(500);
    });

    it('returns 500 for empty body', async () => {
      const res = await sendRaw(socketPath, '/internal/ingest', 'POST', '', { 'x-internal-token': TOKEN });
      expect(res.statusCode).toBe(500);
    });

    it('returns 500 for null body', async () => {
      const res = await sendRaw(socketPath, '/internal/ingest', 'POST', 'null', { 'x-internal-token': TOKEN });
      expect(res.statusCode).toBe(500);
    });

    it('returns 400 for empty JSON object (no html field)', async () => {
      const res = await sendRaw(socketPath, '/internal/ingest', 'POST', '{}', { 'x-internal-token': TOKEN });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('auth boundary', () => {
    it('rejects when token header is completely missing', async () => {
      const res = await sendRaw(socketPath, '/internal/ingest', 'POST', JSON.stringify({ html: '<html/>' }));
      expect(res.statusCode).toBe(401);
      const body = JSON.parse(await collectBody(res));
      expect(body.error).toBe('Unauthorized');
    });

    it('rejects with empty token header', async () => {
      const res = await sendRaw(socketPath, '/internal/ingest', 'POST', JSON.stringify({ html: '<html/>' }), { 'x-internal-token': '' });
      expect(res.statusCode).toBe(401);
    });

    it('rejects with whitespace-only token', async () => {
      const res = await sendRaw(socketPath, '/internal/ingest', 'POST', JSON.stringify({ html: '<html/>' }), { 'x-internal-token': '   ' });
      expect(res.statusCode).toBe(401);
    });
  });

  describe('HTTP method boundary', () => {
    it('returns 404 for GET on /internal/ingest', async () => {
      const res = await sendRaw(socketPath, '/internal/ingest', 'GET', '', { 'x-internal-token': TOKEN });
      expect(res.statusCode).toBe(404);
    });

    it('returns 404 for PUT on /internal/ingest', async () => {
      const res = await sendRaw(socketPath, '/internal/ingest', 'PUT', '{}', { 'x-internal-token': TOKEN });
      expect(res.statusCode).toBe(404);
    });

    it('returns 404 for DELETE on /internal/ingest', async () => {
      const res = await sendRaw(socketPath, '/internal/ingest', 'DELETE', '', { 'x-internal-token': TOKEN });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('large payload boundary', () => {
    it('handles large HTML payload', async () => {
      const largeHtml = '<html>' + 'x'.repeat(50000) + '</html>';
      const res = await sendRaw(socketPath, '/internal/ingest', 'POST', JSON.stringify({ html: largeHtml }), { 'x-internal-token': TOKEN });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(await collectBody(res));
      expect(body.status).toBe('ok');
    });
  });
});
