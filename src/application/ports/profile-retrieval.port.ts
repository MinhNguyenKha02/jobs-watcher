import type { JobLifecycleDocument } from '../../domain/types/job-lifecycle.js';

export interface ProfileRetrievalPort {
  retrieve(job: JobLifecycleDocument): Promise<string>;
}
