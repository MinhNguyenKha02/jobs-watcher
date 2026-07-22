import { getLogger } from '../../infrastructure/outbound/logging/logger.js';
import type { Job } from '../../domain/types/job.js';

import { RabbitMqJobReader } from './components/RabbitMqJobReader.js';
import { JobCardRenderer, type CardStatus } from './components/JobCardRenderer.js';
import { AnsiTerminal } from './components/AnsiTerminal.js';
import { renderPreviewViewerModal } from './components/PreviewViewerModal.js';
import { clearCurrentJob, setCurrentJob, getCurrentJob, getQueueMode, resetState } from './shared-tui-state.js';
import type { CurrentJobState } from './shared-tui-state.js';

const logger = getLogger();

type TuiState = 'IDLE' | 'DISPLAY';

export interface OpsTuiConfig {
  rmqUrl: string;
  socketPath?: string;
  udsToken?: string;
  pollIntervalMs?: number;
  preferredEditor?: 'nano';
}

export class OpsTuiApp {
  private config: OpsTuiConfig;
  private rmqReader: RabbitMqJobReader;
  private renderer: JobCardRenderer;
  private ansiTerminal: AnsiTerminal;

  private isRunning = false;
  private currentJob: Job | null = null;
  private state: TuiState = 'IDLE';
  private lastRenderedModalSignature: string = 'null';
  private lastClearedJobLifecycleId: string | null = null;
  private lastQueueMode = true;

  constructor(config: OpsTuiConfig) {
    this.config = config;
    this.rmqReader = new RabbitMqJobReader(config.rmqUrl);
    this.renderer = new JobCardRenderer();
    this.ansiTerminal = new AnsiTerminal();
  }

  async start(): Promise<void> {
    try {
      logger.info('[render-server] Starting Render Server');
      resetState();

      this.ansiTerminal.enableRawMode();

      await this.rmqReader.start();

      this.isRunning = true;
      await this.mainLoop();
    } catch (err) {
      logger.error('[render-server] Fatal error', { error: String(err) });
      throw err;
    } finally {
      this.stop();
    }
  }

  stop(): void {
    if (!this.isRunning) return;
    logger.info('[render-server] Shutting down...');
    this.isRunning = false;

    try {
      this.ansiTerminal.restoreTerminal();
      this.rmqReader.stop();
      clearCurrentJob();
      logger.info('[render-server] Graceful shutdown complete');
    } catch (err) {
      logger.warn('[render-server] Error during shutdown', { error: String(err) });
    }
  }

  private async mainLoop(): Promise<void> {
    let lastRenderedJobLifecycleId: string | null = null;
    let renderCount = 0;

    while (this.isRunning) {
      try {
        const stateFileJob = getCurrentJob();
        const queueMode = getQueueMode();

        if (queueMode !== this.lastQueueMode) {
          this.lastQueueMode = queueMode;
          this.currentJob = stateFileJob.job;
          this.state = stateFileJob.job ? 'DISPLAY' : 'IDLE';
          this.renderFrame(this.currentJob);
        }

        const modalSignature = JSON.stringify(stateFileJob.modal ?? null);
        if (modalSignature !== this.lastRenderedModalSignature) {
          this.lastRenderedModalSignature = modalSignature;
          this.renderFrame(stateFileJob.job);
        }

        if (renderCount === 0) {
          renderCount++;
          this.renderFrame(null);
        }

        if (this.state === 'DISPLAY') {
          const displayedId = this.currentJob?._id;
          if (displayedId && stateFileJob.jobLifecycleId !== displayedId) {
            this.currentJob = stateFileJob.job;
            this.state = stateFileJob.job ? 'DISPLAY' : 'IDLE';
          }
          await this.sleep(50);
          continue;
        }

        if (!queueMode) {
          await this.sleep(100);
          continue;
        }

        if (this.rmqReader.getQueueDepth() === 0) {
          await this.sleep(200);
          continue;
        }

        await this.sleep(100);
      } catch (err) {
        logger.error('[render-server] Error in main loop', { error: String(err) });
        await this.sleep(1000);
      }
    }
  }

  private renderFrame(job: Job | null = this.currentJob): void {
    const state = getCurrentJob();
    if (state.modal) {
      this.renderModal(state);
      return;
    }

    const cardStatus: CardStatus = {
      sseConnected: this.rmqReader.isConnected(),
      udsReady: true,
      state: this.state,
      message: '',
      queueMode: getQueueMode(),
    };

    const frame = this.renderer.renderCard(job, cardStatus);

    try {
      this.ansiTerminal.write('\x1b[H\x1b[J' + frame + '\n');
    } catch (err) {
      logger.error('[RENDER] Failed to write frame', {
        error: String(err),
        jobLifecycleId: job?._id,
      });
    }
  }

  private renderModal(state: CurrentJobState): void {
    if (!state.modal) return;
    try {
      let modalFrame = '';

      if (state.modal.type === 'PREVIEW_VIEWER') {
        modalFrame = renderPreviewViewerModal(state.modal, state);
        logger.debug('[RENDER] Rendering PREVIEW_VIEWER modal', {
          jobLifecycleId: state.jobLifecycleId,
          currentPage: state.modal.currentPage,
          maxPages: state.modal.maxPages,
        });
      } else {
        logger.warn('[RENDER] Unknown modal type', { modalType: state.modal.type });
        return;
      }
      this.ansiTerminal.write('\x1b[H\x1b[J' + modalFrame + '\n');
      logger.debug('[RENDER] Modal frame written to terminal', {
        modalType: state.modal.type,
      });
    } catch (err) {
      logger.error('[RENDER] Failed to render modal', {
        error: String(err),
        modalType: state.modal?.type,
      });
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

async function main() {
  const args = process.argv.slice(2);
  const isRenderOnly = args.includes('--render-only');

  logger.info('[render-server] Starting with args:', { args, isRenderOnly });

  if (isRenderOnly) {
    try {
      const config: OpsTuiConfig = {
        rmqUrl: process.env.RMQ_URL || 'amqp://guest:guest@127.0.0.1:5672',
      };

      logger.info('[render-server] Creating OpsTuiApp with config', { rmqUrl: config.rmqUrl });
      const app = new OpsTuiApp(config);
      logger.info('[render-server] Calling app.start()');
      await app.start();
    } catch (err) {
      logger.error('[render-server] Fatal error in main', {
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      process.exit(1);
    }
  } else {
    logger.info('[render-server] No --render-only flag, exiting');
    process.exit(0);
  }
}

main().catch((err) => {
  console.error('[render-server] Unhandled error in main:', err);
  process.exit(1);
});
