import amqplib, { type Channel, type ConsumeMessage } from 'amqplib';

import { ActionEvent } from '../../../domain/types/action-event.js';
import { JobStage, JobLifecycleDocument } from '../../../domain/types/job-lifecycle.js';
import type { Job } from '../../../domain/types/job.js';
import { createLogger } from '../../../infrastructure/outbound/logging/logger.js';
import type { JobEventReaderPort } from '../ports/job-event-reader.port.js';
import {
  setCurrentJob,
  clearCurrentJob,
  getCurrentJob,
  getQueueMode,
} from '../shared-tui-state.js';

const logger = createLogger('RMQReader');

const EXCHANGE = 'jobs.events';
const S1_QUEUE = 'tui.s1';
const S2_QUEUE = 'tui.s2';
const S34_QUEUE = 'tui.s3s4';
const PREFETCH = 5;
const DEFERRED_S2_MAX = 10;
const DEFERRED_S2_TTL = 30_000;

export interface RabbitMqJobReaderOptions {
  exchange?: string;
  s1Queue?: string;
  s2Queue?: string;
  s34Queue?: string;
}

interface PendingJob {
  readonly job: Partial<JobLifecycleDocument>;
  stage: JobStage.PARTIAL_PARSED | JobStage.FULL_PARSED;
}

interface S2BufferEntry {
  payload: Partial<JobLifecycleDocument>;
  deliveryTag: number;
  timestamp: number;
}

export class RabbitMqJobReader implements JobEventReaderPort {
  private s1channel: Channel | null = null;
  private s2channel: Channel | null = null;
  private s34channel: Channel | null = null;

  private pendingJobs: PendingJob[] = [];
  private currentJobId: string | null = null;
  private deliveryTagsS1 = new Map<string, number[]>();
  private deliveryTagsS2 = new Map<string, number[]>();
  private deferredS2Buffer = new Map<string, S2BufferEntry>();

  private connected = false;
  private evictTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private baseUrl: string,
    options: RabbitMqJobReaderOptions = {}
  ) {
    this.exchange = options.exchange ?? EXCHANGE;
    this.s1Queue = options.s1Queue ?? S1_QUEUE;
    this.s2Queue = options.s2Queue ?? S2_QUEUE;
    this.s34Queue = options.s34Queue ?? S34_QUEUE;
  }

  private readonly exchange: string;
  private readonly s1Queue: string;
  private readonly s2Queue: string;
  private readonly s34Queue: string;

  getQueueDepth(): number {
    return this.pendingJobs.length;
  }
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Test seam: drop ALL transient reader state so a fresh scenario starts clean.
   * Outstanding tracked deliveries are nacked with requeue=false (discarded) —
   * a tracked tag is never yet acked, so this cannot double-resolve (no 406).
   * Unacked S34 deliveries are not tracked and are acked by their own handler.
   * Channels and consumers stay alive.
   */
  resetReader(): void {
    for (const [, tags] of this.deliveryTagsS1) {
      for (const tag of tags) {
        this.s1channel?.nack({ fields: { deliveryTag: tag } } as ConsumeMessage, false, false);
      }
    }
    for (const [, tags] of this.deliveryTagsS2) {
      for (const tag of tags) {
        this.s2channel?.nack({ fields: { deliveryTag: tag } } as ConsumeMessage, false, false);
      }
    }
    this.deliveryTagsS1.clear();
    this.deliveryTagsS2.clear();
    this.deferredS2Buffer.clear();
    this.pendingJobs = [];
    if (this.currentJobId !== null) {
      this.currentJobId = null;
      clearCurrentJob();
    }
  }

  async start(): Promise<void> {
    try {
      const conn = await amqplib.connect(this.baseUrl);
      const s1 = await conn.createChannel();
      const s2 = await conn.createChannel();
      const s34 = await conn.createChannel();
      this.s1channel = s1;
      this.s2channel = s2;
      this.s34channel = s34;

      await s1.assertExchange(this.exchange, 'topic', { durable: true });
      await s1.assertQueue(this.s1Queue, { durable: true });
      await s2.assertQueue(this.s2Queue, { durable: true });
      await s34.assertQueue(this.s34Queue, { durable: true });

      await s1.bindQueue(this.s1Queue, this.exchange, ActionEvent.GENERATED);
      await s2.bindQueue(this.s2Queue, this.exchange, ActionEvent.PARSE_COMPLETED);
      await s34.bindQueue(this.s34Queue, this.exchange, ActionEvent.QUEUED);
      await s34.bindQueue(this.s34Queue, this.exchange, ActionEvent.TRASHED);
      await s34.bindQueue(this.s34Queue, this.exchange, ActionEvent.ROUTE_FAILED);
      await s34.bindQueue(this.s34Queue, this.exchange, ActionEvent.PARSE_FAILED);

      await s1.prefetch(PREFETCH);
      await s2.prefetch(PREFETCH);
      await s34.prefetch(PREFETCH);

      await s1.consume(this.s1Queue, (msg) => {
        if (msg) this.onMessageS1(msg);
      });
      await s2.consume(this.s2Queue, (msg) => {
        if (msg) this.onMessageS2(msg);
      });
      await s34.consume(this.s34Queue, (msg) => {
        if (msg) this.onMessageS3S4(msg);
      });

      this.evictTimer = setInterval(() => this.evictStaleDeferred(), 5000);
      this.connected = true;
      logger.info('Started, 3 consumers active');
    } catch (err) {
      logger.error('Start failed', { error: String(err) });
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
    logger.info('Stopped');
  }

  private getQueueMode(): boolean {
    return getQueueMode();
  }

  private onMessageS1(msg: ConsumeMessage): void {
    try {
      const payload = JSON.parse(msg.content.toString()) as Partial<JobLifecycleDocument>;
      const id = payload._id as string;
      if (!id) {
        this.s1channel!.ack(msg);
        return;
      }

      const tags = this.deliveryTagsS1.get(id) ?? [];
      tags.push(msg.fields.deliveryTag);
      this.deliveryTagsS1.set(id, tags);

      this.drainDeferredS2(id);

      if (!this.pendingJobs.some((p) => p.job._id === id)) {
        this.pendingJobs.push({ job: payload, stage: JobStage.PARTIAL_PARSED });
      }

      logger.info('job.generated', {
        id,
        company: payload.company,
        stage: JobStage.PARTIAL_PARSED,
      });
      this.autoAdvance();
    } catch (err) {
      logger.warn('C1 Error', { error: String(err) });
      this.s1channel!.nack(msg, false, true);
    }
  }

  /** Dispatches S2 by queue mode: direct ([i], no S1 array) vs queue (S1-then-S2). */
  private onMessageS2(msg: ConsumeMessage): void {
    if (this.getQueueMode() === false) {
      this.onMessageS2Direct(msg);
    } else {
      this.onMessageS2Queue(msg);
    }
  }

  /**
   * Queue-mode S2 (the browser-auto happy path / `[c]` enrichment of an S1 job).
   * Delivery tag is recorded ONLY when the message is retained (merged/displayed/deferred),
   * so a later ack/nack never references an already-resolved tag.
   */
  private onMessageS2Queue(msg: ConsumeMessage): void {
    try {
      const parsed = JSON.parse(msg.content.toString()) as Record<string, unknown>;
      const payload = (
        parsed && typeof parsed === 'object' && 'job' in parsed ? parsed.job : parsed
      ) as Partial<JobLifecycleDocument>;
      const id = payload._id as string;
      if (!id) {
        this.s2channel!.ack(msg);
        return;
      }

      const existingIdx = this.pendingJobs.findIndex((p) => p.job._id === id);
      if (existingIdx !== -1) {
        this.recordS2Tag(id, msg.fields.deliveryTag);
        this.pendingJobs[existingIdx] = {
          ...this.pendingJobs[existingIdx],
          job: { ...this.pendingJobs[existingIdx].job, ...payload },
          stage: JobStage.FULL_PARSED,
        };
        logger.info('job.parse.completed — merged in pending', { id });
        return;
      }
      if (this.currentJobId === id) {
        this.recordS2Tag(id, msg.fields.deliveryTag);
        setCurrentJob(id, { ...getCurrentJob().job, ...payload } as Job, JobStage.FULL_PARSED);
        logger.info('job.parse.completed — IPC enriched displayed job', { id });
        return;
      }
      if (this.deferredS2Buffer.size >= DEFERRED_S2_MAX) {
        logger.warn('DeferredS2Buffer full, nacking', { id });
        this.s2channel!.nack(msg, false, true);
        return;
      }
      this.recordS2Tag(id, msg.fields.deliveryTag);
      this.deferredS2Buffer.set(id, {
        payload,
        deliveryTag: msg.fields.deliveryTag,
        timestamp: Date.now(),
      });
      logger.debug('S2 deferred', { id });
    } catch (err) {
      logger.warn('C2 Error', { error: String(err) });
      this.s2channel!.nack(msg, false, true);
    }
  }

  /**
   * Direct-mode S2 ([i], no S1 array dependency): sets the current job immediately and
   * acks THIS delivery right away — nothing recorded, nothing deferred, no prefetch
   * accumulation, so the tag can never be double-resolved.
   */
  private onMessageS2Direct(msg: ConsumeMessage): void {
    try {
      const parsed = JSON.parse(msg.content.toString()) as Record<string, unknown>;
      const payload = (
        parsed && typeof parsed === 'object' && 'job' in parsed ? parsed.job : parsed
      ) as Partial<JobLifecycleDocument>;
      const id = payload._id as string;
      if (!id) {
        this.ackS2TagDirectForJob(msg);
        return;
      }
      setCurrentJob(id, payload as Job, JobStage.FULL_PARSED);
      this.currentJobId = id;
      this.ackS2TagDirectForJob(msg);
      logger.info('job.parse.completed — direct mode set', { id });
    } catch (err) {
      logger.warn('C2 Direct Error', { error: String(err) });
      this.s2channel!.nack(msg, false, true);
    }
  }

  private recordS2Tag(id: string, deliveryTag: number): void {
    const tags = this.deliveryTagsS2.get(id) ?? [];
    tags.push(deliveryTag);
    this.deliveryTagsS2.set(id, tags);
  }

  private onMessageS3S4(msg: ConsumeMessage): void {
    try {
      const parsed = JSON.parse(msg.content.toString()) as unknown;
      const id =
        parsed !== null && typeof parsed === 'object' && 'jobLifecycleId' in parsed
          ? String((parsed as { jobLifecycleId: unknown }).jobLifecycleId)
          : String(parsed);
      if (!id) {
        this.ackS3TagForJob(msg);
        return;
      }

      // Queue mode has recorded S1/S2 tags for this job; direct mode records
      // nothing, so ONLY queue mode ackS1S2. Each tag is resolved exactly once.
      if (this.getQueueMode() === true) {
        this.ackS1TagForJob(id);
        this.ackS2TagQueueForJob(id);
      }
      this.ackS3TagForJob(msg);

      this.removeFromPending(id);

      if (this.currentJobId === id) {
        this.currentJobId = null;
        clearCurrentJob();
        const routingKey = msg.fields.routingKey;
        if (routingKey === ActionEvent.QUEUED) {
          logger.info('job.queued', { id });
        } else if (routingKey === ActionEvent.TRASHED) {
          logger.info('job.trashed', { id });
        } else if (
          routingKey === ActionEvent.PARSE_FAILED ||
          routingKey === ActionEvent.ROUTE_FAILED
        ) {
          logger.info('job.failed', { id, routingKey });
        }
      }

      this.autoAdvance();
    } catch (err) {
      logger.warn('C3 Error', { error: String(err) });
      this.s34channel!.nack(msg, false, true);
    }
  }

  /** Acks every recorded S1 delivery tag for a job; direct mode never records S1 tags. */
  private ackS1TagForJob(id: string): void {
    const tags = this.deliveryTagsS1.get(id);
    if (tags && this.s1channel) {
      for (const tag of tags) {
        this.s1channel.ack({ fields: { deliveryTag: tag } } as ConsumeMessage, false);
      }
      this.deliveryTagsS1.delete(id);
    }
  }

  /** Acks every recorded queue-mode S2 delivery tag for a job. The deferred buffer is NOT touched here. */
  private ackS2TagQueueForJob(id: string): void {
    const tags = this.deliveryTagsS2.get(id);
    if (tags && this.s2channel) {
      for (const tag of tags) {
        this.s2channel.ack({ fields: { deliveryTag: tag } } as ConsumeMessage, false);
      }
      this.deliveryTagsS2.delete(id);
    }
  }

  /** Direct-mode S2 acks its own delivery immediately; nothing is recorded or deferred. */
  private ackS2TagDirectForJob(msg: ConsumeMessage): void {
    this.s2channel!.ack(msg);
  }

  /** Acks the S34 delivery itself. */
  private ackS3TagForJob(msg: ConsumeMessage): void {
    this.s34channel!.ack(msg);
  }

  private autoAdvance(): void {
    if (this.getQueueMode() === false) return;
    if (this.currentJobId !== null) return;
    if (this.pendingJobs.length === 0) return;
    const next = this.pendingJobs.shift()!;
    this.currentJobId = next.job._id as string;
    setCurrentJob(next.job._id as string, next.job as Job, next.stage);
    logger.info('Auto-advanced to next job', { id: next.job._id, stage: next.stage });
  }

  private removeFromPending(id: string): void {
    const idx = this.pendingJobs.findIndex((j) => j.job._id === id);
    if (idx !== -1) this.pendingJobs.splice(idx, 1);
  }

  private drainDeferredS2(id: string): void {
    const entry = this.deferredS2Buffer.get(id);
    if (!entry) return;
    this.deferredS2Buffer.delete(id);

    const existingIdx = this.pendingJobs.findIndex((p) => p.job._id === id);
    if (existingIdx !== -1) {
      this.pendingJobs[existingIdx] = {
        ...this.pendingJobs[existingIdx],
        job: { ...this.pendingJobs[existingIdx].job, ...entry.payload },
        stage: JobStage.FULL_PARSED,
      };
    } else {
      this.pendingJobs.push({ job: entry.payload, stage: JobStage.FULL_PARSED });
    }
    logger.info('Deferred S2 drained', { id });
  }

  private evictStaleDeferred(): void {
    const now = Date.now();
    for (const [id, entry] of this.deferredS2Buffer) {
      if (now - entry.timestamp > DEFERRED_S2_TTL) {
        const tracked = (this.deliveryTagsS2.get(id) ?? []).includes(entry.deliveryTag);
        if (tracked) {
          // Truly stale (no S1 ever arrived): drop the outstanding delivery.
          logger.warn('Evicting stale deferred S2', { id });
          this.s2channel?.nack(
            { fields: { deliveryTag: entry.deliveryTag } } as ConsumeMessage,
            false,
            false
          );
          const tags = this.deliveryTagsS2.get(id) ?? [];
          const idx = tags.indexOf(entry.deliveryTag);
          if (idx !== -1) tags.splice(idx, 1);
          if (tags.length === 0) this.deliveryTagsS2.delete(id);
        }
        // Otherwise the tag was already resolved (acked by S34): drop the stale entry silently.
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
