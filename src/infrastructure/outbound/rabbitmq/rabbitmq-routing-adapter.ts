import type { RoutingPort } from '../../../application/ports/routing.port.js';
import type { JobLifecycleDocument } from '../../outbound/persistence/schemas.js';
import type { RabbitMqConnection } from './rabbitmq-connection-adapter.js';
import { ActionEvent } from '../../../domain/types/action-event.js';
import { traceContextToHeaders, type TraceContext } from '../monitoring/trace-context.js';

export class RabbitMqRoutingAdapter implements RoutingPort {
  constructor(
    private rmq: RabbitMqConnection,
    private traceCtx?: TraceContext
  ) {}

  async emitJobQueued(job: Partial<JobLifecycleDocument>, context?: unknown): Promise<void> {
    const channel = this.rmq.getChannel();
    const headers = this.traceCtx ? traceContextToHeaders(this.traceCtx) : {};
    channel.publish(this.rmq.getExchange(), ActionEvent.QUEUED, Buffer.from(JSON.stringify({ job, context })), {
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
