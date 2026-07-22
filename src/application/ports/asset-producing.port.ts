import type { JobLifecycleDocument } from '../../domain/types/job-lifecycle.js';

export interface AssetProducingPort {
  toAsset(job: Partial<JobLifecycleDocument>): Promise<string>;
}
