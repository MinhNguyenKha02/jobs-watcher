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
  }): void;
  incConsumed(queue: string, routingKey: string): void;
  setInfraReady(component: TuiInfraComponent, ready: 0 | 1): void;
  setChannelReady(channel: 's1' | 's2' | 's2direct' | 's34', ready: 0 | 1): void;
}
