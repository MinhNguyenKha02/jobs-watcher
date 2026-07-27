import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ActionEvent } from '../../../src/domain/types/action-event.js';

const mockChannel = vi.hoisted(() => ({
  publish: vi.fn(),
}));

const mockRmq = vi.hoisted(() => ({
  getChannel: vi.fn().mockReturnValue(mockChannel),
  getExchange: vi.fn().mockReturnValue('jobs.events'),
}));

vi.mock('../../../src/infrastructure/outbound/rabbitmq/rabbitmq-connection.js', () => ({
  RabbitMqConnection: vi.fn().mockImplementation(() => mockRmq),
}));

import { RabbitMqRoutingAdapter } from '../../../src/infrastructure/outbound/rabbitmq/rabbitmq-route-adapter.js';

describe('RabbitMqRoutingAdapter', () => {
  let adapter: RabbitMqRoutingAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new RabbitMqRoutingAdapter(mockRmq as any);
  });

  it('emitJobQueued publishes to QUEUED routing key', async () => {
    await adapter.emitJobQueued('job-1');
    expect(mockChannel.publish).toHaveBeenCalledWith(
      'jobs.events',
      ActionEvent.QUEUED,
      expect.any(Buffer),
      expect.objectContaining({ persistent: true }),
    );
    const buffer = mockChannel.publish.mock.calls[0][2] as Buffer;
    expect(JSON.parse(buffer.toString())).toEqual({ jobLifecycleId: 'job-1', context: undefined });
  });

  it('emitJobTrashed publishes to TRASHED routing key', async () => {
    const reason = 'filter-rejected';
    await adapter.emitJobTrashed('job-1', reason);
    expect(mockChannel.publish).toHaveBeenCalledWith(
      'jobs.events',
      ActionEvent.TRASHED,
      expect.any(Buffer),
      expect.objectContaining({ persistent: true }),
    );
    const buffer = mockChannel.publish.mock.calls[0][2] as Buffer;
    expect(JSON.parse(buffer.toString())).toEqual({ jobLifecycleId: 'job-1', reason, context: undefined });
  });

  it('emitRouteFailed publishes to ROUTE_FAILED routing key', async () => {
    const reason = 'no-operator-match';
    await adapter.emitRouteFailed('job-1', reason);
    expect(mockChannel.publish).toHaveBeenCalledWith(
      'jobs.events',
      ActionEvent.ROUTE_FAILED,
      expect.any(Buffer),
      expect.objectContaining({ persistent: true }),
    );
    const buffer = mockChannel.publish.mock.calls[0][2] as Buffer;
    expect(JSON.parse(buffer.toString())).toEqual({ jobLifecycleId: 'job-1', reason, context: undefined });
  });

  it('includes trace context headers when provided', async () => {
    const adapterWithTrace = new RabbitMqRoutingAdapter(mockRmq as any, { traceId: 'trace-abc' });
    await adapterWithTrace.emitJobQueued('job-1');
    expect(mockChannel.publish).toHaveBeenCalledWith(
      'jobs.events',
      ActionEvent.QUEUED,
      expect.any(Buffer),
      expect.objectContaining({ headers: { 'x-trace-id': 'trace-abc' }, persistent: true }),
    );
  });
});
