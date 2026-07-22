import { MongoClient, type Collection } from 'mongodb';
import { getLogger } from '../logging/logger.js';
import type { JobLifecyclePort } from '../../../application/ports/job-lifecycle.port.js';
import { COLLECTIONS, INDEXES, type JobLifecycleDocument } from './schemas.js';

const logger = getLogger();

export class MongoJobLifecycleAdapter implements JobLifecyclePort {
  private collection: Collection<JobLifecycleDocument> | null = null;
  private client: MongoClient;

  constructor(private mongoUri: string, private dbName: string) {
    this.client = new MongoClient(mongoUri);
  }

  async connect(): Promise<void> {
    const db = this.client.db(this.dbName);
    this.collection = db.collection<JobLifecycleDocument>(COLLECTIONS.JOB_LIFECYCLE);
    for (const index of INDEXES.JOB_LIFECYCLE) {
      await this.collection.createIndex(index.key as unknown as Record<string, number>, { unique: index.unique, name: index.name });
    }
    logger.info('[MongoJobLifecycleAdapter] Connected and indexes ensured');
  }

  async disconnect(): Promise<void> {
    await this.client.close();
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
      { $set: { stage: stage as any, status: status as any, updatedAt: new Date(), stageTimestamp: new Date() } }
    );
  }

  async findById(jobLifecycleId: string): Promise<JobLifecycleDocument | null> {
    if (!this.collection) throw new Error('MongoJobLifecycleAdapter not connected');
    return this.collection.findOne({ _id: jobLifecycleId });
  }
}
