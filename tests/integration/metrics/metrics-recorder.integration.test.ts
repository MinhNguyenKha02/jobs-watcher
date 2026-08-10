import { MongoClient } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';

import {
  MetricsRecorder,
  ApplicationMetric,
} from '../../../src/infrastructure/outbound/monitoring/metrics-recorder.js';

describe('MetricsRecorder (integration)', () => {
  let mongod: MongoMemoryServer;
  let client: MongoClient;
  let recorder: MetricsRecorder;
  let uri: string;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    uri = mongod.getUri();
    client = new MongoClient(uri);
    await client.connect();
    recorder = new MetricsRecorder(uri, 'test_db');
  });

  afterAll(async () => {
    await client.close();
    await mongod.stop();
  });

  it('GIVEN MetricsRecorder WHEN recorder.record THEN records and retrieves a metric', async () => {
    const metric: ApplicationMetric = {
      jobId: 'job-123',
      profileHash: 'hash-abc',
      event: 'sent',
      timestamp: new Date(),
      version: '1.0.0',
    };
    await recorder.record(metric);
    const found = await recorder.findByJob('job-123');
    expect(found.length).toBe(1);
    expect(found[0].jobId).toBe('job-123');
  });
});
