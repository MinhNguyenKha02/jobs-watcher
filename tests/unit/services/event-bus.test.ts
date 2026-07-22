import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { eventBus } = await import('../../../src/infrastructure/event-bus.js' );

describe('EventBus', () => {
  beforeEach(() => {
    eventBus.removeAllListeners();
  });

  describe('event routing', () => {
    it('delivers job.generated events to registered listeners', () => {
      const handler = vi.fn();
      eventBus.on('job.generated', handler);
      const payload = { joblifecycleId: 'job-1', timestamp: new Date().toISOString() };
      eventBus.emit('job.generated', payload);
      expect(handler).toHaveBeenCalledWith(payload);
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('delivers job.parse.completed events', () => {
      const handler = vi.fn();
      eventBus.on('job.parse.completed', handler);
      const payload = { joblifecycleId: 'job-1', timestamp: new Date().toISOString(), matchScore: 85 };
      eventBus.emit('job.parse.completed', payload);
      expect(handler).toHaveBeenCalledWith(payload);
    });

    it('delivers job.parse.failed events', () => {
      const handler = vi.fn();
      eventBus.on('job.parse.failed', handler);
      const payload = { joblifecycleId: 'job-1', timestamp: new Date().toISOString(), error: 'parse error' };
      eventBus.emit('job.parse.failed', payload);
      expect(handler).toHaveBeenCalledWith(payload);
    });

    it('delivers job.route.queued events', () => {
      const handler = vi.fn();
      eventBus.on('job.route.queued', handler);
      const payload = { joblifecycleId: 'job-1', timestamp: new Date().toISOString() };
      eventBus.emit('job.route.queued', payload);
      expect(handler).toHaveBeenCalledWith(payload);
    });

    it('delivers job.route.trashed events', () => {
      const handler = vi.fn();
      eventBus.on('job.route.trashed', handler);
      const payload = { joblifecycleId: 'job-1', timestamp: new Date().toISOString(), reason: 'not interested' };
      eventBus.emit('job.route.trashed', payload);
      expect(handler).toHaveBeenCalledWith(payload);
    });

    it('delivers job.route.failed events', () => {
      const handler = vi.fn();
      eventBus.on('job.route.failed', handler);
      const payload = { joblifecycleId: 'job-1', timestamp: new Date().toISOString(), error: 'DB timeout' };
      eventBus.emit('job.route.failed', payload);
      expect(handler).toHaveBeenCalledWith(payload);
    });

    it('delivers job.processed events', () => {
      const handler = vi.fn();
      eventBus.on('job.processed', handler);
      const payload = { joblifecycleId: 'job-1', timestamp: new Date().toISOString(), tookMs: 150 };
      eventBus.emit('job.processed', payload);
      expect(handler).toHaveBeenCalledWith(payload);
    });
  });

  describe('listener lifecycle', () => {
    it('supports multiple listeners for same event', () => {
      const h1 = vi.fn();
      const h2 = vi.fn();
      eventBus.on('job.generated', h1);
      eventBus.on('job.generated', h2);
      eventBus.emit('job.generated', { joblifecycleId: 'j1', timestamp: new Date().toISOString() });
      expect(h1).toHaveBeenCalledTimes(1);
      expect(h2).toHaveBeenCalledTimes(1);
    });

    it('removes listeners with removeListener', () => {
      const handler = vi.fn();
      eventBus.on('job.generated', handler);
      eventBus.removeListener('job.generated', handler);
      eventBus.emit('job.generated', { joblifecycleId: 'j1', timestamp: new Date().toISOString() });
      expect(handler).not.toHaveBeenCalled();
    });

    it('calling removeListener for non-existent listener does not throw', () => {
      const handler = vi.fn();
      expect(() => eventBus.removeListener('job.route.failed', handler)).not.toThrow();
    });

    it('emitting with no listeners does not throw', () => {
      expect(() => {
        eventBus.emit('job.generated', { joblifecycleId: 'j1', timestamp: new Date().toISOString() });
      }).not.toThrow();
    });
  });

  describe('error isolation', () => {
    it('one listener error does not affect other listeners', () => {
      const throwing = vi.fn(() => { throw new Error('listener error'); });
      const ok = vi.fn();
      eventBus.on('job.generated', throwing);
      eventBus.on('job.generated', ok);

      expect(() => {
        eventBus.emit('job.generated', { joblifecycleId: 'j1', timestamp: new Date().toISOString() });
      }).toThrow('listener error');

      expect(throwing).toHaveBeenCalledTimes(1);
      expect(ok).not.toHaveBeenCalled();
    });
  });

  describe('payload shape', () => {
    it('includes optional tookMs field', () => {
      const handler = vi.fn();
      eventBus.on('job.processed', handler);
      const payload = { joblifecycleId: 'j1', timestamp: new Date().toISOString(), tookMs: 250 };
      eventBus.emit('job.processed', payload);
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({ tookMs: 250 }));
    });

    it('includes optional manifestPath field', () => {
      const handler = vi.fn();
      eventBus.on('job.generated', handler);
      const payload = { joblifecycleId: 'j1', timestamp: new Date().toISOString(), manifestPath: '/tmp/manifest.json' };
      eventBus.emit('job.generated', payload);
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({ manifestPath: '/tmp/manifest.json' }));
    });
  });

  describe('singleton instance', () => {
    it('is a singleton', async () => {
      const { eventBus: bus2 } = await import('../../../src/infrastructure/event-bus.js' );
      expect(bus2).toBe(eventBus);
    });
  });
});
