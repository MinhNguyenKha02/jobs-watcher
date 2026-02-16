import { MetricsRecorder, ApplicationMetric } from '../../../src/services/metrics/metrics-recorder.js';

describe('MetricsRecorder', () => {
  it('constructs with Mongo URI', () => {
    const recorder = new MetricsRecorder('mongodb://localhost:27017', 'test_db');
    expect(recorder).toBeInstanceOf(MetricsRecorder);
  });
});
