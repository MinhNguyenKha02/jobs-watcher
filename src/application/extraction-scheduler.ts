import { AntiBotBlockedError, matchBlockedContents } from '../domain/services/blocked-page-guard.js';
import { JobSource, JobStage } from '../domain/types/job-lifecycle.js';

import type { BrowserPort } from './ports/browser.port.js';
import type { ExtractionQueuePort } from './ports/extraction-queue.port.js';
import type { IngestorPort } from './ports/inbound/ingestor.port.js';
import type { JobLifecyclePort } from './ports/job-lifecycle.port.js';
import type { LoggerPort } from './ports/logger.port.js';
import type { DaemonMetricsPort } from './ports/metrics.port.js';
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
    private metricsRegistry?: DaemonMetricsPort,
    private logger?: LoggerPort,
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
    this.logger?.info('Started', { workers: WORKER_COUNT });
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
    this.logger?.info('Worker started', { workerId });
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
        this.logger?.info('Worker dequeued job', { workerId, jobLifecycleId });
        this.metricsRegistry?.jobsInFlight.inc({ stage: 's1', source: 'browser-auto', phase: 'enriching' });

        const jobDoc = await this.jobLifecycleColPort.findById(jobLifecycleId);
        if (!jobDoc) {
          this.logger?.error('findJobLifecycle returned null after dequeue — job lifecycle doc missing', {
            jobLifecycleId,
            action: 'job_lifecycle_doc_missing',
          });
        }
        const url = jobDoc?.url || '';
        const extractResult = await this.browser.extract(url);
        const rawPayload = extractResult.html;
        // Anti-bot guard over adapter outcome (port owner): hard edge blocks are unpreventable
        // client-side, so they route to the existing PARTIAL fallback (manual TUI rescue), never FULL.
        const marker = matchBlockedContents(rawPayload);
        if (marker) throw new AntiBotBlockedError(url, marker);
        await this.ingestor.processIngest(
          JobSource.BROWSER_AUTO,
          JobStage.FULL_PARSED,
          rawPayload,
          jobLifecycleId
        );
        this.metricsRegistry?.jobsInFlight.dec({ stage: 's1', source: 'browser-auto', phase: 'enriching' });
        if (startMs > 0) {
          const durationSec = (Date.now() - startMs) / 1000;
          this.metricsRegistry?.jobStageDuration.observe({ stage: 'extraction' }, durationSec);
        }
      } catch (extractErr) {
        const errMsg = extractErr instanceof Error ? extractErr.message : String(extractErr);
        const marker = extractErr instanceof AntiBotBlockedError ? extractErr.marker : undefined;
        this.logger?.warn('Extraction failed', { workerId, jobLifecycleId, error: errMsg, ...(marker ? { marker } : {}) });
        this.metricsRegistry?.jobsInFlight.dec({ stage: 's1', source: 'browser-auto', phase: 'enriching' });
        this.metricsRegistry?.jobErrors.inc({
          stage: 'extraction',
          error_type: marker ? 'anti_bot_block' : 'browser',
          ...(marker ? { marker } : {}),
        });
        await this.ingestor.processIngest(
          JobSource.BROWSER_AUTO,
          JobStage.PARTIAL_PARSED,
          '',
          jobLifecycleId
        );
      }
    }
    this.logger?.info('Worker stopped', { workerId });
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
    this.logger?.info('Stopped');
  }
}
