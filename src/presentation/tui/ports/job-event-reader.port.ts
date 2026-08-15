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
  /** Drop all transient reader state so a fresh scenario starts clean. */
  resetReader(): void;
}