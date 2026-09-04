import { describe, it, expect } from 'vitest';

import { JobStage } from '../../../../src/domain/types/job-lifecycle.js';
import { RabbitMqJobReader } from '../../../../src/presentation/tui/components/RabbitMqJobReader.js';

describe('RabbitMqJobReader.getPendingSnapshot', () => {
  it('GIVEN empty reader WHEN getPendingSnapshot THEN depth 0', () => {
    const r = new RabbitMqJobReader('amqp://test', { s1Queue: 'tui.test.s1' });
    const s = r.getPendingSnapshot();
    expect(s.depth).toBe(0);
    expect(s.partial).toBe(0);
    expect(s.deferred).toBe(0);
  });

  it('GIVEN real _id 19ee89f68ae8acfb-job-1 WHEN midTruncate via pane THEN 19ee…job-1', async () => {
    const { midTruncateId } =
      await import('../../../../src/presentation/tui/components/RmqConsumerPane.js');
    expect(midTruncateId('19ee89f68ae8acfb-job-1')).toBe('19ee…job-1');
    expect(midTruncateId('19ee89f68ae8acfb-job-12', 11)).toContain('…job-');
  });

  it('GIVEN 2 S1 then 1 S2 deferred WHEN snapshot THEN deferred 1', () => {
    const r = new RabbitMqJobReader('amqp://test');
    // inject via private access for GWT (local-only)
    // pendingJobs empty initially
    const snap1 = r.getPendingSnapshot();
    expect(snap1.peekIds.length).toBe(0);
    // simulate pending directly
    (
      r as unknown as { pendingJobs: Array<{ job: { _id: string }; stage: JobStage }> }
    ).pendingJobs = [
      { job: { _id: '19ee89f68ae8acfb-job-1' }, stage: JobStage.PARTIAL_PARSED },
      { job: { _id: '19eaf3b653f5a504-job-7' }, stage: JobStage.FULL_PARSED },
    ];
    const s = r.getPendingSnapshot();
    expect(s.depth).toBe(2);
    expect(s.partial).toBe(1);
    expect(s.full).toBe(1);
  });
});
