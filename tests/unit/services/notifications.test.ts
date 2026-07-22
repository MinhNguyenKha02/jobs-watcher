import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execSync } from 'child_process';

const mockLogger = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };

vi.mock('../../../src/services/logger.js', () => ({
  getLogger: vi.fn(() => mockLogger),
}));

vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

describe('notifyUser', () => {
  let originalPlatform: string;

  beforeEach(() => {
    vi.clearAllMocks();
    originalPlatform = process.platform;
    globalThis.__notifyLastSent = {};
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it('sends Linux notification via notify-send', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    const { notifyUser } = await import('../../../src/infrastructure/outbound/notifications.js' );

    await notifyUser({ title: 'Test', message: 'Hello', urgency: 'normal', id: 42 });

    expect(execSync).toHaveBeenCalledWith(
      expect.stringContaining('notify-send'),
      { stdio: 'ignore' },
    );
    expect(execSync).toHaveBeenCalledWith(
      expect.stringContaining('-r 42'),
      expect.any(Object),
    );
    expect(execSync).toHaveBeenCalledWith(
      expect.stringContaining('--urgency=normal'),
      expect.any(Object),
    );
  });

  it('sends macOS notification via osascript', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    const { notifyUser } = await import('../../../src/infrastructure/outbound/notifications.js' );

    await notifyUser({ title: 'Test', message: 'Hello' });

    expect(execSync).toHaveBeenCalledWith(
      expect.stringContaining('osascript'),
      { stdio: 'ignore' },
    );
  });

  it('skips notification on Windows (no-op)', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    const { notifyUser } = await import('../../../src/infrastructure/outbound/notifications.js' );

    await notifyUser({ title: 'Test', message: 'Hello' });

    expect(execSync).not.toHaveBeenCalled();
  });

  it('rate-limits by id within 1 second', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    const { notifyUser } = await import('../../../src/infrastructure/outbound/notifications.js' );

    await notifyUser({ title: 'Alert', message: 'First', id: 2001 });
    await notifyUser({ title: 'Alert', message: 'Second', id: 2001 });

    expect(execSync).toHaveBeenCalledTimes(1);
  });

  it('rate-limits by title when no id', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    const { notifyUser } = await import('../../../src/infrastructure/outbound/notifications.js' );

    await notifyUser({ title: 'Dupe', message: 'First' });
    await notifyUser({ title: 'Dupe', message: 'Second' });

    expect(execSync).toHaveBeenCalledTimes(1);
  });

  it('allows different ids through rate limiter', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    const { notifyUser } = await import('../../../src/infrastructure/outbound/notifications.js' );

    await notifyUser({ title: 'A', message: 'First', id: 1 });
    await notifyUser({ title: 'B', message: 'Second', id: 2 });

    expect(execSync).toHaveBeenCalledTimes(2);
  });

  it('handles notification system failure gracefully', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    vi.mocked(execSync).mockImplementation(() => { throw new Error('notify-send not found'); });
    const { notifyUser } = await import('../../../src/infrastructure/outbound/notifications.js' );

    await expect(notifyUser({ title: 'Fail', message: 'Oops' })).resolves.not.toThrow();
    expect(mockLogger.debug).toHaveBeenCalledWith(
      'Notification not sent (system not available)',
      expect.any(Object),
    );
  });

  it('uses high urgency for critical notifications', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    const { notifyUser } = await import('../../../src/infrastructure/outbound/notifications.js' );

    await notifyUser({ title: 'Critical', message: 'OOM', urgency: 'high' });

    expect(execSync).toHaveBeenCalledWith(
      expect.stringContaining('--urgency=high'),
      expect.any(Object),
    );
  });
});
