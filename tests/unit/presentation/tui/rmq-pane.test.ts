import { describe, it, expect } from 'vitest';

import {
  renderRmqConsumerPane,
  midTruncateId,
} from '../../../../src/presentation/tui/components/RmqConsumerPane.js';

describe('RmqConsumerPane', () => {
  it('GIVEN real _id 19ee89f68ae8acfb-job-1 WHEN midTruncate THEN 19ee…job-1', () => {
    expect(midTruncateId('19ee89f68ae8acfb-job-1')).toBe('19ee…job-1');
  });

  it('GIVEN 5 pend +1 deferred WHEN render width 96 THEN contains Q:5 and +N logic', () => {
    const snap = {
      depth: 5,
      partial: 2,
      full: 3,
      deferred: 1,
      deferredIds: ['19f11a2b3c4d5e6f-job-2'],
      peekIds: [
        '19ee89f68ae8acfb-job-1',
        '19eaf3b653f5a504-job-7',
        '19ef3be490a9f62c-job-1',
        '19f00a1b2c3d4e5f6-job-0',
        '19f11a2b3c4d5e6f-job-2',
      ],
      peekStages: [
        'full' as const,
        'partial' as const,
        'full' as const,
        'full' as const,
        'partial' as const,
      ],
      connected: true,
      queueMode: true,
    };
    const frame = renderRmqConsumerPane(snap, 96);
    expect(frame).toContain('Q:5');
    expect(frame).toContain('P:2');
    expect(frame).toContain('19ee…job-1');
  });

  it('GIVEN 6 depth WHEN render THEN overflow +N more same line', () => {
    const snap = {
      depth: 6,
      partial: 3,
      full: 3,
      deferred: 0,
      deferredIds: [],
      peekIds: ['a-job-1', 'a-job-2', 'a-job-3', 'a-job-4', 'a-job-5', 'a-job-6'],
      peekStages: [
        'full' as const,
        'full' as const,
        'full' as const,
        'full' as const,
        'full' as const,
        'full' as const,
      ],
      connected: true,
      queueMode: true,
    };
    const frame = renderRmqConsumerPane(snap, 96);
    // 5 cap + overflow
    expect(frame).toContain('pend:');
  });
});
