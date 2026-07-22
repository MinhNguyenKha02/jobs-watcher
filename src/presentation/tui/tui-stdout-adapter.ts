/**
 * Render Server - TUI Render Process
 *
 * Render-only process: Displays jobs from RabbitMQ stream (3-queue topology)
 * No keyboard input handling (handled by tui-stdin-adapter.ts)
 * 
 * State Lifecycle:
 * - Signal 1 (job.generated): setCurrentJob(job, 'PARTIAL')
 * - Signal 2 (job.parse.completed): setCurrentJob(job, 'FULL_PARSED')
 * - Signal 3 (job.routed): clearCurrentJob() → back to IDLE
 * 
 * Features:
 * - Event-driven RMQ subscription (no polling)
 * - Single active job (FIFO queue)
 * - Full ANSI redraw per frame
 * - All logs to stderr, UI to stdout
 * - ~20 FPS refresh rate
 */

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

  /**
   * Start the TUI app (render-server mode).
   */
  async start(): Promise<void> {
    try {
      logger.info('[render-server] 🚀 Starting Render Server (render-only mode)');
      resetState();

      // Enable ANSI terminal raw mode
      this.ansiTerminal.enableRawMode();

      // Connect to RabbitMQ
      await this.rmqReader.connect();
      logger.info('[render-server] ✓ RMQ connected');

      // Register signal listeners for state lifecycle
      this.registerSignalListeners();

      // Main event loop (render only, no keyboard)
      this.isRunning = true;
      await this.mainLoop();
    } catch (err) {
      logger.error('[render-server] Fatal error', { error: String(err) });
      throw err;
    } finally {
      this.stop();
    }
  }

  /**
   * Register listeners for RMQ signals (job.generated, job.parse.completed, job.routed)
   */
  private registerSignalListeners(): void {
    logger.info('[render-server] Registering signal listeners...');
    
    // Signal 1: job.generated - job enters system with PARTIAL data
    this.rmqReader.addEventListener('job.generated', (event: any) => {
      logger.info('[SIGNAL-1] 📨 Received job.generated event (raw)', {
        eventType: event.type,
        hasData: !!event.data,
        hasPayload: !!event.payload,
        dataPreview: String(event.data || event.payload).substring(0, 60),
      });
      
      try {
        const payload = event.data || event.payload;
        if (!payload) {
          logger.warn('[SIGNAL-1] No payload found in event');
          return;
        }
        
        const jobLifecycleId = payload?.jobLifecycleId;
        const company = payload?.company;
        const position = payload?.position || payload?.title;
        
        logger.info('[SIGNAL-1] Parsed values', {
          jobLifecycleId,
          company,
          position,
          payloadKeys: Object.keys(payload).slice(0, 5),
        });
        
        if (!jobLifecycleId) {
          logger.warn('[SIGNAL-1] No jobLifecycleId in payload, skipping');
          return;
        }

        // Signal 1 is informational only — render loop handles setCurrentJob on dequeue
        // (Removed setCurrentJob from here to fix race condition: S1 burst would overwrite state)
        
        logger.info('[SIGNAL-1] Job received and queued', {
          jobLifecycleId,
          company,
          position,
          queueDepth: this.rmqReader.getQueueDepth(),
        });

        logger.info('[SIGNAL-1] ✅ Signal processed (state updated by render loop only)', {
          jobLifecycleId,
        });
      } catch (err) {
        logger.error('[SIGNAL-1] ❌ Error processing job.generated', {
          error: String(err),
          stack: (err as any)?.stack?.split('\\n')[0],
        });
      }
    });

    // Signal 2: job.parse.completed - job enriched with full parsed data + score
    // Unified guard for both modes:
    //   - Queue mode: enrichment for displayed job (currentJob must exist, jobLifecycleId must match)
    //   - Direct mode: fresh job arrival via [i] → UDS → ingestor → SSE (currentJob may be null)
    this.rmqReader.addEventListener('job.parse.completed', (event: any) => {
      logger.info('[SIGNAL-2] 📨 Received job.parse.completed event', {
        eventType: event.type,
        dataPreview: String(event.data || event.payload).substring(0, 60),
      });
      
      try {
        const payload = event.data || event.payload;
        const jobLifecycleId = payload?.jobLifecycleId;
        
        logger.info('[SIGNAL-2] Parsed values', { jobLifecycleId });
        
        if (!jobLifecycleId) {
          logger.warn('[SIGNAL-2] No jobLifecycleId in payload');
          return;
        }

        const isQueueMode = getQueueMode();
        const displayedId = this.currentJob?._id;

        // Cross-job guard: Signal 2 belongs to a different displayed job — skip (queue mode only)
        // Direct mode: accept any lifecycleId (single-slot, always show latest [i] result)
        if (isQueueMode && this.currentJob && displayedId !== jobLifecycleId) {
          logger.info('[SIGNAL-2] Signal for different job (not displayed), skipping', {
            displayedId,
            signalJobLifecycleId: jobLifecycleId,
          });
          return;
        }

        // Queue guard: Signal 2 arrived before render loop dequeued — defer
        if (!this.currentJob && isQueueMode) {
          logger.info('[SIGNAL-2] No current job yet (queue mode), defer', {
            jobLifecycleId,
          });
          return;
        }

        // Accept: direct mode fresh job or enrichment for displayed job
        const currentStage = getCurrentJob().stage;
        const enrichedJob = this.currentJob
          ? { ...this.currentJob, ...payload }
          : payload;

        logger.info('[SIGNAL-2] Processing', {
          jobLifecycleId,
          score: payload?.matchScore || 0,
          mode: isQueueMode ? 'queue' : 'direct',
          isEnrichment: !!this.currentJob,
        });

        this.currentJob = enrichedJob;
        this.state = 'DISPLAY';
        setCurrentJob(jobLifecycleId, enrichedJob, 'FULL_PARSED');
        this.renderFrame(enrichedJob);

        logger.info('[SIGNAL-2] ✅ Signal processed', {
          jobLifecycleId,
          stage: currentStage,
          candidateCount: payload?.candidateCount,
          timestampMs: Date.now(),
        });
      } catch (err) {
        logger.error('[SIGNAL-2] ❌ Error processing job.parse.completed', {
          error: String(err),
          stack: (err as any)?.stack?.split('\\n')[0],
        });
      }
    });

    // Signal 3a: job.route.queued
    this.rmqReader.addEventListener('job.route.queued', (event: any) =>
      this.onRouteEvent(event, 'route.queued'));

    // Signal 3b: job.route.trashed
    this.rmqReader.addEventListener('job.route.trashed', (event: any) =>
      this.onRouteEvent(event, 'route.trashed'));

    // Signal 4: job.parse.failed
    this.rmqReader.addEventListener('job.parse.failed', (event: any) =>
      this.onRouteEvent(event, 'parse.failed'));

    // Signal 4: job.route.failed
    this.rmqReader.addEventListener('job.route.failed', (event: any) =>
      this.onRouteEvent(event, 'route.failed'));

    logger.info('[render-server] ✅ Signal listeners registered');
  }

  /**
   * Shared handler for all route/clear events (Signal 3a, 3b, 4, 4).
   * Tracks S4 failure count for observability.
   */
  private s4FailureCount = 0;
  private onRouteEvent(event: any, label: string): void {
    try {
      const payload = event.data || event.payload;
      const jobLifecycleId = payload?.jobLifecycleId;
      const reason = payload?.error || payload?.reason || label;

      const isS4 = label === 'parse.failed' || label === 'route.failed';

      if (isS4) {
        this.s4FailureCount++;
        logger.info(`[SIGNAL-4] Failure count: ${this.s4FailureCount}`, { jobLifecycleId, reason });
      }

      // S4 (parse.failed) in direct mode: clear only if for the active job
      if (label === 'parse.failed' && !getQueueMode()) {
        if (jobLifecycleId && this.currentJob?._id === jobLifecycleId) {
          this.lastClearedJobLifecycleId = this.currentJob?._id ?? null;
          clearCurrentJob();
          this.currentJob = null;
          this.state = 'IDLE';
          this.renderFrame(null);
          logger.info('[SIGNAL-4] Direct mode — cleared display', { reason, jobLifecycleId });
        } else {
          logger.info('[SIGNAL-4] Direct mode — S4 for different job, ignoring', { jobLifecycleId, activeId: this.currentJob?._id, reason });
        }
        return;
      }

      if (jobLifecycleId && this.currentJob?._id === jobLifecycleId) {
        if (jobLifecycleId === this.lastClearedJobLifecycleId) {
          logger.info(`[${label}] Already cleared, skipping duplicate`, { jobLifecycleId });
          return;
        }
        this.lastClearedJobLifecycleId = jobLifecycleId;
        logger.info(`[${label}] Clearing current job`, { jobLifecycleId, reason });

        clearCurrentJob();
        this.currentJob = null;
        this.state = 'IDLE';
        this.renderFrame(null);

        logger.info(`[${label}] ✅ State cleared`, { jobLifecycleId, reason, timestampMs: Date.now() });
      }
    } catch (err) {
      logger.error(`[${label}] Error`, { error: String(err) });
    }
  }

  /**
   * Stop the TUI app gracefully.
   */
  stop(): void {
    if (!this.isRunning) return;

    logger.info('[render-server] Shutting down...');
    this.isRunning = false;

    try {
      // Restore terminal mode
      this.ansiTerminal.restoreTerminal();

      this.rmqReader.disconnect();
      clearCurrentJob();
      logger.info('[render-server] ✓ Graceful shutdown complete');
    } catch (err) {
      logger.warn('[render-server] Error during shutdown', { error: String(err) });
    }
  }

  /**
   * Main event loop: EVENT-DRIVEN RENDERING ONLY
   * ✓ Only renders when SSE events cause state changes
   * ✓ No timer-based rendering (eliminates repeated output)
   * ✓ nextJob() signal-based wakeup drives loop
   */
  private async mainLoop(): Promise<void> {
    let lastRenderedJobLifecycleId: string | null = null;
    let renderCount = 0;

    while (this.isRunning) {
      try {
        const stateFileJob = getCurrentJob();
        const queueMode = getQueueMode();

        // Track mode changes — refresh job from new active sub-state and re-render
        if (queueMode !== this.lastQueueMode) {
          this.lastQueueMode = queueMode;
          this.currentJob = stateFileJob.job;
          this.state = stateFileJob.job ? 'DISPLAY' : 'IDLE';
          this.renderFrame(this.currentJob);
        }

        // Modal updates from tui-stdin-adapter (e.g., [p] preview)
        const modalSignature = JSON.stringify(stateFileJob.modal ?? null);
        if (modalSignature !== this.lastRenderedModalSignature) {
          this.lastRenderedModalSignature = modalSignature;
          this.renderFrame(stateFileJob.job);
        }

        // Initial render (first loop iteration)
        if (renderCount === 0) {
          renderCount++;
          this.renderFrame(null);
        }

        // Do not dequeue while a job is displayed
        if (this.state === 'DISPLAY') {
          await this.sleep(50);
          continue;
        }

        // Direct mode: no auto-dequeue
        if (!queueMode) {
          await this.sleep(100);
          continue;
        }

        // Non-blocking peek — poll queue so mode changes can be checked
        if (!this.rmqReader.peekNextJob()) {
          await this.sleep(200);
          continue;
        }
        this.currentJob = await this.rmqReader.nextJob();
        if (!this.currentJob) continue;

        const jobLifecycleId = this.currentJob._id;
        this.lastClearedJobLifecycleId = null;
        
        // Validate _id exists
        if (!jobLifecycleId) {
          logger.warn('[RENDER] No _id in job, skipping');
          continue;
        }

        // Skip placeholder IDs from SseJobReader fallback
        // These are generated when SSE payload has no _id (SseJobReader)
        if (jobLifecycleId.startsWith('sse-fallback-')) {
          logger.debug('[RENDER] Skipping placeholder ID (SseJobReader fallback)', {
            jobLifecycleId,
            company: this.currentJob.company,
          });
          continue;
        }

        // Only render if state changed
        const wasState = this.state;
        if (jobLifecycleId !== lastRenderedJobLifecycleId) {
          const stage = this.currentJob.details ? 'FULL_PARSED' : 'PARTIAL';
          setCurrentJob(jobLifecycleId, this.currentJob, stage);
          this.state = 'DISPLAY';
          lastRenderedJobLifecycleId = jobLifecycleId;
          this.renderFrame(this.currentJob);
          logger.info('[RENDER] 🎨 Job rendered', {
            jobLifecycleId,
            company: this.currentJob.company,
            wasState,
            queueDepth: this.rmqReader.getQueueDepth?.() ?? 0,
          });
        } else {
          logger.debug('[RENDER] SKIP render (same ID)', {
            jobLifecycleId,
            lastRenderedJobLifecycleId,
            wasState,
          });
        }

        // RMQ events (job.parse.completed, job.routed) will trigger re-renders
        // via Signal listeners (see registerSignalListeners)
      } catch (err) {
        logger.error('[render-server] Error in main loop', { error: String(err) });
        await this.sleep(1000);
      }
    }
  }

  /**
   * Render the TUI frame with job and status.
   */
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
      logger.error('[RENDER] ❌ Failed to write frame', {
        error: String(err),
        jobLifecycleId: job?._id,
      });
    }
  }

  /**
   * Render an active modal overlay
   * Dispatches to appropriate modal renderer based on modal type
   */
  private renderModal(state: CurrentJobState): void {
    if (!state.modal) return;
    try {
      let modalFrame = '';

      if (state.modal.type === 'PREVIEW_VIEWER') {
        modalFrame = renderPreviewViewerModal(state.modal, state);
        logger.debug('[RENDER] 🎨 Rendering PREVIEW_VIEWER modal', {
          jobLifecycleId: state.jobLifecycleId,
          currentPage: state.modal.currentPage,
          maxPages: state.modal.maxPages,
        });
      } else {
        logger.warn('[RENDER] Unknown modal type', { modalType: state.modal.type });
        return;
      }
      // Use cursor-based clear instead of full screen clear (same fix as renderFrame)
      this.ansiTerminal.write('\x1b[H\x1b[J' + modalFrame + '\n');
      logger.debug('[RENDER] ✅ Modal frame written to terminal', {
        modalType: state.modal.type,
      });
    } catch (err) {
      logger.error('[RENDER] ❌ Failed to render modal', {
        error: String(err),
        modalType: state.modal?.type,
      });
    }
  }

  /**
   * Sleep helper.
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * CLI Entry Point: Handle --render-only flag and start render server
 */
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

// Always run main - it checks for--render-only flag
main().catch((err) => {
  console.error('[render-server] Unhandled error in main:', err);
  process.exit(1);
});
