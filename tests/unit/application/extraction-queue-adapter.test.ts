import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MongoExtractionQueueAdapter } from '../../../src/infrastructure/outbound/persistence/extraction-queue-adapter.js';
import { MetricsRegistry } from '../../../src/infrastructure/outbound/monitoring/metrics-registry.js';

function createMockCollection() {
  return {
    updateOne: vi.fn(),
    findOneAndDelete: vi.fn(),
    countDocuments: vi.fn(),
  };
}

describe('MongoExtractionQueueAdapter', () => {
  let collection: ReturnType<typeof createMockCollection>;
  let adapter: MongoExtractionQueueAdapter;

  beforeEach(() => {
    collection = createMockCollection();
    adapter = new MongoExtractionQueueAdapter(collection as any, new MetricsRegistry());
  });

  describe('enqueue', () => {
    it('upserts with $setOnInsert for a jobLifecycleId', async () => {
      collection.updateOne.mockResolvedValue({ acknowledged: true } as any);

      await adapter.enqueue('job-1');

      expect(collection.updateOne).toHaveBeenCalledWith(
        { _id: 'job-1' },
        { $setOnInsert: { _id: 'job-1', jobLifecycleId: 'job-1', createdAt: expect.any(Date) } },
        { upsert: true },
      );
    });

    it('does not throw on duplicate _id (upsert is no-op)', async () => {
      collection.updateOne.mockResolvedValue({ acknowledged: true } as any);

      await adapter.enqueue('job-1');
      await adapter.enqueue('job-1');

      expect(collection.updateOne).toHaveBeenCalledTimes(2);
    });
  });

  describe('dequeue', () => {
    it('returns the oldest job and removes it (FIFO)', async () => {
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
      collection.findOneAndDelete.mockResolvedValue(null);

      const result = await adapter.dequeue();

      expect(result).toBeNull();
    });
  });

  describe('size', () => {
    it('returns document count', async () => {
      collection.countDocuments.mockResolvedValue(5);

      const size = await adapter.size();

      expect(size).toBe(5);
      expect(collection.countDocuments).toHaveBeenCalledOnce();
    });

    it('returns 0 when collection is empty', async () => {
      collection.countDocuments.mockResolvedValue(0);

      const size = await adapter.size();

      expect(size).toBe(0);
    });
  });
});
