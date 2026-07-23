import express, { type Request, type Response } from 'express';
import { createLogger } from '../../outbound/logging/logger.js';
import type { MetricsRegistry } from '../../outbound/monitoring/metrics-registry.js';
import { SystemMonitor } from '../../outbound/monitoring/system-monitor.js';

const logger = createLogger('Health');

export interface HealthOptions {
  port: number;
  metricsRegistry: MetricsRegistry;
  systemMonitor?: SystemMonitor;
}

function startSystemMetricsCollection(systemMonitor: SystemMonitor, registry: MetricsRegistry): void {
  setInterval(() => {
    systemMonitor.measureEventLoopLag();
    const snap = systemMonitor.snapshot();
    registry.systemMemory.set({ type: 'rss' }, snap.rssMb * 1024 * 1024);
    registry.systemMemory.set({ type: 'heapUsed' }, snap.heapUsedMb * 1024 * 1024);
    registry.systemMemory.set({ type: 'heapTotal' }, snap.heapTotalMb * 1024 * 1024);
    registry.systemCpu.set(snap.cpuPercent);
    registry.eventLoopLag.set(snap.eventLoopLagMs / 1000);
  }, 10000);
}

export function startHealthServer(opts: HealthOptions): void {
  const app = express();

  if (opts.systemMonitor) {
    startSystemMetricsCollection(opts.systemMonitor, opts.metricsRegistry);
  }

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
      logger.error('Failed to serve metrics', { error: err instanceof Error ? err.message : String(err) });
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
      logger.error('Failed to serve /health/observability', { error: err instanceof Error ? err.message : String(err) });
      res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  app.listen(opts.port, () => {
    logger.info('Server listening', { port: opts.port });
  });
}
