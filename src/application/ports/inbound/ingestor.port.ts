import { JobSource, JobStage } from '../../../domain/types/job-lifecycle.js';

export interface IngestMetadata {
  subject?: string;
  from?: string;
  to?: string;
  threadId?: string;
  messageId?: string;
}

export interface IngestorPort {
  processIngest(
    source: JobSource,
    stage: JobStage,
    rawPayload: string,
    jobLifecycleId?: string,
    metadata?: IngestMetadata,
    receivedAt?: Date,
  ): Promise<void>;

  processResolution(
    jobLifecycleId: string,
    action: 'queue' | 'trash',
  ): Promise<void>;
}
