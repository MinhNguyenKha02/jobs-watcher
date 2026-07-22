import type { ParsePort } from '../../../application/ports/parse.port.js';
import type { JobLifecycleDocument } from '../../outbound/persistence/schemas.js';
import type { RabbitMqConnection } from './rabbitmq-connection.js';
import { JobStage, JobSource } from '../../../domain/types/job-lifecycle.js';
import { traceContextToHeaders, type TraceContext } from '../monitoring/trace-context.js';

export class RabbitMqParseAdapter implements ParsePort {
  constructor(
    private rmq: RabbitMqConnection,
    private traceCtx?: TraceContext
  ) {}

  async emitGenerated(job: Partial<JobLifecycleDocument>, context: {
    stage: JobStage.PARTIAL_PARSED | JobStage.FULL_PARSED;
    source: JobSource.BROWSER_AUTO | JobSource.MANUAL;
  }): Promise<void> {
    const channel = this.rmq.getChannel();
    const routingKey = context.stage === JobStage.PARTIAL_PARSED ? 'job.s1.generated' : 'job.s2.generated';
    const headers = this.traceCtx ? traceContextToHeaders(this.traceCtx) : {};
    channel.publish(this.rmq.getExchange(), routingKey, Buffer.from(JSON.stringify(job)), {
      headers,
      persistent: true,
    });
  }

  async emitCompleted(jobLifecycleId: string, job: Partial<JobLifecycleDocument>, context: {
    stage: JobStage.FULL_PARSED;
    source: JobSource;
  }): Promise<void> {
    const channel = this.rmq.getChannel();
    const routingKey = 'job.s2.completed';
    const headers = this.traceCtx ? traceContextToHeaders(this.traceCtx) : {};
    channel.publish(this.rmq.getExchange(), routingKey, Buffer.from(JSON.stringify({ jobLifecycleId, job })), {
      headers,
      persistent: true,
    });
  }

  async emitFailed(jobLifecycleId: string, context: {
    stage: JobStage.PARTIAL_PARSED | JobStage.FULL_PARSED;
    source: JobSource.BROWSER_AUTO | JobSource.MANUAL;
    error: string;
  }): Promise<void> {
    const channel = this.rmq.getChannel();
    const routingKey = context.stage === JobStage.PARTIAL_PARSED ? 'job.s1.failed' : 'job.s2.failed';
    const headers = this.traceCtx ? traceContextToHeaders(this.traceCtx) : {};
    channel.publish(this.rmq.getExchange(), routingKey, Buffer.from(JSON.stringify({ jobLifecycleId, error: context.error })), {
      headers,
      persistent: true,
    });
  }
}
