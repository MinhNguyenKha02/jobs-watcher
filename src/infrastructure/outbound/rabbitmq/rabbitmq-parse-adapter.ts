import type { ParsePort } from '../../../application/ports/parse.port.js';
import { ActionEvent } from '../../../domain/types/action-event.js';
import type { JobSource, JobStage, JobStatus } from '../../../domain/types/job-lifecycle.js';
import type { Job } from '../../../domain/types/job.js';
import type { DaemonMetricsRegistry } from '../monitoring/metrics-registry.js';
import { traceContextToHeaders, type TraceContext } from '../monitoring/trace-context.js';

import type { RabbitMqConnection } from './rabbitmq-connection.js';

export class RabbitMqParseAdapter implements ParsePort {
  constructor(
    private rmq: RabbitMqConnection,
    private metricsRegistry?: DaemonMetricsRegistry,
    private traceCtx?: TraceContext
  ) {}

  async emitGenerated(
    job: Job,
    context: { stage: JobStage; source: JobSource; status: JobStatus }
  ): Promise<void> {
    if (!job._id) throw new Error('emitGenerated requires _id');
    const channel = this.rmq.getChannel();
    const headers = this.traceCtx ? traceContextToHeaders(this.traceCtx) : {};
    channel.publish(
      this.rmq.getExchange(),
      ActionEvent.GENERATED,
      Buffer.from(
        JSON.stringify({ ...job, stage: context.stage, status: context.status, source: context.source })
      ),
      {
        headers,
        persistent: true,
      }
    );
    this.metricsRegistry?.rmqPublishedTotal.inc({ routingKey: ActionEvent.GENERATED });
  }

  async emitCompleted(
    job: Job,
    context: { stage: JobStage; source: JobSource; status: JobStatus }
  ): Promise<void> {
    if (!job._id) throw new Error('emitCompleted requires _id');
    const channel = this.rmq.getChannel();
    const headers = this.traceCtx ? traceContextToHeaders(this.traceCtx) : {};
    channel.publish(
      this.rmq.getExchange(),
      ActionEvent.PARSE_COMPLETED,
      Buffer.from(
        JSON.stringify({ ...job, stage: context.stage, status: context.status, source: context.source })
      ),
      {
        headers,
        persistent: true,
      }
    );
    this.metricsRegistry?.rmqPublishedTotal.inc({ routingKey: ActionEvent.PARSE_COMPLETED });
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
    this.metricsRegistry?.rmqPublishedTotal.inc({ routingKey: ActionEvent.PARSE_FAILED });
  }
}
