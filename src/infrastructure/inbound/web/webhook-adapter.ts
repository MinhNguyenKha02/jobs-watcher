import express, { type Request, type Response } from 'express';
import { createLogger } from '../../outbound/logging/logger.js';
import type { IngestorPort } from '../../../application/ports/inbound/ingestor.port.js';
import { JobStage, JobSource } from '../../../domain/types/job-lifecycle.js';

const logger = createLogger('Webhook');

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

export interface GmailClient {
  getMessage(messageId: string): Promise<unknown>;
  extractHeader(message: unknown, name: string): string;
  extractBody(message: unknown): string;
  getMessagesSinceHistory(historyId: string, labelId?: string): Promise<string[]>;
}

export class WebhookAdapter {
  private ingestor: IngestorPort;
  private gmail: GmailClient;
  private server: Server | null = null;

  constructor(ingestor: IngestorPort, gmail: GmailClient) {
    this.ingestor = ingestor;
    this.gmail = gmail;
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
        const raw = req.body as Record<string, unknown>;
        let gmailMessageId = '';

        if (
          raw &&
          typeof raw === 'object' &&
          'message' in raw &&
          typeof (raw as PubSubPushPayload).message?.data === 'string'
        ) {
          const pubsub = raw as PubSubPushPayload;
          const decoded = decodeBase64Json(pubsub.message!.data!);
          const historyId = String(decoded.historyId || '');
          if (historyId) {
            const ids = await this.gmail.getMessagesSinceHistory(historyId);
            gmailMessageId = ids[0] || '';
          }
          logger.info('PubSub push', {
            historyId,
            emailAddress: decoded.emailAddress,
            gmailMessageId,
          });
        } else if (raw && typeof raw === 'object' && typeof raw.messageId === 'string') {
          gmailMessageId = raw.messageId as string;
          logger.info('Simulated push', { gmailMessageId });
        }

        if (!gmailMessageId) {
          logger.warn('No messageId resolved — skipping');
          res.status(202).json({ status: 'accepted', messageId: '' });
          return;
        }

        const gmailMsg = await this.gmail.getMessage(gmailMessageId);
        const rawPayload = this.gmail.extractBody(gmailMsg);
        const subject = this.gmail.extractHeader(gmailMsg, 'Subject');
        const from = this.gmail.extractHeader(gmailMsg, 'From');
        const to = this.gmail.extractHeader(gmailMsg, 'To');

        if (!rawPayload.trim()) {
          logger.warn('Empty email body after extraction', { gmailMessageId });
          res.status(202).json({ status: 'accepted', messageId: gmailMessageId });
          return;
        }

        await this.ingestor.processIngest(
          JobSource.BROWSER_AUTO,
          JobStage.PARTIAL_PARSED,
          rawPayload,
          undefined,
          {
            messageId: gmailMessageId,
            threadId: this.gmail.extractHeader(gmailMsg, 'Message-ID') || '',
            from,
            to,
            subject,
          }
        );
        res.status(202).json({ status: 'accepted', messageId: gmailMessageId });
      } catch (err) {
        logger.error('Processing failed', {
          error: err instanceof Error ? err.message : String(err),
        });
        res.status(500).json({ status: 'error', error: 'Internal server error' });
      }
    });

    this.server = app.listen(port, () => {
      logger.info('Listening', { port, path });
    });
  }
}
