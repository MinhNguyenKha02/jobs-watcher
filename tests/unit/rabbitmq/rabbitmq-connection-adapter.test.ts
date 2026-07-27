import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockChannel = vi.hoisted(() => ({
  assertExchange: vi.fn().mockResolvedValue(undefined),
  close: vi.fn().mockResolvedValue(undefined),
}));

const mockConnection = vi.hoisted(() => ({
  createChannel: vi.fn().mockResolvedValue(mockChannel),
  close: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('amqplib', () => ({
  default: {
    connect: vi.fn().mockResolvedValue(mockConnection),
  },
}));

import { RabbitMqConnection } from '../../../src/infrastructure/outbound/rabbitmq/rabbitmq-connection.js';

describe('RabbitMqConnection', () => {
  let conn: RabbitMqConnection;

  beforeEach(() => {
    vi.clearAllMocks();
    conn = new RabbitMqConnection({ url: 'amqp://localhost', exchange: 'jobs.events' });
  });

  afterEach(async () => {
    await conn.disconnect().catch(() => {});
  });

  it('connect creates channel and asserts exchange', async () => {
    await conn.connect();
    expect(mockConnection.createChannel).toHaveBeenCalled();
    expect(mockChannel.assertExchange).toHaveBeenCalledWith('jobs.events', 'topic', { durable: true });
  });

  it('getChannel throws when not connected', () => {
    expect(() => conn.getChannel()).toThrow('RabbitMqConnection not connected');
  });

  it('getChannel returns channel after connect', async () => {
    await conn.connect();
    const channel = conn.getChannel();
    expect(channel).toBe(mockChannel);
  });

  it('disconnect closes channel and connection', async () => {
    await conn.connect();
    await conn.disconnect();
    expect(mockChannel.close).toHaveBeenCalled();
    expect(mockConnection.close).toHaveBeenCalled();
  });

  it('disconnect handles no-op when not connected', async () => {
    await expect(conn.disconnect()).resolves.toBeUndefined();
  });

  it('getExchange returns config exchange', () => {
    expect(conn.getExchange()).toBe('jobs.events');
  });
});
