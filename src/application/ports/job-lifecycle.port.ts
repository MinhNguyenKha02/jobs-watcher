import type { JobLifecycleDocument } from '../../domain/types/job-lifecycle.js';

export interface JobLifecyclePort {
  upsert(doc: Partial<JobLifecycleDocument>): Promise<void>;
  updateStage(jobLifecycleId: string, stage: string, status: string): Promise<void>;
  findById(jobLifecycleId: string): Promise<JobLifecycleDocument | null>;
}
