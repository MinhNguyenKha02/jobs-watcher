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
      connected: true,
      queueMode: true,
      peekIds: ['19ee…job-1', '19ea…job-7', '19ef…job-1', '19f0…job-0', '19f1…job-2'],
    };
    const frame = renderRmqConsumerPane(snap, 96);
    expect(frame).toContain('Q:5');
    expect(frame).toContain('P:2');
    expect(frame).toContain('D:1');
    expect(frame).toContain('19ee…job-1');
  });

  it('GIVEN 6 depth WHEN render THEN overflow +N more same line', () => {
    const snap = {
      depth: 6,
      partial: 3,
      full: 3,
      deferred: 0,
      connected: true,
      queueMode: true,
      peekIds: ['19ee…job-1', '19ea…job-7', '19ef…job-1', '19f0…job-0', '19f1…job-2'],
    };
    const frame = renderRmqConsumerPane(snap, 96);
    // pend line shows truncated ids +N more
    expect(frame).toContain('pend:');
    expect(frame).toContain('19ee…job-1');
    expect(frame).toContain('+1 more');
  });
});
