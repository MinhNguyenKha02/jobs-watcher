import { describe, it, expect, vi, beforeEach } from 'vitest';

let lruInstance: any;
vi.mock('lru-cache', () => {
  const LRUCache = vi.fn();
  lruInstance = {
    set: vi.fn(),
    get: vi.fn(),
    has: vi.fn(),
    delete: vi.fn(),
    clear: vi.fn(),
    entries: vi.fn(() => []),
    size: 0,
  };
  LRUCache.mockImplementation(() => lruInstance);
  return { default: LRUCache };
});

vi.mock('mongodb', () => ({ MongoClient: vi.fn() }));
vi.mock('express', () => ({ default: vi.fn(() => ({ use: vi.fn(), get: vi.fn() })) }));
vi.mock('../../../src/services/logger.js', () => ({ getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) }));
vi.mock('../../../src/services/queue-metrics.js', () => ({ metrics: { getMetrics: vi.fn() } }));
vi.mock('../../../src/config.js', () => ({ config: { mongodb: { uri: '', dbName: '' }, sse: { eventBufferMax: 100, replayLimit: 50 } } }));

const { isSignalEvent, determineEventType, bufferEvent, getBufferedEvents } = await import('../../../src/infrastructure/outbound/sse-server.js' );

describe('isSignalEvent', () => {
  it('returns false for null/undefined', () => {
    expect(isSignalEvent(null)).toBe(false);
    expect(isSignalEvent(undefined)).toBe(false);
  });

  it('returns true for job.generated', () => {
    expect(isSignalEvent('job.generated')).toBe(true);
  });

  it('returns true for job.parse.completed', () => {
    expect(isSignalEvent('job.parse.completed')).toBe(true);
  });

  it('returns true for job.parse.failed', () => {
    expect(isSignalEvent('job.parse.failed')).toBe(true);
  });

  it('returns true for job.route.queued', () => {
    expect(isSignalEvent('job.route.queued')).toBe(true);
  });

  it('returns true for job.route.trashed', () => {
    expect(isSignalEvent('job.route.trashed')).toBe(true);
  });

  it('returns true for job.route.failed', () => {
    expect(isSignalEvent('job.route.failed')).toBe(true);
  });

  it('returns false for job.generated.failed (capture-only)', () => {
    expect(isSignalEvent('job.generated.failed')).toBe(false);
  });

  it('returns false for browser.auto.failure', () => {
    expect(isSignalEvent('browser.auto.failure')).toBe(false);
  });

  it('returns false for browser.auto.success', () => {
    expect(isSignalEvent('browser.auto.success')).toBe(false);
  });

  it('returns false for unrelated event names', () => {
    expect(isSignalEvent('email.parse.started')).toBe(false);
    expect(isSignalEvent('job.parse.started')).toBe(false);
    expect(isSignalEvent('')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(isSignalEvent('JOB.GENERATED')).toBe(true);
    expect(isSignalEvent('Job.Parse.Completed')).toBe(true);
  });
});

describe('determineEventType', () => {
  it('returns null for null/undefined', () => {
    expect(determineEventType(undefined)).toBeNull();
  });

  it('returns job.generated for job.generated action', () => {
    expect(determineEventType('job.generated')).toBe('job.generated');
  });

  it('returns job.parse.completed for job.parse.completed action', () => {
    expect(determineEventType('job.parse.completed')).toBe('job.parse.completed');
  });

  it('returns job.parse.failed for job.parse.failed action', () => {
    expect(determineEventType('job.parse.failed')).toBe('job.parse.failed');
  });

  it('returns job.route.queued for job.route.queued action', () => {
    expect(determineEventType('job.route.queued')).toBe('job.route.queued');
  });

  it('returns job.route.trashed for job.route.trashed action', () => {
    expect(determineEventType('job.route.trashed')).toBe('job.route.trashed');
  });

  it('returns job.route.failed for job.route.failed action', () => {
    expect(determineEventType('job.route.failed')).toBe('job.route.failed');
  });

  it('returns null for capture-only events', () => {
    expect(determineEventType('job.generated.failed')).toBeNull();
    expect(determineEventType('browser.auto.failure')).toBeNull();
    expect(determineEventType('browser.auto.success')).toBeNull();
  });

  it('returns null for unknown action', () => {
    expect(determineEventType('random.action')).toBeNull();
  });
});

describe('bufferEvent / getBufferedEvents', () => {
  beforeEach(() => {
    lruInstance.entries.mockReturnValue([]);
    lruInstance.size = 0;
    lruInstance.set.mockClear();
  });

  it('bufferEvent stores payload to LRU', () => {
    bufferEvent({ joblifecycleId: 'job-1', action: 'job.generated' });

    expect(lruInstance.set).toHaveBeenCalledOnce();
    const key = lruInstance.set.mock.calls[0][0];
    expect(key).toContain('job-1');
    expect(key).toContain('job.generated');
  });

  it('getBufferedEvents collects all entries from LRU', () => {
    lruInstance.entries.mockReturnValue([
      ['key1', { joblifecycleId: 'job-1' }],
      ['key2', { joblifecycleId: 'job-2' }],
    ]);

    const events = getBufferedEvents();
    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({ joblifecycleId: 'job-1' });
    expect(events[1]).toEqual({ joblifecycleId: 'job-2' });
  });

  it('getBufferedEvents returns empty when cache is empty', () => {
    expect(getBufferedEvents()).toEqual([]);
  });
});
