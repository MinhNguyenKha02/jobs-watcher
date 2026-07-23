import { MetricsRecorder, ApplicationMetric } from '../../../src/infrastructure/outbound/monitoring/metrics-recorder.js';

describe('MetricsRecorder', () => {
  it('constructs with Mongo URI', () => {
    const recorder = new MetricsRecorder('mongodb://localhost:27017', 'test_db');
    expect(recorder).toBeInstanceOf(MetricsRecorder);
  });
});
