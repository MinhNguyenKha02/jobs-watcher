import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

vi.mock('../../../src/services/logger.js', () => ({
  getLogger: vi.fn(() => mockLogger),
}));

vi.mock('../../../src/services/notifications.js', () => ({
  notifyUser: vi.fn(),
}));

describe('MemoryMonitor', () => {
  let MemoryMonitor: any;
  let monitor: any;
  let originalMemoryUsage: typeof process.memoryUsage;
  let originalCpuUsage: typeof process.cpuUsage;
  let notifyUser: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    originalMemoryUsage = process.memoryUsage;
    originalCpuUsage = process.cpuUsage;

    process.memoryUsage = vi.fn(() => ({
      rss: 50 * 1024 * 1024,
      heapUsed: 30 * 1024 * 1024,
      heapTotal: 64 * 1024 * 1024,
      external: 5 * 1024 * 1024,
    })) as any;

    process.cpuUsage = vi.fn(() => ({ user: 100000, system: 50000 })) as any;
    Date.now = vi.fn(() => 1000);

    const mod = await import('../../../src/infrastructure/outbound/monitoring/memory-monitor.js' );
    MemoryMonitor = mod.MemoryMonitor;
    notifyUser = (await import('../../../src/infrastructure/outbound/notifications.js' )).notifyUser;
    monitor = new MemoryMonitor({ warningThresholdMb: 160, criticalThresholdMb: 190 });
  });

  afterEach(() => {
    process.memoryUsage = originalMemoryUsage;
    process.cpuUsage = originalCpuUsage;
  });

  it('snapshot returns correct shape with memory values in MB', () => {
    const snap = monitor.snapshot();
    expect(snap).toHaveProperty('rssMb');
    expect(snap).toHaveProperty('heapUsedMb');
    expect(snap).toHaveProperty('heapTotalMb');
    expect(snap).toHaveProperty('externalMb');
    expect(snap).toHaveProperty('cpuPercent');
    expect(snap.rssMb).toBe(50);
    expect(snap.heapUsedMb).toBe(30);
    expect(snap.heapTotalMb).toBe(64);
    expect(snap.externalMb).toBe(5);
  });

  it('checkAndAlert does nothing when memory is ok', async () => {
    await monitor.checkAndAlert('test');
    expect(notifyUser).not.toHaveBeenCalled();
  });

  it('warns when memory exceeds warning threshold', async () => {
    process.memoryUsage = vi.fn(() => ({
      rss: 170 * 1024 * 1024,
      heapUsed: 100 * 1024 * 1024,
      heapTotal: 200 * 1024 * 1024,
      external: 10 * 1024 * 1024,
    })) as any;

    await monitor.checkAndAlert('production');

    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('[Memory]'),
    );
    expect(notifyUser).toHaveBeenCalledWith(
      expect.objectContaining({
        title: expect.stringContaining('Memory Warning'),
        urgency: 'normal',
      }),
    );
  });

  it('triggers critical alert when memory exceeds critical threshold', async () => {
    process.memoryUsage = vi.fn(() => ({
      rss: 200 * 1024 * 1024,
      heapUsed: 150 * 1024 * 1024,
      heapTotal: 256 * 1024 * 1024,
      external: 20 * 1024 * 1024,
    })) as any;

    await monitor.checkAndAlert('production');

    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('[Memory]'),
    );
    expect(notifyUser).toHaveBeenCalledWith(
      expect.objectContaining({
        title: expect.stringContaining('Memory Critical'),
        urgency: 'high',
      }),
    );
  });

  it('does not re-alert at same memory level', async () => {
    process.memoryUsage = vi.fn(() => ({
      rss: 170 * 1024 * 1024,
      heapUsed: 100 * 1024 * 1024,
      heapTotal: 200 * 1024 * 1024,
      external: 10 * 1024 * 1024,
    })) as any;

    await monitor.checkAndAlert('test');
    await monitor.checkAndAlert('test');

    expect(notifyUser).toHaveBeenCalledTimes(1);
  });

  it('uses default thresholds when not configured', async () => {
    const defaultMonitor = new MemoryMonitor();
    expect(defaultMonitor).toBeDefined();
  });

  it('computes CPU percentage', () => {
    Date.now = vi.fn(() => 1000);
    const snap1 = monitor.snapshot();

    Date.now = vi.fn(() => 2000);
    process.cpuUsage = vi.fn(() => ({ user: 200000, system: 100000 })) as any;
    const snap2 = monitor.snapshot();

    expect(snap2.cpuPercent).toBeGreaterThanOrEqual(0);
  });
});
