import type { JobLifecycleDocument } from '../../domain/types/job-lifecycle.js';
import { JobStage, JobSource } from '../../domain/types/job-lifecycle.js';

export interface ParsePort {
  emitGenerated(job: Partial<JobLifecycleDocument>, context: {
    stage: JobStage.PARTIAL_PARSED | JobStage.FULL_PARSED;
    source: JobSource.BROWSER_AUTO | JobSource.MANUAL;
  }): Promise<void>;

  emitCompleted(job: Partial<JobLifecycleDocument>, context: {
    stage: JobStage.FULL_PARSED;
    source: JobSource;
  }): Promise<void>;

  emitFailed(jobLifecycleId: string, context: {
    stage: JobStage.PARTIAL_PARSED | JobStage.FULL_PARSED;
    source: JobSource.BROWSER_AUTO | JobSource.MANUAL;
    error: string;
  }): Promise<void>;
}
