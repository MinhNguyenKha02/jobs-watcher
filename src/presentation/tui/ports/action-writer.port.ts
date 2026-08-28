/**
 * TUI action boundary port.
 *
 * Owned by the TUI module; the wire complement of the daemon's inbound
 * `IngestorPort` (as exposed by `UdsAdapter` over `/internal/action` and
 * `/internal/ingest`). Implemented by `UdsActionWriter`.
 */

export enum OperatorAction {
  QUEUE = 'queue',
  TRASH = 'trash',
}

export interface ActionPayload {
  jobLifecycleId: string;
  action: OperatorAction;
  editedKVs?: Record<string, unknown>;
  generatedPath?: string;
  source?: string;
}

export interface WebhookIngestPayload {
  html: string;
  jobLifecycleId?: string;
}

export interface ActionWriterPort {
  queue(jobLifecycleId: string): Promise<void>;
  trash(jobLifecycleId: string): Promise<void>;
  ingest(html: string): Promise<void>;
  webhookIngest(jobLifecycleId?: string): Promise<string>;
}
