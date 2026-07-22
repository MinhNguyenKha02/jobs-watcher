import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('QueueMetrics', () => {
  let metrics: any;

  beforeEach(async () => {
    vi.resetModules();
    vi.mock('../../../src/services/event-bus.js', () => ({
      eventBus: { emit: vi.fn() },
    }));
    const mod = await import('../../../src/infrastructure/outbound/monitoring/queue-metrics.js' );
    metrics = new mod.default();
  });

  it('getMetrics returns initial zero state', () => {
    const m = metrics.getMetrics();
    expect(m.enqueued).toBe(0);
    expect(m.dequeued).toBe(0);
    expect(m.pending).toBe(0);
    expect(m.emptyPolls).toBe(0);
    expect(m.failed).toBe(0);
    expect(m.emptyPollRatio).toBe(0);
    expect(m.signalCounts.signal1Generated).toBe(0);
    expect(m.signalCounts.signal2Completed).toBe(0);
    expect(m.signalCounts.signal2Failed).toBe(0);
    expect(m.signalCounts.signal3Queued).toBe(0);
    expect(m.signalCounts.signal3Trashed).toBe(0);
    expect(m.signalCounts.signal4Failed).toBe(0);
  });

  it('recordEnqueue increments enqueued and updates pending', () => {
    metrics.recordEnqueue();
    expect(metrics.enqueued).toBe(1);
    expect(metrics.getMetrics().pending).toBe(1);
  });

  it('recordDequeue increments dequeued and reduces pending', () => {
    metrics.recordEnqueue();
    metrics.recordEnqueue();
    metrics.recordDequeue();
    expect(metrics.dequeued).toBe(1);
    expect(metrics.getMetrics().pending).toBe(1);
  });

  it('pending is never negative', () => {
    metrics.recordDequeue();
    metrics.recordDequeue();
    expect(metrics.getMetrics().pending).toBe(0);
  });

  it('recordEmptyPoll increments emptyPolls', () => {
    metrics.recordEmptyPoll();
    metrics.recordEmptyPoll();
    expect(metrics.emptyPolls).toBe(2);
  });

  it('recordFailure increments failed', () => {
    metrics.recordFailure();
    expect(metrics.failed).toBe(1);
  });

  it('recordSignal1Generated increments signal count', () => {
    metrics.recordSignal1Generated();
    expect(metrics.signal1Generated).toBe(1);
    expect(metrics.getMetrics().signalCounts.signal1Generated).toBe(1);
  });

  it('recordSignal2Completed increments signal count', () => {
    metrics.recordSignal2Completed();
    expect(metrics.signal2Completed).toBe(1);
  });

  it('recordSignal2Failed increments signal count', () => {
    metrics.recordSignal2Failed();
    expect(metrics.signal2Failed).toBe(1);
  });

  it('recordSignal3Queued increments signal count', () => {
    metrics.recordSignal3Queued();
    expect(metrics.signal3Queued).toBe(1);
  });

  it('recordSignal3Trashed increments signal count', () => {
    metrics.recordSignal3Trashed();
    expect(metrics.signal3Trashed).toBe(1);
  });

  it('recordSignal4Failed increments signal count', () => {
    metrics.recordSignal4Failed();
    expect(metrics.signal4Failed).toBe(1);
  });

  it('getMetrics returns snapshot, not live reference', () => {
    const m1 = metrics.getMetrics();
    metrics.recordEnqueue();
    const m2 = metrics.getMetrics();
    expect(m1.enqueued).toBe(0);
    expect(m2.enqueued).toBe(1);
    expect(m1.pending).toBe(0);
    expect(m2.pending).toBe(1);
  });

  it('emptyPollRatio is calculated correctly', () => {
    metrics.recordEmptyPoll();
    metrics.recordEmptyPoll();
    metrics.recordDequeue();
    // ratio = 2 / (1 + 2) = 0.666...
    expect(metrics.getMetrics().emptyPollRatio).toBeCloseTo(2 / 3);
  });

  it('emptyPollRatio is 0 when no polls or dequeues', () => {
    expect(metrics.getMetrics().emptyPollRatio).toBe(0);
  });

  it('all signal counters are independent', () => {
    metrics.recordSignal1Generated();
    metrics.recordSignal2Completed();
    metrics.recordSignal3Queued();
    metrics.recordSignal2Failed();
    metrics.recordSignal3Trashed();
    metrics.recordSignal4Failed();
    const m = metrics.getMetrics();
    expect(m.signalCounts.signal1Generated).toBe(1);
    expect(m.signalCounts.signal2Completed).toBe(1);
    expect(m.signalCounts.signal3Queued).toBe(1);
    expect(m.signalCounts.signal2Failed).toBe(1);
    expect(m.signalCounts.signal3Trashed).toBe(1);
    expect(m.signalCounts.signal4Failed).toBe(1);
  });
});
