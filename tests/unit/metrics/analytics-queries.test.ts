import { AnalyticsQueries } from '../../../src/infrastructure/outbound/monitoring/analytics-queries.js';

describe('AnalyticsQueries', () => {
  it('constructs with Mongo URI', () => {
    const queries = new AnalyticsQueries('mongodb://localhost:27017', 'test_db');
    expect(queries).toBeInstanceOf(AnalyticsQueries);
  });
});
