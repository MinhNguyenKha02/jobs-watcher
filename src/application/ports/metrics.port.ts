export type DaemonInfraComponent = 'mongo' | 'rabbitmq' | 'browser' | 'uds' | 'webhook' | 'scheduler';

import type { Registry } from 'prom-client';

export type DaemonMetricsPort = {
  readonly register: Registry;
  metrics(): Promise<string>;
  // legacy direct prom handles (compat while ports adopt)
  readonly jobsBrokered: { inc(o: Record<string, string>): void };
  readonly jobStageTotal: { inc(o: Record<string, string>): void };
  readonly jobStageDuration: { observe(o: Record<string, string>, v: number): void };
  readonly jobErrors: { inc(o: Record<string, string>): void };
  readonly jobsInFlight: { inc(o: Record<string, string>): void; dec(o: Record<string, string>): void };
  readonly extractionQueueEnqueueTotal: { inc(): void };
  readonly extractionQueueDequeueTotal: { inc(): void };
  readonly rmqPublishedTotal: { inc(o: Record<string, string>): void };
  readonly infraReady: { set(o: Record<string, string>, v: number): void };
  readonly extractionQueueDepth: { set(v: number): void };
  jobsBrokeredInc(source: string): void;
  jobStageTotalInc(stage: string, status: string): void;
  jobStageDurationObserve(stage: string, sec: number): void;
  jobErrorsInc(stage: string, errorType: string): void;
  jobsInFlightInc(stage: string): void;
  jobsInFlightDec(stage: string): void;
  extractionQueueEnqueueInc(): void;
  extractionQueueDequeueInc(): void;
  rmqPublishedInc(routingKey: string): void;
  setInfraReady(component: DaemonInfraComponent, ready: 0 | 1): void;
  setExtractionQueueDepth(depth: number): void;
};


