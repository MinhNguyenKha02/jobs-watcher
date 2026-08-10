import type { JobLifecycleDocument } from '../../domain/types/job-lifecycle.js';
import { JobSource } from '../../domain/types/job-lifecycle.js';

export interface RoutePort {
  emitJobQueued(jobLifecycleId: string, context?: { source: JobSource }): Promise<void>;
  emitJobTrashed(jobLifecycleId: string, reason: string): Promise<void>;
  emitRouteFailed(jobLifecycleId: string, reason: string): Promise<void>;
}
