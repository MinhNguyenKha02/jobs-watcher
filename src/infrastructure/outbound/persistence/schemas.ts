export interface JobLifecycleDocument {
  _id: string;
  raw: string;
  gmailMeta?: {
    messageId: string;
    body: string;
    threadId?: string;
    from?: string;
    to?: string;
    subject?: string;
  };
  company: string;
  role: string;
  description?: string;
  salary?: string;
  location?: string;
  url?: string;
  details?: Record<string, unknown>;
  deadline?: string;
  easyApply?: boolean;
  stage: string;
  status: string;
  source: string;
  createdAt: Date;
  updatedAt: Date;
  stageTimestamp: Date;
  routedAt?: Date;
}

export interface ExtractionQueueDocument {
  _id: string;
  jobLifecycleId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  createdAt: Date;
  updatedAt: Date;
}

export const COLLECTIONS = {
  JOB_LIFECYCLE: 'job_lifecycle',
  EXTRACTION_QUEUE: 'extraction_queue',
} as const;

export const INDEXES = {
  JOB_LIFECYCLE: [
    { key: { role: 1, company: 1 }, unique: true, name: 'idx_role_company' },
    { key: { status: 1 }, name: 'idx_status' },
  ],
  EXTRACTION_QUEUE: [
    { key: { status: 1, createdAt: 1 }, name: 'idx_status_created' },
  ],
};
