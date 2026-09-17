import { describe, it, expect } from 'vitest';

import {
  renderRmqConsumerPane,
  renderRmqConsumerPaneFromMetrics,
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
    expect(frame).toContain('Q(tui):5');
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
    expect(frame).toContain('pend:');
    expect(frame).toContain('19ee…job-1');
    expect(frame).toContain('+1 more');
  });

  it('GIVEN infraReady + consumed WHEN renderFromMetrics THEN infra and consumed lines', () => {
    const frame = renderRmqConsumerPaneFromMetrics(
      {
        rmqPendingDepth: [{ labels: { queue: 'total' }, value: 2 }],
        rmqPendingPartial: [{ labels: {}, value: 1 }],
        rmqPendingFull: [{ labels: {}, value: 1 }],
        rmqDeferredCount: [{ labels: {}, value: 0 }],
        infraReady: [
          { labels: { component: 'rmq' }, value: 1 },
          { labels: { component: 'rmq_channels' }, value: 1 },
          { labels: { component: 'uds_client' }, value: 1 },
          { labels: { component: 'ipc' }, value: 1 },
          { labels: { component: 'queue_mode' }, value: 1 },
        ],
        rmqPendingIds: [
          { labels: { id: '19ee…job-1' }, value: 1 },
          { labels: { id: '19ea…job-7' }, value: 1 },
        ],
        rmqConsumedTotal: [
          { labels: { queue: 'tui.s1', routingKey: 'job.generated' }, value: 5 },
          { labels: { queue: 'tui.s2', routingKey: 'job.parse.completed' }, value: 3 },
        ],
      },
      96,
    );
    expect(frame).toContain('infra rmq:1');
    expect(frame).toContain('consumed:');
    expect(frame).toContain('tui.s1 5');
    expect(frame).not.toContain('pref 5/5/1/5');
  });

  it('GIVEN daemon metrics on tui port WHEN renderFromMetrics THEN wrong-port guard', () => {
    const frame = renderRmqConsumerPaneFromMetrics(
      {
        jobsBrokeredTotal: [{ labels: { source: 'browser-auto' }, value: 1 }],
      } as any,
      96,
    );
    expect(frame).toContain('WRONG PORT');
  });

  it('GIVEN undefined metrics WHEN renderFromMetrics THEN no crash and Q(tui):0', () => {
    const frame = renderRmqConsumerPaneFromMetrics(undefined, 96);
    expect(frame).toContain('Q(tui):0');
    expect(frame).toContain('cur: —');
  });

  it('GIVEN hard-cut legacy rmqConnected WHEN metrics contain old key THEN ignored (infraReady used)', () => {
    const frame = renderRmqConsumerPaneFromMetrics(
      {
        rmqPendingDepth: [{ labels: { queue: 'total' }, value: 1 }],
        rmqConnected: [{ labels: {}, value: 1 }] as any,
        infraReady: [{ labels: { component: 'rmq' }, value: 0 }],
      } as any,
      96,
    );
    // infraReady 0 overrides legacy 1
    expect(frame).toContain('infra rmq:0');
  });

  it('GIVEN IPC cur partial_parsed with mixed pend P:3 F:1 WHEN render THEN cur matches PA exact fragment', () => {
    const frame = renderRmqConsumerPane(
      {
        depth: 4,
        partial: 3,
        full: 1,
        deferred: 0,
        connected: true,
        queueMode: true,
        peekIds: ['1a09…job-0', '1a09…job-4', '1a09…job-5', '1a09…job-6'],
        curId: '1a09…job-3',
        curStage: 'partial_parsed',
      },
      96,
    );
    expect(frame).toContain('cur:1a09…job-3 partial_parsed');
    expect(frame).not.toContain('PARTIAL');
    expect(frame).not.toContain('mixed');
  });

  it('GIVEN IPC cur full_parsed WHEN render THEN cur shows raw FULL_PARSED wording', () => {
    const frame = renderRmqConsumerPane(
      {
        depth: 4,
        partial: 3,
        full: 1,
        deferred: 0,
        connected: true,
        queueMode: true,
        peekIds: ['1a09…job-0', '1a09…job-4', '1a09…job-5', '1a09…job-6'],
        curId: '1a09…job-3',
        curStage: 'full_parsed',
      },
      96,
    );
    expect(frame).toContain('cur:1a09…job-3 full_parsed');
  });

  it('GIVEN full-length rmqCur id WHEN renderFromMetrics THEN cur truncates to PA width 13', () => {
    const frame = renderRmqConsumerPaneFromMetrics(
      {
        rmqPendingDepth: [{ labels: { queue: 'total' }, value: 1 }],
        rmqCur: [{ labels: { id: '1a09f3244ae345fd-job-3', stage: 'partial_parsed' }, value: 1 }],
      },
      96,
    );
    expect(frame).toContain('cur:1a09…job-3 partial_parsed');
  });

  it('GIVEN cur id redelivered into peek heads WHEN renderFromMetrics THEN pend excludes cur and shown+N=depth', () => {
    const frame = renderRmqConsumerPaneFromMetrics(
      {
        rmqPendingDepth: [{ labels: { queue: 'total' }, value: 5 }],
        rmqPendingPartial: [{ labels: {}, value: 3 }],
        rmqPendingFull: [{ labels: {}, value: 2 }],
        rmqDeferredCount: [{ labels: {}, value: 0 }],
        rmqPendingIds: [
          { labels: { id: '1a09…job-3' }, value: 1 },
          { labels: { id: '1a09…job-0' }, value: 1 },
          { labels: { id: '1a09…job-4' }, value: 1 },
          { labels: { id: '1a09…job-5' }, value: 1 },
          { labels: { id: '1a09…job-6' }, value: 1 },
        ],
        rmqCur: [{ labels: { id: '1a09f3244ae345fd-job-3', stage: 'partial_parsed' }, value: 1 }],
      },
      96,
    );
    const pendLine = frame.split('\n').find((l) => l.includes('pend:')) ?? '';
    expect(frame).toContain('cur:1a09…job-3 partial_parsed');
    expect(pendLine).not.toContain('1a09…job-3');
    expect(pendLine).toContain('1a09…job-0');
    // 4 shown +1 more = depth 5
    expect(pendLine).toContain('+1 more');
  });
});
