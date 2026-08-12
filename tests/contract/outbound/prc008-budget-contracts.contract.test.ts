import 'dotenv/config';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import amqplib, { type Channel, type ChannelModel } from 'amqplib';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { UdsActionWriter } from '../../../src/presentation/tui/components/UdsActionWriter.js';

const RMQ_URL = process.env.RABBITMQ_URL || 'amqp://localhost';

// Registers a persistent consumer and resolves each delivery through a queue so
// that requeued (redelivered) messages are observable on the same consumer.
function collectMessages(
  ch: Channel,
  queue: string
): { messages: amqplib.ConsumeMessage[]; next: () => Promise<amqplib.ConsumeMessage> } {
  const messages: amqplib.ConsumeMessage[] = [];
  const waiters: Array<(msg: amqplib.ConsumeMessage) => void> = [];
  ch.consume(
    queue,
    (msg) => {
      if (!msg) return;
      const waiter = waiters.shift();
      if (waiter) waiter(msg);
      else messages.push(msg);
    },
    { noAck: false }
  );
  return {
    messages,
    next: () => {
      const buffered = messages.shift();
      if (buffered) return Promise.resolve(buffered);
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error(`Timeout waiting for message on ${queue}`)),
          8000
        );
        waiters.push((msg) => {
          clearTimeout(timeout);
          resolve(msg);
        });
      });
    },
  };
}

describe('PRC-008 — RMQ redelivery contracts (deterministic, no latency assertions)', () => {
  let rmqConn: ChannelModel;
  let ch: Channel;

  beforeAll(async () => {
    rmqConn = await amqplib.connect(RMQ_URL);
    ch = await rmqConn.createChannel();
  });

  afterAll(async () => {
    try {
      await ch.close();
    } catch {}
    try {
      await rmqConn.close();
    } catch {}
  });

  it('GIVEN the PRC precondition WHEN assertQueue → sendToQueue → nack on the real PRC THEN nack(requeue=true) redelivers the message with fields.redelivered === true', async () => {
    const { queue } = await ch.assertQueue('', { exclusive: true });
    const sink = collectMessages(ch, queue);
    ch.sendToQueue(queue, Buffer.from(JSON.stringify({ id: 'job-r1' })));

    const first = await sink.next();
    expect(first.content.toString()).toBe(JSON.stringify({ id: 'job-r1' }));
    expect(first.fields.redelivered).toBe(false);

    ch.nack(first, false, true);

    const redelivered = await sink.next();
    expect(redelivered.content.toString()).toBe(JSON.stringify({ id: 'job-r1' }));
    expect(redelivered.fields.redelivered).toBe(true);
    ch.ack(redelivered);
  });

  it('GIVEN the PRC precondition WHEN assertQueue → sendToQueue → nack on the real PRC THEN nack(requeue=false) drops the message — queue drains to 0', async () => {
    const { queue } = await ch.assertQueue('', { exclusive: true });
    const sink = collectMessages(ch, queue);
    ch.sendToQueue(queue, Buffer.from(JSON.stringify({ id: 'job-drop' })));

    const msg = await sink.next();
    expect(msg.content.toString()).toBe(JSON.stringify({ id: 'job-drop' }));

    ch.nack(msg, false, false);

    const check = await ch.checkQueue(queue);
    expect(check.messageCount).toBe(0);
  });
});

describe('PRC-008 — UdsActionWriter maxRetries=3 (real UDS HTTP server returning 500)', () => {
  it('GIVEN the PRC precondition WHEN the port is exercised on the real PRC THEN exhausts exactly 3 attempts then throws on persistent non-2xx (S4)', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prc008-uds-'));
    const socketPath = path.join(tmpDir, 'ingest.sock');
    let requests = 0;

    const server = http.createServer((req, res) => {
      requests++;
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end('{"error":"boom"}');
    });

    await new Promise<void>((r) => server.listen(socketPath, r));

    try {
      const writer = new UdsActionWriter(socketPath, 'test-token');
      await expect(writer.queue('job-uds')).rejects.toThrow(/Action failed: 500/);
      expect(requests).toBe(3);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
