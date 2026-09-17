import type { Registry } from 'prom-client';

export type TuiInfraComponent = 'rmq' | 'rmq_channels' | 'uds_client' | 'ipc' | 'queue_mode';

export interface TuiMetricsPort {
  readonly register: Registry;
  metrics(): Promise<string>;
  syncSnapshot(snapshot: {
    depth: number;
    partial: number;
    full: number;
    deferred: number;
    connected: boolean;
    queueMode: boolean;
    peekIds: string[];
    curId?: string | null;
    curStage?: string | null;
  }): void;
  ackInc(queue: string): void;
  unackInc(queue: string): void;
  unackDec(queue: string): void;
  setInfraReady(component: TuiInfraComponent, ready: 0 | 1): void;
}
