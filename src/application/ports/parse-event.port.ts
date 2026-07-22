import type { CanonicalJob } from '../../domain/types/canonical.js';
import { JobStage, JobSource } from '../../domain/types/job-lifecycle.js';

export interface ParseEventPort {
  emitJobGenerated(job: CanonicalJob, context: {
    stage: JobStage.PARTIAL_PARSED | JobStage.FULL_PARSED;
    source: JobSource.BROWSER_AUTO | JobSource.MANUAL;
    candidateCount?: number;
  }): Promise<void>;

  emitParseCompleted(jobLifecycleId: string, job: CanonicalJob, context: {
    stage: JobStage.FULL_PARSED;
    source: JobSource;
    errors?: any[];
  }): Promise<void>;

  emitParseFailed(jobLifecycleId: string, context: {
    stage: JobStage.PARTIAL_PARSED | JobStage.FULL_PARSED;
    source: JobSource.BROWSER_AUTO | JobSource.MANUAL;
    error: string;
  }): Promise<void>;

  emitJobGeneratedFailed(jobLifecycleId: string, context: {
    stage: JobStage;
    source: JobSource;
    error: string;
  }): Promise<void>;
}
