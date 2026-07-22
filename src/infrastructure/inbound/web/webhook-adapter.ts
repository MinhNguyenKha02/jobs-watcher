import express, { type Request, type Response } from 'express';
import { getLogger } from '../../outbound/logging/logger.js';
import type { JobIngestor } from '../../../application/ingestor.js';
import { JobStage, JobSource } from '../../../domain/types/job-lifecycle.js';
import type { ProcessIngestCommand } from '../../../application/commands.js';

const logger = getLogger();

import type { Server } from 'http';

interface PubSubPushPayload {
  message?: {
    data?: string;
    messageId?: string;
    publishTime?: string;
    attributes?: Record<string, string>;
  };
  subscription?: string;
}

function decodeBase64Json(data: string): Record<string, unknown> {
  try {
    return JSON.parse(Buffer.from(data, 'base64').toString('utf-8'));
  } catch {
    return {};
  }
}

export class WebhookAdapter {
  private ingestor: JobIngestor;
  private server: Server | null = null;

  constructor(ingestor: JobIngestor) {
    this.ingestor = ingestor;
  }

  async stop(): Promise<void> {
    if (this.server) {
      await new Promise<void>((resolve) => this.server?.close(() => resolve()));
    }
  }

  start(port: number, path: string): void {
    const app = express();

    app.use(express.json({ limit: '10mb' }));
    app.use(express.text({ limit: '10mb', type: 'text/plain' }));

    app.post(path, async (req: Request, res: Response) => {
      try {
        const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
        const raw = req.body as Record<string, unknown>;
        let messageId = '';

        if (raw && typeof raw === 'object' && 'message' in raw && typeof (raw as PubSubPushPayload).message?.data === 'string') {
          const pubsub = raw as PubSubPushPayload;
          messageId = pubsub.message!.messageId || '';
          const decoded = decodeBase64Json(pubsub.message!.data!);
          logger.info('[Webhook] PubSub push', { messageId, historyId: decoded.historyId, emailAddress: decoded.emailAddress });
        } else if (raw && typeof raw === 'object' && typeof raw.messageId === 'string') {
          messageId = raw.messageId as string;
          logger.info('[Webhook] Simulated push', { messageId });
        } else {
          messageId = `webhook-${Date.now()}`;
          logger.info('[Webhook] Generic push, generated messageId', { messageId });
        }

        const command: ProcessIngestCommand = {
          source: JobSource.BROWSER_AUTO,
          stage: JobStage.PARTIAL_PARSED,
          rawPayload: body,
          jobLifecycleId: undefined,
          metadata: {
            messageId,
            threadId: (req.headers['x-thread-id'] as string) || '',
            from: (req.headers['x-from'] as string) || '',
            to: (req.headers['x-to'] as string) || '',
            subject: (req.headers['x-subject'] as string) || '',
          },
        };

        await this.ingestor.processIngestCommand(command);
        res.status(202).json({ status: 'accepted', messageId });
      } catch (err) {
        logger.error('[Webhook] Processing failed', { error: err instanceof Error ? err.message : String(err) });
        res.status(500).json({ status: 'error', error: 'Internal server error' });
      }
    });

    this.server = app.listen(port, () => {
      logger.info(`[Webhook] Listening on port ${port}${path}`);
    });
  }
}
