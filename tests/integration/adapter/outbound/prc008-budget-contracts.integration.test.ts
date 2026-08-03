import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import amqplib, { type Channel, type Connection } from 'amqplib';
import { UdsActionWriter } from '../../../../src/presentation/tui/components/UdsActionWriter.js';
import { JobIngestor } from '../../../../src/application/ingestor.js';
import { JobStage, JobStatus, JobSource } from '../../../../src/domain/types/job-lifecycle.js';
import { MetricsRegistry } from '../../../../src/infrastructure/outbound/monitoring/metrics-registry.js';
import { Registry } from 'prom-client';

const RMQ_URL = process.env.RABBITMQ_URL || 'amqp://localhost';

// Registers a persistent consumer and resolves each delivery through a queue so
// that requeued (redelivered) messages are observable on the same consumer.
function collectMessages(ch: Channel, queue: string): { messages: amqplib.ConsumeMessage[]; next: () => Promise<amqplib.ConsumeMessage> } {
  const messages: amqplib.ConsumeMessage[] = [];
  const waiters: Array<(msg: amqplib.ConsumeMessage) => void> = [];
  ch.consume(queue, (msg) => {
    if (!msg) return;
    const waiter = waiters.shift();
    if (waiter) waiter(msg);
    else messages.push(msg);
  }, { noAck: false });
  return {
    messages,
    next: () => {
      const buffered = messages.shift();
      if (buffered) return Promise.resolve(buffered);
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error(`Timeout waiting for message on ${queue}`)), 8000);
        waiters.push((msg) => {
          clearTimeout(timeout);
          resolve(msg);
        });
      });
    },
  };
}

describe('PRC-008 — RMQ redelivery contracts (deterministic, no latency assertions)', () => {
  let rmqConn: Connection;
  let ch: Channel;

  beforeAll(async () => {
    rmqConn = await amqplib.connect(RMQ_URL);
    ch = await rmqConn.createChannel();
  });

  afterAll(async () => {
    try { await ch.close(); } catch {}
    try { await rmqConn.close(); } catch {}
  });

  it('nack(requeue=true) redelivers the message with fields.redelivered === true', async () => {
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

  it('nack(requeue=false) drops the message — queue drains to 0', async () => {
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
  it('exhausts exactly 3 attempts then throws on persistent non-2xx', async () => {
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

describe('PRC-008 — JobIngestor queryWithRetry budget (maxRetries=5)', () => {
  const metrics = new MetricsRegistry(new Registry());

  it('missing job: queries findById 5 times then emits ROUTE_FAILED', async () => {
    const findById = vi.fn().mockResolvedValue(null);
    const emitRouteFailed = vi.fn().mockResolvedValue(undefined);

    const ingestor = new JobIngestor(
      { findById } as any,
      {} as any,
      { emitRouteFailed } as any,
      {} as any,
      undefined as any,
      metrics,
    );

    await ingestor.processResolution('missing-job', 'queue');

    expect(findById).toHaveBeenCalledTimes(5);
    expect(emitRouteFailed).toHaveBeenCalledWith('missing-job', 'No existing job lifecycle found');
  });

  it('found on first query: no wasted retries, resolves directly', async () => {
    const doc = {
      _id: 'job-ok',
      role: 'Engineer',
      company: 'PRC Co',
      stage: JobStage.FULL_PARSED,
      status: JobStatus.ENRICHED,
      createdAt: new Date(),
      updatedAt: new Date(),
      stageTimestamp: new Date(),
    };
    const findById = vi.fn().mockResolvedValue(doc);
    const updateStage = vi.fn().mockResolvedValue(undefined);
    const emitJobQueued = vi.fn().mockResolvedValue(undefined);

    const ingestor = new JobIngestor(
      { findById, updateStage } as any,
      {} as any,
      { emitRouteFailed: vi.fn(), emitJobQueued } as any,
      {} as any,
      undefined as any,
      metrics,
    );

    await ingestor.processResolution('job-ok', 'queue');

    expect(findById).toHaveBeenCalledTimes(1);
    expect(updateStage).toHaveBeenCalledWith('job-ok', JobStage.FULL_PARSED, JobStatus.QUEUED);
    expect(emitJobQueued).toHaveBeenCalledWith('job-ok', { source: JobSource.MANUAL });
  });
});
