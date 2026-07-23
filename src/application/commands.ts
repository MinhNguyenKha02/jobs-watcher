import { JobStage, JobSource } from '../domain/types/job-lifecycle.js';

export interface ProcessIngestCommand {
  source: JobSource;
  stage: JobStage;
  rawPayload: string;
  jobLifecycleId?: string;
  metadata?: {
    subject?: string;
    from?: string;
    to?: string;
    threadId?: string;
    messageId?: string;
  };
  receivedAt?: Date;
}

export type ResolutionAction = 'queue' | 'trash';

export interface ProcessResolutionCommand {
  jobLifecycleId: string;
  action: ResolutionAction;
}
