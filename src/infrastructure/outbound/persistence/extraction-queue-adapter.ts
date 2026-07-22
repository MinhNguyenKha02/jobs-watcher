import { Collection } from 'mongodb';
import { ExtractionQueueDocument } from '../../../domain/types/extraction-queue.js';
import type { ExtractionQueuePort } from '../../../application/ports/extraction-queue.port.js';

export class MongoExtractionQueueAdapter implements ExtractionQueuePort {
  private _onEnqueue: (() => void) | null = null;

  constructor(private collection: Collection<ExtractionQueueDocument>) {}

  onEnqueue(cb: () => void): void {
    this._onEnqueue = cb;
  }

  async enqueue(jobLifecycleId: string): Promise<void> {
    await this.collection.updateOne(
      { _id: jobLifecycleId },
      { $setOnInsert: { _id: jobLifecycleId, jobLifecycleId, createdAt: new Date() } },
      { upsert: true },
    );
    this._onEnqueue?.();
  }

  async dequeue(): Promise<ExtractionQueueDocument | null> {
    const doc = await this.collection.findOneAndDelete(
      {},
      { sort: { createdAt: 1 } },
    );
    return doc;
  }

  async size(): Promise<number> {
    return this.collection.countDocuments();
  }
}
