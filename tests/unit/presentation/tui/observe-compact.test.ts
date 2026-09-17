import { describe, it, expect } from 'vitest';

import { renderObserveCompactPane } from '../../../../src/presentation/tui/components/ObserveCompactPane.js';

describe('ObserveCompactPane compact', () => {
  it('GIVEN s3 totals by source WHEN render 64w THEN q/t split by origin', () => {
    const frame = renderObserveCompactPane(
      {
        metrics: {
          jobStageTotal: [
            { labels: { stage: 's3', status: 'queued', source: 'browser-auto' }, value: 3 },
            { labels: { stage: 's3', status: 'queued', source: 'manual' }, value: 1 },
            { labels: { stage: 's3', status: 'trashed', source: 'browser-auto' }, value: 9 },
            { labels: { stage: 's3', status: 'trashed', source: 'manual' }, value: 2 },
          ],
        },
      } as any,
      64,
    );
    expect(frame).toContain('q[a]:3 q[m]:1 t[a]:9 t[m]:2');
  });

  it('GIVEN filter rejects WHEN render THEN flt split by source and stage', () => {
    const frame = renderObserveCompactPane(
      {
        metrics: {
          jobStageTotal: [],
          jobFilterRejectTotal: [
            { labels: { source: 'browser-auto', stage: 's1' }, value: 4 },
            { labels: { source: 'browser-auto', stage: 's2' }, value: 2 },
            { labels: { source: 'manual', stage: 's2' }, value: 1 },
          ],
        },
      } as any,
      64,
    );
    expect(frame).toContain('flt[a1]:4 flt[a2]:2 flt[m2]:1');
  });

  it('GIVEN errors by stage WHEN render THEN grouped counts plus total', () => {
    const frame = renderObserveCompactPane(
      {
        metrics: {
          jobErrorsTotal: [
            { labels: { stage: 's2', error_type: 'filter_rejected', marker: '' }, value: 1 },
            { labels: { stage: 'extraction', error_type: 'anti_bot_block', marker: 'access_denied' }, value: 2 },
          ],
        },
      } as any,
      64,
    );
    expect(frame).toContain('error[s1:0 s2:1 s3:0 ext:2 res:0 tot:3]');
  });

  it('GIVEN in-flight jobs WHEN render THEN busy and idle derived from pool of 3', () => {
    const frame = renderObserveCompactPane(
      {
        metrics: {
          extractionQueueDepth: [{ labels: {}, value: 2 }],
          extractionQueueEnqueueTotal: [{ labels: {}, value: 10 }],
          extractionQueueDequeueTotal: [{ labels: {}, value: 8 }],
          jobsInFlight: [{ labels: { stage: 's1' }, value: 2 }],
        },
      } as any,
      64,
    );
    expect(frame).toContain('extr_q depth:2 in-flight:2 workers busy:2 idle:1');
  });

  it('GIVEN slow durations WHEN render THEN red flag appended, values kept', () => {
    const frame = renderObserveCompactPane(
      {
        metrics: {
          jobStageDurationSecondsSum: [
            { labels: { stage: 's1_s2' }, value: 8.62 },
            { labels: { stage: 'extraction' }, value: 62.8 },
          ],
          jobStageDurationSecondsCount: [
            { labels: { stage: 's1_s2' }, value: 2 },
            { labels: { stage: 'extraction' }, value: 2 },
          ],
        },
      } as any,
      64,
    );
    expect(frame).toContain('extr 31.40s🔴');
    expect(frame).toContain('s1_s2 4.31s');
    expect(frame).not.toContain('s1_s2 4.31s🔴');
  });

  it('GIVEN daemon pub plus tui consumed WHEN render THEN signed deltas with detail', () => {
    const frame = renderObserveCompactPane(
      {
        metrics: {
          rmqPublishedTotal: [
            { labels: { routingKey: 'job.generated' }, value: 15 },
            { labels: { routingKey: 'job.parse.completed' }, value: 3 },
            { labels: { routingKey: 'job.queue' }, value: 4 },
            { labels: { routingKey: 'job.trash' }, value: 11 },
          ],
        },
        tuiMetrics: {
          rmqConsumedTotal: [
            { labels: { queue: 'tui.s1' }, value: 14 },
            { labels: { queue: 'tui.s2' }, value: 3 },
            { labels: { queue: 'tui.s3s4' }, value: 15 },
          ],
        },
      } as any,
      64,
    );
    expect(frame).toContain('pub s1:+1 s2:+0 s3s4:+0');
    expect(frame).toContain('(g:15 pc:3 pf:0 q:4 t:11 rf:0)');
  });

  it('GIVEN no tui join WHEN render THEN pub-only detail with dash deltas', () => {
    const frame = renderObserveCompactPane(
      {
        metrics: {
          rmqPublishedTotal: [{ labels: { routingKey: 'job.generated' }, value: 5 }],
        },
      } as any,
      64,
    );
    expect(frame).toContain('pub s1:— s2:— s3s4:—');
    expect(frame).toContain('g:5');
  });

  it('GIVEN infraReady + memory WHEN render THEN merged sys and infra line', () => {
    const frame = renderObserveCompactPane(
      {
        metrics: {
          systemMemoryBytes: [
            { labels: { type: 'rss' }, value: 300 * 1024 * 1024 },
            { labels: { type: 'heapUsed' }, value: 80 * 1024 * 1024 },
          ],
          systemCpuPercent: [{ labels: {}, value: 4.2 }],
          eventLoopLagSeconds: [{ labels: {}, value: 0.012 }],
          infraReady: [
            { labels: { component: 'mongo' }, value: 1 },
            { labels: { component: 'rabbitmq' }, value: 1 },
            { labels: { component: 'browser' }, value: 1 },
            { labels: { component: 'uds' }, value: 1 },
            { labels: { component: 'webhook' }, value: 0 },
            { labels: { component: 'scheduler' }, value: 1 },
          ],
        },
      } as any,
      64,
    );
    expect(frame).toContain('heap');
    expect(frame).toContain('mongo:1');
  });

  it('GIVEN empty metrics WHEN render THEN no crash and zero lines', () => {
    const frame = renderObserveCompactPane({ metrics: {} } as any, 64);
    expect(frame).toContain('q[a]:0');
    expect(frame).toContain('tot:0');
    expect(frame).not.toContain('/metrics');
    expect(frame).not.toContain('poll 5s');
  });

  it('GIVEN tui metrics on daemon port WHEN render THEN wrong-port guard', () => {
    const frame = renderObserveCompactPane(
      {
        metrics: {
          rmqPendingDepth: [{ labels: { queue: 'total' }, value: 5 }],
        },
      } as any,
      64,
    );
    expect(frame).toContain('WRONG PORT');
  });

  it('GIVEN containers in snapshot WHEN render THEN ignored (no ns)', () => {
    const frame = renderObserveCompactPane(
      {
        metrics: { jobsBrokeredTotal: [{ labels: {}, value: 1 }] },
        containers: { daemon: { ns: 'x', healthPort: 9090 } },
      } as any,
      64,
    );
    expect(frame).not.toContain('ns');
  });
});
