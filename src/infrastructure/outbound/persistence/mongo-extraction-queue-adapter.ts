import { Collection, type Db } from 'mongodb';

import type { ExtractionQueuePort } from '../../../application/ports/extraction-queue.port.js';
import {
  ExtractionQueueDocument,
  COLLECTIONS,
} from '../../../infrastructure/outbound/persistence/schemas.js';
import { createLogger } from '../logging/logger.js';
import type { DaemonMetricsRegistry } from '../monitoring/metrics-registry.js';
import type { TraceContext } from '../monitoring/trace-context.js';

const logger = createLogger('MongoExtractionQueueAdapter');

export class MongoExtractionQueueAdapter implements ExtractionQueuePort {
  private _onEnqueue: (() => void) | null = null;
  private metricsRegistry: DaemonMetricsRegistry;

  private collection: Collection<ExtractionQueueDocument>;

  constructor(metricsRegistry: DaemonMetricsRegistry, db: Db) {
    this.collection = db.collection<ExtractionQueueDocument>(COLLECTIONS.EXTRACTION_QUEUE);
    this.metricsRegistry = metricsRegistry;
    logger.info('MongoExtractionQueueAdapter initialized', {
      collection: COLLECTIONS.EXTRACTION_QUEUE,
    });
  }

  onEnqueue(cb: () => void): void {
    this._onEnqueue = cb;
  }

  async enqueue(jobLifecycleId: string, _traceCtx?: TraceContext): Promise<void> {
    await this.collection.updateOne(
      { _id: jobLifecycleId },
      { $setOnInsert: { _id: jobLifecycleId, jobLifecycleId, createdAt: new Date() } },
      { upsert: true }
    );
    this.metricsRegistry.extractionQueueEnqueueTotal.inc();
    this._onEnqueue?.();
  }

  async dequeue(_traceCtx?: TraceContext): Promise<ExtractionQueueDocument | null> {
    const doc = await this.collection.findOneAndDelete({}, { sort: { createdAt: 1 } });
    if (doc) this.metricsRegistry.extractionQueueDequeueTotal.inc();
    return doc;
  }

  async size(): Promise<number> {
    return this.collection.countDocuments();
  }
}
