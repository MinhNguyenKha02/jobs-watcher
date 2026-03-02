/**
 * MetricsRecorder Service (Sprint 5)
 * Records application events and metrics for analytics.
 */

import { MongoClient, Collection } from 'mongodb';

export interface ApplicationMetric {
  jobId: string;
  profileHash: string;
  // Add 'queued' to represent enqueueing/ingestion events
  event: 'queued' | 'sent' | 'opened' | 'replied' | 'failed';
  jobFitScore?: number;
  profileGaps?: string[];
  timestamp: Date;
  version: string;
}

export class MetricsRecorder {
  private collection: Collection<ApplicationMetric>;

  constructor(mongoUri: string, dbName: string = 'jobs_watcher') {
    const client = new MongoClient(mongoUri);
    this.collection = client.db(dbName).collection<ApplicationMetric>('analytics');
  }

  async record(metric: ApplicationMetric): Promise<void> {
    await this.collection.insertOne(metric);
  }

  async findByJob(jobId: string): Promise<ApplicationMetric[]> {
    return this.collection.find({ jobId }).toArray();
  }
}
