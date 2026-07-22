import type { Channel } from 'amqplib';
import { getLogger } from '../logging/logger.js';
import type { TraceContext, TraceHeaders } from '../monitoring/trace-context.js';
import { headersToTraceContext } from '../monitoring/trace-context.js';
import { createTraceContext } from '../monitoring/trace-context.js';

const logger = getLogger();

interface PendingAck {
  deliveryTag: number;
  channel: Channel;
}

interface DeferredS2Entry {
  content: unknown;
  deliveryTag: number;
  channel: Channel;
  timestamp: number;
}

const DEFERRED_S2_MAX = 10;
const DEFERRED_S2_TTL_MS = 30_000;
const EVICTOR_INTERVAL_MS = 5_000;

export class RabbitMqJobReader {
  private s1channel: Channel;
  private s2channel: Channel;
  private s34channel: Channel;

  private pendingAcks = new Map<string, PendingAck[]>();
  private deferredS2 = new Map<string, DeferredS2Entry>();
  private evictorTimer: ReturnType<typeof setInterval> | null = null;

  private onS1: ((job: unknown, trace: TraceContext) => Promise<void>) | null = null;
  private onS2: ((job: unknown, trace: TraceContext) => Promise<void>) | null = null;
  private onS3S4: ((event: unknown, trace: TraceContext) => Promise<void>) | null = null;

  constructor(
    private config: {
      s1Queue: string;
      s2Queue: string;
      s34Queue: string;
      prefetch?: number;
    }
  ) {}

  setOnS1(handler: (job: unknown, trace: TraceContext) => Promise<void>): void {
    this.onS1 = handler;
  }

  setOnS2(handler: (job: unknown, trace: TraceContext) => Promise<void>): void {
    this.onS2 = handler;
  }

  setOnS3S4(handler: (event: unknown, trace: TraceContext) => Promise<void>): void {
    this.onS3S4 = handler;
  }

  async start(s1ch: Channel, s2ch: Channel, s34ch: Channel): Promise<void> {
    this.s1channel = s1ch;
    this.s2channel = s2ch;
    this.s34channel = s34ch;

    const prefetch = this.config.prefetch ?? 5;
    await this.s1channel.prefetch(prefetch);
    await this.s2channel.prefetch(prefetch);
    await this.s34channel.prefetch(prefetch);

    await this.s1channel.consume(this.config.s1Queue, (msg) => {
      if (!msg) return;
      this.onMessageS1(msg.content, msg.properties.headers as Record<string, unknown> ?? {}, msg.fields.deliveryTag);
    });

    await this.s2channel.consume(this.config.s2Queue, (msg) => {
      if (!msg) return;
      this.onMessageS2(msg.content, msg.properties.headers as Record<string, unknown> ?? {}, msg.fields.deliveryTag);
    });

    await this.s34channel.consume(this.config.s34Queue, (msg) => {
      if (!msg) return;
      this.onMessageS3S4(msg.content, msg.properties.headers as Record<string, unknown> ?? {}, msg.fields.deliveryTag);
    });

    this.evictorTimer = setInterval(() => this.evictStaleDeferredS2(), EVICTOR_INTERVAL_MS);
  }

  async stop(): Promise<void> {
    if (this.evictorTimer) {
      clearInterval(this.evictorTimer);
      this.evictorTimer = null;
    }
    await this.s1channel.cancel('s1-consumer');
    await this.s2channel.cancel('s2-consumer');
    await this.s34channel.cancel('s34-consumer');
  }

  private parseJobId(payload: Buffer): string | null {
    try {
      const parsed = JSON.parse(payload.toString());
      return parsed?.jobLifecycleId ?? parsed?._id ?? null;
    } catch {
      return null;
    }
  }

  private async onMessageS1(content: Buffer, headers: Record<string, unknown>, deliveryTag: number): Promise<void> {
    const trace = headersToTraceContext(headers) ?? createTraceContext();
    const jobId = this.parseJobId(content);
    if (!jobId) {
      this.s1channel.nack({ deliveryTag } as any, false, false);
      return;
    }

    let job: unknown;
    try {
      job = JSON.parse(content.toString());
    } catch {
      this.s1channel.nack({ deliveryTag } as any, false, false);
      return;
    }

    if (!this.pendingAcks.has(jobId)) {
      this.pendingAcks.set(jobId, []);
    }
    this.pendingAcks.get(jobId)!.push({ deliveryTag, channel: this.s1channel });

    this.drainDeferredS2(jobId, trace);

    if (this.onS1) {
      await this.onS1(job, trace);
    }
  }

  private async onMessageS2(content: Buffer, headers: Record<string, unknown>, deliveryTag: number): Promise<void> {
    const trace = headersToTraceContext(headers) ?? createTraceContext();
    const jobId = this.parseJobId(content);
    if (!jobId) {
      this.s2channel.nack({ deliveryTag } as any, false, false);
      return;
    }

    let job: unknown;
    try {
      job = JSON.parse(content.toString());
    } catch {
      this.s2channel.nack({ deliveryTag } as any, false, false);
      return;
    }

    if (this.pendingAcks.has(jobId)) {
      this.pendingAcks.get(jobId)!.push({ deliveryTag, channel: this.s2channel });
    } else {
      this.deferredS2.set(jobId, { content: job, deliveryTag, channel: this.s2channel, timestamp: Date.now() });
      if (this.deferredS2.size > DEFERRED_S2_MAX) {
        const oldest = this.findOldestDeferredS2();
        if (oldest) {
          this.deferredS2.delete(oldest[0]);
          oldest[1].channel.nack({ deliveryTag: oldest[1].deliveryTag } as any, false, true);
        }
      }
      return;
    }

    if (this.onS2) {
      await this.onS2(job, trace);
    }
  }

  private async onMessageS3S4(content: Buffer, headers: Record<string, unknown>, deliveryTag: number): Promise<void> {
    const trace = headersToTraceContext(headers) ?? createTraceContext();

    let event: unknown;
    try {
      event = JSON.parse(content.toString());
    } catch {
      this.s34channel.nack({ deliveryTag } as any, false, false);
      return;
    }

    this.s34channel.ack({ deliveryTag } as any);

    if (this.onS3S4) {
      await this.onS3S4(event, trace);
    }
  }

  drainDeferredS2(jobId: string, _trace: TraceContext): void {
    const deferred = this.deferredS2.get(jobId);
    if (!deferred) return;

    this.deferredS2.delete(jobId);

    if (!this.pendingAcks.has(jobId)) {
      this.pendingAcks.set(jobId, []);
    }
    this.pendingAcks.get(jobId)!.push({ deliveryTag: deferred.deliveryTag, channel: deferred.channel });

    if (this.onS2) {
      this.onS2(deferred.content, _trace).catch((err) => {
        logger.warn('[RabbitMqJobReader] Deferred S2 handler failed', { jobId, error: err instanceof Error ? err.message : String(err) });
      });
    }
  }

  ackAllForJob(jobId: string): void {
    const acks = this.pendingAcks.get(jobId);
    if (!acks) return;

    for (const ack of acks) {
      try {
        ack.channel.ack({ deliveryTag: ack.deliveryTag } as any);
      } catch (err) {
        logger.warn('[RabbitMqJobReader] ackAllForJob failed', { jobId, deliveryTag: ack.deliveryTag, error: err instanceof Error ? err.message : String(err) });
      }
    }
    this.pendingAcks.delete(jobId);
  }

  removeFromPending(jobId: string): void {
    this.pendingAcks.delete(jobId);
    this.deferredS2.delete(jobId);
  }

  private findOldestDeferredS2(): [string, DeferredS2Entry] | null {
    let oldest: [string, DeferredS2Entry] | null = null;
    for (const [id, entry] of this.deferredS2) {
      if (!oldest || entry.timestamp < oldest[1].timestamp) {
        oldest = [id, entry];
      }
    }
    return oldest;
  }

  private evictStaleDeferredS2(): void {
    const now = Date.now();
    for (const [id, entry] of this.deferredS2) {
      if (now - entry.timestamp > DEFERRED_S2_TTL_MS) {
        logger.warn('[RabbitMqJobReader] Evicting stale deferred S2', { jobId: id, ageMs: now - entry.timestamp });
        entry.channel.nack({ deliveryTag: entry.deliveryTag } as any, false, true);
        this.deferredS2.delete(id);
      }
    }
  }
}
