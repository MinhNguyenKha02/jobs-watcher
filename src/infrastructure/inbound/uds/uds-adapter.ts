import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

import type { IngestorPort } from '../../../application/ports/inbound/ingestor.port.js';
import { JobStage, JobSource } from '../../../domain/types/job-lifecycle.js';
import { createLogger } from '../../outbound/logging/logger.js';

const logger = createLogger('UDS');

export interface UdsAdapterConfig {
  socketPath: string;
  token?: string;
}

export class UdsAdapter {
  private server: http.Server | null = null;

  constructor(
    private ingestor: IngestorPort,
    private config: UdsAdapterConfig
  ) {}

  async start(): Promise<void> {
    const dir = path.dirname(this.config.socketPath);
    await fs.promises.mkdir(dir, { recursive: true });
    try {
      await fs.promises.unlink(this.config.socketPath);
    } catch {}
    this.server = http.createServer((req, res) => this.handleRequest(req, res));
    this.server.timeout = 10000;
    this.server.keepAliveTimeout = 5000;
    this.server.headersTimeout = 11000;
    return new Promise<void>((resolve, reject) => {
      this.server!.listen(this.config.socketPath, () => {
        logger.info('Listening', { socketPath: this.config.socketPath });
        resolve();
      });
      this.server!.once('error', reject);
    });
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    return new Promise<void>((resolve) => this.server!.close(() => resolve()));
  }

  private authenticate(req: http.IncomingMessage): boolean {
    if (!this.config.token) return true;
    const token = req.headers['x-internal-token'];
    return token === this.config.token;
  }

  private async drain(req: http.IncomingMessage): Promise<void> {
    for await (const _chunk of req) {
      /* discard */
    }
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    // Guard slow clients / stalled ingest: if not handled in 10s, surface 503.
    req.setTimeout(10000, () => {
      if (!res.writableEnded) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Request timeout' }));
        req.destroy();
      }
    });
    req.on('close', () => {
      // best-effort drain on client abort
    });
    if (!this.authenticate(req)) {
      await this.drain(req);
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }

    const url = req.url || '/';
    if (req.method === 'POST' && url.startsWith('/internal/action')) {
      await this.handleAction(req, res);
    } else if (req.method === 'POST' && url.startsWith('/internal/ingest')) {
      const isWebhook = url.includes('webhook=true');
      await this.handleIngest(req, res, isWebhook);
    } else {
      await this.drain(req);
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    }
  }

  private async readBody(req: http.IncomingMessage): Promise<string> {
    const MAX_BYTES = 5_242_880;
    const bufs: Buffer[] = [];
    let total = 0;
    for await (const chunk of req) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
      total += buf.length;
      if (total > MAX_BYTES) {
        // Drain remainder and surface 413 at caller.
        for await (const _c of req) {
          /* discard */
        }
        throw new Error('Payload Too Large');
      }
      bufs.push(buf);
    }
    return Buffer.concat(bufs).toString();
  }

  private async handleAction(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    let bodyStr: string;
    try {
      bodyStr = await this.readBody(req);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === 'Payload Too Large') {
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Payload Too Large' }));
        return;
      }
      throw err;
    }
    try {
      const body = JSON.parse(bodyStr) as {
        jobLifecycleId?: string;
        action?: string;
      };
      const jobLifecycleId = body.jobLifecycleId;
      const action = body.action as 'queue' | 'trash';
      if (!jobLifecycleId || !action) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing jobLifecycleId or action' }));
        return;
      }
      // Decouple HTTP from ingestor: validate sync, respond 202, process async.
      res.writeHead(202, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'accepted' }));
      void this.ingestor.processResolution(jobLifecycleId, action).catch((e) => {
        logger.error('Action async failed', { error: e instanceof Error ? e.message : String(e) });
      });
    } catch (err) {
      if (res.writableEnded) return;
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('Payload Too Large')) {
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Payload Too Large' }));
        return;
      }
      logger.error('Action failed', { error: msg });
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
  }

  private async handleIngest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    isWebhook: boolean
  ): Promise<void> {
    let bodyStr: string;
    try {
      bodyStr = await this.readBody(req);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === 'Payload Too Large') {
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Payload Too Large' }));
        return;
      }
      throw err;
    }
    try {
      const body = JSON.parse(bodyStr) as {
        html?: string;
        jobLifecycleId?: string;
      };
      const html = body.html || '';
      if (!html.trim()) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Empty html payload' }));
        return;
      }

      // Decouple: validate html sync, respond 202, ingest async.
      res.writeHead(202, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'accepted' }));
      void this.ingestor
        .processIngest(
          JobSource.MANUAL,
          JobStage.FULL_PARSED,
          html,
          isWebhook ? body.jobLifecycleId : undefined
        )
        .catch((e) => {
          logger.error('Ingest async failed', {
            error: e instanceof Error ? e.message : String(e),
          });
        });
    } catch (err) {
      if (res.writableEnded) return;
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('Payload Too Large')) {
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Payload Too Large' }));
        return;
      }
      logger.error('Ingest failed', { error: msg });
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
  }
}
