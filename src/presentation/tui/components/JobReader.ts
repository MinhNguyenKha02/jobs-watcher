import type { Job } from '../../../domain/types/job.js';

export class JobReader {
  private jobQueue: Job[] = [];
  private processedIds = new Set<string>();
  private arrivalSignal: (() => void) | null = null;

  addEventListener(_eventType: string, _callback: (event: unknown) => void): void {}

  removeEventListener(_eventType: string, _callback: (event: unknown) => void): void {}

  start(_baseUrl: string, _token?: string): void {}

  stop(): void {}

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
