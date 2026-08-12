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
    const bufs: Buffer[] = [];
    for await (const chunk of req) {
      bufs.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
    }
    return Buffer.concat(bufs).toString();
  }

  private async handleAction(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      const body = JSON.parse(await this.readBody(req)) as {
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
      await this.ingestor.processResolution(jobLifecycleId, action);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
    } catch (err) {
      logger.error('Action failed', { error: err instanceof Error ? err.message : String(err) });
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
  }

  private async handleIngest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    isWebhook: boolean
  ): Promise<void> {
    try {
      const body = JSON.parse(await this.readBody(req)) as {
        html?: string;
        jobLifecycleId?: string;
      };
      const html = body.html || '';
      if (!html.trim()) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Empty html payload' }));
        return;
      }

      await this.ingestor.processIngest(
        JobSource.MANUAL,
        JobStage.FULL_PARSED,
        html,
        isWebhook ? body.jobLifecycleId : undefined
      );
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
    } catch (err) {
      logger.error('Ingest failed', { error: err instanceof Error ? err.message : String(err) });
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
  }
}
