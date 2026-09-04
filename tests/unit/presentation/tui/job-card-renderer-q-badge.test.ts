import { describe, it, expect } from 'vitest';

import { JobCardRenderer } from '../../../../src/presentation/tui/components/JobCardRenderer.js';

describe('JobCardRenderer Q badge + new line', () => {
  it('GIVEN CardStatus Q:3 P:1 F:2 D:1 cur:19ee89f68ae8acfb-job-1 FULL WHEN renderCard THEN header contains Q:3 cur:19ee…', () => {
    const r = new JobCardRenderer(120, 24);
    const frame = r.renderCard(
      {
        _id: '19ee89f68ae8acfb-job-1',
        company: 'FullCo',
        role: 'Full Stack',
        details: 'details',
      } as never,
      {
        sseConnected: true,
        udsReady: true,
        state: 'DISPLAY',
        queueMode: true,
        pendingDepth: 3,
        pendingPartial: 1,
        pendingFull: 2,
        deferredCount: 1,
        currentJobId: '19ee89f68ae8acfb-job-1',
        currentStage: 'full_parsed',
      }
    );
    expect(frame).toContain('Q:3');
    expect(frame).toContain('19ee…job-1');
    expect(frame).toContain('Job #');
    expect(frame).toContain('[FULL]');
  });

  it('GIVEN PARTIAL without details WHEN render THEN [PARTIAL]', () => {
    const r = new JobCardRenderer(120, 24);
    const frame = r.renderCard(
      { _id: '19ee89f68ae8acfb-job-7', company: 'Acme', role: 'Dev' } as never,
      { sseConnected: true, udsReady: true, state: 'DISPLAY', pendingDepth: 1 } as never
    );
    expect(frame).toContain('[PARTIAL]');
  });
});
