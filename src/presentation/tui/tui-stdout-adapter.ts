import type { Job } from '../../domain/types/job.js';
import { startHealthServer } from '../../infrastructure/inbound/health/health-adapter.js';
import { createLogger } from '../../infrastructure/outbound/logging/logger.js';
import { TuiMetricsRegistry } from '../../infrastructure/outbound/monitoring/metrics-registry.js';
import { probeIpcPath, probeUdsActive } from '../../infrastructure/utils/uds-probe.js';

import { AnsiTerminal } from './components/AnsiTerminal.js';
import { JobCardRenderer, type CardStatus } from './components/JobCardRenderer.js';
import { renderPreviewViewerModal } from './components/PreviewViewerModal.js';
import { RabbitMqJobReader } from './components/RabbitMqJobReader.js';
import { getCurrentJob, getQueueMode, watchStateFile, ensureSharedStateFile, setCardScrollMax } from './shared-tui-state.js';
import type { CurrentJobState } from './shared-tui-state.js';

const logger = createLogger('TUI');

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
  private tuiMetrics: TuiMetricsRegistry;
  private healthServer: ReturnType<typeof startHealthServer> | null = null;

  private isRunning = false;
  private currentJob: Job | null = null;
  private state: TuiState = 'IDLE';
  private lastRenderedModalSignature: string = 'null';
  private lastRenderedJobLifecycleId: string | null = null;
  private lastRenderedCardScroll = 0;
  private lastQueueMode = true;
  private unwatchState: (() => void) | null = null;
  private probeTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: OpsTuiConfig) {
    this.config = config;
    this.tuiMetrics = new TuiMetricsRegistry();
    this.rmqReader = new RabbitMqJobReader(config.rmqUrl, { metricsRegistry: this.tuiMetrics });
    this.renderer = new JobCardRenderer();
    this.ansiTerminal = new AnsiTerminal();
  }

  async start(): Promise<void> {
    try {
      logger.info('Starting Render Server');
      // Preserve shared IPC across reruns (no wipe; --purge path in tmux script handles explicit clear).
      // Single recreate side: ensure file exists so ipc probe reads 1 and watch() avoids ENOENT.
      try {
        ensureSharedStateFile();
      } catch {}
      this.ansiTerminal.enableRawMode();

      await this.rmqReader.start();

      // AMQP duo: expose 9091 health on same TuiMetricsRegistry (2+1 obs, daemon 9090)
      const tuiPort = Number(process.env.TUI_HEALTH_PORT || process.env.TUI_PORT || '9091');
      const udsPath = process.env.UDS_SOCKET_PATH || '';
      this.healthServer = startHealthServer({
        port: tuiPort,
        metricsRegistry: this.tuiMetrics,
        containers: {
          tui: {
            ns: 'default',
            healthPort: tuiPort,
            rmq: { exchange: 'jobs.events', queues: { s1: 'tui.s1', s2: 'tui.s2', s2direct: 'tui.s2direct', s34: 'tui.s3s4' } },
            uds: { socketPath: udsPath },
          },
        },
      });
      logger.info('TUI health listening', { port: tuiPort });

      // P3 dual probe: file-exists fast path + active UDS dial (no POST side effect).
      const refreshProbe = (): void => {
        try {
          const statePath = process.env.TUI_SHARED_STATE_PATH || '';
          this.tuiMetrics.setInfraReady('ipc', probeIpcPath(statePath));
        } catch {
          this.tuiMetrics.setInfraReady('ipc', 0);
        }
        void probeUdsActive(udsPath).then((v) => {
          try {
            this.tuiMetrics.setInfraReady('uds_client', v);
          } catch {}
        });
      };
      refreshProbe();
      if (this.probeTimer) clearInterval(this.probeTimer);
      this.probeTimer = setInterval(refreshProbe, 2000);
      if (typeof (this.probeTimer as unknown as { unref?: () => void }).unref === 'function') {
        (this.probeTimer as unknown as { unref: () => void }).unref();
      }

      this.isRunning = true;
      // Event-driven repaint for cross-process IPC writes (PB mode/modal) + same-process reader.
      try {
        this.unwatchState = watchStateFile((s) => {
          if (!this.isRunning) return;
          this.lastRenderedModalSignature = JSON.stringify(s.modal ?? null);
          this.lastRenderedJobLifecycleId = s.jobLifecycleId;
          this.lastRenderedCardScroll = s.cardScroll;
          this.currentJob = s.job;
          this.state = s.job ? 'DISPLAY' : 'IDLE';
          this.lastQueueMode = getQueueMode();
          this.renderFrame(s.job);
        });
      } catch {}
      await this.mainLoop();
    } catch (err) {
      logger.error('Fatal error', { error: String(err) });
      throw err;
    } finally {
      this.stop();
    }
  }

  stop(): void {
    if (this.probeTimer) clearInterval(this.probeTimer);
    this.probeTimer = null;
    try {
      this.unwatchState?.();
    } catch {}
    this.unwatchState = null;
    if (!this.isRunning) return;
    logger.info('Shutting down...');
    this.isRunning = false;

    try {
      this.healthServer?.close();
    } catch {}
    this.healthServer = null;

    try {
      this.ansiTerminal.restoreTerminal();
      this.rmqReader.stop();
      // Preserve IPC on shutdown so rerun (no --purge) restores current job.
      logger.info('Graceful shutdown complete');
    } catch (err) {
      logger.warn('Error during shutdown', { error: String(err) });
    }
  }

  private async mainLoop(): Promise<void> {
    let renderCount = 0;

    while (this.isRunning) {
      try {
        const stateFileJob = getCurrentJob();
        const queueMode = getQueueMode();

        if (queueMode !== this.lastQueueMode) {
          this.lastQueueMode = queueMode;
          this.currentJob = stateFileJob.job;
          this.state = stateFileJob.job ? 'DISPLAY' : 'IDLE';
          this.lastRenderedJobLifecycleId = stateFileJob.jobLifecycleId;
          this.lastRenderedCardScroll = stateFileJob.cardScroll;
          this.renderFrame(this.currentJob);
        }

        const modalSignature = JSON.stringify(stateFileJob.modal ?? null);
        if (modalSignature !== this.lastRenderedModalSignature) {
          this.lastRenderedModalSignature = modalSignature;
          this.lastRenderedJobLifecycleId = stateFileJob.jobLifecycleId;
          this.lastRenderedCardScroll = stateFileJob.cardScroll;
          this.currentJob = stateFileJob.job;
          this.state = stateFileJob.job ? 'DISPLAY' : 'IDLE';
          this.renderFrame(stateFileJob.job);
        }

        // IPC job change (RMQ MAKES via set/clear + autoAdvance): repaint PA.
        if (stateFileJob.jobLifecycleId !== this.lastRenderedJobLifecycleId) {
          this.lastRenderedJobLifecycleId = stateFileJob.jobLifecycleId;
          this.lastRenderedCardScroll = stateFileJob.cardScroll;
          this.currentJob = stateFileJob.job;
          this.state = stateFileJob.job ? 'DISPLAY' : 'IDLE';
          this.renderFrame(stateFileJob.job);
        }

        // Card-scroll-only IPC write (PB ↑/↓): repaint PA at the new offset.
        if (stateFileJob.cardScroll !== this.lastRenderedCardScroll) {
          this.lastRenderedCardScroll = stateFileJob.cardScroll;
          this.currentJob = stateFileJob.job;
          this.state = stateFileJob.job ? 'DISPLAY' : 'IDLE';
          this.renderFrame(stateFileJob.job);
        }

        if (renderCount === 0) {
          renderCount++;
          this.lastRenderedJobLifecycleId = stateFileJob.jobLifecycleId;
          this.lastRenderedCardScroll = stateFileJob.cardScroll;
          this.currentJob = stateFileJob.job;
          this.state = stateFileJob.job ? 'DISPLAY' : 'IDLE';
          this.renderFrame(stateFileJob.job);
        }

        if (this.state === 'DISPLAY') {
          const displayedId = this.currentJob?._id;
          if (displayedId && stateFileJob.jobLifecycleId !== displayedId) {
            this.currentJob = stateFileJob.job;
            this.state = stateFileJob.job ? 'DISPLAY' : 'IDLE';
            this.lastRenderedJobLifecycleId = stateFileJob.jobLifecycleId;
            this.lastRenderedCardScroll = stateFileJob.cardScroll;
            this.renderFrame(this.currentJob);
          }
          await this.sleep(50);
          continue;
        }

        if (!queueMode) {
          await this.sleep(100);
          continue;
        }

        await this.sleep(100);
      } catch (err) {
        logger.error('Error in main loop', { error: String(err) });
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

    // Pending metrics from live reader (matches PC tui-poll Q/P/F/D).
    const cardStatus: CardStatus = {
      sseConnected: this.rmqReader.isConnected(),
      udsReady: true,
      state: this.state,
      message: '',
      queueMode: getQueueMode(),
      pendingDepth: this.rmqReader.getQueueDepth(),
      pendingPartial: this.rmqReader.getPendingPartial(),
      pendingFull: this.rmqReader.getPendingFull(),
      deferredCount: this.rmqReader.getDeferredCount(),
      currentJobId: state.jobLifecycleId,
      currentStage: state.stage,
    };

    const frame = this.renderer.renderCard(job, cardStatus, undefined, state.cardScroll);

    // B1-5 overflow gate: publish the body's max offset for PB (change-only
    // write inside — no watch loop). Stale by at most one render after resize.
    try {
      setCardScrollMax(this.renderer.cardBodyStats(job, cardStatus).maxOffset);
    } catch {}

    try {
      this.ansiTerminal.write('\x1b[H\x1b[J' + frame + '\n');
    } catch (err) {
      logger.error('Failed to write frame', {
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
        modalFrame = renderPreviewViewerModal(state.modal);
      } else {
        logger.warn('Unknown modal type', { modalType: state.modal.type });
        return;
      }
      this.ansiTerminal.write('\x1b[H\x1b[J' + modalFrame + '\n');
    } catch (err) {
      logger.error('Failed to render modal', {
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

  logger.debug('Starting with args', { args, isRenderOnly });

  if (isRenderOnly) {
    try {
      const config: OpsTuiConfig = {
        rmqUrl: process.env.RMQ_URL || 'amqp://guest:guest@127.0.0.1:5672',
      };

      logger.debug('Creating OpsTuiApp with config', { rmqUrl: config.rmqUrl });
      const app = new OpsTuiApp(config);
      await app.start();
    } catch (err) {
      logger.error('Fatal error in main', {
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      process.exit(1);
    }
  } else {
    logger.info('No --render-only flag, exiting');
    process.exit(0);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('Unhandled error in main:', err);
    process.exit(1);
  });
}
