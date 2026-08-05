import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import amqplib, { type Channel, type Connection } from 'amqplib';
import { chromium } from 'playwright-extra';
import { MongoJobLifecycleAdapter } from '../../src/infrastructure/outbound/persistence/mongo-job-lifecycle-adapter.js';
import { MongoInitializer } from '../../src/infrastructure/outbound/persistence/mongo-init.js';
import { MongoExtractionQueueAdapter } from '../../src/infrastructure/outbound/persistence/mongo-extraction-queue-adapter.js';
import { RabbitMqConnection } from '../../src/infrastructure/outbound/rabbitmq/rabbitmq-connection.js';
import { RabbitMqParseAdapter } from '../../src/infrastructure/outbound/rabbitmq/rabbitmq-parse-adapter.js';
import { RabbitMqRoutingAdapter } from '../../src/infrastructure/outbound/rabbitmq/rabbitmq-route-adapter.js';
import { ExtractionScheduler } from '../../src/application/extraction-scheduler.js';
import { PlaywrightBrowserAdapter } from '../../src/infrastructure/outbound/browser/browser-adapter.js';
import { MetricsRegistry } from '../../src/infrastructure/outbound/monitoring/metrics-registry.js';
import { Registry } from 'prom-client';
import { JobIngestor } from '../../src/application/ingestor.js';
import { JobStage, JobStatus, JobSource } from '../../src/domain/types/job-lifecycle.js';
import { ActionEvent } from '../../src/domain/types/action-event.js';
import { createTestStorage } from '../helpers/create-test-storage.js';
import { setupConsumer, TempDirAssetAdapter, waitForAsset } from '../helpers/e2e-harness.js';

const RMQ_URL = process.env.RABBITMQ_URL || 'amqp://localhost';
const EXCHANGE = process.env.RABBITMQ_EXCHANGE || 'jobs.events.e2e.c2';

function topcvDetailHtml(role: string, company: string): string {
  return `<html><body>
<div id="jobsearch-ViewjobHeader">
  <h1 data-testid="jobsearch-JobInfoHeader-title"><span>${role}</span></h1>
  <div class="company-header">
    <div data-testid="inlineHeader-companyName">${company}</div>
    <div data-testid="inlineHeader-companyLocation">Ho Chi Minh City</div>
  </div>
  <div id="salaryInfoAndJobType">
    <span>$1000 - $1500 a month</span>
  </div>
</div>
<div id="jobDescriptionText" class="job-description-section">
  <p>We are looking for a Backend Developer with TypeScript experience to join our team. You will build and maintain backend services using Node.js and TypeScript.</p>
  <h2>Requirements</h2>
  <ul>
    <li>TypeScript and Node.js proficiency</li>
    <li>Experience with databases</li>
  </ul>
</div>
</body></html>`;
}

const hasPlaywright = (() => {
  try {
    return fs.existsSync(chromium.executablePath());
  } catch {
    return false;
  }
})();

function startDetailServer(): Promise<{ server: http.Server; urlFor: (role: string, company: string) => string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const parsed = new URL(req.url || '/', 'http://127.0.0.1');
      const role = parsed.searchParams.get('role') || 'Backend Developer';
      const company = parsed.searchParams.get('company') || 'C2AutoCo';
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(topcvDetailHtml(role, company));
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as any;
      resolve({
        server,
        urlFor: (role, company) => `http://127.0.0.1:${addr.port}/viewjob?jk=c2-auto&role=${encodeURIComponent(role)}&company=${encodeURIComponent(company)}`,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

function seedPartialJob(adapter: MongoJobLifecycleAdapter, id: string, url: string, role: string, company: string): Promise<void> {
  return adapter.upsert({
    _id: id,
    raw: '<html><body>partial</body></html>',
    stage: JobStage.PARTIAL_PARSED,
    status: JobStatus.ENRICHING,
    source: JobSource.BROWSER_AUTO,
    company,
    role,
    description: 'TypeScript backend developer needed for our growing engineering team',
    url,
    createdAt: new Date(),
    updatedAt: new Date(),
    stageTimestamp: new Date(),
  } as any);
}

describe.skipIf(!hasPlaywright)('C2 browser-auto e2e — seed s1 → real scheduler + Playwright → s2c full parse → [j] queue + PDF / [d] trash → next pick', () => {
  let storage: Awaited<ReturnType<typeof createTestStorage>>;
  let rmqConn: Connection;
  let conCh: Channel;
  let rmqConnection: RabbitMqConnection;
  let ingestor: JobIngestor;
  let adapter: MongoJobLifecycleAdapter;
  let eqAdapter: MongoExtractionQueueAdapter;
  let scheduler: ExtractionScheduler;
  let assetAdapter: TempDirAssetAdapter;
  let detailServer: Awaited<ReturnType<typeof startDetailServer>>;
  let tempDir: string;

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'c2-e2e-assets-'));
    detailServer = await startDetailServer();

    storage = await createTestStorage();
    const initializer = new MongoInitializer(storage.client, storage.dbName);
    await initializer.init();
    adapter = new MongoJobLifecycleAdapter(storage.client.db(storage.dbName));

    rmqConn = await amqplib.connect(RMQ_URL);
    const pubCh = await rmqConn.createChannel();
    conCh = await rmqConn.createChannel();
    await pubCh.assertExchange(EXCHANGE, 'topic', { durable: true });

    rmqConnection = new RabbitMqConnection({ url: RMQ_URL, exchange: EXCHANGE });
    await rmqConnection.connect();

    assetAdapter = new TempDirAssetAdapter(tempDir);
    const metrics = new MetricsRegistry(new Registry());
    eqAdapter = new MongoExtractionQueueAdapter(metrics, storage.client.db(storage.dbName));

    ingestor = new JobIngestor(
      adapter,
      new RabbitMqParseAdapter(rmqConnection),
      new RabbitMqRoutingAdapter(rmqConnection),
      eqAdapter,
      assetAdapter as any,
      metrics,
    );

    scheduler = new ExtractionScheduler(
      eqAdapter,
      new PlaywrightBrowserAdapter({ headless: true, timeout: 5000 }),
      adapter as any,
      ingestor,
      metrics,
    );
    await scheduler.start();
  }, 120000);

  afterAll(async () => {
    try { await scheduler.stop(); } catch {}
    try { await rmqConnection.disconnect(); } catch {}
    try { await conCh.close(); } catch {}
    try { await rmqConn.close(); } catch {}
    try { await detailServer.close(); } catch {}
    await storage.stop();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await storage.client.db(storage.dbName).dropDatabase();
    await new MongoInitializer(storage.client, storage.dbName).init();
    assetAdapter.pdfPath = null;
  }, 30000);

  it('full browser-auto cycle: seed s1 → scheduler+Playwright extract → s2c → [j] queue → real asset pdf → next pick', async () => {
    const jobId = 'c2-auto-job-0';
    await seedPartialJob(adapter, jobId, detailServer.urlFor('Backend Developer', 'C2AutoCo'), 'Backend Developer', 'C2AutoCo');

    const gen = await setupConsumer(conCh, EXCHANGE, [ActionEvent.GENERATED]);
    const comp = await setupConsumer(conCh, EXCHANGE, [ActionEvent.PARSE_COMPLETED]);

    await eqAdapter.enqueue(jobId);

    const genMsg = await gen.consume;
    expect(genMsg._id).toBe(jobId);
    expect(genMsg.role).toBe('Backend Developer');
    expect(genMsg.company).toBe('C2AutoCo');

    const compMsg = await comp.consume;
    expect(compMsg.job).toBeDefined();
    expect(compMsg.job._id).toBe(jobId);
    expect(compMsg.job.stage).toBe(JobStage.FULL_PARSED);
    expect(compMsg.job.status).toBe(JobStatus.ENRICHED);
    expect(compMsg.job.company).toBe('C2AutoCo');
    expect(compMsg.job.role).toBe('Backend Developer');

    const s2Doc = await adapter.findById(jobId);
    expect(s2Doc).not.toBeNull();
    expect(s2Doc!.stage).toBe(JobStage.FULL_PARSED);
    expect(s2Doc!.status).toBe(JobStatus.ENRICHED);

    // [j]: operator queues the fully-parsed job → QUEUED event + real asset pdf.
    const queue = await setupConsumer(conCh, EXCHANGE, [ActionEvent.QUEUED, ActionEvent.TRASHED, ActionEvent.ROUTE_FAILED]);
    await ingestor.processResolution(jobId, 'queue');

    const queueMsg = await queue.consume;
    expect(queueMsg.jobLifecycleId).toBe(jobId);

    await waitForAsset(assetAdapter);
    expect(assetAdapter.pdfPath).not.toBeNull();
    expect(fs.existsSync(assetAdapter.pdfPath!)).toBe(true);
    expect(fs.statSync(assetAdapter.pdfPath!).size).toBeGreaterThan(0);

    const finalDoc = await adapter.findById(jobId);
    expect(finalDoc).not.toBeNull();
    expect(finalDoc!.status).toBe(JobStatus.QUEUED);

    // Next pick: a second seeded job still completes after the first was routed.
    const jobId2 = 'c2-auto-job-1';
    await seedPartialJob(adapter, jobId2, detailServer.urlFor('Data Engineer', 'C2DataCo'), 'Data Engineer', 'C2DataCo');
    const comp2 = await setupConsumer(conCh, EXCHANGE, [ActionEvent.PARSE_COMPLETED]);
    await eqAdapter.enqueue(jobId2);

    const comp2Msg = await comp2.consume;
    expect(comp2Msg.job).toBeDefined();
    expect(comp2Msg.job._id).toBe(jobId2);
    expect(comp2Msg.job.status).toBe(JobStatus.ENRICHED);
  }, 60000);

  it('[d] trash variant: seed s1 → scheduler+Playwright → s2c → [d] trash → next cycle continues', async () => {
    const jobId = 'c2-auto-trash-0';
    await seedPartialJob(adapter, jobId, detailServer.urlFor('Backend Developer', 'C2TrashCo'), 'Backend Developer', 'C2TrashCo');

    const comp = await setupConsumer(conCh, EXCHANGE, [ActionEvent.PARSE_COMPLETED]);
    await eqAdapter.enqueue(jobId);

    const compMsg = await comp.consume;
    expect(compMsg.job).toBeDefined();
    expect(compMsg.job._id).toBe(jobId);
    expect(compMsg.job.status).toBe(JobStatus.ENRICHED);

    // [d]: trash the fully-parsed job → TRASHED event + TRASHED doc.
    const trash = await setupConsumer(conCh, EXCHANGE, [ActionEvent.TRASHED, ActionEvent.ROUTE_FAILED, ActionEvent.PARSE_FAILED]);
    await ingestor.processResolution(jobId, 'trash');

    const trashMsg = await trash.consume;
    expect(trashMsg.jobLifecycleId).toBe(jobId);
    expect(trashMsg.reason).toBe('operator:trash');

    const trashed = await adapter.findById(jobId);
    expect(trashed).not.toBeNull();
    expect(trashed!.status).toBe(JobStatus.TRASHED);

    // Next cycle: a second job still completes after the trash.
    const jobId2 = 'c2-auto-trash-1';
    await seedPartialJob(adapter, jobId2, detailServer.urlFor('Data Engineer', 'C2DataTrashCo'), 'Data Engineer', 'C2DataTrashCo');
    const comp2 = await setupConsumer(conCh, EXCHANGE, [ActionEvent.PARSE_COMPLETED]);
    await eqAdapter.enqueue(jobId2);

    const comp2Msg = await comp2.consume;
    expect(comp2Msg.job).toBeDefined();
    expect(comp2Msg.job._id).toBe(jobId2);
    expect(comp2Msg.job.status).toBe(JobStatus.ENRICHED);
  }, 60000);
});
