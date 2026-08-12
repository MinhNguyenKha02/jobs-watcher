import { Db, type Collection } from 'mongodb';

import type { JobLifecyclePort } from '../../../application/ports/job-lifecycle.port.js';
import { JobStage, JobStatus } from '../../../domain/types/job-lifecycle.js';
import { createLogger } from '../logging/logger.js';

import { COLLECTIONS, type JobLifecycleDocument } from './schemas.js';

const logger = createLogger('MongoJobLifecycleAdapter');
export class MongoJobLifecycleAdapter implements JobLifecyclePort {
  private collection: Collection<JobLifecycleDocument> | null = null;

  constructor(private db: Db) {
    this.collection = this.db.collection<JobLifecycleDocument>(COLLECTIONS.JOB_LIFECYCLE);
    logger.info('MongoJobLifecycleAdapter initialized', { collection: COLLECTIONS.JOB_LIFECYCLE });
  }

  async upsert(doc: Partial<JobLifecycleDocument>): Promise<void> {
    if (!this.collection) throw new Error('MongoJobLifecycleAdapter not connected');
    const _id = doc._id;
    if (!_id) throw new Error('upsert requires _id');
    await this.collection.updateOne(
      { _id },
      { $set: { ...doc, updatedAt: new Date() } },
      { upsert: true }
    );
  }

  async updateStage(jobLifecycleId: string, stage: string, status: string): Promise<void> {
    if (!this.collection) throw new Error('MongoJobLifecycleAdapter not connected');
    await this.collection.updateOne(
      { _id: jobLifecycleId },
      {
        $set: {
          stage: stage as JobStage,
          status: status as JobStatus,
          updatedAt: new Date(),
          stageTimestamp: new Date(),
        },
      }
    );
  }

  async findById(jobLifecycleId: string): Promise<JobLifecycleDocument | null> {
    if (!this.collection) throw new Error('MongoJobLifecycleAdapter not connected');
    return this.collection.findOne({ _id: jobLifecycleId });
  }
}
