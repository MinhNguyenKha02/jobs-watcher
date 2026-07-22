import type { Job } from './job.js';

export enum JobStage {
  PARTIAL_PARSED = 'partial_parsed',
  FULL_PARSED = 'full_parsed'
}

export enum JobStatus {
  ENRICHING = 'enriching',
  ENRICHED = 'enriched',
  QUEUED = 'queued',
  TRASHED = 'trashed',
  FAILED = 'failed'
}

export enum JobSource {
  BROWSER_AUTO = 'browser-auto',
  MANUAL = 'manual'
}

export interface JobLifecycleDocument extends Job {
  _id: string;
  raw: string;
  gmailMeta?: {
    messageId: string;
    body?: string;
    threadId?: string;
    from?: string;
    to?: string;
    subject?: string;
  };
  stage: JobStage;
  status: JobStatus;
  source: JobSource;
  trashReason?: string;
  createdAt: Date;
  updatedAt: Date;
  stageTimestamp: Date;
  routedAt?: Date;
}

export type JobLifecycleInput = Partial<JobLifecycleDocument> & {
  _id: string;
  stage: JobStage;
  status: JobStatus;
  source: JobSource;
};