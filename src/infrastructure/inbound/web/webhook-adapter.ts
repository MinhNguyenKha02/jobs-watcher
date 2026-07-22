import express, { type Request, type Response } from 'express';
import { getLogger } from '../../outbound/logging/logger.js';
import type { JobIngestor } from '../../../application/ingestor.js';
import { JobStage, JobSource } from '../../../domain/types/job-lifecycle.js';
import type { ProcessIngestCommand } from '../../../application/commands.js';

const logger = getLogger();

export class WebhookAdapter {
  private ingestor: JobIngestor;

  constructor(ingestor: JobIngestor) {
    this.ingestor = ingestor;
  }

  start(port: number, path: string): void {
    const app = express();

    app.use(express.json({ limit: '10mb' }));
    app.use(express.text({ limit: '10mb', type: 'text/plain' }));

    app.post(path, async (req: Request, res: Response) => {
      try {
        const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
        const messageId = req.headers['x-message-id'] as string || `webhook-${Date.now()}`;

        const command: ProcessIngestCommand = {
          source: JobSource.BROWSER_AUTO,
          stage: JobStage.PARTIAL_PARSED,
          rawPayload: body,
          jobLifecycleId: undefined,
          metadata: {
            messageId,
            threadId: req.headers['x-thread-id'] as string,
            from: req.headers['x-from'] as string,
            to: req.headers['x-to'] as string,
            subject: req.headers['x-subject'] as string,
          },
        };

        await this.ingestor.processIngestCommand(command);
        res.status(202).json({ status: 'accepted', messageId });
      } catch (err) {
        logger.error('[Webhook] Processing failed', { error: err instanceof Error ? err.message : String(err) });
        res.status(500).json({ status: 'error', error: 'Internal server error' });
      }
    });

    app.listen(port, () => {
      logger.info(`[Webhook] Server listening on port ${port}`);
    });
  }
}
