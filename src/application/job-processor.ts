import type { Job } from '../types.js';

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
    return result;
  }
}
