import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createLogger } from '../../outbound/logging/logger.js';
import type { JobIngestor } from '../../../application/ingestor.js';
import { JobStage, JobSource } from '../../../domain/types/job-lifecycle.js';
import type { ProcessIngestCommand, ProcessResolutionCommand } from '../../../application/commands.js';

const logger = createLogger('UDS');

export interface UdsAdapterConfig {
  socketPath: string;
  token?: string;
}

export class UdsAdapter {
  private server: http.Server | null = null;

  constructor(
    private ingestor: JobIngestor,
    private config: UdsAdapterConfig,
  ) {}

  async start(): Promise<void> {
    const dir = path.dirname(this.config.socketPath);
    await fs.promises.mkdir(dir, { recursive: true });
    try { await fs.promises.unlink(this.config.socketPath); } catch { }
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

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (!this.authenticate(req)) {
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
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    }
  }

  private async readBody(req: http.IncomingMessage): Promise<string> {
    const bufs: Buffer[] = [];
    for await (const chunk of req) bufs.push(Buffer.from(chunk));
    return Buffer.concat(bufs).toString();
  }

  private async handleAction(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      const body = JSON.parse(await this.readBody(req));
      const command: ProcessResolutionCommand = {
        jobLifecycleId: body.jobLifecycleId,
        action: body.action,
        editedKVs: body.editedKVs,
      };
      if (!command.jobLifecycleId || !command.action) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing jobLifecycleId or action' }));
        return;
      }
      await this.ingestor.processResolutionCommand(command);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
    } catch (err) {
      logger.error('Action failed', { error: err instanceof Error ? err.message : String(err) });
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
  }

  private async handleIngest(req: http.IncomingMessage, res: http.ServerResponse, isWebhook: boolean): Promise<void> {
    try {
      const body = JSON.parse(await this.readBody(req));
      const html = body.html || '';
      if (!html.trim()) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Empty html payload' }));
        return;
      }

      const command: ProcessIngestCommand = {
        source: JobSource.MANUAL,
        stage: JobStage.FULL_PARSED,
        rawPayload: html,
        jobLifecycleId: isWebhook ? body.jobLifecycleId : undefined,
      };

      await this.ingestor.processIngestCommand(command);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
    } catch (err) {
      logger.error('Ingest failed', { error: err instanceof Error ? err.message : String(err) });
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
  }
}
