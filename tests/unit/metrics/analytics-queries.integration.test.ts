import { MongoMemoryServer } from 'mongodb-memory-server';

import { AnalyticsQueries } from '../../../src/infrastructure/outbound/monitoring/analytics-queries.js';
import { MetricsRecorder, ApplicationMetric } from '../../../src/infrastructure/outbound/monitoring/metrics-recorder.js';

/**
 * Integration test for AnalyticsQueries
 */
describe('AnalyticsQueries (integration)', () => {
  let mongod: MongoMemoryServer;
  let uri: string;
  let queries: AnalyticsQueries;
  let recorder: MetricsRecorder;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    uri = mongod.getUri();
    queries = new AnalyticsQueries(uri, 'test_db');
    recorder = new MetricsRecorder(uri, 'test_db');
  });

  afterAll(async () => {
    await mongod.stop();
  });

  it('computes totalSent, successRate, avgJobFit, topProfileGaps', async () => {
    // Insert metrics
    await recorder.record({
      jobId: 'job-1',
      profileHash: 'hash-1',
      event: 'sent',
      timestamp: new Date(),
      version: '1.0.0',
      jobFitScore: 80,
      profileGaps: ['TypeScript', 'Node.js'],
    });
    await recorder.record({
      jobId: 'job-2',
      profileHash: 'hash-2',
      event: 'sent',
      timestamp: new Date(),
      version: '1.0.0',
      jobFitScore: 60,
      profileGaps: ['Node.js'],
    });
    await recorder.record({
      jobId: 'job-1',
      profileHash: 'hash-1',
      event: 'replied',
      timestamp: new Date(),
      version: '1.0.0',
      jobFitScore: 80,
      profileGaps: ['TypeScript'],
    });

    const totalSent = await queries.totalSent();
    expect(totalSent).toBe(2);
    const successRate = await queries.successRate();
    expect(successRate).toBeCloseTo(0.5);
    const avgJobFit = await queries.avgJobFit();
    expect(avgJobFit).toBeCloseTo(73.33, 1);
    const topGaps = await queries.topProfileGaps(2);
    expect(topGaps.length).toBeGreaterThan(0);
    expect(topGaps[0].gap).toBeDefined();
    expect(topGaps[0].count).toBeGreaterThan(0);
  });
});
