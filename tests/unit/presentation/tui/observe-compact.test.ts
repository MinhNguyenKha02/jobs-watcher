import { describe, it, expect } from 'vitest';

import { renderObserveCompactPane } from '../../../../src/presentation/tui/components/ObserveCompactPane.js';

describe('ObserveCompactPane compact', () => {
  it('GIVEN JSON with jobsBrokeredTotal WHEN render 64w THEN contains brokered', () => {
    const frame = renderObserveCompactPane(
      {
        metrics: {
          jobsBrokeredTotal: [{ labels: { source: 'browser-auto' }, value: 12 }],
          jobStageTotal: [{ labels: { stage: 's1', status: 'enriching' }, value: 3 }],
          jobErrorsTotal: [{ labels: { stage: 's1', errorType: 'extraction' }, value: 1 }],
          jobsInFlight: [{ labels: { stage: 's1' }, value: 1 }],
        },
      } as any,
      64,
    );
    expect(frame).toContain('jobs_brok[a/m]:12');
  });

  it('GIVEN infraReady + queue depth WHEN render THEN infra line and extr_q depth', () => {
    const frame = renderObserveCompactPane(
      {
        metrics: {
          infraReady: [
            { labels: { component: 'mongo' }, value: 1 },
            { labels: { component: 'rabbitmq' }, value: 1 },
            { labels: { component: 'browser' }, value: 1 },
            { labels: { component: 'uds' }, value: 1 },
            { labels: { component: 'webhook' }, value: 0 },
            { labels: { component: 'scheduler' }, value: 1 },
          ],
          extractionQueueDepth: [{ labels: {}, value: 3 }],
          extractionQueueEnqueueTotal: [{ labels: {}, value: 10 }],
          extractionQueueDequeueTotal: [{ labels: {}, value: 7 }],
          rmqPublishedTotal: [{ labels: { routingKey: 'job.generated' }, value: 5 }],
        },
      } as any,
      64,
    );
    expect(frame).toContain('infra mongo:1');
    expect(frame).toContain('extr_q depth:3');
    expect(frame).toContain('enq:10');
    expect(frame).toContain('g:5');
    expect(frame).toContain('pc:0');
  });

  it('GIVEN heap memory WHEN render THEN heap shown', () => {
    const frame = renderObserveCompactPane(
      {
        metrics: {
          systemMemoryBytes: [
            { labels: { type: 'rss' }, value: 300 * 1024 * 1024 },
            { labels: { type: 'heapUsed' }, value: 80 * 1024 * 1024 },
          ],
          systemCpuPercent: [{ labels: {}, value: 4.2 }],
          eventLoopLagSeconds: [{ labels: {}, value: 0.012 }],
        },
      } as any,
      64,
    );
    expect(frame).toContain('heap');
  });

  it('GIVEN empty metrics WHEN render THEN no crash and contains brokered', () => {
    const frame = renderObserveCompactPane({ metrics: {} } as any, 64);
    expect(frame).toContain('jobs_brok[a/m]:0');
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
