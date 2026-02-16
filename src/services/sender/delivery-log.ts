/**
 * DeliveryLog Service (Sprint 4)
 * Tracks sent status, errors, and retries in action_log collection.
 */

import { MongoClient, Collection } from 'mongodb';

export interface DeliveryLogEntry {
  jobId: string;
  profileHash: string;
  recipient: string;
  status: 'sent' | 'failed' | 'retry';
  error?: string;
  timestamp: Date;
}

export class DeliveryLog {
  private collection: Collection<DeliveryLogEntry>;

  constructor(mongoUri: string, dbName: string = 'jobs_watcher') {
    const client = new MongoClient(mongoUri);
    this.collection = client.db(dbName).collection<DeliveryLogEntry>('action_log');
  }

  async log(entry: DeliveryLogEntry): Promise<void> {
    await this.collection.insertOne(entry);
  }

  async findByJob(jobId: string): Promise<DeliveryLogEntry[]> {
    return this.collection.find({ jobId }).toArray();
  }
}
