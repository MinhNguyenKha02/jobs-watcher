import type { JobPresenter, JobPresentationResult } from '../application/job-processor.js';
import type { Job } from '../types.js';

// Mock showJobPopup for tests to avoid Ink ES module loading
let showJobPopup: (job: any) => Promise<{ action: any; enrichedData?: any }>;
if (process.env.NODE_ENV === 'test') {
  showJobPopup = async (job) => ({ action: 'queue', enrichedData: {} });
} else {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  showJobPopup = require('./JobPopup.tsx').showJobPopup;
}
import type { ActionType, EnrichedJobData } from './JobPopup.tsx';

export class TuiJobPresenter implements JobPresenter<ActionType, EnrichedJobData> {
  async present(job: Job): Promise<JobPresentationResult<ActionType, EnrichedJobData>> {
    const result = await showJobPopup(job);
    return { action: result.action, payload: result.enrichedData };
  }
}
