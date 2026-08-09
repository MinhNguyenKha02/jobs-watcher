import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { MongoExtractionQueueAdapter } from '../../../../src/infrastructure/outbound/persistence/mongo-extraction-queue-adapter.js';
import { MetricsRegistry } from '../../../../src/infrastructure/outbound/monitoring/metrics-registry.js';
import { Registry } from 'prom-client';
import { createTestContainer, type TestContainer } from '../../../helpers/test-container.js';

describe('ExtractionQueue storage (Mongo FIFO, mongodb-memory-server)', () => {
  let tc: TestContainer;
  let queue: MongoExtractionQueueAdapter;

  beforeAll(async () => {
    tc = await createTestContainer({ ns: 'extraction-queue' });
    await tc.start();
    queue = tc.extractionQueueAdapter;
  }, 120000);

  afterAll(async () => {
    await tc.stop();
  });

  it('dequeues in FIFO order and returns the persisted identity per job', async () => {
    await queue.enqueue('job-a');
    await queue.enqueue('job-b');
    await queue.enqueue('job-c');

    expect((await queue.dequeue())?._id).toBe('job-a');
    expect((await queue.dequeue())?._id).toBe('job-b');
    expect((await queue.dequeue())?._id).toBe('job-c');
    expect(await queue.size()).toBe(0);
  });

  it('re-enqueuing the same job lifecycle id is idempotent (no duplicate rows, size stable)', async () => {
    await queue.enqueue('job-idem');
    await queue.enqueue('job-idem');

    expect(await queue.size()).toBe(1);
    expect((await queue.dequeue())?._id).toBe('job-idem');
    expect(await queue.size()).toBe(0);
  });

  it('dequeue on an empty queue returns null without error', async () => {
    expect(await queue.dequeue()).toBeNull();
  });

  it('onEnqueue callback fires for every enqueue, including idempotent re-enqueue', async () => {
    const cb = vi.fn();
    queue.onEnqueue(cb);

    await queue.enqueue('job-cb-1');
    await queue.enqueue('job-cb-1');
    await queue.enqueue('job-cb-2');

    expect(cb).toHaveBeenCalledTimes(3);
    queue.onEnqueue(() => undefined);
    await queue.dequeue();
    await queue.dequeue();
  });
});