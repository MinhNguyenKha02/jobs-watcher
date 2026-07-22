import amqplib, { type Channel } from 'amqplib';
import { getLogger } from '../logging/logger.js';

const logger = getLogger();

export interface RabbitMqConfig {
  url: string;
  exchange: string;
}

export class RabbitMqConnection {
  private connection: Awaited<ReturnType<typeof amqplib.connect>> | null = null;
  private channel: Channel | null = null;

  constructor(private config: RabbitMqConfig) {}

  async connect(): Promise<void> {
    this.connection = await amqplib.connect(this.config.url);
    this.channel = await this.connection.createChannel();
    await this.channel.assertExchange(this.config.exchange, 'topic', { durable: true });
    logger.info('[RabbitMq] Connected to exchange', { exchange: this.config.exchange });
  }

  async disconnect(): Promise<void> {
    try {
      await this.channel?.close();
      await this.connection?.close();
    } catch (err) {
      logger.warn('[RabbitMq] Disconnect error', { error: err instanceof Error ? err.message : String(err) });
    }
  }

  getChannel(): Channel {
    if (!this.channel) throw new Error('RabbitMqConnection not connected');
    return this.channel;
  }

  getExchange(): string {
    return this.config.exchange;
  }
}
