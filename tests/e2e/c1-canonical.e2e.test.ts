import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import amqplib, { type Channel, type Connection } from 'amqplib';
import { WebhookAdapter } from '../../src/infrastructure/inbound/web/webhook-adapter.js';
import { MongoJobLifecycleAdapter } from '../../src/infrastructure/outbound/persistence/mongo-job-lifecycle-adapter.js';
import { MongoInitializer } from '../../src/infrastructure/outbound/persistence/mongo-init.js';
import { RabbitMqConnection } from '../../src/infrastructure/outbound/rabbitmq/rabbitmq-connection.js';
import { RabbitMqParseAdapter } from '../../src/infrastructure/outbound/rabbitmq/rabbitmq-parse-adapter.js';
import { RabbitMqRoutingAdapter } from '../../src/infrastructure/outbound/rabbitmq/rabbitmq-route-adapter.js';
import { MetricsRegistry } from '../../src/infrastructure/outbound/monitoring/metrics-registry.js';
import { Registry } from 'prom-client';
import { JobIngestor } from '../../src/application/ingestor.js';
import { JobStage, JobStatus } from '../../src/domain/types/job-lifecycle.js';
import { ActionEvent } from '../../src/domain/types/action-event.js';
import { createTestStorage } from '../helpers/create-test-storage.js';
import { topcvEmailHtmlMany, topcvDetailHtml } from '../helpers/html-fixtures.js';
import { UdsAdapter } from '../../src/infrastructure/inbound/uds/uds-adapter.js';
import { setupConsumer, udsHelpers, postJson, TempDirAssetAdapter, waitForAsset } from '../helpers/e2e-harness.js';

const RMQ_URL = process.env.RABBITMQ_URL || 'amqp://localhost';
const EXCHANGE = process.env.RABBITMQ_EXCHANGE || 'jobs.events.e2e.c1';
const INTERNAL_TOKEN = 'c1-e2e-token';

describe('C1 canonical e2e — webhook msg → s1 → [o]/[p]/[c] → fully job → [j] → asset pdf (full system, real deps)', () => {
  const webhookPort = 18240;
  const webhookPath = '/webhook';
  const messageId = 'c1-canonical-msg';
  const jobLifecycleId = `${messageId}-job-0`;

  let storage: Awaited<ReturnType<typeof createTestStorage>>;
  let rmqConn: Connection;
  let conCh: Channel;
  let rmqConnection: RabbitMqConnection;
  let ingestor: JobIngestor;
  let adapter: MongoJobLifecycleAdapter;
  let webhook: WebhookAdapter;
  let assetAdapter: TempDirAssetAdapter;
  let udsAdapter: UdsAdapter;
  let uds: ReturnType<typeof udsHelpers>;
  let tempDir: string;

  const gmail = {
    getMessage: vi.fn(async () => ({})),
    extractHeader: vi.fn((_m: unknown, name: string) => ({ Subject: 'Job Alert', From: 'jobs@topcv.vn', To: 'me@dev.vn', 'Message-ID': `thr-${messageId}` })[name] || ''),
    extractBody: vi.fn(() => topcvEmailHtmlMany([{ role: 'Software Engineer', company: 'C1CanonicalCo' }])),
    getMessagesSinceHistory: vi.fn(async () => [messageId]),
  };

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'c1-e2e-assets-'));

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
    const extractionQueueAdapter = new (await import('../../src/infrastructure/outbound/persistence/mongo-extraction-queue-adapter.js')).MongoExtractionQueueAdapter(metrics, storage.client.db(storage.dbName));

    ingestor = new JobIngestor(
      adapter,
      new RabbitMqParseAdapter(rmqConnection),
      new RabbitMqRoutingAdapter(rmqConnection),
      extractionQueueAdapter,
      assetAdapter as any,
      metrics,
    );

    webhook = new WebhookAdapter(ingestor, gmail as any);
    await new Promise<void>((resolve) => {
      webhook.start(webhookPort, webhookPath);
      setTimeout(resolve, 250);
    });

    const socketPath = path.join(os.tmpdir(), 'c1-e2e-uds.sock');
    uds = udsHelpers(socketPath, INTERNAL_TOKEN);
    udsAdapter = new UdsAdapter(ingestor, { socketPath, token: INTERNAL_TOKEN });
    await udsAdapter.start();
  }, 120000);

  afterAll(async () => {
    try { if (udsAdapter) await udsAdapter.stop(); } catch {}
    try { if (webhook) await webhook.stop(); } catch {}
    try { await rmqConnection.disconnect(); } catch {}
    try { await conCh.close(); } catch {}
    try { await rmqConn.close(); } catch {}
    await storage.stop();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('full canonical cycle: webhook s1 → s2 full parse → [j] queue → real asset pdf', async () => {
    // s1: real HTTP webhook push → ingestor → GENERATED event + stored doc.
    const gen = await setupConsumer(conCh, EXCHANGE, [ActionEvent.GENERATED]);
    const res = await postJson(webhookPort, webhookPath, { messageId });
    expect(res.status).toBe(202);

    const genMsg = await gen.consume;
    expect(genMsg._id).toBe(jobLifecycleId);
    expect(genMsg.role).toBe('Software Engineer');
    expect(genMsg.company).toBe('C1CanonicalCo');
    expect(genMsg.stage).toBe(JobStage.PARTIAL_PARSED);

    const s1Doc = await adapter.findById(jobLifecycleId);
    expect(s1Doc).not.toBeNull();
    expect(s1Doc!.status).toBe(JobStatus.ENRICHING);

    // [o]/[p]/[c]: stage-2 full parse of the job detail → PARSE_COMPLETED + ENRICHED,
    // injected through the real UdsAdapter (`POST /internal/ingest?webhook=true`).
    const comp = await setupConsumer(conCh, EXCHANGE, [ActionEvent.PARSE_COMPLETED]);
    const cRes = await uds.ingest(topcvDetailHtml('Software Engineer', 'C1CanonicalCo'), jobLifecycleId);
    expect(cRes.statusCode).toBe(200);

    const compMsg = await comp.consume;
    expect(compMsg.job).toBeDefined();
    expect(compMsg.job._id).toBe(jobLifecycleId);
    expect(compMsg.job.stage).toBe(JobStage.FULL_PARSED);
    expect(compMsg.job.status).toBe(JobStatus.ENRICHED);

    // [j]: operator queues the fully-parsed job → QUEUED event + real asset pdf,
    // injected through the real UdsAdapter (`POST /internal/action`).
    const queue = await setupConsumer(conCh, EXCHANGE, [ActionEvent.QUEUED, ActionEvent.TRASHED, ActionEvent.ROUTE_FAILED]);
    const jRes = await uds.action(jobLifecycleId, 'queue');
    expect(jRes.statusCode).toBe(200);

    const queueMsg = await queue.consume;
    expect(queueMsg.jobLifecycleId).toBe(jobLifecycleId);

    await waitForAsset(assetAdapter);
    expect(assetAdapter.pdfPath).not.toBeNull();
    expect(fs.existsSync(assetAdapter.pdfPath!)).toBe(true);
    const size = fs.statSync(assetAdapter.pdfPath!).size;
    expect(size).toBeGreaterThan(0);

    const finalDoc = await adapter.findById(jobLifecycleId);
    expect(finalDoc).not.toBeNull();
    expect(finalDoc!.stage).toBe(JobStage.FULL_PARSED);
    expect(finalDoc!.status).toBe(JobStatus.QUEUED);
  }, 60000);
});
