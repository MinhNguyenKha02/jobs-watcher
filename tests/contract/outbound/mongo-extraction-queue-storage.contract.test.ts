import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

import type { ExtractionQueuePort } from '../../../src/application/ports/extraction-queue.port.js';
import {
  buildTestDaemonContainer,
  type TestDaemonContainer,
} from '../../helpers/test-container.js';

describe('ExtractionQueue storage (Mongo FIFO, mongodb-memory-server)', () => {
  let daemon: TestDaemonContainer;
  let queue: ExtractionQueuePort;

  beforeAll(async () => {
    daemon = await buildTestDaemonContainer({ ns: 'extraction-queue' });
    await daemon.start();
    queue = daemon.extractQueue;
  }, 120000);

  afterAll(async () => {
    await daemon.stop();
  });

  it('GIVEN the ExtractionQueue precondition WHEN enqueue → dequeue → size on the real ExtractionQueue THEN dequeues in FIFO order and returns the persisted identity per job', async () => {
    await queue.enqueue('job-a');
    await queue.enqueue('job-b');
    await queue.enqueue('job-c');

    expect((await queue.dequeue())?._id).toBe('job-a');
    expect((await queue.dequeue())?._id).toBe('job-b');
    expect((await queue.dequeue())?._id).toBe('job-c');
    expect(await queue.size()).toBe(0);
  });

  it('GIVEN the ExtractionQueue precondition WHEN enqueue → size → dequeue on the real ExtractionQueue THEN re-enqueuing the same job lifecycle id is idempotent (no duplicate rows, size stable)', async () => {
    await queue.enqueue('job-idem');
    await queue.enqueue('job-idem');

    expect(await queue.size()).toBe(1);
    expect((await queue.dequeue())?._id).toBe('job-idem');
    expect(await queue.size()).toBe(0);
  });

  it('GIVEN the ExtractionQueue precondition WHEN dequeue on the real ExtractionQueue THEN dequeue on an empty queue returns null without error', async () => {
    expect(await queue.dequeue()).toBeNull();
  });

  it('GIVEN the ExtractionQueue precondition WHEN onEnqueue → enqueue → dequeue on the real ExtractionQueue THEN onEnqueue callback fires for every enqueue, including idempotent re-enqueue', async () => {
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
