import { vi } from 'vitest';

import {
  validateP0HardGate,
  validateP1P2HardGate,
} from '../../../src/infrastructure/utils/p-index-hard-gates.js';

describe('verify-e2e-output hard gates', () => {
  it('passes P0 when runtime action evidence and route correlation are present', () => {
    const failures = validateP0HardGate({
      actionLog: [
        {
          messageId: 'msg-1',
          action: 'manual_validate_to_queue',
          details: { route: 'job_queue' },
        },
      ],
      needsEnrichment: [{ messageId: 'msg-1', finalRoute: 'job_queue' }],
      jobQueue: [{ messageId: 'msg-1', status: 'queued' }],
      jobTrash: [],
      metrics: [],
    });

    expect(failures).toEqual([]);
  });

  it('fails P0 when action evidence is missing', () => {
    const failures = validateP0HardGate({
      actionLog: [],
      needsEnrichment: [{ messageId: 'msg-1', finalRoute: 'job_queue' }],
      jobQueue: [{ messageId: 'msg-1' }],
      jobTrash: [],
      metrics: [],
    });

    expect(failures.some((failure) => failure.gate === 'P0')).toBe(true);
  });

  it('fails P0 when operator evidence is stale under freshness enforcement', () => {
    const now = Date.parse('2026-03-06T12:00:00.000Z');
    const stale = new Date(now - 26 * 60 * 60 * 1000).toISOString();
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(now);

    try {
      process.env.VERIFY_OPERATOR_FRESHNESS = '1';
      process.env.OPERATOR_EVIDENCE_MAX_AGE_HOURS = '24';

      const failures = validateP0HardGate({
        actionLog: [
          {
            messageId: 'msg-1',
            action: 'manual_validate_to_queue',
            details: { route: 'job_queue' },
            timestamp: stale,
          },
        ],
        needsEnrichment: [{ messageId: 'msg-1', finalRoute: 'job_queue' }],
        jobQueue: [{ messageId: 'msg-1', status: 'queued' }],
        jobTrash: [],
        metrics: [],
      });

      expect(
        failures.some((failure) => failure.gate === 'P0' && failure.reason.includes('stale'))
      ).toBe(true);
    } finally {
      delete process.env.VERIFY_OPERATOR_FRESHNESS;
      delete process.env.OPERATOR_EVIDENCE_MAX_AGE_HOURS;
      nowSpy.mockRestore();
    }
  });

  it('passes P1/P2 when required alert and metrics evidence exists', () => {
    const failures = validateP1P2HardGate({
      actionLog: [{ action: 'alert_routed_email', details: { channel: 'email' } }],
      needsEnrichment: [],
      jobQueue: [],
      jobTrash: [],
      metrics: [
        { metric: 'queue_lag_ms', value: 120000 },
        { metric: 'concurrency_inflight', value: 2 },
        { metric: 'backpressure_queue_depth', value: 4 },
        { metric: 'memory_rss_mb', value: 420 },
        { metric: 'memory_rss_mb', value: 400 },
      ],
    });

    expect(failures).toEqual([]);
  });

  it('fails P1/P2 when queue lag, alert, and stability signals are missing', () => {
    const failures = validateP1P2HardGate({
      actionLog: [],
      needsEnrichment: [],
      jobQueue: [],
      jobTrash: [],
      metrics: [{ metric: 'memory_rss_mb', value: 500 }],
    });

    expect(failures.some((failure) => failure.gate === 'P1')).toBe(true);
    expect(failures.some((failure) => failure.gate === 'P2')).toBe(true);
  });
});
