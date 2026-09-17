export type DaemonInfraComponent = 'mongo' | 'rabbitmq' | 'browser' | 'uds' | 'webhook' | 'scheduler';

import type { Registry } from 'prom-client';

export type DaemonMetricsPort = {
  readonly register: Registry;
  metrics(): Promise<string>;
  readonly jobsBrokered: { inc(o: Record<string, string>): void };
  readonly jobStageTotal: { inc(o: Record<string, string>): void };
  readonly jobStageDuration: { observe(o: Record<string, string>, v: number): void };
  readonly jobErrors: { inc(o: Record<string, string>): void };
  readonly jobsInFlight: { inc(o: Record<string, string>): void; dec(o: Record<string, string>): void };
  readonly extractionQueueEnqueueTotal: { inc(): void };
  readonly extractionQueueDequeueTotal: { inc(): void };
  readonly rmqPublishedTotal: { inc(o: Record<string, string>): void };
  readonly jobFilterRejectTotal: { inc(o: Record<string, string>): void };
  readonly infraReady: { set(o: Record<string, string>, v: number): void };
  readonly extractionQueueDepth: { set(v: number): void };
  setInfraReady(component: DaemonInfraComponent, ready: 0 | 1): void;
  setExtractionQueueDepth(depth: number): void;
};


