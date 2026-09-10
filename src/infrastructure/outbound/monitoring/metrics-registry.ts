import { Counter, Gauge, Histogram, Registry } from 'prom-client';

export class DaemonMetricsRegistry {
  readonly register: Registry;

  readonly jobsBrokered: Counter<string>;
  readonly jobStageTotal: Counter<string>;
  readonly jobStageDuration: Histogram<string>;
  readonly jobErrors: Counter<string>;
  readonly jobsInFlight: Gauge<string>;
  readonly systemMemory: Gauge<string>;
  readonly systemCpu: Gauge<string>;
  readonly eventLoopLag: Gauge<string>;
  readonly extractionQueueEnqueueTotal: Counter<string>;
  readonly extractionQueueDequeueTotal: Counter<string>;
  readonly rmqPublishedTotal: Counter<string>;

  constructor(register?: Registry) {
    this.register = register ?? new Registry();

    this.jobsBrokered = new Counter({
      name: 'jobs_brokered_total',
      help: 'Total number of jobs brokered into the system',
      labelNames: ['source'],
      registers: [this.register],
    });

    this.jobStageTotal = new Counter({
      name: 'job_stage_total',
      help: 'Number of jobs at each pipeline stage',
      labelNames: ['stage', 'status'],
      registers: [this.register],
    });

    this.jobStageDuration = new Histogram({
      name: 'job_stage_duration_seconds',
      help: 'Duration of each pipeline stage',
      labelNames: ['stage'],
      buckets: [0.1, 0.5, 1, 2.5, 5, 10, 30, 60, 120],
      registers: [this.register],
    });

    this.jobErrors = new Counter({
      name: 'job_errors_total',
      help: 'Number of errors per stage',
      labelNames: ['stage', 'error_type'],
      registers: [this.register],
    });

    this.jobsInFlight = new Gauge({
      name: 'jobs_in_flight',
      help: 'Number of jobs currently being processed',
      labelNames: ['stage'],
      registers: [this.register],
    });

    this.systemMemory = new Gauge({
      name: 'system_memory_bytes',
      help: 'System memory usage by type',
      labelNames: ['type'],
      registers: [this.register],
    });

    this.systemCpu = new Gauge({
      name: 'system_cpu_percent',
      help: 'CPU usage percentage',
      registers: [this.register],
    });

    this.eventLoopLag = new Gauge({
      name: 'event_loop_lag_seconds',
      help: 'Event loop lag in seconds',
      registers: [this.register],
    });

    this.extractionQueueEnqueueTotal = new Counter({
      name: 'extraction_queue_enqueue_total',
      help: 'Number of jobs enqueued to extraction queue',
      registers: [this.register],
    });

    this.extractionQueueDequeueTotal = new Counter({
      name: 'extraction_queue_dequeue_total',
      help: 'Number of jobs dequeued from extraction queue',
      registers: [this.register],
    });

    this.rmqPublishedTotal = new Counter({
      name: 'rmq_published_total',
      help: 'Total RMQ messages published by daemon',
      labelNames: ['routingKey'],
      registers: [this.register],
    });
  }

  async metrics(): Promise<string> {
    return await this.register.metrics();
  }

  async metricsJson(): Promise<unknown> {
    return await this.register.getMetricsAsJSON();
  }

  clear(): void {
    this.register.clear();
  }
}

export class TuiMetricsRegistry {
  readonly register: Registry;

  readonly rmqPendingDepth: Gauge<string>;
  readonly rmqPendingPartial: Gauge<string>;
  readonly rmqPendingFull: Gauge<string>;
  readonly rmqDeferredCount: Gauge<string>;
  readonly rmqConnected: Gauge<string>;
  readonly rmqQueueMode: Gauge<string>;
  readonly rmqConsumedTotal: Counter<string>;
  readonly rmqPendingIds: Gauge<string>;

  constructor(register?: Registry) {
    this.register = register ?? new Registry();

    this.rmqPendingDepth = new Gauge({
      name: 'rmq_pending_depth',
      help: 'TUI RMQ pending depth (total)',
      labelNames: ['queue'],
      registers: [this.register],
    });

    this.rmqPendingPartial = new Gauge({
      name: 'rmq_pending_partial',
      help: 'TUI RMQ pending partial count',
      registers: [this.register],
    });

    this.rmqPendingFull = new Gauge({
      name: 'rmq_pending_full',
      help: 'TUI RMQ pending full count',
      registers: [this.register],
    });

    this.rmqDeferredCount = new Gauge({
      name: 'rmq_deferred_count',
      help: 'TUI RMQ deferred S2 count',
      registers: [this.register],
    });

    this.rmqConnected = new Gauge({
      name: 'rmq_connected',
      help: 'TUI RMQ connected (1) or disconnected (0)',
      registers: [this.register],
    });

    this.rmqQueueMode = new Gauge({
      name: 'rmq_queue_mode',
      help: 'TUI queue mode (1=queue ON, 0=direct)',
      registers: [this.register],
    });

    this.rmqConsumedTotal = new Counter({
      name: 'rmq_consumed_total',
      help: 'Total RMQ messages consumed by TUI',
      labelNames: ['queue', 'routingKey'],
      registers: [this.register],
    });

    this.rmqPendingIds = new Gauge({
      name: 'rmq_pending_ids',
      help: 'TUI RMQ pending ids (midTruncate 11, max 5)',
      labelNames: ['id'],
      registers: [this.register],
    });

    // initialize gauges to 0
    this.rmqPendingDepth.set({ queue: 'total' }, 0);
    this.rmqPendingPartial.set(0);
    this.rmqPendingFull.set(0);
    this.rmqDeferredCount.set(0);
    this.rmqConnected.set(0);
    this.rmqQueueMode.set(1);
  }

  syncSnapshot(snapshot: {
    depth: number;
    partial: number;
    full: number;
    deferred: number;
    connected: boolean;
    queueMode: boolean;
    peekIds: string[];
  }): void {
    this.rmqPendingDepth.set({ queue: 'total' }, snapshot.depth);
    this.rmqPendingPartial.set(snapshot.partial);
    this.rmqPendingFull.set(snapshot.full);
    this.rmqDeferredCount.set(snapshot.deferred);
    this.rmqConnected.set(snapshot.connected ? 1 : 0);
    this.rmqQueueMode.set(snapshot.queueMode ? 1 : 0);
    this.rmqPendingIds.reset();
    for (const id of snapshot.peekIds.slice(0, 5)) {
      this.rmqPendingIds.set({ id }, 1);
    }
  }

  incConsumed(queue: string, routingKey: string): void {
    this.rmqConsumedTotal.inc({ queue, routingKey });
  }

  async metrics(): Promise<string> {
    return await this.register.metrics();
  }

  async metricsJson(): Promise<unknown> {
    return await this.register.getMetricsAsJSON();
  }

  clear(): void {
    this.register.clear();
  }
}
