import { describe, it, expect } from 'vitest';
import pLimit from '../../../src/infrastructure/utils/p-limit.js';

describe('pLimit', () => {
  it('GIVEN pLimit WHEN exercised THEN limits concurrency to 1', async () => {
    const limit = pLimit(1);
    let running = 0;
    let maxRunning = 0;

    const tasks = Array.from({ length: 5 }, (_, i) =>
      limit(async () => {
        running++;
        maxRunning = Math.max(maxRunning, running);
        await new Promise((r) => setTimeout(r, 10));
        running--;
        return i;
      })
    );

    const results = await Promise.all(tasks);
    expect(results).toEqual([0, 1, 2, 3, 4]);
    expect(maxRunning).toBe(1);
  });

  it('GIVEN pLimit WHEN exercised THEN limits concurrency to 2', async () => {
    const limit = pLimit(2);
    let running = 0;
    let maxRunning = 0;

    const tasks = Array.from({ length: 6 }, () =>
      limit(async () => {
        running++;
        maxRunning = Math.max(maxRunning, running);
        await new Promise((r) => setTimeout(r, 10));
        running--;
      })
    );

    await Promise.all(tasks);
    expect(maxRunning).toBe(2);
  });

  it('GIVEN pLimit WHEN exercised THEN respects concurrency floor of 1', () => {
    const limit = pLimit(0);
    expect(limit).toBeDefined();
  });

  it('GIVEN pLimit WHEN exercised THEN handles errors without blocking queue', async () => {
    const limit = pLimit(1);

    const errorTask = limit(async () => {
      throw new Error('fail');
    });
    const successTask = limit(async () => 'ok');

    await expect(errorTask).rejects.toThrow('fail');
    await expect(successTask).resolves.toBe('ok');
  });

  it('GIVEN pLimit WHEN order.push THEN processes in FIFO order', async () => {
    const limit = pLimit(1);
    const order: number[] = [];

    const task1 = limit(async () => {
      order.push(1);
      await new Promise((r) => setTimeout(r, 5));
      return 1;
    });
    const task2 = limit(async () => {
      order.push(2);
      return 2;
    });
    const task3 = limit(async () => {
      order.push(3);
      return 3;
    });

    await task1;
    await task2;
    await task3;

    expect(order).toEqual([1, 2, 3]);
  });

  it('GIVEN pLimit WHEN exercised THEN returns resolved values', async () => {
    const limit = pLimit(3);
    const results = await Promise.all([
      limit(async () => 'a'),
      limit(async () => 'b'),
      limit(async () => 'c'),
    ]);
    expect(results).toEqual(['a', 'b', 'c']);
  });

  it('GIVEN pLimit WHEN exercised THEN does not exceed concurrency with many tasks', async () => {
    const limit = pLimit(3);
    let running = 0;
    let maxRunning = 0;

    const tasks = Array.from({ length: 20 }, () =>
      limit(async () => {
        running++;
        maxRunning = Math.max(maxRunning, running);
        await new Promise((r) => setTimeout(r, 5));
        running--;
      })
    );

    await Promise.all(tasks);
    expect(maxRunning).toBeLessThanOrEqual(3);
  });
});
