import amqplib, { type Channel, type ChannelModel, type ConsumeMessage } from 'amqplib';
import { getLogger } from '../../../infrastructure/outbound/logging/logger.js';
import { ActionEvent } from '../../../domain/types/action-event.js';
import { setCurrentJob, clearCurrentJob, getCurrentJob, getQueueMode } from '../shared-tui-state.js';

const logger = getLogger();

const EXCHANGE = 'jobs.events';
const S1_QUEUE = 'tui.s1';
const S2_QUEUE = 'tui.s2';
const S34_QUEUE = 'tui.s3s4';
const PREFETCH = 5;
const DEFERRED_S2_MAX = 10;
const DEFERRED_S2_TTL = 30_000;

interface PendingJob {
  readonly id: string;
  readonly job: Record<string, unknown>;
  stage: 'PARTIAL' | 'FULL_PARSED';
}

interface S2BufferEntry {
  payload: Record<string, unknown>;
  deliveryTag: number;
  timestamp: number;
}

export class RabbitMqJobReader {
  private s1channel: Channel | null = null;
  private s2channel: Channel | null = null;
  private s34channel: Channel | null = null;

  private pendingJobs: PendingJob[] = [];
  private currentJobId: string | null = null;
  private queueMode = true;
  private deliveryTagsS1 = new Map<string, number[]>();
  private deliveryTagsS2 = new Map<string, number[]>();
  private deferredS2Buffer = new Map<string, S2BufferEntry>();

  private connected = false;
  private evictTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private baseUrl: string) {}

  getQueueDepth(): number { return this.pendingJobs.length; }
  isConnected(): boolean { return this.connected; }

  async start(): Promise<void> {
    try {
      const conn = await amqplib.connect(this.baseUrl);
      const s1 = await conn.createChannel();
      const s2 = await conn.createChannel();
      const s34 = await conn.createChannel();
      this.s1channel = s1;
      this.s2channel = s2;
      this.s34channel = s34;

      await s1.assertExchange(EXCHANGE, 'topic', { durable: true });
      await s1.assertQueue(S1_QUEUE, { durable: true });
      await s2.assertQueue(S2_QUEUE, { durable: true });
      await s34.assertQueue(S34_QUEUE, { durable: true });

      await s1.bindQueue(S1_QUEUE, EXCHANGE, ActionEvent.GENERATED);
      await s2.bindQueue(S2_QUEUE, EXCHANGE, ActionEvent.PARSE_COMPLETED);
      await s34.bindQueue(S34_QUEUE, EXCHANGE, ActionEvent.QUEUED);
      await s34.bindQueue(S34_QUEUE, EXCHANGE, ActionEvent.TRASHED);
      await s34.bindQueue(S34_QUEUE, EXCHANGE, ActionEvent.ROUTE_FAILED);
      await s34.bindQueue(S34_QUEUE, EXCHANGE, ActionEvent.PARSE_FAILED);

      await s1.prefetch(PREFETCH);
      await s2.prefetch(PREFETCH);
      await s34.prefetch(PREFETCH);

      await s1.consume(S1_QUEUE, (msg) => { if (msg) this.onMessageS1(msg); });
      await s2.consume(S2_QUEUE, (msg) => { if (msg) this.onMessageS2(msg); });
      await s34.consume(S34_QUEUE, (msg) => { if (msg) this.onMessageS3S4(msg); });

      this.evictTimer = setInterval(() => this.evictStaleDeferred(), 5000);
      this.connected = true;
      logger.info('[RMQReader] Started, 3 consumers active');
    } catch (err) {
      logger.error('[RMQReader] Start failed', { error: String(err) });
      this.connected = false;
    }
  }

  stop(): void {
    this.connected = false;
    if (this.evictTimer) clearInterval(this.evictTimer);
    this.nackAllPending();
    [this.s1channel, this.s2channel, this.s34channel].forEach((ch) => {
      if (ch) ch.close().catch(() => {});
    });
    logger.info('[RMQReader] Stopped');
  }

  setQueueMode(mode: boolean): void {
    this.queueMode = mode;
  }

  private onMessageS1(msg: ConsumeMessage): void {
    try {
      const payload = JSON.parse(msg.content.toString()) as Record<string, unknown>;
      const id = (payload._id ?? payload.jobLifecycleId) as string;
      if (!id) { this.s1channel!.ack(msg); return; }

      const tags = this.deliveryTagsS1.get(id) ?? [];
      tags.push(msg.fields.deliveryTag);
      this.deliveryTagsS1.set(id, tags);

      this.drainDeferredS2(id);

      if (!this.pendingJobs.some((p) => p.id === id)) {
        this.pendingJobs.push({ id, job: payload, stage: 'PARTIAL' });
      }

      logger.info('[SIGNAL-1] job.generated', { id, company: payload.company, stage: 'PARTIAL' });
      this.autoAdvance();
    } catch (err) {
      logger.warn('[RMQReader:C1] Error', { error: String(err) });
      this.s1channel!.nack(msg, false, true);
    }
  }

  private onMessageS2(msg: ConsumeMessage): void {
    try {
      const payload = JSON.parse(msg.content.toString()) as Record<string, unknown>;
      const id = (payload._id ?? payload.jobLifecycleId) as string;
      if (!id) { this.s2channel!.ack(msg); return; }

      const tags = this.deliveryTagsS2.get(id) ?? [];
      tags.push(msg.fields.deliveryTag);
      this.deliveryTagsS2.set(id, tags);

      const existingIdx = this.pendingJobs.findIndex((p) => p.id === id);
      if (existingIdx !== -1) {
        this.pendingJobs[existingIdx] = {
          ...this.pendingJobs[existingIdx],
          job: { ...this.pendingJobs[existingIdx].job, ...payload },
          stage: 'FULL_PARSED',
        };
        logger.info('[SIGNAL-2] job.parse.completed — merged in pending', { id });
      } else if (this.currentJobId === id) {
        setCurrentJob(id, { ...getCurrentJob().job, ...payload } as any, 'FULL_PARSED');
        logger.info('[SIGNAL-2] job.parse.completed — IPC enriched displayed job', { id });
      } else if (!this.queueMode) {
        if (this.currentJobId !== null) {
          this.ackAllForJob(this.currentJobId);
        }
        setCurrentJob(id, payload as any, 'FULL_PARSED');
        this.currentJobId = id;
        logger.info('[SIGNAL-2] job.parse.completed — direct mode set', { id });
      } else {
        if (this.deferredS2Buffer.size >= DEFERRED_S2_MAX) {
          logger.warn('[RMQReader:C2] DeferredS2Buffer full, nacking', { id });
          this.s2channel!.nack(msg, false, true);
          return;
        }
        this.deferredS2Buffer.set(id, { payload, deliveryTag: msg.fields.deliveryTag, timestamp: Date.now() });
        logger.debug('[RMQReader:C2] S2 deferred', { id });
      }
    } catch (err) {
      logger.warn('[RMQReader:C2] Error', { error: String(err) });
      this.s2channel!.nack(msg, false, true);
    }
  }

  private onMessageS3S4(msg: ConsumeMessage): void {
    try {
      const payload = JSON.parse(msg.content.toString()) as Record<string, unknown>;
      const id = (payload._id ?? payload.jobLifecycleId) as string;
      if (!id) { this.s34channel!.ack(msg); return; }

      this.ackAllForJob(id);
      this.s34channel!.ack(msg);

      this.removeFromPending(id);

      if (this.currentJobId === id) {
        this.currentJobId = null;
        clearCurrentJob();
        const routingKey = msg.fields.routingKey;
        if (routingKey === ActionEvent.QUEUED) {
          logger.info('[SIGNAL-3] job.queued', { id });
        } else if (routingKey === ActionEvent.TRASHED) {
          logger.info('[SIGNAL-3] job.trashed', { id });
        } else if (routingKey === ActionEvent.PARSE_FAILED || routingKey === ActionEvent.ROUTE_FAILED) {
          logger.info('[SIGNAL-4] job.failed', { id, routingKey });
        }
      }

      if (this.queueMode) this.autoAdvance();
    } catch (err) {
      logger.warn('[RMQReader:C3] Error', { error: String(err) });
      this.s34channel!.nack(msg, false, true);
    }
  }

  private ackAllForJob(id: string): void {
    const s1Tags = this.deliveryTagsS1.get(id);
    if (s1Tags && this.s1channel) {
      for (const tag of s1Tags) {
        this.s1channel.ack({ fields: { deliveryTag: tag } } as ConsumeMessage, false);
      }
      this.deliveryTagsS1.delete(id);
    }
    const s2Tags = this.deliveryTagsS2.get(id);
    if (s2Tags && this.s2channel) {
      for (const tag of s2Tags) {
        this.s2channel.ack({ fields: { deliveryTag: tag } } as ConsumeMessage, false);
      }
      this.deliveryTagsS2.delete(id);
    }
  }

  private autoAdvance(): void {
    if (!this.queueMode) return;
    if (this.currentJobId !== null) return;
    if (this.pendingJobs.length === 0) return;
    const next = this.pendingJobs.shift()!;
    this.currentJobId = next.id;
    setCurrentJob(next.id, next.job as any, next.stage);
    logger.info('[RMQReader] Auto-advanced to next job', { id: next.id, stage: next.stage });
  }

  private removeFromPending(id: string): void {
    const idx = this.pendingJobs.findIndex((j) => j.id === id);
    if (idx !== -1) this.pendingJobs.splice(idx, 1);
  }

  private drainDeferredS2(id: string): void {
    const entry = this.deferredS2Buffer.get(id);
    if (!entry) return;
    this.deferredS2Buffer.delete(id);

    const existingIdx = this.pendingJobs.findIndex((p) => p.id === id);
    if (existingIdx !== -1) {
      this.pendingJobs[existingIdx] = {
        ...this.pendingJobs[existingIdx],
        job: { ...this.pendingJobs[existingIdx].job, ...entry.payload },
        stage: 'FULL_PARSED',
      };
    } else {
      this.pendingJobs.push({ id, job: entry.payload, stage: 'FULL_PARSED' });
    }
    logger.info('[RMQReader] Deferred S2 drained', { id });
  }

  private evictStaleDeferred(): void {
    const now = Date.now();
    for (const [id, entry] of this.deferredS2Buffer) {
      if (now - entry.timestamp > DEFERRED_S2_TTL) {
        logger.warn('[RMQReader] Evicting stale deferred S2', { id });
        this.s2channel?.nack({ fields: { deliveryTag: entry.deliveryTag } } as ConsumeMessage, false, false);
        this.deferredS2Buffer.delete(id);
      }
    }
  }

  private nackAllPending(): void {
    for (const [, tags] of this.deliveryTagsS1) {
      for (const tag of tags) {
        this.s1channel?.nack({ fields: { deliveryTag: tag } } as ConsumeMessage, false, true);
      }
    }
    this.deliveryTagsS1.clear();
    for (const [, tags] of this.deliveryTagsS2) {
      for (const tag of tags) {
        this.s2channel?.nack({ fields: { deliveryTag: tag } } as ConsumeMessage, false, true);
      }
    }
    this.deliveryTagsS2.clear();
  }
}
