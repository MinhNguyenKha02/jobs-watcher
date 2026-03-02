/**
 * Job Queue Adapter (MongoDB)
 *
 * Provides enqueue, dequeue, and markProcessed for jobs.
 * For pre-prod, swap to Redis adapter.
 */

import { MongoClient, ObjectId } from 'mongodb';
import { getLogger } from '../logger.js';
const logger = getLogger();

export class MongoJobQueue {
  private client: MongoClient;
  private dbName: string;
  private collectionName: string;

  constructor(client: MongoClient, dbName = 'jobs_watcher', collectionName = 'job_queue') {
    this.client = client;
    this.dbName = dbName;
    this.collectionName = collectionName;
  }

  async enqueue(job: any) {
    const db = this.client.db(this.dbName);
    const result = await db.collection(this.collectionName).insertOne({
      ...job,
      status: 'queued',
      enqueuedAt: new Date(),
    });
    logger.info('[MongoJobQueue] Job enqueued', { jobId: result.insertedId });
  }

  async dequeue(): Promise<any | null> {
    const db = this.client.db(this.dbName);
    // Find one queued job and mark as processing
    const job = await db
      .collection(this.collectionName)
      .findOneAndUpdate(
        { status: 'queued' },
        { $set: { status: 'processing', processingAt: new Date() } },
        { returnDocument: 'after' }
      );
    if (job && job.value) {
      logger.info('[MongoJobQueue] Job dequeued for processing', { jobId: job.value._id });
      return job.value;
    }
    logger.warn('[MongoJobQueue] No queued job found');
    return null;
  }

  async markProcessed(jobId: ObjectId) {
    const db = this.client.db(this.dbName);
    await db
      .collection(this.collectionName)
      .updateOne({ _id: jobId }, { $set: { status: 'processed', processedAt: new Date() } });
    logger.info('[MongoJobQueue] Job marked as processed', { jobId });
  }

  async markProcessedFlexible(jobId: ObjectId | string) {
    const db = this.client.db(this.dbName);
    const query = typeof jobId === 'string' ? { _id: new ObjectId(jobId) } : { _id: jobId };
    await db
      .collection(this.collectionName)
      .updateOne(query, { $set: { status: 'processed', processedAt: new Date() } });
    logger.info('[MongoJobQueue] Job marked as processed', { jobId });
  }

  async clearQueue() {
    const db = this.client.db(this.dbName);
    const result = await db.collection(this.collectionName).deleteMany({});
    logger.info('[MongoJobQueue] Queue cleared', { deletedCount: result.deletedCount });
  }
}

// For pre-prod: implement RedisJobQueue with similar interface
// (Use ioredis or redis npm package)
