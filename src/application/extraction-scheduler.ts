import { JobSource, JobStage } from '../domain/types/job-lifecycle.js';
import { createLogger } from '../infrastructure/outbound/logging/logger.js';
import type { DaemonMetricsRegistry } from '../infrastructure/outbound/monitoring/metrics-registry.js';

import type { BrowserPort } from './ports/browser.port.js';
import type { ExtractionQueuePort } from './ports/extraction-queue.port.js';
import type { IngestorPort } from './ports/inbound/ingestor.port.js';
import type { JobLifecyclePort } from './ports/job-lifecycle.port.js';

const logger = createLogger('ExtractionScheduler');
const WORKER_COUNT = 3;

export class ExtractionScheduler {
  private workers: Promise<void>[] = [];
  private running = false;
  private stopRequested = false;
  private waiters: Array<() => void> = [];

  constructor(
    private queue: ExtractionQueuePort,
    private browser: BrowserPort,
    private jobLifecycleColPort: JobLifecyclePort,
    private ingestor: IngestorPort,
    private metricsRegistry?: DaemonMetricsRegistry
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
    logger.info('Started', { workers: WORKER_COUNT });
  }

  private wakeOneWorker(): void {
    const resolve = this.waiters.shift();
    if (resolve) resolve();
  }

  private async waitForTurn(): Promise<void> {
    if (this.stopRequested) return;

    await new Promise<void>((resolve) => {
      if (this.stopRequested) {
        resolve();
        return;
      }

      this.waiters.push(resolve);

      void this.queue.size().then((sz) => {
        if (sz > 0) {
          const idx = this.waiters.indexOf(resolve);
          if (idx !== -1) {
            this.waiters.splice(idx, 1);
            resolve();
          }
        }
      });
    });
  }

  private async runWorker(workerId: number): Promise<void> {
    logger.info('Worker started', { workerId });
    while (!this.stopRequested) {
      let jobLifecycleId: string | undefined;
      let startMs = 0;
      try {
        const item = await this.queue.dequeue();
        if (!item) {
          await this.waitForTurn();
          continue;
        }
        jobLifecycleId = item.jobLifecycleId;
        startMs = Date.now();
        logger.info('Worker dequeued job', { workerId, jobLifecycleId });
        this.metricsRegistry?.jobsInFlight.inc({ stage: 's1' });

        const jobDoc = await this.jobLifecycleColPort.findById(jobLifecycleId);
        if (!jobDoc) {
          logger.error('findJobLifecycle returned null after dequeue — job lifecycle doc missing', {
            jobLifecycleId,
            action: 'job_lifecycle_doc_missing',
          });
        }
        const url = jobDoc?.url || '';
        const extractResult = await this.browser.extract(url);
        const rawPayload = extractResult.html;
        await this.ingestor.processIngest(
          JobSource.BROWSER_AUTO,
          JobStage.FULL_PARSED,
          rawPayload,
          jobLifecycleId
        );
        this.metricsRegistry?.jobsInFlight.dec({ stage: 's1' });
        if (startMs > 0) {
          const durationSec = (Date.now() - startMs) / 1000;
          this.metricsRegistry?.jobStageDuration.observe({ stage: 'extraction' }, durationSec);
        }
      } catch (extractErr) {
        const errMsg = extractErr instanceof Error ? extractErr.message : String(extractErr);
        logger.warn('Extraction failed', { workerId, jobLifecycleId, error: errMsg });
        this.metricsRegistry?.jobsInFlight.dec({ stage: 's1' });
        this.metricsRegistry?.jobErrors.inc({ stage: 'extraction', error_type: 'browser' });
        await this.ingestor.processIngest(
          JobSource.BROWSER_AUTO,
          JobStage.PARTIAL_PARSED,
          '',
          jobLifecycleId
        );
      }
    }
    logger.info('Worker stopped', { workerId });
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
    logger.info('Stopped');
  }
}
