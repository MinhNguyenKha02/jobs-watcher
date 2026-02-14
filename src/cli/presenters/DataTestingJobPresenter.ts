import type { Job } from '../../types.js';
import type { JobPresenter, JobPresentationResult } from '../../application/job-processor.js';
import { processEnrichedJob, type EnrichedJobResult } from '../../ui/EnrichedJobHandler.js';

export type DataTestingAction = EnrichedJobResult['action'];
export type DataTestingPayload = EnrichedJobResult;

export class DataTestingJobPresenter implements JobPresenter<DataTestingAction, DataTestingPayload> {
  constructor(
    private jobNumber: number,
    private openBrowserOnStart: boolean
  ) {}

  async present(job: Job): Promise<JobPresentationResult<DataTestingAction, DataTestingPayload>> {
    const result = await processEnrichedJob(this.jobNumber, job, this.openBrowserOnStart);
    return { action: result.action, payload: result };
  }
}
