import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CircuitBreaker } from '../../../src/infrastructure/outbound/circuit-breaker.js' ;

describe('CircuitBreaker', () => {
  let cb: CircuitBreaker;

  beforeEach(() => {
    cb = new CircuitBreaker(3, 2, 60000);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('initial state', () => {
    it('starts closed', () => {
      const state = cb.getState();
      expect(state.isOpen).toBe(false);
      expect(state.consecutiveFailures).toBe(0);
    });
  });

  describe('execute — success path', () => {
    it('returns result on success', async () => {
      const result = await cb.execute(() => Promise.resolve('ok'), 'test-op');
      expect(result).toBe('ok');
    });

    it('resets failure count after success threshold reached', async () => {
      for (let i = 0; i < 3; i++) {
        try { await cb.execute(() => Promise.reject(new Error('fail')), 'test-op'); } catch {}
      }
      expect(cb.getState().isOpen).toBe(true);

      vi.advanceTimersByTime(60001);

      await cb.execute(() => Promise.resolve('ok'), 'test-op');
      expect(cb.getState().isOpen).toBe(false);

      await cb.execute(() => Promise.resolve('ok'), 'test-op');
      expect(cb.getState().consecutiveFailures).toBe(0);
    });
  });

  describe('execute — failure path', () => {
    it('throws on failure and increments count', async () => {
      await expect(cb.execute(() => Promise.reject(new Error('fail')), 'test-op')).rejects.toThrow('fail');
      expect(cb.getState().consecutiveFailures).toBe(1);
    });

    it('opens after reaching failure threshold', async () => {
      for (let i = 0; i < 3; i++) {
        try { await cb.execute(() => Promise.reject(new Error('fail')), 'test-op'); } catch {}
      }
      expect(cb.getState().isOpen).toBe(true);
      expect(cb.getState().consecutiveFailures).toBe(3);
    });

    it('returns null when open', async () => {
      for (let i = 0; i < 3; i++) {
        try { await cb.execute(() => Promise.reject(new Error('fail')), 'test-op'); } catch {}
      }
      const result = await cb.execute(() => Promise.resolve('should-not-reach'), 'test-op');
      expect(result).toBeNull();
    });
  });

  describe('half-open recovery', () => {
    it('transitions to half-open after reset time expires', async () => {
      for (let i = 0; i < 3; i++) {
        try { await cb.execute(() => Promise.reject(new Error('fail')), 'test-op'); } catch {}
      }
      expect(cb.getState().isOpen).toBe(true);

      vi.advanceTimersByTime(60001);

      const result = await cb.execute(() => Promise.resolve('recovered'), 'test-op');
      expect(result).toBe('recovered');
      expect(cb.getState().isOpen).toBe(false);
    });

    it('stays closed after successful half-open execution', async () => {
      for (let i = 0; i < 3; i++) {
        try { await cb.execute(() => Promise.reject(new Error('fail')), 'test-op'); } catch {}
      }
      vi.advanceTimersByTime(60001);
      await cb.execute(() => Promise.resolve('ok'), 'test-op');
      await cb.execute(() => Promise.resolve('ok'), 'test-op');
      expect(cb.getState().isOpen).toBe(false);
      expect(cb.getState().consecutiveFailures).toBe(0);
    });

    it('reopens after failureThreshold failures during half-open', async () => {
      for (let i = 0; i < 3; i++) {
        try { await cb.execute(() => Promise.reject(new Error('fail')), 'test-op'); } catch {}
      }
      expect(cb.getState().isOpen).toBe(true);

      vi.advanceTimersByTime(60001);

      for (let i = 0; i < 3; i++) {
        try { await cb.execute(() => Promise.reject(new Error('fail-again')), 'test-op'); } catch {}
      }
      expect(cb.getState().isOpen).toBe(true);
      expect(cb.getState().consecutiveFailures).toBe(3);
    });
  });

  describe('getState', () => {
    it('returns openUntil when open', async () => {
      for (let i = 0; i < 3; i++) {
        try { await cb.execute(() => Promise.reject(new Error('fail')), 'test-op'); } catch {}
      }
      const state = cb.getState();
      expect(state.isOpen).toBe(true);
      expect(state.openUntil).toBeDefined();
      expect(typeof state.openUntil).toBe('string');
    });

    it('returns null openUntil when closed', () => {
      const state = cb.getState();
      expect(state.isOpen).toBe(false);
      expect(state.openUntil).toBeNull();
    });
  });

  describe('custom thresholds', () => {
    it('uses custom failure threshold', async () => {
      const custom = new CircuitBreaker(1, 1, 60000);
      try { await custom.execute(() => Promise.reject(new Error('fail')), 'test'); } catch {}
      expect(custom.getState().isOpen).toBe(true);
    });

    it('uses custom reset time', async () => {
      const fast = new CircuitBreaker(1, 1, 100);
      for (let i = 0; i < 1; i++) {
        try { await fast.execute(() => Promise.reject(new Error('fail')), 'test'); } catch {}
      }
      expect(fast.getState().isOpen).toBe(true);

      vi.advanceTimersByTime(101);
      const result = await fast.execute(() => Promise.resolve('ok'), 'test');
      expect(result).toBe('ok');
    });
  });
});
