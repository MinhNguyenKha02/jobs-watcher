import http from 'http';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { getDaemonMetrics, getTuiMetrics, sumMetric, findMetric } from '../../helpers/assert-metrics.js';
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
    // Per-suite cycle teardown: stops first, then self-deletes the 4
    // namespaced queues + timestamped test exchange (finally => no cleanup script).
    try {
      await tui.stop().catch(() => {});
      await daemon.stop().catch(() => {});
    } finally {
      await tui.reader.deleteQueues();
    }
  });

  it('GIVEN daemon container WHEN GET /health/observability THEN camelCase labeled map with containers.daemon.healthPort', async () => {
    const obs = await fetchJson(daemonPort, '/health/observability');
    expect(obs.metrics).toBeDefined();
    // camelCase keys, not snake_case
    expect(obs.metrics.jobsBrokeredTotal).toBeDefined();
    expect(obs.metrics.jobStageTotal).toBeDefined();
    expect(obs.metrics.systemMemoryBytes).toBeDefined();
    expect(obs.metrics.infraReady).toBeDefined();
    expect(obs.metrics.extractionQueueDepth).toBeDefined();
    // no snake keys
    expect(obs.metrics.jobs_brokered_total).toBeUndefined();
    expect(obs.metrics.infra_ready).toBeUndefined();
    // infraReady components present
    expect(findMetric(obs.metrics, 'infraReady', { component: 'mongo' })).toBeDefined();
    expect(obs.containers?.daemon?.healthPort).toBe(daemonPort);
    expect(obs.containers?.daemon?.ports).toEqual(expect.arrayContaining(['jobLifecycle']));
    // via helper cross-check via test container (no inline registry)
    const m = await getDaemonMetrics(daemon.metricsRegistry);
    expect(m.jobsBrokeredTotal).toBeDefined();
    expect(m.infraReady).toBeDefined();
    // hard-cut: rmqConnected not on daemon
    expect(obs.metrics.rmqConnected).toBeUndefined();
    expect(obs.metrics.rmqQueueMode).toBeUndefined();
  });

  it('GIVEN tui container WHEN GET /health/observability THEN rmq_pending_* camelCase and containers.tui.healthPort', async () => {
    const obs = await fetchJson(tuiPort, '/health/observability');
    expect(obs.metrics).toBeDefined();
    expect(obs.metrics.rmqPendingDepth).toBeDefined();
    expect(obs.metrics.rmqPendingPartial).toBeDefined();
    expect(obs.metrics.rmqDeferredCount).toBeDefined();
    expect(obs.metrics.infraReady).toBeDefined();
    expect(findMetric(obs.metrics, 'infraReady', { component: 'rmq' })).toBeDefined();
    expect(findMetric(obs.metrics, 'infraReady', { component: 'queue_mode' })).toBeDefined();
    // hard-cut legacy
    expect(obs.metrics.rmqConnected).toBeUndefined();
    expect(obs.metrics.rmqQueueMode).toBeUndefined();
    expect(obs.metrics.rmq_pending_depth).toBeUndefined();
    expect(obs.containers?.tui?.healthPort).toBe(tuiPort);
    expect(obs.containers?.tui?.rmq?.queues?.s1).toBe(`tui.${ns}.s1`);
    const mt = await getTuiMetrics(tui.metricsRegistry);
    expect(sumMetric(mt as unknown as Record<string, Array<{ labels: Record<string, string>; value: number }>>, 'rmqPendingDepth')).toBeGreaterThanOrEqual(0);
    // ensure daemon keys not on tui
    expect(obs.metrics.jobsBrokeredTotal).toBeUndefined();
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
    expect(txt).toContain('infra_ready');
    const txtTui = await new Promise<string>((resolve, reject) => {
      http
        .get({ host: '127.0.0.1', port: tuiPort, path: '/metrics' }, (res) => {
          let raw = '';
          res.on('data', (c) => (raw += c));
          res.on('end', () => resolve(raw));
        })
        .on('error', reject);
    });
    expect(txtTui).toContain('rmq_pending_depth');
    expect(txt).not.toContain('rmq_pending_depth');
  });
});
