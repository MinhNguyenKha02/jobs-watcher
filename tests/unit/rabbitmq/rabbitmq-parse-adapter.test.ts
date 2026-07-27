import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Channel } from 'amqplib';
import { ActionEvent } from '../../../src/domain/types/action-event.js';
import { JobStage, JobSource } from '../../../src/domain/types/job-lifecycle.js';

const mockChannel = vi.hoisted(() => ({
  publish: vi.fn(),
}));

const mockRmq = vi.hoisted(() => ({
  getChannel: vi.fn().mockReturnValue(mockChannel),
  getExchange: vi.fn().mockReturnValue('jobs.events'),
}));

vi.mock('../../../src/infrastructure/outbound/rabbitmq/rabbitmq-connection-adapter.js', () => ({
  RabbitMqConnection: vi.fn().mockImplementation(() => mockRmq),
}));

import { RabbitMqParseAdapter } from '../../../src/infrastructure/outbound/rabbitmq/rabbitmq-parse-adapter.js';

describe('RabbitMqParseAdapter', () => {
  let adapter: RabbitMqParseAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new RabbitMqParseAdapter(mockRmq as any);
  });

  it('emitGenerated publishes to GENERATED routing key', async () => {
    const job = { _id: 'job-1', company: 'TestCo' };
    await adapter.emitGenerated(job, { stage: JobStage.PARTIAL_PARSED, source: JobSource.BROWSER_AUTO });
    expect(mockChannel.publish).toHaveBeenCalledWith(
      'jobs.events',
      ActionEvent.GENERATED,
      expect.any(Buffer),
      expect.objectContaining({ persistent: true }),
    );
    const buffer = mockChannel.publish.mock.calls[0][2] as Buffer;
    expect(JSON.parse(buffer.toString())).toEqual(job);
  });

  it('emitCompleted publishes to PARSE_COMPLETED routing key', async () => {
    const job = { company: 'TestCo' };
    await adapter.emitCompleted(job, { stage: JobStage.FULL_PARSED, source: JobSource.MANUAL });
    expect(mockChannel.publish).toHaveBeenCalledWith(
      'jobs.events',
      ActionEvent.PARSE_COMPLETED,
      expect.any(Buffer),
      expect.objectContaining({ persistent: true }),
    );
    const buffer = mockChannel.publish.mock.calls[0][2] as Buffer;
    expect(JSON.parse(buffer.toString())).toEqual({ job });
  });

  it('emitFailed publishes to PARSE_FAILED routing key', async () => {
    await adapter.emitFailed('job-1', { stage: JobStage.PARTIAL_PARSED, source: JobSource.BROWSER_AUTO, error: 'Timeout' });
    expect(mockChannel.publish).toHaveBeenCalledWith(
      'jobs.events',
      ActionEvent.PARSE_FAILED,
      expect.any(Buffer),
      expect.objectContaining({ persistent: true }),
    );
    const buffer = mockChannel.publish.mock.calls[0][2] as Buffer;
    expect(JSON.parse(buffer.toString())).toEqual({ jobLifecycleId: 'job-1' });
  });

  it('includes trace context headers when provided', async () => {
    const adapterWithTrace = new RabbitMqParseAdapter(mockRmq as any, { traceId: 'trace-123' });
    await adapterWithTrace.emitGenerated({ _id: 'job-1' }, { stage: JobStage.PARTIAL_PARSED, source: JobSource.BROWSER_AUTO });
    expect(mockChannel.publish).toHaveBeenCalledWith(
      'jobs.events',
      ActionEvent.GENERATED,
      expect.any(Buffer),
      expect.objectContaining({ headers: { 'x-trace-id': 'trace-123' }, persistent: true }),
    );
  });
});
