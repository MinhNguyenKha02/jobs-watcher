import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import amqplib, { type Channel, type Connection } from 'amqplib';
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
import { topcvDetailHtml, nonJobHtml } from '../helpers/html-fixtures.js';
import { UdsAdapter } from '../../src/infrastructure/inbound/uds/uds-adapter.js';
import { setupConsumer, udsHelpers } from '../helpers/e2e-harness.js';

const RMQ_URL = process.env.RABBITMQ_URL || 'amqp://localhost';
const EXCHANGE = process.env.RABBITMQ_EXCHANGE || 'jobs.events.e2e.c3';
const INTERNAL_TOKEN = 'c3-e2e-token';

describe('C3 error e2e — s2 failure → s4 → next s1/s2 recovers (full system, real deps)', () => {
  const messageId = 'c3-error-recovery';

  let storage: Awaited<ReturnType<typeof createTestStorage>>;
  let rmqConn: Connection;
  let conCh: Channel;
  let rmqConnection: RabbitMqConnection;
  let ingestor: JobIngestor;
  let adapter: MongoJobLifecycleAdapter;
  let udsAdapter: UdsAdapter;
  let uds: ReturnType<typeof udsHelpers>;

  beforeAll(async () => {
    storage = await createTestStorage();
    const initializer = new MongoInitializer(storage.client, storage.dbName);
    await initializer.init();
    adapter = new MongoJobLifecycleAdapter(storage.client.db(storage.dbName));

    rmqConn = await amqplib.connect(RMQ_URL);
    conCh = await rmqConn.createChannel();
    await conCh.assertExchange(EXCHANGE, 'topic', { durable: true });

    rmqConnection = new RabbitMqConnection({ url: RMQ_URL, exchange: EXCHANGE });
    await rmqConnection.connect();

    const metrics = new MetricsRegistry(new Registry());
    const extractionQueueAdapter = new (await import('../../src/infrastructure/outbound/persistence/mongo-extraction-queue-adapter.js')).MongoExtractionQueueAdapter(metrics, storage.client.db(storage.dbName));

    ingestor = new JobIngestor(
      adapter,
      new RabbitMqParseAdapter(rmqConnection),
      new RabbitMqRoutingAdapter(rmqConnection),
      extractionQueueAdapter,
      new (await import('../../src/infrastructure/outbound/asset-builder/asset-producing-adapter.js')).AssetProducingAdapter() as any,
      metrics,
    );

    const socketPath = path.join(os.tmpdir(), 'c3-e2e-uds.sock');
    uds = udsHelpers(socketPath, INTERNAL_TOKEN);
    udsAdapter = new UdsAdapter(ingestor, { socketPath, token: INTERNAL_TOKEN });
    await udsAdapter.start();
  }, 120000);

  afterAll(async () => {
    try { if (udsAdapter) await udsAdapter.stop(); } catch {}
    try { await rmqConnection.disconnect(); } catch {}
    try { await conCh.close(); } catch {}
    try { await rmqConn.close(); } catch {}
    await storage.stop();
  });

  it('s2 parse failure → s4, then next valid clipboard → s2 completes (recovery)', async () => {
    // s2 failure: an unparseable (but non-empty) payload on a real UDS ingest
    // → PARSE_FAILED (s4) over real RMQ; the system does not crash.
    const fail = await setupConsumer(conCh, EXCHANGE, [ActionEvent.PARSE_FAILED]);
    const failRes = await uds.ingest(nonJobHtml(), messageId);
    expect(failRes.statusCode).toBe(200);

    const failMsg = await fail.consume;
    expect(failMsg.jobLifecycleId).toBe(messageId);

    // recovery: next valid clipboard → PARSE_COMPLETED + ENRICHED + clip-* doc (s4→s2 auto-advance).
    const comp = await setupConsumer(conCh, EXCHANGE, [ActionEvent.PARSE_COMPLETED]);
    const okRes = await uds.ingest(topcvDetailHtml('Software Engineer', 'C3RecoveryCo'));
    expect(okRes.statusCode).toBe(200);

    const compMsg = await comp.consume;
    expect(compMsg.job).toBeDefined();
    expect(compMsg.job._id).toMatch(/^clip-/);
    expect(compMsg.job.company).toBe('C3RecoveryCo');
    expect(compMsg.job.stage).toBe(JobStage.FULL_PARSED);
    expect(compMsg.job.status).toBe(JobStatus.ENRICHED);

    const okDoc = await adapter.findById(compMsg.job._id);
    expect(okDoc).not.toBeNull();
    expect(okDoc!.company).toBe('C3RecoveryCo');
  }, 60000);
});