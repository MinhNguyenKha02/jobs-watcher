/**
 * TUI job-event reader boundary port.
 *
 * Owned by the TUI module; the consuming complement of the daemon's outbound
 * `ParsePort`/`RoutePort` events carried on the `jobs.events` exchange.
 * Implemented by `RabbitMqJobReader`.
 */

export interface JobEventReaderPort {
  start(): Promise<void>;
  stop(): void;
  isConnected(): boolean;
  getQueueDepth(): number;
  /** Read-only peek of pending job ids (oldest-first), for saga-ring assertions. */
  peekPending(): string[];
  /** Current queue/direct mode (shared-tui-state). */
  getQueueModeState(): boolean;
  /** Drop all transient reader state so a fresh scenario starts clean. */
  resetReader(): void;
  /** Aggregate purge of the 4 durable TUI queues (s1/s2/s2direct/s3s4); idempotent, best-effort. */
  purgeQueues(): Promise<void>;
}
