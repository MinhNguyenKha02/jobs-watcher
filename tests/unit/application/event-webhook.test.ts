import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('CircuitBreaker', () => {
  let CircuitBreaker: typeof import('../../../src/infrastructure/outbound/circuit-breaker.js' ).CircuitBreaker;
  let cb: InstanceType<typeof CircuitBreaker>;

  beforeEach(async () => {
    vi.useFakeTimers();
    const mod = await import('../../../src/infrastructure/outbound/circuit-breaker.js' );
    CircuitBreaker = mod.CircuitBreaker;
    cb = new CircuitBreaker();
    vi.spyOn(cb, 'failureThreshold', 'get').mockReturnValue(3);
    vi.spyOn(cb, 'successThreshold', 'get').mockReturnValue(2);
    vi.spyOn(cb, 'resetTimeMs', 'get').mockReturnValue(60000);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('executes successfully and returns result', async () => {
    const result = await cb.execute(async () => 'ok', 'test');
    expect(result).toBe('ok');
  });

  it('opens after failureThreshold failures', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('fail'));
    await expect(cb.execute(fn, 'test')).rejects.toThrow('fail');
    await expect(cb.execute(fn, 'test')).rejects.toThrow('fail');
    await expect(cb.execute(fn, 'test')).rejects.toThrow('fail');
    expect(fn).toHaveBeenCalledTimes(3);

    const result = await cb.execute(fn, 'test');
    expect(result).toBeNull();
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('closes after successThreshold consecutive successes', async () => {
    const failFn = vi.fn().mockRejectedValue(new Error('fail'));
    await expect(cb.execute(failFn, 'test')).rejects.toThrow('fail');
    await expect(cb.execute(failFn, 'test')).rejects.toThrow('fail');
    await expect(cb.execute(failFn, 'test')).rejects.toThrow('fail');
    expect(await cb.execute(failFn, 'test')).toBeNull();
    expect(failFn).toHaveBeenCalledTimes(3);

    vi.advanceTimersByTime(60001);

    const successFn = vi.fn().mockResolvedValue('ok');
    expect(await cb.execute(successFn, 'test')).toBe('ok');
    expect(await cb.execute(successFn, 'test')).toBe('ok');
    expect(await cb.execute(successFn, 'test')).toBe('ok');
    expect(successFn).toHaveBeenCalledTimes(3);
  });

  it('auto-resets after resetTimeMs passes', async () => {
    const failFn = vi.fn().mockRejectedValue(new Error('fail'));
    await expect(cb.execute(failFn, 'test')).rejects.toThrow('fail');
    await expect(cb.execute(failFn, 'test')).rejects.toThrow('fail');
    await expect(cb.execute(failFn, 'test')).rejects.toThrow('fail');
    await expect(cb.execute(failFn, 'test')).resolves.toBeNull();
    expect(failFn).toHaveBeenCalledTimes(3);

    vi.advanceTimersByTime(60001);

    const successFn = vi.fn().mockResolvedValue('ok');
    const result = await cb.execute(successFn, 'test');
    expect(result).toBe('ok');
    expect(successFn).toHaveBeenCalledTimes(1);
  });

  it('does not auto-reset before resetTimeMs elapses', async () => {
    const failFn = vi.fn().mockRejectedValue(new Error('fail'));
    await expect(cb.execute(failFn, 'test')).rejects.toThrow('fail');
    await expect(cb.execute(failFn, 'test')).rejects.toThrow('fail');
    await expect(cb.execute(failFn, 'test')).rejects.toThrow('fail');
    await expect(cb.execute(failFn, 'test')).resolves.toBeNull();
    expect(failFn).toHaveBeenCalledTimes(3);

    vi.advanceTimersByTime(59999);

    const result = await cb.execute(failFn, 'test');
    expect(result).toBeNull();
    expect(failFn).toHaveBeenCalledTimes(3);
  });
});

