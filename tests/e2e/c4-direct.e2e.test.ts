import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
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
import { detailHtmlFor } from '../helpers/html-fixtures.js';
import { UdsAdapter } from '../../src/infrastructure/inbound/uds/uds-adapter.js';
import { postJsonOverUds } from '../../src/infrastructure/utils/uds-http.js';
import {
  setQueueMode,
  getQueueMode,
  resetState,
} from '../../src/presentation/tui/shared-tui-state.js';

const RMQ_URL = process.env.RABBITMQ_URL || 'amqp://localhost';
const EXCHANGE = process.env.RABBITMQ_EXCHANGE || 'jobs.events.e2e.c4';
const INTERNAL_TOKEN = 'c4-e2e-token';

function udsHelpers(socketPath: string) {
  return {
    ingest: (html: string) =>
      postJsonOverUds(
        { socketPath, path: '/internal/ingest', headers: { 'x-internal-token': INTERNAL_TOKEN } },
        { html },
      ),
    action: (jobLifecycleId: string, action: string) =>
      postJsonOverUds(
        { socketPath, path: '/internal/action', headers: { 'x-internal-token': INTERNAL_TOKEN } },
        { jobLifecycleId, action },
      ),
  };
}

// Fresh exclusive queue bound to the desired routing keys at consume-time.
async function setupConsumer(ch: Channel, routingKeys: string[]): Promise<{ consume: Promise<any> }> {
  const { queue } = await ch.assertQueue('', { exclusive: true });
  for (const key of routingKeys) {
    await ch.bindQueue(queue, EXCHANGE, key);
  }
  const consume = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timeout waiting for message on ${EXCHANGE}:${routingKeys.join('|')}`)), 10000);
    ch.consume(queue, (msg) => {
      if (msg) {
        clearTimeout(timeout);
        ch.ack(msg);
        resolve(JSON.parse(msg.content.toString()));
      }
    }, { noAck: false });
  });
  return { consume };
}

describe('C4 direct e2e — [b] direct mode → [i] clipboard ingest → fully job → [d] trash → next cycle', () => {
  let storage: Awaited<ReturnType<typeof createTestStorage>>;
  let rmqConn: Connection;
  let pubCh: Channel;
  let conCh: Channel;
  let rmqConnection: RabbitMqConnection;
  let ingestor: JobIngestor;
  let adapter: MongoJobLifecycleAdapter;
  let udsAdapter: UdsAdapter;
  let uds: ReturnType<typeof udsHelpers>;
  let firstJobId: string;

  const extractionQueue = {
    enqueue: vi.fn(),
    dequeue: vi.fn(),
    size: vi.fn(),
    onEnqueue: vi.fn(),
  };
  const assetProducing = { toAsset: vi.fn() };

  beforeAll(async () => {
    storage = await createTestStorage();
    const initializer = new MongoInitializer(storage.client, storage.dbName);
    await initializer.init();
    adapter = new MongoJobLifecycleAdapter(storage.client.db(storage.dbName));

    rmqConn = await amqplib.connect(RMQ_URL);
    pubCh = await rmqConn.createChannel();
    conCh = await rmqConn.createChannel();
    await pubCh.assertExchange(EXCHANGE, 'topic', { durable: true });

    rmqConnection = new RabbitMqConnection({ url: RMQ_URL, exchange: EXCHANGE });
    await rmqConnection.connect();

    ingestor = new JobIngestor(
      adapter,
      new RabbitMqParseAdapter(rmqConnection),
      new RabbitMqRoutingAdapter(rmqConnection),
      extractionQueue as any,
      assetProducing as any,
      new MetricsRegistry(new Registry()),
    );

    const socketPath = path.join(os.tmpdir(), 'c4-e2e-uds.sock');
    uds = udsHelpers(socketPath);
    udsAdapter = new UdsAdapter(ingestor, { socketPath, token: INTERNAL_TOKEN });
    await udsAdapter.start();

    resetState();
  }, 120000);

  afterAll(async () => {
    try { await udsAdapter?.stop(); } catch {}
    try { await rmqConnection.disconnect(); } catch {}
    try { await pubCh.close(); } catch {}
    try { await conCh.close(); } catch {}
    try { await rmqConn.close(); } catch {}
    await storage.stop();
    resetState();
  });

  beforeEach(async () => {
    await storage.client.db(storage.dbName).dropDatabase();
    resetState();
    setQueueMode(true);
  });

  it('[b] toggle to direct mode → [i] clipboard ingest → fully job → [d] trash → next cycle works', async () => {
    // [b]: toggle queue → direct.
    setQueueMode(false);
    expect(getQueueMode()).toBe(false);

    // [i]: direct clipboard ingest (signal2b) → fully-parsed ENRICHED job + PARSE_COMPLETED event,
    // injected through the real UdsAdapter (`POST /internal/ingest`).
    const comp = await setupConsumer(conCh, [ActionEvent.PARSE_COMPLETED]);
    const iRes = await uds.ingest(detailHtmlFor('Backend Engineer', 'C4DirectCo'));
    expect(iRes.statusCode).toBe(200);
    const compMsg = await comp.consume;

    expect(compMsg.job).toBeDefined();
    firstJobId = compMsg.job._id;
    expect(firstJobId).toMatch(/^clip-/);
    expect(compMsg.job.role).toBe('Backend Engineer');
    expect(compMsg.job.company).toBe('C4DirectCo');
    expect(compMsg.job.stage).toBe(JobStage.FULL_PARSED);
    expect(compMsg.job.status).toBe(JobStatus.ENRICHED);

    const stored = await adapter.findById(firstJobId);
    expect(stored).not.toBeNull();
    expect(stored!.status).toBe(JobStatus.ENRICHED);
    expect(stored!.source).toBe('manual');

    // [d]: trash the fully-parsed job → TRASHED event + TRASHED doc,
    // injected through the real UdsAdapter (`POST /internal/action`).
    const trash = await setupConsumer(conCh, [ActionEvent.TRASHED, ActionEvent.ROUTE_FAILED, ActionEvent.PARSE_FAILED]);
    const dRes = await uds.action(firstJobId, 'trash');
    expect(dRes.statusCode).toBe(200);
    const trashMsg = await trash.consume;
    expect(trashMsg.jobLifecycleId).toBe(firstJobId);
    expect(trashMsg.reason).toBe('operator:trash');

    const trashed = await adapter.findById(firstJobId);
    expect(trashed).not.toBeNull();
    expect(trashed!.status).toBe(JobStatus.TRASHED);

    // Next cycle: a second direct ingest still works after the trash.
    const comp2 = await setupConsumer(conCh, [ActionEvent.PARSE_COMPLETED]);
    const i2Res = await uds.ingest(detailHtmlFor('Data Engineer', 'C4DirectCo2'));
    expect(i2Res.statusCode).toBe(200);
    const comp2Msg = await comp2.consume;
    expect(comp2Msg.job._id).toMatch(/^clip-/);
    expect(comp2Msg.job._id).not.toBe(firstJobId);
    expect(comp2Msg.job.company).toBe('C4DirectCo2');

    const stored2 = await adapter.findById(comp2Msg.job._id);
    expect(stored2).not.toBeNull();
    expect(stored2!.status).toBe(JobStatus.ENRICHED);
  }, 60000);
});
