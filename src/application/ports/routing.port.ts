import type { JobLifecycleDocument } from '../../domain/types/job-lifecycle.js';
import { JobSource } from '../../domain/types/job-lifecycle.js';

export interface RoutingPort {
  emitJobQueued(job: Partial<JobLifecycleDocument>, context?: { source: JobSource }): Promise<void>;
  emitJobTrashed(jobLifecycleId: string, reason: string, context?: { operatorEdits?: Record<string, unknown> }): Promise<void>;
  emitRouteFailed(jobLifecycleId: string, reason: string, context?: { operatorEdits?: Record<string, unknown> }): Promise<void>;
}
