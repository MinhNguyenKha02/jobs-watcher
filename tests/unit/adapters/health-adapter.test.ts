import { describe, it, expect } from 'vitest';
import { startHealthServer } from '../../../src/infrastructure/inbound/health/health-adapter.js';

describe('HealthAdapter — smoke test', () => {
  it('exports startHealthServer function', () => {
    expect(typeof startHealthServer).toBe('function');
  });

  it('accepts minimal options without system monitor', () => {
    const metricsRegistry = {
      metrics: async () => 'mock metrics',
      systemMemory: { set: () => {} },
      systemCpu: { set: () => {} },
      eventLoopLag: { set: () => {} },
    };
    expect(() =>
      startHealthServer({
        port: 0,
        metricsRegistry: metricsRegistry as any,
      }),
    ).not.toThrow();
  });
});
