import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { createTestStorage } from '../helpers/create-test-storage.js';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import type { Server } from 'node:http';

describe('Boundary failures at adapter boundaries', () => {
  let storage: Awaited<ReturnType<typeof createTestStorage>>;
  let socketPath: string;
  let server: Server;
  let capturedErrors: Array<{ req: http.IncomingMessage; error: string }>;

  function createBoundaryHandler(req: http.IncomingMessage, res: http.ServerResponse) {
    if (!req.url) { res.writeHead(404); res.end(); return; }

    const token = (req.headers['x-internal-token'] || '') as string;
    const INTERNAL_TOKEN = process.env.INTERNAL_AUTH_TOKEN || '';
    if (INTERNAL_TOKEN && token !== INTERNAL_TOKEN) {
      capturedErrors.push({ req, error: 'unauthorized' });
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }

    if (req.method === 'POST' && req.url?.startsWith('/internal/ingest')) {
      let body = '';
      req.on('data', (c: any) => { body += c; });
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          const html = parsed.html || '';
          if (typeof html !== 'string') {
            capturedErrors.push({ req, error: 'html_not_string' });
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'html must be a string' }));
            return;
          }
          res.writeHead(202, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ accepted: true, length: html.length }));
        } catch (err: any) {
          capturedErrors.push({ req, error: 'invalid_json' });
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'invalid_json' }));
        }
      });
      return;
    }

    if (req.method === 'POST' && req.url === '/internal/action') {
      let body = '';
      req.on('data', (c: any) => { body += c; });
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          if (!parsed.joblifecycleId || typeof parsed.joblifecycleId !== 'string') {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'missing joblifecycleId' }));
            return;
          }
          res.writeHead(202, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ accepted: true }));
        } catch {
          capturedErrors.push({ req, error: 'invalid_json' });
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'invalid_json' }));
        }
      });
      return;
    }

    res.writeHead(404);
    res.end();
  }

  function sendRaw(path: string, method: string, body: string, headers?: Record<string, string>): Promise<http.IncomingMessage> {
    return new Promise((resolve, reject) => {
      const options: http.RequestOptions = {
        socketPath,
        path,
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

  beforeAll(async () => {
    storage = await createTestStorage();
    socketPath = path.join(os.tmpdir(), `boundary-test-${Date.now()}.sock`);
    capturedErrors = [];
    if (fs.existsSync(socketPath)) fs.unlinkSync(socketPath);

    server = http.createServer(createBoundaryHandler);
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(socketPath, resolve);
    });
  });

  afterAll(async () => {
    try { await new Promise<void>((resolve) => server.close(() => resolve())); } catch {}
    try { if (fs.existsSync(socketPath)) fs.unlinkSync(socketPath); } catch {}
    await storage.stop();
  });

  describe('malformed payloads', () => {
    it('returns 400 for invalid JSON on /internal/ingest', async () => {
      const res = await sendRaw('/internal/ingest', 'POST', 'not-json-at-all');
      expect(res.statusCode).toBe(400);
      const body = JSON.parse(await collectBody(res));
      expect(body.error).toBe('invalid_json');
    });

    it('returns 400 for invalid JSON on /internal/action', async () => {
      const res = await sendRaw('/internal/action', 'POST', '{invalid json!!!}');
      expect(res.statusCode).toBe(400);
    });

    it('handles empty body gracefully', async () => {
      const res = await sendRaw('/internal/ingest', 'POST', '');
      expect(res.statusCode).toBe(400);
    });

    it('handles null body', async () => {
      const res = await sendRaw('/internal/ingest', 'POST', 'null');
      // JSON.parse('null') returns null, causing TypeError when accessing .html
      expect(res.statusCode).toBe(400);
    });

    it('handles empty JSON object', async () => {
      const res = await sendRaw('/internal/ingest', 'POST', '{}');
      expect(res.statusCode).toBe(202);
    });
  });

  describe('auth boundary', () => {
    beforeAll(() => {
      process.env.INTERNAL_AUTH_TOKEN = 'boundary-secret';
    });

    afterAll(() => {
      delete process.env.INTERNAL_AUTH_TOKEN;
    });

    it('rejects when token header is completely missing', async () => {
      const res = await sendRaw('/internal/ingest', 'POST', JSON.stringify({ html: '<html/>' }));
      expect(res.statusCode).toBe(401);
      const body = JSON.parse(await collectBody(res));
      expect(body.error).toBe('unauthorized');
    });

    it('rejects with empty token header', async () => {
      const res = await sendRaw('/internal/ingest', 'POST', JSON.stringify({ html: '<html/>' }), { 'x-internal-token': '' });
      expect(res.statusCode).toBe(401);
    });

    it('rejects with whitespace-only token', async () => {
      const res = await sendRaw('/internal/ingest', 'POST', JSON.stringify({ html: '<html/>' }), { 'x-internal-token': '   ' });
      expect(res.statusCode).toBe(401);
    });
  });

  describe('HTTP method boundary', () => {
    it('returns 404 for GET on /internal/ingest', async () => {
      const res = await sendRaw('/internal/ingest', 'GET', '');
      expect(res.statusCode).toBe(404);
    });

    it('returns 404 for PUT on /internal/ingest', async () => {
      const res = await sendRaw('/internal/ingest', 'PUT', '{}');
      expect(res.statusCode).toBe(404);
    });

    it('returns 404 for DELETE on /internal/ingest', async () => {
      const res = await sendRaw('/internal/ingest', 'DELETE', '');
      expect(res.statusCode).toBe(404);
    });
  });

  describe('large payload boundary', () => {
    it('handles large HTML payload', async () => {
      const largeHtml = '<html>' + 'x'.repeat(50000) + '</html>';
      const res = await sendRaw('/internal/ingest', 'POST', JSON.stringify({ html: largeHtml }));
      expect(res.statusCode).toBe(202);
      const body = JSON.parse(await collectBody(res));
      expect(body.accepted).toBe(true);
      expect(body.length).toBe(largeHtml.length);
    });
  });
});
