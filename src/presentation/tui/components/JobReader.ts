import type { Job } from '../../../domain/types/job.js';
import { getLogger } from '../../../infrastructure/outbound/logging/logger.js';

const logger = getLogger();

export class JobReader {
  private jobQueue: Job[] = [];
  private processedIds = new Set<string>();
  private arrivalSignal: (() => void) | null = null;

  addEventListener(_eventType: string, _callback: (event: any) => void): void {}

  removeEventListener(_eventType: string, _callback: (event: any) => void): void {}

  start(_baseUrl: string, _token?: string): void {
    logger.info('[JobReader] Started (stub — replace with RabbitMqJobReader)');
  }

  stop(): void {
    logger.info('[JobReader] Stopped');
  }

  connect(): boolean {
    return true;
  }

  disconnect(): void {}

  isConnected(): boolean {
    return true;
  }

  getQueueDepth(): number {
    return this.jobQueue.length;
  }

  peekNextJob(): Job | null {
    return this.jobQueue[0] ?? null;
  }

  async nextJob(): Promise<Job | null> {
    return this.jobQueue.shift() ?? null;
  }

  pushJob(job: Job): void {
    if (job._id && this.processedIds.has(job._id)) return;
    if (job._id) this.processedIds.add(job._id);
    this.jobQueue.push(job);
    this.arrivalSignal?.();
  }
}
