import { describe, it, expect } from 'vitest';

import { renderStdinStatusPane } from '../../../../src/presentation/tui/components/StdinStatusPane.js';

describe('StdinStatusPane 2-line', () => {
  it('GIVEN last j queue 19ee89f68ae8acfb-job-1 queue:ON WHEN render THEN contains last: j 19ee…', () => {
    const frame = renderStdinStatusPane(
      {
        lastAction: 'j queue',
        jobLifecycleId: '19ee89f68ae8acfb-job-1',
        queueMode: true,
        processedCount: 12,
        udsTookMs: 3,
        modalActive: false,
        lastError: null,
      },
      96
    );
    expect(frame).toContain('last:');
    expect(frame).toContain('19ee…job-1');
    expect(frame).toContain('queue:ON');
  });

  it('GIVEN queueMode OFF WHEN render THEN queue:OFF', () => {
    const frame = renderStdinStatusPane(
      {
        lastAction: null,
        jobLifecycleId: null,
        queueMode: false,
        processedCount: 0,
        udsTookMs: null,
        modalActive: false,
        lastError: null,
      },
      96
    );
    expect(frame).toContain('queue:OFF');
  });
});
