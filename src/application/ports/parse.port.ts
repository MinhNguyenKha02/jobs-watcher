import { JobStage, JobSource, JobStatus } from '../../domain/types/job-lifecycle.js';
import type { Job } from '../../domain/types/job.js';

export interface ParsePort {
  emitGenerated(
    job: Job,
    context: {
      stage: JobStage.PARTIAL_PARSED | JobStage.FULL_PARSED;
      source: JobSource.BROWSER_AUTO | JobSource.MANUAL;
      status: JobStatus;
    }
  ): Promise<void>;

  emitCompleted(
    job: Job,
    context: {
      stage: JobStage.FULL_PARSED;
      source: JobSource;
      status: JobStatus;
    }
  ): Promise<void>;

  emitFailed(
    jobLifecycleId: string,
    context: {
      stage: JobStage.PARTIAL_PARSED | JobStage.FULL_PARSED;
      source: JobSource.BROWSER_AUTO | JobSource.MANUAL;
      error: string;
    }
  ): Promise<void>;
}
