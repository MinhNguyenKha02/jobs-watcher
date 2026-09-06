import http from 'http';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { DaemonMetricsRegistry } from '../../../src/infrastructure/outbound/monitoring/metrics-registry.js';
import { getDaemonMetrics, getTuiMetrics, sumMetric } from '../../helpers/assert-metrics.js';
import { buildTestDaemonContainer, buildTestTuiContainer } from '../../helpers/test-container.js';

function fetchJson(port: number, path: string): Promise<any> {
  return new Promise((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port, path }, (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(raw));
          } catch (e) {
            reject(e);
          }
        });
      })
      .on('error', reject);
  });
}

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const srv = http.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const a = srv.address() as any;
      const p = a.port;
      srv.close(() => resolve(p));
    });
  });
}

describe('Health monitor contract — daemon+TUI 2 prom, camelCase labeled, containers healthPort', () => {
  const ns = `health-monitor-${Date.now()}`;
  let daemon: Awaited<ReturnType<typeof buildTestDaemonContainer>>;
  let tui: Awaited<ReturnType<typeof buildTestTuiContainer>>;
  let daemonPort = 0;
  let tuiPort = 0;

  beforeAll(async () => {
    daemonPort = await freePort();
    tuiPort = await freePort();
    daemon = await buildTestDaemonContainer({ ns, health: { port: daemonPort } });
    tui = await buildTestTuiContainer({ ns, health: { port: tuiPort } });
    await daemon.start();
    await tui.start();
    // tick to ensure health servers listening
    await new Promise((r) => setTimeout(r, 300));
  }, 30000);

  afterAll(async () => {
    await tui.stop().catch(() => {});
    await daemon.stop().catch(() => {});
  });

  it('GIVEN daemon container WHEN GET /health/observability THEN camelCase labeled map with containers.daemon.healthPort', async () => {
    const obs = await fetchJson(daemonPort, '/health/observability');
    expect(obs.metrics).toBeDefined();
    // camelCase keys, not snake_case
    expect(obs.metrics.jobsBrokeredTotal).toBeDefined();
    expect(obs.metrics.jobStageTotal).toBeDefined();
    expect(obs.metrics.systemMemoryBytes).toBeDefined();
    // no snake keys
    expect(obs.metrics.jobs_brokered_total).toBeUndefined();
    expect(obs.containers?.daemon?.healthPort).toBe(daemonPort);
    expect(obs.containers?.daemon?.ports).toEqual(expect.arrayContaining(['jobLifecycle']));
    // via helper cross-check
    const m = await getDaemonMetrics(daemon.metricsRegistry as DaemonMetricsRegistry);
    expect(m.jobsBrokeredTotal).toBeDefined();
  });

  it('GIVEN tui container WHEN GET /health/observability THEN rmq_pending_* camelCase and containers.tui.healthPort', async () => {
    const obs = await fetchJson(tuiPort, '/health/observability');
    expect(obs.metrics).toBeDefined();
    expect(obs.metrics.rmqPendingDepth).toBeDefined();
    expect(obs.metrics.rmqPendingPartial).toBeDefined();
    expect(obs.metrics.rmqDeferredCount).toBeDefined();
    expect(obs.metrics.rmqConnected).toBeDefined();
    expect(obs.metrics.rmqQueueMode).toBeDefined();
    expect(obs.metrics.rmq_pending_depth).toBeUndefined();
    expect(obs.containers?.tui?.healthPort).toBe(tuiPort);
    expect(obs.containers?.tui?.rmq?.queues?.s1).toBe(`tui.${ns}.s1`);
    const mt = await getTuiMetrics(tui.metricsRegistry);
    expect(sumMetric(mt as any, 'rmqPendingDepth')).toBeGreaterThanOrEqual(0);
  });

  it('GIVEN daemon+ tui WHEN health ports distinct THEN 2 prom separate', async () => {
    expect(daemonPort).not.toBe(tuiPort);
    const txt = await new Promise<string>((resolve, reject) => {
      http
        .get({ host: '127.0.0.1', port: daemonPort, path: '/metrics' }, (res) => {
          let raw = '';
          res.on('data', (c) => (raw += c));
          res.on('end', () => resolve(raw));
        })
        .on('error', reject);
    });
    expect(txt).toContain('jobs_brokered_total');
  });
});
