import express, { type Request, type Response } from 'express';

import { createLogger } from '../../outbound/logging/logger.js';
import type { DaemonMetricsRegistry, TuiMetricsRegistry } from '../../outbound/monitoring/metrics-registry.js';
import { SystemMonitor } from '../../outbound/monitoring/system-monitor.js';

const logger = createLogger('Health');

export interface HealthOptions {
  port: number;
  metricsRegistry: DaemonMetricsRegistry | TuiMetricsRegistry;
  systemMonitor?: SystemMonitor;
  containers?: {
    daemon?: {
      nodeEnv: string;
      healthPort: number;
      rabbitmq: { exchange: string };
      uds: { socketPath: string };
      asset: { outputDir: string };
      ports: string[];
    };
    tui?: {
      ns: string;
      healthPort: number;
      rmq: { exchange: string; queues: { s1: string; s2: string; s2direct: string; s34: string } };
      uds: { socketPath: string };
    };
  };
}

function toCamel(s: string): string {
  return s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

function startSystemMetricsCollection(
  systemMonitor: SystemMonitor,
  registry: DaemonMetricsRegistry
): void {
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

export function startHealthServer(opts: HealthOptions): import('http').Server {
  const app = express();

  if (opts.systemMonitor) {
    // only daemon registry has systemMemory
    const r = opts.metricsRegistry as DaemonMetricsRegistry;
    if ('systemMemory' in r) {
      startSystemMetricsCollection(opts.systemMonitor, r);
    }
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
      logger.error('Failed to serve metrics', {
        error: err instanceof Error ? err.message : String(err),
      });
      res.status(500).send('Internal Server Error');
    }
  });

  app.get('/health/observability', async (_req: Request, res: Response) => {
    try {
      const json = (await opts.metricsRegistry.register.getMetricsAsJSON()) as Array<{
        name: string;
        values: Array<{ labels: Record<string, string>; value: number }>;
      }>;
      const metrics: Record<string, Array<{ labels: Record<string, string>; value: number }>> = {};
      for (const m of json) {
        const camelName = toCamel(m.name);
        const mapped = m.values
          .filter((v) => typeof v.value === 'number' && !Number.isNaN(v.value))
          .map((v) => {
            const labels: Record<string, string> = {};
            for (const [k, val] of Object.entries(v.labels || {})) {
              labels[toCamel(k)] = String(val);
            }
            return { labels, value: Number(v.value) };
          });
        metrics[camelName] = mapped;
      }
      res.json({ metrics, containers: opts.containers ?? null, health: { status: 'ok' } });
    } catch (err) {
      logger.error('Failed to serve /health/observability', {
        error: err instanceof Error ? err.message : String(err),
      });
      res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  const server = app.listen(opts.port, () => {
    logger.info('Server listening', { port: opts.port });
  });
  return server as unknown as ReturnType<typeof import('http').createServer>;
}
