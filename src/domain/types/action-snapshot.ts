export const ActionEnum = {
  JOB_GENERATED: 'job.generated',
  JOB_GENERATED_FAILED: 'job.generated.failed',
  JOB_PARSE_COMPLETED: 'job.parse.completed',
  JOB_PARSE_FAILED: 'job.parse.failed',
  JOB_ROUTE_QUEUED: 'job.route.queued',
  JOB_ROUTE_TRASHED: 'job.route.trashed',
  JOB_ROUTE_FAILED: 'job.route.failed',
  BROWSER_AUTO_FAILURE: 'browser.auto.failure',
  BROWSER_AUTO_SUCCESS: 'browser.auto.success',
} as const;

export type ActionType = (typeof ActionEnum)[keyof typeof ActionEnum];

export interface ActionSnapshotDocument {
  _id?: string;
  source: string;
  jobLifecycleId: string;
  action: ActionType;
  receivedAt: Date;
  timestamp?: Date;
}
