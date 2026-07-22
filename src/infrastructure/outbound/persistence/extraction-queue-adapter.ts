import { Collection } from 'mongodb';
import { Counter, type Registry } from 'prom-client';
import { ExtractionQueueDocument } from '../../../domain/types/extraction-queue.js';
import type { ExtractionQueuePort } from '../../../application/ports/extraction-queue.port.js';
import type { TraceContext } from '../monitoring/trace-context.js';

export interface ExtractionQueueAdapterOptions {
  register?: Registry;
}

export class MongoExtractionQueueAdapter implements ExtractionQueuePort {
  private _onEnqueue: (() => void) | null = null;
  private enqueueCounter: Counter<string>;
  private dequeueCounter: Counter<string>;

  constructor(
    private collection: Collection<ExtractionQueueDocument>,
    private options?: ExtractionQueueAdapterOptions,
  ) {
    const reg = options?.register;
    this.enqueueCounter = new Counter({
      name: 'extraction_queue_enqueue_total',
      help: 'Number of jobs enqueued to extraction queue',
      registers: reg ? [reg] : undefined,
    });
    this.dequeueCounter = new Counter({
      name: 'extraction_queue_dequeue_total',
      help: 'Number of jobs dequeued from extraction queue',
      registers: reg ? [reg] : undefined,
    });
  }

  onEnqueue(cb: () => void): void {
    this._onEnqueue = cb;
  }

  async enqueue(jobLifecycleId: string, traceCtx?: TraceContext): Promise<void> {
    await this.collection.updateOne(
      { _id: jobLifecycleId },
      { $setOnInsert: { _id: jobLifecycleId, jobLifecycleId, createdAt: new Date() } },
      { upsert: true },
    );
    this.enqueueCounter.inc();
    this._onEnqueue?.();
  }

  async dequeue(traceCtx?: TraceContext): Promise<ExtractionQueueDocument | null> {
    const doc = await this.collection.findOneAndDelete(
      {},
      { sort: { createdAt: 1 } },
    );
    if (doc) this.dequeueCounter.inc();
    return doc;
  }

  async size(): Promise<number> {
    return this.collection.countDocuments();
  }
}
