import type { ParsePort } from '../../../application/ports/parse.port.js';
import { ActionEvent } from '../../../domain/types/action-event.js';
import type { JobLifecycleDocument } from '../../outbound/persistence/schemas.js';
import { traceContextToHeaders, type TraceContext } from '../monitoring/trace-context.js';

import type { RabbitMqConnection } from './rabbitmq-connection.js';

export class RabbitMqParseAdapter implements ParsePort {
  constructor(
    private rmq: RabbitMqConnection,
    private traceCtx?: TraceContext
  ) {}

  async emitGenerated(job: Partial<JobLifecycleDocument>, _context: unknown): Promise<void> {
    const channel = this.rmq.getChannel();
    const headers = this.traceCtx ? traceContextToHeaders(this.traceCtx) : {};
    channel.publish(
      this.rmq.getExchange(),
      ActionEvent.GENERATED,
      Buffer.from(JSON.stringify(job)),
      {
        headers,
        persistent: true,
      }
    );
  }

  async emitCompleted(job: Partial<JobLifecycleDocument>, _context: unknown): Promise<void> {
    const channel = this.rmq.getChannel();
    const headers = this.traceCtx ? traceContextToHeaders(this.traceCtx) : {};
    channel.publish(
      this.rmq.getExchange(),
      ActionEvent.PARSE_COMPLETED,
      Buffer.from(JSON.stringify({ job })),
      {
        headers,
        persistent: true,
      }
    );
  }

  async emitFailed(jobLifecycleId: string, _context: unknown): Promise<void> {
    const channel = this.rmq.getChannel();
    const headers = this.traceCtx ? traceContextToHeaders(this.traceCtx) : {};
    channel.publish(
      this.rmq.getExchange(),
      ActionEvent.PARSE_FAILED,
      Buffer.from(JSON.stringify({ jobLifecycleId })),
      {
        headers,
        persistent: true,
      }
    );
  }
}
