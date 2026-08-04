import amqplib, { type Channel, type ChannelModel } from 'amqplib';
import { RabbitMqConnection } from '../../src/infrastructure/outbound/rabbitmq/rabbitmq-connection.js';
import { RabbitMqParseAdapter } from '../../src/infrastructure/outbound/rabbitmq/rabbitmq-parse-adapter.js';
import { RabbitMqRoutingAdapter } from '../../src/infrastructure/outbound/rabbitmq/rabbitmq-route-adapter.js';
import type { ParsePort } from '../../src/application/ports/parse.port.js';
import type { RoutePort } from '../../src/application/ports/route.port.js';
import { ActionEvent } from '../../src/domain/types/action-event.js';

const RMQ_URL = process.env.RABBITMQ_URL || 'amqp://localhost';

export interface ConsumeHandle {
  /** Resolves with the first message matching the bound routing keys. */
  msg: () => Promise<any>;
}

export interface RealDipBus {
  exchange: string;
  rmqConnection: RabbitMqConnection;
  parsePort: ParsePort;
  routePort: RoutePort;
  /**
   * Binds a fresh exclusive queue to the given routing keys and awaits the
   * binding, so the caller can `await bus.setup(...)` BEFORE triggering the
   * system-under-test. This removes the bind-vs-publish race and keeps each
   * consumption isolated per test.
   */
  setup: (routingKeys: ActionEvent[], timeoutMs?: number) => Promise<ConsumeHandle>;
  teardown: () => Promise<void>;
}

/**
 * Real-DIP bus harness: wires real RabbitMQ Parse/Route adapters over the
 * application ports (ParsePort/RoutePort) so a JobIngestor built on them
 * exercises the actual outbound adapters — the runtime DIP proof.
 *
 * Consumers use a fresh exclusive queue bound at consume-time, so runs are
 * deterministic and cannot collide with the live system or sibling suites.
 */
export async function createRealDipBus(exchange: string): Promise<RealDipBus> {
  const conn = await amqplib.connect(RMQ_URL);
  const ch = await conn.createChannel();
  await ch.assertExchange(exchange, 'topic', { durable: true });

  const rmqConnection = new RabbitMqConnection({ url: RMQ_URL, exchange });
  await rmqConnection.connect();

  const setup = async (routingKeys: ActionEvent[], timeoutMs = 10000): Promise<ConsumeHandle> => {
    const { queue } = await ch.assertQueue('', { exclusive: true });
    for (const key of routingKeys) {
      await ch.bindQueue(queue, exchange, key);
    }
    return {
      msg: () =>
        new Promise<any>((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error(`Timeout waiting for message on ${exchange}:${routingKeys.join('|')}`)),
            timeoutMs,
          );
          ch.consume(
            queue,
            (msg) => {
              if (msg) {
                clearTimeout(timer);
                ch.ack(msg);
                resolve(JSON.parse(msg.content.toString()));
              }
            },
            { noAck: false },
          );
        }),
    };
  };

  return {
    exchange,
    rmqConnection,
    parsePort: new RabbitMqParseAdapter(rmqConnection),
    routePort: new RabbitMqRoutingAdapter(rmqConnection),
    setup,
    teardown: async () => {
      try { await rmqConnection.disconnect(); } catch {}
      try { await ch.close(); } catch {}
      try { await conn.close(); } catch {}
    },
  };
}