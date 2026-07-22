import { vi } from 'vitest';
import type { MongoClient } from 'mongodb';

import { MongoJobQueue } from '../../src/infrastructure/outbound/persistence/job-queue-adapter.js';

describe('MongoJobQueue enqueue dedup', () => {
  const makeQueue = () => {
    const collection = {
      createIndex: vi.fn(async () => 'messageId_1'),
      updateOne: vi.fn(async () => ({ upsertedCount: 0, upsertedId: null as string | null })),
      insertOne: vi.fn(async () => ({ insertedId: 'inserted-1' })),
    };

    const db = {
      collection: vi.fn().mockReturnValue(collection),
    };

    const client = {
      db: vi.fn().mockReturnValue(db),
    };

    const queue = new MongoJobQueue(client as unknown as MongoClient);
    return { queue, client, db, collection };
  };

  it('upserts by messageId and ensures indexes only once', async () => {
    const { queue, collection } = makeQueue();
    collection.updateOne.mockResolvedValueOnce({ upsertedCount: 1, upsertedId: 'id-1' });

    await queue.enqueue({ messageId: 'msg-1', position: 'Engineer' });
    await queue.enqueue({ messageId: 'msg-1', position: 'Engineer' });

    expect(collection.createIndex).toHaveBeenCalledTimes(1);
    expect(collection.updateOne).toHaveBeenCalledTimes(2);
    expect(collection.updateOne).toHaveBeenCalledWith(
      { messageId: 'msg-1' },
      expect.objectContaining({
        $setOnInsert: expect.objectContaining({ messageId: 'msg-1', status: 'queued' }),
        $set: expect.objectContaining({ lastSeenAt: expect.any(Date) }),
      }),
      { upsert: true }
    );
    expect(collection.insertOne).not.toHaveBeenCalled();
  });

  it('falls back to insertOne when messageId is missing', async () => {
    const { queue, collection } = makeQueue();

    await queue.enqueue({ position: 'No Message ID' });

    expect(collection.createIndex).toHaveBeenCalledTimes(1);
    expect(collection.updateOne).not.toHaveBeenCalled();
    expect(collection.insertOne).toHaveBeenCalledTimes(1);
    expect(collection.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        position: 'No Message ID',
        status: 'queued',
        enqueuedAt: expect.any(Date),
      })
    );
  });

  it('creates the expected partial unique index for messageId dedup', async () => {
    const { queue, collection } = makeQueue();
    collection.updateOne.mockResolvedValueOnce({ upsertedCount: 0, upsertedId: null });

    await queue.enqueue({ messageId: 'msg-2', position: 'Engineer' });

    expect(collection.createIndex).toHaveBeenCalledWith(
      { messageId: 1 },
      {
        unique: true,
        partialFilterExpression: { messageId: { $type: 'string' } },
      }
    );
  });
});
