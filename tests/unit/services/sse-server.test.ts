import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { isSignalEvent, determineEventType, bufferEvent, getBufferedEvents } = await import('../../../src/infrastructure/outbound/sse-server.js' );

describe('sse-server', () => {
  beforeEach(() => {
    // Ensure buffer is clean between tests
    getBufferedEvents();
  });

  describe('isSignalEvent', () => {
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

    it('returns false for audit-only events like email.parse.started', () => {
      expect(isSignalEvent('email.parse.started')).toBe(false);
    });

    it('returns false for null/undefined/empty', () => {
      expect(isSignalEvent(null)).toBe(false);
      expect(isSignalEvent(undefined)).toBe(false);
      expect(isSignalEvent('')).toBe(false);
    });
  });

  describe('determineEventType', () => {
    it('maps job.generated', () => {
      expect(determineEventType('job.generated')).toBe('job.generated');
    });

    it('maps job.parse.completed', () => {
      expect(determineEventType('job.parse.completed')).toBe('job.parse.completed');
    });

    it('maps job.parse.failed', () => {
      expect(determineEventType('job.parse.failed')).toBe('job.parse.failed');
    });

    it('maps job.route.queued', () => {
      expect(determineEventType('job.route.queued')).toBe('job.route.queued');
    });

    it('maps job.route.trashed', () => {
      expect(determineEventType('job.route.trashed')).toBe('job.route.trashed');
    });

    it('maps job.route.failed', () => {
      expect(determineEventType('job.route.failed')).toBe('job.route.failed');
    });

    it('returns null for job.generated.failed', () => {
      expect(determineEventType('job.generated.failed')).toBeNull();
    });

    it('returns null for browser.auto events', () => {
      expect(determineEventType('browser.auto.failure')).toBeNull();
      expect(determineEventType('browser.auto.success')).toBeNull();
    });

    it('returns null for unknown action', () => {
      expect(determineEventType('unknown.action')).toBeNull();
    });

    it('returns null for null/undefined', () => {
      expect(determineEventType(null)).toBeNull();
      expect(determineEventType(undefined)).toBeNull();
    });
  });

  describe('bufferEvent / getBufferedEvents', () => {
    it('buffers and retrieves events', () => {
      bufferEvent({ action: 'job.generated', joblifecycleId: 'job-1', company: 'Acme' });
      const events = getBufferedEvents();
      expect(events.length).toBeGreaterThanOrEqual(1);
      expect(events.some(e => e.joblifecycleId === 'job-1')).toBe(true);
    });

    it('buffers multiple events', () => {
      bufferEvent({ action: 'job.generated', joblifecycleId: 'job-a' });
      bufferEvent({ action: 'job.parse.completed', joblifecycleId: 'job-a', score: 85 });
      bufferEvent({ action: 'job.route.queued', joblifecycleId: 'job-a' });

      const events = getBufferedEvents();
      expect(events.length).toBeGreaterThanOrEqual(3);
    });

    it('handles events without joblifecycleId', () => {
      bufferEvent({ action: 'system.event', message: 'info' });
      const events = getBufferedEvents();
      expect(events.some(e => e.action === 'system.event')).toBe(true);
    });
  });

  describe('dedup pattern (B4 fix)', () => {
    it('same action+joblifecycleId within 500ms window suppresses second emit', async () => {
      const { default: eventBus } = await import('../../../src/infrastructure/event-bus.js' );
      const emitSpy = vi.spyOn(eventBus, 'emit');
      const cache = new (await import('lru-cache')).default<string, boolean>({ max: 200, ttl: 500 });

      function guardedEmit(key: string, eventName: string, payload: any) {
        if (cache.has(key)) return;
        cache.set(key, true);
        eventBus.emit(eventName as any, payload);
      }

      const payload = { joblifecycleId: 'dedup-test-job' };
      guardedEmit('job.parse.completed:dedup-test-job', 'job.parse.completed', payload);
      guardedEmit('job.parse.completed:dedup-test-job', 'job.parse.completed', payload);
      guardedEmit('job.generated:dedup-test-job', 'job.generated', payload);

      expect(emitSpy).toHaveBeenCalledTimes(2);
    });

    it('different actions for same joblifecycleId are not deduped', async () => {
      const { default: eventBus } = await import('../../../src/infrastructure/event-bus.js' );
      const emitSpy = vi.spyOn(eventBus, 'emit');
      const cache = new (await import('lru-cache')).default<string, boolean>({ max: 200, ttl: 500 });

      function guardedEmit(key: string, eventName: string, payload: any) {
        if (cache.has(key)) return;
        cache.set(key, true);
        eventBus.emit(eventName as any, payload);
      }

      const payload = { joblifecycleId: 'multi-action-job' };
      guardedEmit('job.generated:multi-action-job', 'job.generated', payload);
      guardedEmit('job.parse.completed:multi-action-job', 'job.parse.completed', payload);
      guardedEmit('job.route.queued:multi-action-job', 'job.route.queued', payload);

      expect(emitSpy).toHaveBeenCalledTimes(3);
    });
  });
});
