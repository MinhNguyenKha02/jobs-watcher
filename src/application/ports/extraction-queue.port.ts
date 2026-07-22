import type { ExtractionQueueDocument } from '../../domain/types/extraction-queue.js';

export interface ExtractionQueuePort {
  enqueue(jobLifecycleId: string): Promise<void>;
  dequeue(): Promise<ExtractionQueueDocument | null>;
  size(): Promise<number>;
  onEnqueue(cb: () => void): void;
}
