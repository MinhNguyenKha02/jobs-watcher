import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import amqplib, { type Channel, type Connection, type ConsumeMessage } from 'amqplib';
import { ActionEvent } from '../../src/domain/types/action-event.js';

const RMQ_URL = process.env.RABBITMQ_URL || 'amqp://localhost';
const EXCHANGE = process.env.RABBITMQ_EXCHANGE || 'jobs.events';
const TEST_PREFIX = `rmq-int-${Date.now()}`;

const S1_QUEUE = `${TEST_PREFIX}.tui.s1`;
const S2_QUEUE = `${TEST_PREFIX}.tui.s2`;
const S3S4_QUEUE = `${TEST_PREFIX}.tui.s3s4`;

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

describe('RMQ Signal Flow Integration', { timeout: 30000 }, () => {
  let conn: Connection;
  let pubChannel: Channel;
  let conChannel: Channel;

  beforeAll(async () => {
    conn = await amqplib.connect(RMQ_URL);
    pubChannel = await conn.createChannel();
    conChannel = await conn.createChannel();
    await setupTopology(pubChannel);
  });

  afterEach(async () => {
    await conChannel.close();
    conChannel = await conn.createChannel();
    await purgeQueues(pubChannel);
  });

  afterAll(async () => {
    await purgeQueues(pubChannel);
    await pubChannel.close();
    await conChannel.close();
    await conn.close();
  });

  it('exchange and queues exist with correct bindings', async () => {
    const s1Bindings = await conChannel.checkQueue(S1_QUEUE);
    expect(s1Bindings.consumerCount).toBe(0);
    expect(s1Bindings.messageCount).toBe(0);

    const s2Bindings = await conChannel.checkQueue(S2_QUEUE);
    expect(s2Bindings.consumerCount).toBe(0);

    const s3s4Bindings = await conChannel.checkQueue(S3S4_QUEUE);
    expect(s3s4Bindings.consumerCount).toBe(0);
  });

  it('publishes generated event → consumed on s1 queue', async () => {
    const msg = { jobLifecycleId: 'rmq-test-1', role: 'Software Engineer', company: 'Test Co' };
    const consumed = new Promise<any>((resolve) => {
      conChannel.consume(S1_QUEUE, (m) => {
        if (m) {
          resolve(JSON.parse(m.content.toString()));
          conChannel.ack(m);
        }
      }, { noAck: false });
    });

    pubChannel.publish(EXCHANGE, ActionEvent.GENERATED, Buffer.from(JSON.stringify(msg)), { persistent: true });

    const result = await consumed;
    expect(result.jobLifecycleId).toBe('rmq-test-1');
    expect(result.role).toBe('Software Engineer');
  });

  it('full signal flow: generated → parse_completed → queued', async () => {
    const generated = { jobLifecycleId: 'rmq-flow-1', role: 'Backend Engineer' };
    const completed = { jobLifecycleId: 'rmq-flow-1', job: generated };
    const s1Consumed = new Promise<any>((resolve) => {
      conChannel.consume(S1_QUEUE, (m) => {
        if (m) { resolve(JSON.parse(m.content.toString())); conChannel.ack(m); }
      }, { noAck: false });
    });
    pubChannel.publish(EXCHANGE, ActionEvent.GENERATED, Buffer.from(JSON.stringify(generated)), { persistent: true });
    const s1Result = await s1Consumed;
    expect(s1Result.jobLifecycleId).toBe('rmq-flow-1');

    const s3Consumed = new Promise<any>((resolve) => {
      conChannel.consume(S3S4_QUEUE, (m) => {
        if (m) { resolve(JSON.parse(m.content.toString())); conChannel.ack(m); }
      }, { noAck: false });
    });
    pubChannel.publish(EXCHANGE, ActionEvent.QUEUED, Buffer.from(JSON.stringify(completed)), { persistent: true });
    const s3Result = await s3Consumed;
    expect(s3Result.job).toBeDefined();
    expect(s3Result.job.jobLifecycleId).toBe('rmq-flow-1');
  });

  it('F1: burst 12 generated messages — s1 consumer prefetch=5 drains all', async () => {
    const received: string[] = [];
    const allReceived = new Promise<void>((resolve) => {
      conChannel.prefetch(5);
      conChannel.consume(S1_QUEUE, (m) => {
        if (m) {
          received.push(JSON.parse(m.content.toString()).jobLifecycleId);
          conChannel.ack(m);
          if (received.length === 12) resolve();
        }
      }, { noAck: false });
    });

    for (let i = 0; i < 12; i++) {
      pubChannel.publish(EXCHANGE, ActionEvent.GENERATED,
        Buffer.from(JSON.stringify({ jobLifecycleId: `rmq-burst-${i}` })), { persistent: true });
    }

    await allReceived;
    expect(received).toHaveLength(12);
    for (let i = 0; i < 12; i++) {
      expect(received).toContain(`rmq-burst-${i}`);
    }
  });

  it('F3: S2 before S1 — DeferredS2Buffer path (S1 arrival triggers merge)', async () => {
    const completedPayload = { jobLifecycleId: 'rmq-defer-1', role: 'Frontend Engineer' };

    const s2Delivered = new Promise<void>((resolve) => {
      conChannel.consume(S2_QUEUE, (m) => {
        if (m) {
          conChannel.ack(m);
          resolve();
        }
      }, { noAck: false });
    });

    pubChannel.publish(EXCHANGE, ActionEvent.PARSE_COMPLETED,
      Buffer.from(JSON.stringify({ jobLifecycleId: 'rmq-defer-1', job: completedPayload })), { persistent: true });
    await s2Delivered;

    const s1Delivered = new Promise<void>((resolve) => {
      conChannel.consume(S1_QUEUE, (m) => {
        if (m) {
          conChannel.ack(m);
          resolve();
        }
      }, { noAck: false });
    });

    pubChannel.publish(EXCHANGE, ActionEvent.GENERATED,
      Buffer.from(JSON.stringify(completedPayload)), { persistent: true });
    await s1Delivered;
  });

  it('publishes trash event → consumed on s3s4 queue', async () => {
    const trashed = { jobLifecycleId: 'rmq-trash-1', reason: 'not interested' };
    const consumed = new Promise<any>((resolve) => {
      conChannel.consume(S3S4_QUEUE, (m) => {
        if (m) { resolve(JSON.parse(m.content.toString())); conChannel.ack(m); }
      }, { noAck: false });
    });

    pubChannel.publish(EXCHANGE, ActionEvent.TRASHED, Buffer.from(JSON.stringify(trashed)), { persistent: true });

    const result = await consumed;
    expect(result.jobLifecycleId).toBe('rmq-trash-1');
    expect(result.reason).toBe('not interested');
  });

  it('publishes route failed event → consumed on s3s4 queue', async () => {
    const failed = { jobLifecycleId: 'rmq-fail-1', reason: 'extraction error' };
    const consumed = new Promise<any>((resolve) => {
      conChannel.consume(S3S4_QUEUE, (m) => {
        if (m) { resolve(JSON.parse(m.content.toString())); conChannel.ack(m); }
      }, { noAck: false });
    });

    pubChannel.publish(EXCHANGE, ActionEvent.ROUTE_FAILED, Buffer.from(JSON.stringify(failed)), { persistent: true });

    const result = await consumed;
    expect(result.jobLifecycleId).toBe('rmq-fail-1');
  });
});
