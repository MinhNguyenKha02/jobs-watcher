import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'http';
import { createTestStorage } from '../../helpers/create-test-storage.js';
import { MongoJobLifecycleAdapter } from '../../../src/infrastructure/outbound/persistence/mongo-job-lifecycle-adapter.js';
import { MongoInitializer } from '../../../src/infrastructure/outbound/persistence/mongo-init.js';
import { JobIngestor } from '../../../src/application/ingestor.js';
import { JobStage, JobSource } from '../../../src/domain/types/job-lifecycle.js';
import { MetricsRegistry } from '../../../src/infrastructure/outbound/monitoring/metrics-registry.js';
import { Registry } from 'prom-client';
import { startHealthServer } from '../../../src/infrastructure/inbound/health/health-adapter.js';
import { topcvEmailHtmlMany, topcvDetailHtml } from '../../helpers/html-fixtures.js';

function fetchText(port: number, path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port, path }, (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: raw }));
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

describe('PRC-009 — Metrics + health readiness on real flows', () => {
  let storage: Awaited<ReturnType<typeof createTestStorage>>;
  let adapter: MongoJobLifecycleAdapter;
  let registry: Registry;
  let metrics: MetricsRegistry;
  let ingestor: JobIngestor;
  let healthPort = 0;

  beforeAll(async () => {
    storage = await createTestStorage();
    const initializer = new MongoInitializer(storage.client, storage.dbName);
    await initializer.init();
    adapter = new MongoJobLifecycleAdapter(storage.client.db(storage.dbName));
    registry = new Registry();
    metrics = new MetricsRegistry(registry);
    healthPort = await freePort();
    startHealthServer({ port: healthPort, metricsRegistry: metrics, systemMonitor: {} as any });
    await new Promise((r) => setTimeout(r, 200));
  }, 120000);

  beforeEach(async () => {
    await storage.clearDb();
    ingestor = new JobIngestor(
      adapter,
      {
        emitGenerated: vi.fn(() => Promise.resolve()),
        emitCompleted: vi.fn(() => Promise.resolve()),
        emitFailed: vi.fn(() => Promise.resolve()),
      },
      {
        emitJobQueued: vi.fn(() => Promise.resolve()),
        emitJobTrashed: vi.fn(() => Promise.resolve()),
        emitRouteFailed: vi.fn(() => Promise.resolve()),
      },
      undefined as any,
      undefined as any,
      metrics
    );
  });

  afterAll(async () => {
    await storage.stop();
  });

  it('GIVEN PRC WHEN exercised THEN health endpoint is reachable (readiness probe)', async () => {
    const res = await fetchText(healthPort, '/health');
    expect(res.status).toBe(200);
  }, 15000);

  it('GIVEN PRC WHEN exercised THEN prometheus /metrics endpoint exposes jobs_brokered_total after an ingest', async () => {
    await ingestor.processIngest(
      JobSource.BROWSER_AUTO,
      JobStage.PARTIAL_PARSED,
      topcvEmailHtmlMany([{ role: 'Software Engineer', company: 'MetricCo1' }]),
      undefined,
      { messageId: 'metric-1' }
    );
    const res = await fetchText(healthPort, '/metrics');
    expect(res.status).toBe(200);
    expect(res.body).toContain('jobs_brokered_total');
  }, 15000);

  it('GIVEN PRC WHEN exercised THEN jobs_brokered_total increments per source (browser-auto)', async () => {
    await ingestor.processIngest(
      JobSource.BROWSER_AUTO,
      JobStage.PARTIAL_PARSED,
      topcvEmailHtmlMany([{ role: 'Backend Developer', company: 'MetricCo2' }]),
      undefined,
      { messageId: 'metric-2' }
    );
    const text = await registry.metrics();
    expect(text).toContain('jobs_brokered_total');
    const m = registry.getSingleMetric('jobs_brokered_total');
    const values = m ? await m.get() : null;
    const browserAuto = values?.values.find((v: any) => v.labels.source === 'browser-auto');
    expect(Number(browserAuto?.value ?? 0)).toBeGreaterThan(0);
  }, 15000);

  it('GIVEN PRC WHEN exercised THEN job_stage_total tracks s1 enriching after PARTIAL_PARSED ingest', async () => {
    await ingestor.processIngest(
      JobSource.BROWSER_AUTO,
      JobStage.PARTIAL_PARSED,
      topcvEmailHtmlMany([{ role: 'Data Engineer', company: 'MetricCo3' }]),
      undefined,
      { messageId: 'metric-3' }
    );
    const m = registry.getSingleMetric('job_stage_total');
    const values = m ? await m.get() : null;
    const s1 = values?.values.find((v: any) => v.labels.stage === 's1');
    expect(Number(s1?.value ?? 0)).toBeGreaterThan(0);
  }, 15000);

  it('GIVEN PRC WHEN exercised THEN job_stage_total tracks s2 enriched after FULL_PARSED merge', async () => {
    await ingestor.processIngest(
      JobSource.BROWSER_AUTO,
      JobStage.PARTIAL_PARSED,
      topcvEmailHtmlMany([{ role: 'Software Engineer', company: 'MetricCo4' }]),
      undefined,
      { messageId: 'metric-4' }
    );
    const id = 'metric-4-job-0';
    await ingestor.processIngest(
      JobSource.MANUAL,
      JobStage.FULL_PARSED,
      topcvDetailHtml('Software Engineer', 'MetricCo4'),
      id
    );
    const m = registry.getSingleMetric('job_stage_total');
    const values = m ? await m.get() : null;
    const s2 = values?.values.find((v: any) => v.labels.stage === 's2');
    expect(Number(s2?.value ?? 0)).toBeGreaterThan(0);
  }, 15000);

  it('GIVEN PRC WHEN exercised THEN job_stage_total tracks s3 queued after queue resolution', async () => {
    await ingestor.processIngest(
      JobSource.BROWSER_AUTO,
      JobStage.PARTIAL_PARSED,
      topcvEmailHtmlMany([{ role: 'Full Stack Developer', company: 'MetricCo5' }]),
      undefined,
      { messageId: 'metric-5' }
    );
    const id = 'metric-5-job-0';
    await ingestor.processIngest(
      JobSource.MANUAL,
      JobStage.FULL_PARSED,
      topcvDetailHtml('Full Stack Developer', 'MetricCo5'),
      id
    );
    await ingestor.processResolution(id, 'queue');
    const m = registry.getSingleMetric('job_stage_total');
    const values = m ? await m.get() : null;
    const s3 = values?.values.find((v: any) => v.labels.status === 'queued');
    expect(Number(s3?.value ?? 0)).toBeGreaterThan(0);
  }, 15000);

  it('GIVEN PRC WHEN exercised THEN job_errors_total increments on s2 parse failure', async () => {
    await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, '', 'metric-fail-1');
    const m = registry.getSingleMetric('job_errors_total');
    const values = m ? await m.get() : null;
    const s2 = values?.values.find((v: any) => v.labels.stage === 's2');
    expect(Number(s2?.value ?? 0)).toBeGreaterThan(0);
  }, 15000);

  it('GIVEN PRC WHEN exercised THEN jobs_in_flight gauge returns to zero after processed job (no leak)', async () => {
    await ingestor.processIngest(
      JobSource.BROWSER_AUTO,
      JobStage.PARTIAL_PARSED,
      topcvEmailHtmlMany([{ role: 'Web Developer', company: 'MetricCo6' }]),
      undefined,
      { messageId: 'metric-6' }
    );
    const m = registry.getSingleMetric('jobs_in_flight');
    const values = m ? await m.get() : null;
    const inFlight = values?.values.find((v: any) => v.labels.stage === 's1');
    expect(Number(inFlight?.value ?? 0)).toBe(0);
  }, 15000);

  it('GIVEN PRC WHEN registry.getSingleMetric THEN system_memory_bytes gauge registered', async () => {
    const m = registry.getSingleMetric('system_memory_bytes');
    expect(m).toBeDefined();
  });

  it('GIVEN PRC WHEN registry.getSingleMetric THEN event_loop_lag_seconds gauge registered', async () => {
    const m = registry.getSingleMetric('event_loop_lag_seconds');
    expect(m).toBeDefined();
  });

  it('GIVEN PRC WHEN exercised THEN metrics are cleared between registries (no duplicate metric error)', () => {
    const registry2 = new Registry();
    const m2 = new MetricsRegistry(registry2);
    expect(m2.register).toBeDefined();
  });

  it('GIVEN PRC WHEN exercised THEN s3 route_failed increments job_errors on missing job resolution', async () => {
    await ingestor.processResolution('missing-metric-job', 'queue');
    const m = registry.getSingleMetric('job_errors_total');
    const values = m ? await m.get() : null;
    const total = values?.values.reduce((s: number, v: any) => s + Number(v.value), 0) ?? 0;
    expect(total).toBeGreaterThan(0);
  }, 15000);
});
