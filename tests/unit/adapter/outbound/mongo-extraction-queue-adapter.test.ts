import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MongoExtractionQueueAdapter } from '../../../../src/infrastructure/outbound/persistence/mongo-extraction-queue-adapter.js';
import { MetricsRegistry } from '../../../../src/infrastructure/outbound/monitoring/metrics-registry.js';

function createMockDb() {
  const collection = {
    updateOne: vi.fn(),
    findOneAndDelete: vi.fn(),
    countDocuments: vi.fn(),
  };
  return {
    collection: vi.fn(() => collection),
  };
}

describe('MongoExtractionQueueAdapter', () => {
  let db: ReturnType<typeof createMockDb>;
  let adapter: MongoExtractionQueueAdapter;

  beforeEach(() => {
    db = createMockDb();
    adapter = new MongoExtractionQueueAdapter(new MetricsRegistry(), db as any);
  });

  describe('enqueue', () => {
    it('upserts with $setOnInsert for a jobLifecycleId', async () => {
      const collection = db.collection();
      collection.updateOne.mockResolvedValue({ acknowledged: true } as any);

      await adapter.enqueue('job-1');

      expect(collection.updateOne).toHaveBeenCalledWith(
        { _id: 'job-1' },
        { $setOnInsert: { _id: 'job-1', jobLifecycleId: 'job-1', createdAt: expect.any(Date) } },
        { upsert: true },
      );
    });

    it('does not throw on duplicate _id (upsert is no-op)', async () => {
      const collection = db.collection();
      collection.updateOne.mockResolvedValue({ acknowledged: true } as any);

      await adapter.enqueue('job-1');
      await adapter.enqueue('job-1');

      expect(collection.updateOne).toHaveBeenCalledTimes(2);
    });
  });

  describe('dequeue', () => {
    it('returns the oldest job and removes it (FIFO)', async () => {
      const collection = db.collection();
      const doc = { _id: 'job-1', jobLifecycleId: 'job-1', createdAt: new Date('2024-01-01') };
      collection.findOneAndDelete.mockResolvedValue(doc);

      const result = await adapter.dequeue();

      expect(collection.findOneAndDelete).toHaveBeenCalledWith(
        {},
        { sort: { createdAt: 1 } },
      );
      expect(result).toEqual(doc);
    });

    it('returns null when queue is empty', async () => {
      const collection = db.collection();
      collection.findOneAndDelete.mockResolvedValue(null);

      const result = await adapter.dequeue();

      expect(result).toBeNull();
    });
  });

  describe('size', () => {
    it('returns document count', async () => {
      const collection = db.collection();
      collection.countDocuments.mockResolvedValue(5);

      const size = await adapter.size();

      expect(size).toBe(5);
      expect(collection.countDocuments).toHaveBeenCalledOnce();
    });

    it('returns 0 when collection is empty', async () => {
      const collection = db.collection();
      collection.countDocuments.mockResolvedValue(0);

      const size = await adapter.size();

      expect(size).toBe(0);
    });
  });
});
