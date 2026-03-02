import type { Job } from '../types.js';
import { getLogger } from '../services/logger.js';
const logger = getLogger();

export interface JobPresentationResult<TAction, TPayload> {
  action: TAction;
  payload?: TPayload;
}

export interface JobPresenter<TAction, TPayload> {
  present(job: Job): Promise<JobPresentationResult<TAction, TPayload>>;
}

export interface JobActionHandler<TAction, TPayload> {
  handle(job: Job, action: TAction, payload?: TPayload): Promise<void>;
}

export class JobProcessor<TAction, TPayload> {
  constructor(
    private presenter: JobPresenter<TAction, TPayload>,
    private actionHandler: JobActionHandler<TAction, TPayload>
  ) {}

  async process(job: Job): Promise<JobPresentationResult<TAction, TPayload>> {
    const result = await this.presenter.present(job);
    await this.actionHandler.handle(job, result.action, result.payload);
      logger.info('[JobProcessor] Job processed', { jobId: job.id, status: result.action });
    return result;
  }
}
