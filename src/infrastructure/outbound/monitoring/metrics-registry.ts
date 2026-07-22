import { Counter, Gauge, Histogram, Registry } from 'prom-client';

export class MetricsRegistry {
  readonly register: Registry;

  readonly jobsBrokered: Counter<string>;
  readonly jobStageTotal: Counter<string>;
  readonly jobStageDuration: Histogram<string>;
  readonly jobErrors: Counter<string>;
  readonly jobsInFlight: Gauge<string>;
  readonly systemMemory: Gauge<string>;
  readonly systemCpu: Gauge<string>;
  readonly eventLoopLag: Gauge<string>;

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
  }

  async metrics(): Promise<string> {
    return await this.register.metrics();
  }

  clear(): void {
    this.register.clear();
  }
}
