import { getLogger } from '../infrastructure/outbound/logging/logger.js';
import { JobSource, JobStage } from '../domain/types/job-lifecycle.js';
import type { ExtractionQueuePort } from './ports/extraction-queue.port.js';
import type { BrowserPort } from './ports/browser.port.js';

const logger = getLogger();
const WORKER_COUNT = 3;

type ProcessIngestCommand = (command: {
  source: JobSource;
  stage: JobStage;
  rawPayload: string;
  jobLifecycleId?: string;
}) => Promise<void>;
type FindJobLifecycle = (jobLifecycleId: string) => Promise<{ url?: string } | null>;

export class ExtractionScheduler {
  private workers: Promise<void>[] = [];
  private running = false;
  private stopRequested = false;
  private waiters: Array<() => void> = [];

  constructor(
    private queue: ExtractionQueuePort,
    private browser: BrowserPort,
    private processIngest: ProcessIngestCommand,
    private findJobLifecycle: FindJobLifecycle,
  ) {}

  async start(): Promise<void> {
    this.running = true;
    this.stopRequested = false;
    await this.browser.start();

    this.queue.onEnqueue(() => this.wakeOneWorker());

    for (let i = 0; i < WORKER_COUNT; i++) {
      const worker = this.runWorker(i);
      this.workers.push(worker);
    }
    logger.info('[ExtractionScheduler] Started', { workers: WORKER_COUNT });
  }

  private wakeOneWorker(): void {
    const resolve = this.waiters.shift();
    if (resolve) resolve();
  }

  private async waitForTurn(): Promise<void> {
    if (this.stopRequested) return;

    await new Promise<void>(resolve => {
      if (this.stopRequested) { resolve(); return; }

      this.waiters.push(resolve);

      void this.queue.size().then(sz => {
        if (sz > 0) {
          const idx = this.waiters.indexOf(resolve);
          if (idx !== -1) { this.waiters.splice(idx, 1); resolve(); }
        }
      });
    });
  }

  private async runWorker(workerId: number): Promise<void> {
    logger.info('[ExtractionScheduler] Worker started', { workerId });
    while (!this.stopRequested) {
      let jobLifecycleId: string | undefined;
      try {
        const item = await this.queue.dequeue();
        if (!item) {
          await this.waitForTurn();
          continue;
        }
        logger.info('[ExtractionScheduler] Worker dequeued job', { workerId, jobLifecycleId: item.jobLifecycleId });

        jobLifecycleId = item.jobLifecycleId;
        const jobDoc = await this.findJobLifecycle(jobLifecycleId);
        if (!jobDoc) {
          logger.error('[ExtractionScheduler] findJobLifecycle returned null after dequeue — job lifecycle doc missing', {
            jobLifecycleId,
            action: 'job_lifecycle_doc_missing',
          });
        }1
        const url = jobDoc?.url || '';
        const extractResult = await this.browser.extract(url);
        const rawPayload = extractResult.html;
        await this.processIngest({
          source: JobSource.BROWSER_AUTO,
          stage: JobStage.FULL_PARSED,
          rawPayload,
          jobLifecycleId: jobLifecycleId,
        });
      } catch (extractErr) {
        const errMsg = extractErr instanceof Error ? extractErr.message : String(extractErr);
        logger.warn('[ExtractionScheduler] Extraction failed', { workerId, jobLifecycleId, error: errMsg });
        await this.processIngest({
          source: JobSource.BROWSER_AUTO,
          stage: JobStage.PARTIAL_PARSED,
          rawPayload: '',
          jobLifecycleId: jobLifecycleId,
        });
      }
    }
    logger.info('[ExtractionScheduler] Worker stopped', { workerId });
  }

  async stop(): Promise<void> {
    this.stopRequested = true;
    while (this.waiters.length > 0) {
      const resolve = this.waiters.shift();
      if (resolve) resolve();
    }
    await Promise.all(this.workers);
    await this.browser.stop();
    this.running = false;
    logger.info('[ExtractionScheduler] Stopped');
  }
}
