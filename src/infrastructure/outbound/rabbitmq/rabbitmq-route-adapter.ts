import type { RoutePort } from '../../../application/ports/route.port.js';
import type { JobLifecycleDocument } from '../persistence/schemas.js';
import type { RabbitMqConnection } from './rabbitmq-connection.js';
import { ActionEvent } from '../../../domain/types/action-event.js';
import { traceContextToHeaders, type TraceContext } from '../monitoring/trace-context.js';

export class RabbitMqRoutingAdapter implements RoutePort {
  constructor(
    private rmq: RabbitMqConnection,
    private traceCtx?: TraceContext
  ) {}

  async emitJobQueued(jobLifecycleId: string, context?: unknown): Promise<void> {
    const channel = this.rmq.getChannel();
    const headers = this.traceCtx ? traceContextToHeaders(this.traceCtx) : {};
    channel.publish(this.rmq.getExchange(), ActionEvent.QUEUED, Buffer.from(JSON.stringify({ jobLifecycleId, context })), {
      headers,
      persistent: true,
    });
  }

  async emitJobTrashed(jobLifecycleId: string, reason: string, context?: unknown): Promise<void> {
    const channel = this.rmq.getChannel();
    const headers = this.traceCtx ? traceContextToHeaders(this.traceCtx) : {};
    channel.publish(this.rmq.getExchange(), ActionEvent.TRASHED, Buffer.from(JSON.stringify({ jobLifecycleId, reason, context })), {
      headers,
      persistent: true,
    });
  }

  async emitRouteFailed(jobLifecycleId: string, reason: string, context?: unknown): Promise<void> {
    const channel = this.rmq.getChannel();
    const headers = this.traceCtx ? traceContextToHeaders(this.traceCtx) : {};
    channel.publish(this.rmq.getExchange(), ActionEvent.ROUTE_FAILED, Buffer.from(JSON.stringify({ jobLifecycleId, reason, context })), {
      headers,
      persistent: true,
    });
  }
}
