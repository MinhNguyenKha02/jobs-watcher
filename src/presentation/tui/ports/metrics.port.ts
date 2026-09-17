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
  // Consumer-driven only: deliver→unackInc, broker-ack/nack→unackDec,
  // checkQueue→setReady. No other writers (in-mem by design, rerun-stable
  // via broker redelivery + ready; broker forgets acks so no ack series).
  unackInc(queue: string): void;
  unackDec(queue: string): void;
  setReady(queue: string, n: number): void;
  setInfraReady(component: TuiInfraComponent, ready: 0 | 1): void;
}
