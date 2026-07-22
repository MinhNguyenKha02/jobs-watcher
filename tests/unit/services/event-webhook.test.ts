import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CircuitBreaker } from '../../../src/infrastructure/outbound/circuit-breaker.js' ;

describe('CircuitBreaker', () => {
  let cb: CircuitBreaker;

  beforeEach(() => {
    cb = new CircuitBreaker();
  });

  describe('initial state', () => {
    it('starts closed (allows execution)', async () => {
      const result = await cb.execute(() => Promise.resolve('ok'), 'test');
      expect(result).toBe('ok');
    });
  });

  describe('failure handling', () => {
    it('opens after threshold failures', async () => {
      for (let i = 0; i < 5; i++) {
        await expect(
          cb.execute(() => Promise.reject(new Error('fail')), 'test')
        ).rejects.toThrow('fail');
      }

      const result = await cb.execute(() => Promise.resolve('should not run'), 'test');
      expect(result).toBeNull();
    });

    it('tracks consecutive failures', async () => {
      for (let i = 0; i < 5; i++) {
        await expect(
          cb.execute(() => Promise.reject(new Error('fail')), 'test')
        ).rejects.toThrow('fail');
      }

      const result = await cb.execute(() => Promise.resolve('should not run'), 'test');
      expect(result).toBeNull();
    });
  });

  describe('success recovery', () => {
    it('resets after successThreshold consecutive successes', async () => {
      cb.failureCount = 4;
      cb.successCount = 0;

      const r1 = await cb.execute(() => Promise.resolve('ok1'), 'test');
      expect(r1).toBe('ok1');

      const r2 = await cb.execute(() => Promise.resolve('ok2'), 'test');
      expect(r2).toBe('ok2');

      const r3 = await cb.execute(() => Promise.resolve('ok3'), 'test');
      expect(r3).toBe('ok3');

      await expect(
        cb.execute(() => Promise.reject(new Error('new fail')), 'test')
      ).rejects.toThrow('new fail');
    });

    it('stays open after 1 success but below threshold', async () => {
      cb.failureCount = 5;

      await expect(
        cb.execute(() => Promise.reject(new Error('fail')), 'test')
      ).rejects.toThrow('fail');

      const result = await cb.execute(() => Promise.resolve('ok1'), 'test');
      expect(result).toBeNull();
    });
  });

  describe('auto-reset after cooldown', () => {
    it('auto-resets after resetTimeMs passes', async () => {
      vi.useFakeTimers();

      for (let i = 0; i < 5; i++) {
        await expect(
          cb.execute(() => Promise.reject(new Error('fail')), 'test')
        ).rejects.toThrow('fail');
      }

      let result = await cb.execute(() => Promise.resolve('should not run'), 'test');
      expect(result).toBeNull();

      vi.advanceTimersByTime(61000);

      result = await cb.execute(() => Promise.resolve('ok after cooldown'), 'test');
      expect(result).toBe('ok after cooldown');

      vi.useRealTimers();
    });
  });

  describe('edge cases', () => {
    it('handles success after single failure', async () => {
      await expect(
        cb.execute(() => Promise.reject(new Error('fail once')), 'test')
      ).rejects.toThrow('fail once');

      const result = await cb.execute(() => Promise.resolve('recover'), 'test');
      expect(result).toBe('recover');
    });

    it('does not auto-reset before cooldown period', async () => {
      vi.useFakeTimers();

      for (let i = 0; i < 5; i++) {
        await expect(
          cb.execute(() => Promise.reject(new Error('fail')), 'test')
        ).rejects.toThrow('fail');
      }

      vi.advanceTimersByTime(59000);

      const result = await cb.execute(() => Promise.resolve('should not run'), 'test');
      expect(result).toBeNull();

      vi.useRealTimers();
    });
  });
});
