import amqplib, { type Channel, type ConsumeMessage } from 'amqplib';
import type { Job } from '../../../domain/types/job.js';
import { getLogger } from '../../../infrastructure/outbound/logging/logger.js';
import { createTraceContext } from '../../../infrastructure/outbound/monitoring/trace-context.js';

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

type EventCallback = (event: any) => void;

export class RabbitMqJobReader {
  private connection: amqplib.Connection | null = null;
  private s1channel: Channel | null = null;
  private s2channel: Channel | null = null;
  private s34channel: Channel | null = null;

  private pendingJobs: PendingJob[] = [];
  private currentJobId: string | null = null;
  private queueMode = true;
  private deliveryTagsS1 = new Map<string, number[]>();
  private deliveryTagsS2 = new Map<string, number[]>();
  private deferredS2Buffer = new Map<string, S2BufferEntry>();

  private listeners = new Map<string, Set<EventCallback>>();
  private connected = false;
  private stopped = false;
  private evictTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private baseUrl: string) {}

  addEventListener(eventType: string, callback: EventCallback): void {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, new Set());
    }
    this.listeners.get(eventType)!.add(callback);
  }

  removeEventListener(eventType: string, callback: EventCallback): void {
    this.listeners.get(eventType)?.delete(callback);
  }

  private emit(eventType: string, data: Record<string, unknown>): void {
    const listeners = this.listeners.get(eventType);
    if (!listeners) return;
    for (const cb of listeners) {
      try { cb({ data, payload: data }); } catch (e) {
        logger.warn('[RMQReader] Listener error', { eventType, error: String(e) });
      }
    }
  }

  getQueueDepth(): number { return this.pendingJobs.length; }
  isConnected(): boolean { return this.connected; }

  async connect(): Promise<void> {
    try {
      this.connection = await amqplib.connect(this.baseUrl);
      this.s1channel = await this.connection.createChannel();
      this.s2channel = await this.connection.createChannel();
      this.s34channel = await this.connection.createChannel();

      await this.s1channel.assertExchange(EXCHANGE, 'topic', { durable: true });
      await this.s1channel.assertQueue(S1_QUEUE, { durable: true });
      await this.s1channel.assertQueue(S2_QUEUE, { durable: true });
      await this.s1channel.assertQueue(S34_QUEUE, { durable: true });

      await this.s1channel.bindQueue(S1_QUEUE, EXCHANGE, 'job.generated');
      await this.s2channel.bindQueue(S2_QUEUE, EXCHANGE, 'job.parse.completed');
      await this.s34channel.bindQueue(S34_QUEUE, EXCHANGE, 'job.queue');
      await this.s34channel.bindQueue(S34_QUEUE, EXCHANGE, 'job.trash');
      await this.s34channel.bindQueue(S34_QUEUE, EXCHANGE, 'job.route.failed');
      await this.s34channel.bindQueue(S34_QUEUE, EXCHANGE, 'job.parse.failed');

      await this.s1channel.prefetch(PREFETCH);
      await this.s2channel.prefetch(PREFETCH);
      await this.s34channel.prefetch(PREFETCH);

      await this.s1channel.consume(S1_QUEUE, (msg) => {
        if (msg) this.onMessageS1(msg);
      });
      await this.s2channel.consume(S2_QUEUE, (msg) => {
        if (msg) this.onMessageS2(msg);
      });
      await this.s34channel.consume(S34_QUEUE, (msg) => {
        if (msg) this.onMessageS3S4(msg);
      });

      this.evictTimer = setInterval(() => this.evictStaleDeferred(), 5000);
      this.connected = true;
      logger.info('[RMQReader] Connected, 3 consumers active');
    } catch (err) {
      logger.error('[RMQReader] Connection failed', { error: String(err) });
      this.connected = false;
    }
  }

  disconnect(): void {
    this.stopped = true;
    this.connected = false;
    if (this.evictTimer) clearInterval(this.evictTimer);
    this.nackAllPending();
    [this.s1channel, this.s2channel, this.s34channel].forEach((ch) => {
      if (ch) ch.close().catch(() => {});
    });
    if (this.connection) {
      this.connection.close().catch(() => {});
      this.connection = null;
    }
  }

  start(_url?: string): void {
    if (!this.connected) {
      this.connect().catch((err) => logger.error('[RMQReader] start failed', { error: String(err) }));
    }
  }

  stop(): void { this.disconnect(); }

  nextJob(): Job | null {
    if (this.pendingJobs.length === 0) return null;
    const pending = this.pendingJobs.shift()!;
    this.currentJobId = pending.id;
    return pending.job as unknown as Job;
  }

  peekNextJob(): Job | null {
    return (this.pendingJobs[0]?.job as unknown as Job) ?? null;
  }

  setQueueMode(mode: boolean): void {
    this.queueMode = mode;
  }

  private onMessageS1(msg: ConsumeMessage): void {
    try {
      const payload = JSON.parse(msg.content.toString()) as Record<string, unknown>;
      const id = (payload._id ?? payload.jobLifecycleId) as string;
      if (!id) { this.s1channel!.ack(msg); return; }

      this.deliveryTagsS1.set(id, (this.deliveryTagsS1.get(id) ?? []).concat(msg.fields.deliveryTag));

      this.drainDeferredS2(id);

      pendingLoop:
      if (!this.pendingJobs.some((p) => p.id === id)) {
        for (const p of this.pendingJobs) {
          if (p.id === id) break pendingLoop;
        }
        this.pendingJobs.push({ id, job: payload, stage: 'PARTIAL' });
      }

      this.emit('job.generated', payload);
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

      this.deliveryTagsS2.set(id, (this.deliveryTagsS2.get(id) ?? []).concat(msg.fields.deliveryTag));

      const existingIdx = this.pendingJobs.findIndex((p) => p.id === id);
      if (existingIdx !== -1) {
        this.pendingJobs[existingIdx] = {
          ...this.pendingJobs[existingIdx],
          job: { ...this.pendingJobs[existingIdx].job, ...payload },
          stage: 'FULL_PARSED',
        };
        this.emit('job.parse.completed', this.pendingJobs[existingIdx].job);
      } else if (this.currentJobId === id) {
        this.emit('job.parse.completed', payload);
      } else if (!this.queueMode) {
        this.ackOrphanedTags(id, 'S2');
        this.pendingJobs.push({ id, job: payload, stage: 'FULL_PARSED' });
        this.emit('job.parse.completed', payload);
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

        const routingKey = msg.fields.routingKey;
        if (routingKey === 'job.queue') {
          this.emit('job.route.queued', payload);
        } else if (routingKey === 'job.trash') {
          this.emit('job.route.trashed', payload);
        } else if (routingKey === 'job.parse.failed' || routingKey === 'job.route.failed') {
          this.emit('job.parse.failed', payload);
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

  private ackOrphanedTags(id: string, source: string): void {
    const map = source === 'S1' ? this.deliveryTagsS1 : this.deliveryTagsS2;
    const channel = source === 'S1' ? this.s1channel : this.s2channel;
    const tags = map.get(id);
    if (tags && channel) {
      for (const tag of tags) {
        channel.ack({ fields: { deliveryTag: tag } } as ConsumeMessage, false);
      }
      map.delete(id);
    }
  }

  private autoAdvance(): void {
    if (!this.queueMode) return;
    if (this.currentJobId) return; // already displaying one
    if (this.pendingJobs.length === 0) return;
    this.currentJobId = this.pendingJobs[0]!.id;
    this.emit('auto-advance', { job: this.pendingJobs[0]!.job });
  }

  private removeFromPending(id: string): void {
    this.pendingJobs = this.pendingJobs.filter((p) => p.id !== id);
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

    this.emit('job.parse.completed', entry.payload);
  }

  private evictStaleDeferred(): void {
    const now = Date.now();
    for (const [id, entry] of this.deferredS2Buffer) {
      if (now - entry.timestamp > DEFERRED_S2_TTL) {
        logger.warn('[RMQReader] Evicting stale deferred S2', { id });
        this.ackOrphanedTags(id, 'S2');
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
