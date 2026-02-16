import { DeliveryLog, DeliveryLogEntry } from '../../../src/services/sender/delivery-log.js';

describe('DeliveryLog', () => {
  it('constructs with Mongo URI', () => {
    const log = new DeliveryLog('mongodb://localhost:27017', 'test_db');
    expect(log).toBeInstanceOf(DeliveryLog);
  });
});
