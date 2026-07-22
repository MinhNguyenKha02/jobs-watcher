import type { RoutingPort } from '../../../application/ports/routing.port.js';
import type { JobLifecycleDocument } from '../../outbound/persistence/schemas.js';
import type { RabbitMqConnection } from './rabbitmq-connection.js';
import { JobSource } from '../../../domain/types/job-lifecycle.js';
import { traceContextToHeaders, type TraceContext } from '../monitoring/trace-context.js';

export class RabbitMqRoutingAdapter implements RoutingPort {
  constructor(
    private rmq: RabbitMqConnection,
    private traceCtx?: TraceContext
  ) {}

  async emitJobQueued(job: Partial<JobLifecycleDocument>, context?: { source: JobSource }): Promise<void> {
    const channel = this.rmq.getChannel();
    const headers = this.traceCtx ? traceContextToHeaders(this.traceCtx) : {};
    channel.publish(this.rmq.getExchange(), 'job.s3.queued', Buffer.from(JSON.stringify({ job, context })), {
      headers,
      persistent: true,
    });
  }

  async emitJobTrashed(jobLifecycleId: string, reason: string, context?: { operatorEdits?: Record<string, unknown> }): Promise<void> {
    const channel = this.rmq.getChannel();
    const headers = this.traceCtx ? traceContextToHeaders(this.traceCtx) : {};
    channel.publish(this.rmq.getExchange(), 'job.s3.trashed', Buffer.from(JSON.stringify({ jobLifecycleId, reason, context })), {
      headers,
      persistent: true,
    });
  }

  async emitRouteFailed(jobLifecycleId: string, reason: string, context?: { operatorEdits?: Record<string, unknown> }): Promise<void> {
    const channel = this.rmq.getChannel();
    const headers = this.traceCtx ? traceContextToHeaders(this.traceCtx) : {};
    channel.publish(this.rmq.getExchange(), 'job.s4.failed', Buffer.from(JSON.stringify({ jobLifecycleId, reason, context })), {
      headers,
      persistent: true,
    });
  }
}
