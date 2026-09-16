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

  it('GIVEN queueMode ON WHEN render THEN explicit per-key labels replace PA footer', () => {
    const frame = renderStdinStatusPane(
      {
        lastAction: null,
        jobLifecycleId: null,
        queueMode: true,
        processedCount: 0,
        udsTookMs: null,
        modalActive: false,
        lastError: null,
      },
      120
    );
    expect(frame).toContain('j=queue');
    expect(frame).toContain('d=trash');
    expect(frame).toContain('c=stage2');
    expect(frame).toContain('o=open-url');
  });

  it('GIVEN queueMode OFF WHEN render THEN direct label set without open-url/stage2', () => {
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
      120
    );
    expect(frame).toContain('j=queue');
    expect(frame).not.toContain('o=open-url');
    expect(frame).not.toContain('c=stage2');
  });

  it('GIVEN source browser-auto WHEN render THEN src: auto segment', () => {
    const frame = renderStdinStatusPane(
      {
        lastAction: null,
        jobLifecycleId: null,
        queueMode: true,
        processedCount: 0,
        udsTookMs: null,
        modalActive: false,
        lastError: null,
        source: 'browser-auto',
      },
      120
    );
    expect(frame).toContain('src: auto');
  });

  it('GIVEN source manual WHEN render THEN src: man segment', () => {
    const frame = renderStdinStatusPane(
      {
        lastAction: null,
        jobLifecycleId: null,
        queueMode: true,
        processedCount: 0,
        udsTookMs: null,
        modalActive: false,
        lastError: null,
        source: 'manual',
      },
      120
    );
    expect(frame).toContain('src: man');
  });

  it('GIVEN no source WHEN render THEN src segment omitted', () => {
    const frame = renderStdinStatusPane(
      {
        lastAction: null,
        jobLifecycleId: null,
        queueMode: true,
        processedCount: 0,
        udsTookMs: null,
        modalActive: false,
        lastError: null,
      },
      120
    );
    expect(frame).not.toContain('src:');
  });
});
