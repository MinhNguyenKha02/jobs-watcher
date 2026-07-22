import express, { type Request, type Response } from 'express';
import { getLogger } from '../../outbound/logging/logger.js';
import type { MetricsRegistry } from '../../outbound/monitoring/metrics-registry.js';

const logger = getLogger();

export interface HealthOptions {
  port: number;
  metricsRegistry: MetricsRegistry;
}

export function startHealthServer(opts: HealthOptions): void {
  const app = express();

  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok' });
  });

  app.get('/live', (_req: Request, res: Response) => {
    res.json({ status: 'alive' });
  });

  app.get('/ready', (_req: Request, res: Response) => {
    res.json({ status: 'ready' });
  });

  app.get('/metrics', async (_req: Request, res: Response) => {
    try {
      const metrics = await opts.metricsRegistry.metrics();
      res.set('Content-Type', 'text/plain; charset=utf-8');
      res.send(metrics);
    } catch (err) {
      logger.error('[Health] Failed to serve metrics', { error: err instanceof Error ? err.message : String(err) });
      res.status(500).send('Internal Server Error');
    }
  });

  app.get('/health/observability', async (_req: Request, res: Response) => {
    try {
      const metrics = await opts.metricsRegistry.metrics();
      const lines = metrics.split('\n').filter(l => l && !l.startsWith('#'));
      const parsed: Record<string, number> = {};
      for (const line of lines) {
        const [name, value] = line.split(' ');
        if (name && value !== undefined) {
          const num = Number(value);
          if (!isNaN(num)) parsed[name] = num;
        }
      }
      res.json(parsed);
    } catch (err) {
      logger.error('[Health] Failed to serve /health/observability', { error: err instanceof Error ? err.message : String(err) });
      res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  app.listen(opts.port, () => {
    logger.info(`[Health] Server listening on port ${opts.port}`);
  });
}
