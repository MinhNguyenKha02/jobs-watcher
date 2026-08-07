import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import amqplib, { type Channel, type Connection } from 'amqplib';
import { MongoJobLifecycleAdapter } from '../../../../src/infrastructure/outbound/persistence/mongo-job-lifecycle-adapter.js';
import { RabbitMqConnection } from '../../../../src/infrastructure/outbound/rabbitmq/rabbitmq-connection.js';
import { RabbitMqParseAdapter } from '../../../../src/infrastructure/outbound/rabbitmq/rabbitmq-parse-adapter.js';
import { RabbitMqRoutingAdapter } from '../../../../src/infrastructure/outbound/rabbitmq/rabbitmq-route-adapter.js';
import { MetricsRegistry } from '../../../../src/infrastructure/outbound/monitoring/metrics-registry.js';
import { Registry } from 'prom-client';
import { JobIngestor } from '../../../../src/application/ingestor.js';
import { JobStage, JobStatus, JobSource } from '../../../../src/domain/types/job-lifecycle.js';
import { ActionEvent } from '../../../../src/domain/types/action-event.js';
import { createTestStorage } from '../../../helpers/create-test-storage.js';
import { topcvEmailHtmlMany, topcvDetailHtml } from '../../../helpers/html-fixtures.js';
import type { ExtractionQueuePort } from '../../../../src/application/ports/extraction-queue.port.js';
import type { AssetProducingPort } from '../../../../src/application/ports/asset-producing.port.js';

const RMQ_URL = process.env.RABBITMQ_URL || 'amqp://localhost';
const EXCHANGE = process.env.RABBITMQ_EXCHANGE || 'jobs.events';
const TEST_PREFIX = `rmq-ingestor-${Date.now()}`;

const S1_QUEUE = `${TEST_PREFIX}.s1`;
const S2_QUEUE = `${TEST_PREFIX}.s2`;
const S3S4_QUEUE = `${TEST_PREFIX}.s3s4`;

async function setupTopology(ch: Channel): Promise<void> {
  await ch.assertExchange(EXCHANGE, 'topic', { durable: true });
  await ch.assertQueue(S1_QUEUE, { durable: true });
  await ch.assertQueue(S2_QUEUE, { durable: true });
  await ch.assertQueue(S3S4_QUEUE, { durable: true });
  await ch.bindQueue(S1_QUEUE, EXCHANGE, ActionEvent.GENERATED);
  await ch.bindQueue(S2_QUEUE, EXCHANGE, ActionEvent.PARSE_COMPLETED);
  await ch.bindQueue(S3S4_QUEUE, EXCHANGE, ActionEvent.QUEUED);
  await ch.bindQueue(S3S4_QUEUE, EXCHANGE, ActionEvent.TRASHED);
  await ch.bindQueue(S3S4_QUEUE, EXCHANGE, ActionEvent.ROUTE_FAILED);
  await ch.bindQueue(S3S4_QUEUE, EXCHANGE, ActionEvent.PARSE_FAILED);
}

async function purgeQueues(ch: Channel): Promise<void> {
  try {
    await ch.purgeQueue(S1_QUEUE);
    await ch.purgeQueue(S2_QUEUE);
    await ch.purgeQueue(S3S4_QUEUE);
  } catch { /* ignore */ }
}

function consumeOne(ch: Channel, queue: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timeout waiting for message on ${queue}`)), 8000);
    ch.consume(queue, (msg) => {
      if (msg) {
        clearTimeout(timeout);
        ch.ack(msg);
        resolve(JSON.parse(msg.content.toString()));
      }
    }, { noAck: false });
  });
}

describe('RMQ + Ingestor wiring', { timeout: 30000 }, () => {
  let rmqConn: Connection;
  let pubCh: Channel;
  let conCh: Channel;
  let storage: Awaited<ReturnType<typeof createTestStorage>>;
  let mongoAdapter: MongoJobLifecycleAdapter;
  let rmqConnection: RabbitMqConnection;
  let ingestor: JobIngestor;

  beforeAll(async () => {
    rmqConn = await amqplib.connect(RMQ_URL);
    pubCh = await rmqConn.createChannel();
    conCh = await rmqConn.createChannel();
    await setupTopology(pubCh);

    storage = await createTestStorage();
    mongoAdapter = new MongoJobLifecycleAdapter(storage.client.db(storage.dbName));

    rmqConnection = new RabbitMqConnection({ url: RMQ_URL, exchange: EXCHANGE });
    await rmqConnection.connect();

    const parsePort = new RabbitMqParseAdapter(rmqConnection);
    const routePort = new RabbitMqRoutingAdapter(rmqConnection);
    const extractionQueue: ExtractionQueuePort = {
      enqueue: vi.fn(),
      dequeue: vi.fn(),
      size: vi.fn(),
      onEnqueue: vi.fn(),
    };
    const assetProducing: AssetProducingPort = { toAsset: vi.fn() };
    const metrics = new MetricsRegistry(new Registry());

    ingestor = new JobIngestor(
      mongoAdapter,
      parsePort,
      routePort,
      extractionQueue,
      assetProducing,
      metrics,
    );
  });

  afterAll(async () => {
    await purgeQueues(pubCh);
    await rmqConnection.disconnect();
    await pubCh.close();
    await conCh.close();
    await rmqConn.close();
    await storage.stop();
  });

  beforeEach(async () => {
    await storage.client.db(storage.dbName).dropDatabase();
    await conCh.close();
    conCh = await rmqConn.createChannel();
    await purgeQueues(pubCh);
  });

  it('S1 signal: PARTIAL_PARSED publish emits GENERATED event on RMQ', async () => {
    const html = topcvEmailHtmlMany([{ role: 'Software Engineer', company: 'S1 Co' }]);
    const msgPromise = consumeOne(conCh, S1_QUEUE);

    await ingestor.processIngest(JobSource.BROWSER_AUTO, JobStage.PARTIAL_PARSED, html, undefined, {
      messageId: 's1-test-msg',
    });

    const msg = await msgPromise;
    expect(msg).toBeDefined();
    expect(msg._id).toMatch(/^s1-test-msg-job-/);
    expect(msg.role).toBe('Software Engineer');
    expect(msg.company).toBe('S1 Co');
    expect(msg.stage).toBe('partial_parsed');
  });

  it('S2 signal: MANUAL FULL_PARSED with jobLifecycleId emits PARSE_COMPLETED', async () => {
    const partialHtml = topcvEmailHtmlMany([{ role: 'Software Engineer', company: 'S2 Co' }]);
    const genPromise = consumeOne(conCh, S1_QUEUE);

    await ingestor.processIngest(JobSource.BROWSER_AUTO, JobStage.PARTIAL_PARSED, partialHtml, undefined, {
      messageId: 's2-msg',
    });
    const genMsg = await genPromise;
    const jobLifecycleId = genMsg._id;

    const fullHtml = topcvDetailHtml('Software Engineer', 'S2 Co');
    const compPromise = consumeOne(conCh, S2_QUEUE);

    await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, fullHtml, jobLifecycleId);

    const compMsg = await compPromise;
    expect(compMsg).toBeDefined();
    expect(compMsg.job).toBeDefined();
    expect(compMsg.job._id).toBe(jobLifecycleId);
    expect(compMsg.job.stage).toBe('full_parsed');
    expect(compMsg.job.status).toBe('enriched');
  });

  it('Queue resolution emits QUEUED event on RMQ', async () => {
    const partialHtml = topcvEmailHtmlMany([{ role: 'Software Engineer', company: 'Queue Co' }]);
    const genPromise = consumeOne(conCh, S1_QUEUE);

    await ingestor.processIngest(JobSource.BROWSER_AUTO, JobStage.PARTIAL_PARSED, partialHtml, undefined, {
      messageId: 'queue-msg',
    });
    const genMsg = await genPromise;
    const jobLifecycleId = genMsg._id;

    const fullHtml = topcvDetailHtml('Software Engineer', 'Queue Co');
    const compPromise = consumeOne(conCh, S2_QUEUE);
    await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, fullHtml, jobLifecycleId);
    await compPromise;

    const queuePromise = consumeOne(conCh, S3S4_QUEUE);
    await ingestor.processResolution(jobLifecycleId, 'queue');

    const queueMsg = await queuePromise;
    expect(queueMsg).toBeDefined();
    expect(queueMsg.jobLifecycleId).toBe(jobLifecycleId);
  });

  it('Trash resolution emits TRASHED event on RMQ', async () => {
    const partialHtml = topcvEmailHtmlMany([{ role: 'Software Engineer', company: 'Trash Co' }]);
    const genPromise = consumeOne(conCh, S1_QUEUE);

    await ingestor.processIngest(JobSource.BROWSER_AUTO, JobStage.PARTIAL_PARSED, partialHtml, undefined, {
      messageId: 'trash-msg',
    });
    const genMsg = await genPromise;
    const jobLifecycleId = genMsg._id;

    const fullHtml = topcvDetailHtml('Software Engineer', 'Trash Co');
    const compPromise = consumeOne(conCh, S2_QUEUE);
    await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, fullHtml, jobLifecycleId);
    await compPromise;

    const trashPromise = consumeOne(conCh, S3S4_QUEUE);
    await ingestor.processResolution(jobLifecycleId, 'trash');

    const trashMsg = await trashPromise;
    expect(trashMsg).toBeDefined();
    expect(trashMsg.jobLifecycleId).toBe(jobLifecycleId);
    expect(trashMsg.reason).toBe('operator:trash');
  });

  it('Resolution with missing job emits ROUTE_FAILED event on RMQ', async () => {
    const failPromise = consumeOne(conCh, S3S4_QUEUE);
    await ingestor.processResolution('nonexistent-job', 'queue');

    const failMsg = await failPromise;
    expect(failMsg).toBeDefined();
    expect(failMsg.jobLifecycleId).toBe('nonexistent-job');
    expect(failMsg.reason).toBe('No existing job lifecycle found');
  });

  it('Empty HTML ingest emits PARSE_FAILED event on RMQ', async () => {
    const failPromise = consumeOne(conCh, S3S4_QUEUE);
    await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, '', 'empty-id');

    const failMsg = await failPromise;
    expect(failMsg).toBeDefined();
    expect(failMsg.jobLifecycleId).toBe('empty-id');
  });
});
