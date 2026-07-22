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

describe('processJob error handling', () => {
  let EventDrivenWebhook: typeof import('../../../src/infrastructure/inbound/web/event-webhook.js' ).EventDrivenWebhook;
  let webhook: InstanceType<typeof EventDrivenWebhook>;
  let mockGmail: any;

  beforeEach(async () => {
    mockGmail = {
      getMessage: vi.fn().mockResolvedValue({}),
      extractHeader: vi.fn().mockReturnValue('Test Subject'),
      extractBody: vi.fn().mockReturnValue('<html/>'),
      getLabelId: vi.fn().mockResolvedValue('Label_1'),
      listMessagesByLabel: vi.fn().mockResolvedValue([]),
    };

    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const mod = await import('../../../src/infrastructure/inbound/web/event-webhook.js' );
    EventDrivenWebhook = mod.EventDrivenWebhook;

    webhook = new EventDrivenWebhook(mockGmail, {
      profile: { name: 'Test User', email: 'test@example.com' } as any,
      storage: {
        connect: vi.fn(),
        disconnect: vi.fn(),
      } as any,
      noBackgroundWork: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('handles gmail service error gracefully', async () => {
    mockGmail.getMessage.mockRejectedValue(new Error('Gmail API error'));
    webhook.processJobNotification({ message: { data: Buffer.from(JSON.stringify({ messageId: 'test-1' })).toString('base64') } });
    await vi.waitFor(() => {
      expect(console.error).toHaveBeenCalled();
    }, { interval: 10, timeout: 1000 });
  });

  it('populates processedJobs after notification processing', async () => {
    const msgData = { message: { data: Buffer.from(JSON.stringify({ messageId: 'test-dedup' })).toString('base64') } };
    webhook.processJobNotification(msgData);
    await vi.waitFor(() => {
      expect(webhook['processedJobs'].has('test-dedup')).toBe(true);
    }, { interval: 10, timeout: 1000 });
  });

  it('processes direct messageId without encoded envelope', async () => {
    webhook['processedJobs'] = new Set();
    webhook.processJobNotification({ messageId: 'direct-msg' });
    await vi.waitFor(() => {
      expect(mockGmail.getMessage).toHaveBeenCalledWith('direct-msg');
    }, { interval: 10, timeout: 1000 });
  });

  it('skips already-processed direct messageId', async () => {
    webhook['processedJobs'] = new Set<string>(['already-done']);
    webhook.processJobNotification({ messageId: 'already-done' });
    await vi.waitFor(() => {
      expect(mockGmail.getMessage).not.toHaveBeenCalled();
    }, { interval: 10, timeout: 1000 });
  });
});
