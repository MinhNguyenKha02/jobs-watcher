/**
 * AnalyticsQueries Service (Sprint 5)
 * Provides aggregate and trend queries for metrics.
 */

import { MongoClient, Collection } from 'mongodb';
import type { ApplicationMetric } from './metrics-recorder.js';

export class AnalyticsQueries {
  private collection: Collection<ApplicationMetric>;

  constructor(mongoUri: string, dbName: string = 'jobs_watcher') {
    const client = new MongoClient(mongoUri);
    this.collection = client.db(dbName).collection<ApplicationMetric>('analytics');
  }

  async totalSent(): Promise<number> {
    return this.collection.countDocuments({ event: 'sent' });
  }

  async successRate(): Promise<number> {
    const sent = await this.collection.countDocuments({ event: 'sent' });
    const replied = await this.collection.countDocuments({ event: 'replied' });
    return sent === 0 ? 0 : replied / sent;
  }

  async avgJobFit(): Promise<number> {
    const cursor = this.collection.find({ jobFitScore: { $exists: true } });
    let total = 0, count = 0;
    await cursor.forEach(doc => {
      if (typeof doc.jobFitScore === 'number') {
        total += doc.jobFitScore;
        count++;
      }
    });
    return count === 0 ? 0 : total / count;
  }

  async topProfileGaps(limit = 5): Promise<{ gap: string; count: number }[]> {
    const pipeline = [
      { $unwind: '$profileGaps' },
      { $group: { _id: '$profileGaps', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: limit },
    ];
    const result = await this.collection.aggregate(pipeline).toArray();
    return result.map(r => ({ gap: r._id, count: r.count }));
  }
}
