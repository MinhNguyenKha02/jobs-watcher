import type { JobPresenter, JobPresentationResult } from '../application/job-processor.js';
import type { Job } from '../types.js';

import { showJobPopup, type ActionType, type EnrichedJobData } from './JobPopup.js';

export class TuiJobPresenter implements JobPresenter<ActionType, EnrichedJobData> {
  async present(job: Job): Promise<JobPresentationResult<ActionType, EnrichedJobData>> {
    const result = await showJobPopup(job);
    return { action: result.action, payload: result.enrichedData };
  }
}
