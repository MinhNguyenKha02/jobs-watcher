import { spawn } from 'node:child_process';

import { clipboardGetter } from './services/clipboard-getter.js';
import { createLogger } from '../../infrastructure/outbound/logging/logger.js';

import { KeyboardHandler, KeyAction } from './components/KeyboardHandler.js';
import { UdsActionWriter } from './components/UdsActionWriter.js';
import {
  getCurrentJob,
  getQueueMode,
  setPreviewViewerModal,
  clearModal,
  setQueueMode,
  type ModalState,
} from './shared-tui-state.js';

const logger = createLogger('TUI-Actions');

export interface ActionControllerConfig {
  socketPath: string;
  udsToken?: string;
}

/**
 * ActionController: Handles keyboard input and dispatches actions
 * Runs in separate process from render-server
 */
const PROCESSED_IDS_MAX_SIZE = 1000;

export class ActionController {
  private config: ActionControllerConfig;
  private udsWriter: UdsActionWriter;
  private keyboard: KeyboardHandler;

  private isRunning = false;
  private processedJobLifecycleIds = new Set<string>();

  constructor(config: ActionControllerConfig) {
    this.config = config;
    this.udsWriter = new UdsActionWriter(config.socketPath, config.udsToken);
    this.keyboard = new KeyboardHandler();
  }

  /**
   * Start the action controller (keyboard handler).
   */
  async start(): Promise<void> {
    try {
      logger.info('[action-controller] 🚀 Starting Action Controller');

      // Attach keyboard handler
      await this.keyboard.attach();
      logger.info('[action-controller] ✓ Keyboard attached');

      // Main event loop
      this.isRunning = true;
      await this.mainLoop();
    } catch (err) {
      logger.error('[action-controller] Fatal error', { error: String(err) });
      throw err;
    } finally {
      this.stop();
    }
  }

  /**
   * Stop the action controller gracefully.
   */
  stop(): void {
    if (!this.isRunning) return;

    logger.info('[action-controller] Shutting down...');
    this.isRunning = false;

    try {
      this.keyboard.detach();
      logger.info('[action-controller] ✓ Graceful shutdown complete');
    } catch (err) {
      logger.warn('[action-controller] Error during shutdown', { error: String(err) });
    }
  }

  /**
   * Main event loop: Wait for actions and dispatch them
   */
  private async mainLoop(): Promise<void> {
    while (this.isRunning) {
      try {
        // Wait for keyboard action
        const action = await this.keyboard.waitForAction();

        if (action === 'none' || !this.isRunning) {
          continue;
        }

        // Dispatch the action
        logger.info('[action-controller] Action received', { action });
        await this.dispatchAction(action);
      } catch (err) {
        logger.error('[action-controller] Error in main loop', { error: String(err) });
        await this.sleep(500);
      }
    }
  }

  /**
   * Dispatch an action and execute appropriate handler.
   * Checks for active modals first and routes to modal handlers if needed.
   */
  private async dispatchAction(action: KeyAction): Promise<void> {
    try {
      // Check if a modal is currently active
      const current = getCurrentJob();
      if (current.modal) {
        // Route to modal-specific handler
        await this.handleModalInput(action, current.modal);
        return;
      }

      // Otherwise, dispatch normal action
      switch (action) {
        case KeyAction.QUEUE:
          await this.handleQueue();
          break;

        case KeyAction.TRASH:
          await this.handleTrash();
          break;

        case KeyAction.PREVIEW:
          await this.handlePreview();
          break;

        case KeyAction.INGEST:
          await this.handleIngest();
          break;

        case KeyAction.WEBHOOK_STAGE2_PARSE:
           logger.info('[action-controller] [c] About to call handleWebhookStage2Parse');
          await this.handleWebhookStage2Parse();
           logger.info('[action-controller] [c] handleWebhookStage2Parse completed');
          break;

        case KeyAction.OPEN:
          await this.handleOpenUrl();
          break;

        case KeyAction.TOGGLE_QUEUE:
          await this.handleToggleQueue();
          break;

        case KeyAction.HELP:
          await this.handleHelp();
          break;

        case KeyAction.QUIT:
          logger.info('[action-controller] User quit requested');
          this.stop();
          break;

        case KeyAction.MODAL_DISCARD:
        case KeyAction.MODAL_SCROLL_UP:
        case KeyAction.MODAL_SCROLL_DOWN:
          // These should only be used when a modal is active
          logger.warn('[action-controller] Modal action received but no modal active', { action });
          break;

        default:
          logger.warn('[action-controller] Unknown action', { action });
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
       const stack = err instanceof Error ? err.stack : '';
       logger.error('[action-controller] Action dispatch failed', { action, error: errorMsg, stack });
    }
  }

  /**
   * Handle input when a modal is active
   * Routes to appropriate modal-specific handler based on modal type
   */
  private async handleModalInput(action: KeyAction, modal: Exclude<ModalState, null>): Promise<void> {
    try {
      if (modal.type === 'PREVIEW_VIEWER') {
        if (action === KeyAction.MODAL_SCROLL_DOWN) {
          await this.handlePreviewScrollDown();
        } else if (action === KeyAction.MODAL_SCROLL_UP) {
          await this.handlePreviewScrollUp();
        } else if (action === KeyAction.QUIT || action === KeyAction.MODAL_DISCARD) {
          await this.handlePreviewClose();
        } else {
          await this.handlePreviewClose();
          logger.info('[MODAL] Preview modal closed for action passthrough', { action });
          await this.dispatchAction(action);
        }
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error('[action-controller] Modal input handling failed', { action, modalType: modal.type, error: errorMsg });
    }
  }

  /**
   * Modal Action Handler: Scroll preview up (previous page)
   */
  private async handlePreviewScrollUp(): Promise<void> {
    try {
      const { updatePreviewPage } = await import('./shared-tui-state.js');
      updatePreviewPage('up');
      logger.debug('[MODAL] Preview scrolled up');
    } catch (err) {
      logger.error('[MODAL] Preview scroll up failed', { error: String(err) });
    }
  }

  /**
   * Modal Action Handler: Scroll preview down (next page)
   */
  private async handlePreviewScrollDown(): Promise<void> {
    try {
      const { updatePreviewPage } = await import('./shared-tui-state.js');
      updatePreviewPage('down');
      logger.debug('[MODAL] Preview scrolled down');
    } catch (err) {
      logger.error('[MODAL] Preview scroll down failed', { error: String(err) });
    }
  }

  /**
   * Modal Action Handler: Close preview modal
   */
  private async handlePreviewClose(): Promise<void> {
    try {
      clearModal();
      logger.info('[MODAL] Preview modal closed');
    } catch (err) {
      logger.error('[MODAL] Preview close failed', { error: String(err) });
    }
  }

  /**
   * Action: Queue job - send to job_queue via UDS (stderr output with [ROUTE] tag)
   */
  private async handleQueue(): Promise<void> {
    try {
      const state = getCurrentJob();

      if (!state.jobLifecycleId) {
        logger.warn('[ROUTE] No job selected', { jobLifecycleId: null });
        return;
      }

      if (this.processedJobLifecycleIds.has(state.jobLifecycleId)) {
        logger.warn('[ROUTE] Job already being processed', { jobLifecycleId: state.jobLifecycleId });
        return;
      }

      // M2: add to processed set only AFTER successful UDS send
      const udsStart = Date.now();
      await this.udsWriter.queue(state.jobLifecycleId, {});
      const udsTook = Date.now() - udsStart;

      this.addProcessedId(state.jobLifecycleId);

      logger.info('[ROUTE] Action executed', {
        action: 'queue',
        jobLifecycleId: state.jobLifecycleId,
        Signal: 3,
        udsTookMs: udsTook,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('[ROUTE] Action failed', { action: 'queue', error: message });
      console.log(`[ROUTE] Action failed (queue): ${message}`);
    }
  }

  /**
   * Action: Trash job - send to job_trash via UDS (stderr output with [ROUTE] tag)
   */
  private async handleTrash(): Promise<void> {
    try {
      const state = getCurrentJob();

      if (!state.jobLifecycleId) {
        logger.warn('[ROUTE] No job selected', { jobLifecycleId: null });
        return;
      }

      if (this.processedJobLifecycleIds.has(state.jobLifecycleId)) {
        logger.warn('[ROUTE] Job already being processed', { jobLifecycleId: state.jobLifecycleId });
        return;
      }

      // M2: add to processed set only AFTER successful UDS send
      const udsStart = Date.now();
      await this.udsWriter.trash(state.jobLifecycleId, {});
      const udsTook = Date.now() - udsStart;

      this.addProcessedId(state.jobLifecycleId);

      logger.info('[ROUTE] Action executed', {
        action: 'trash',
        jobLifecycleId: state.jobLifecycleId,
        Signal: 3,
        udsTookMs: udsTook,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('[ROUTE] Action failed', { action: 'trash', error: message });
      console.log(`[ROUTE] Action failed (trash): ${message}`);
    }
  }

  /**
   * Action: Preview job - show current job + clipboard preview (stderr only)
   */
  private async handlePreview(): Promise<void> {
    const current = getCurrentJob();
    const queueMode = getQueueMode();

    try {
      // Queue mode: preview requires a displayed job
      if (queueMode && (!current.jobLifecycleId || !current.job)) {
        logger.warn('[PREVIEW] No job available in queue mode', { jobLifecycleId: null });
        return;
      }

      // Direct mode: preview works without a job (clipboard-only)
      try {
        const clipboardArr = await clipboardGetter();
        const clipboardHtml = clipboardArr[0] || '';

        if (clipboardHtml) {
          setPreviewViewerModal(clipboardHtml, 20);
          logger.info('[PREVIEW] Showing clipboard content in modal');
        } else {
          logger.info('[PREVIEW] Clipboard empty');
        }
      } catch (err) {
        logger.warn('[PREVIEW] Failed to read clipboard', { error: String(err) });
      }
    } catch (err) {
      logger.error('[PREVIEW] Preview failed', { error: String(err) });
    }
  }

  /**
   * Action: [i] Ingest Clipboard - Direct clipboard → needs_enrichment (fully parsed)
   */
  private async handleIngest(): Promise<void> {
    if (getQueueMode()) {
      logger.info('[ACTION] [i] ignored in queue mode');
      console.log('[i] ignored in queue mode — press [b] to switch to direct mode');
      return;
    }
    try {
      logger.info('[ACTION] Reading clipboard...');

      const clipboardArr = await clipboardGetter();
      const htmlPayload = clipboardArr[0];

      if (!htmlPayload) {
        logger.warn('[ACTION] Clipboard empty or not HTML');
        return;
      }

      logger.info('[ACTION] Ingesting clipboard as Stage 2...');

      // Send to UDS /internal/ingest without jobLifecycleId (auto-generated as 'clip-...')
      const headers: Record<string, string> = {};
      if (this.config.udsToken) {
        headers['x-internal-token'] = this.config.udsToken;
      }

      const ingestOpts = {
        socketPath: this.config.socketPath,
        path: '/internal/ingest',
        method: 'POST' as const,
        headers: headers || undefined,
        timeoutMs: 10000,
      };

      const ingestPayload = {
        webhook: false,
        html: htmlPayload,
      };

      // Dynamic import for postJsonOverUds
      const { postJsonOverUds } = await import('../../infrastructure/utils/uds-http.js');
      const res = await postJsonOverUds(ingestOpts, ingestPayload);
      if (res.statusCode < 200 || res.statusCode >= 300) {
        throw new Error(`Ingest failed: ${res.statusCode} ${res.body}`);
      }

      logger.info('[ACTION] Clipboard ingestion triggered');
    } catch (err) {
      logger.error('[ACTION] Clipboard ingest failed', { error: String(err) });
    }
  }

  /**
   * Action: [c] Webhook Stage 2 Parse - Clipboard parse + Stage 2 enrichment
   */
  private async handleWebhookStage2Parse(): Promise<void> {
    if (!getQueueMode()) {
      logger.info('[action-controller] [c] ignored in direct mode');
      return;
    }
    const current = getCurrentJob();
      logger.info('[action-controller] [c] getCurrentJob() returned', { jobLifecycleId: current?.jobLifecycleId });
    try {
      logger.info('[action-controller] 📝 [c] Stage 2 Parse action started');

      // Validate job state exists
      if (!current || !current.jobLifecycleId) {
        logger.error('[action-controller] [c] No job jobLifecycleId available', {
          hasJob: !!current,
          jobLifecycleId: current?.jobLifecycleId,
        });
        return;
      }

      // B1: Guard — reject [c] if job is already FULL_PARSED (would corrupt enriched fields)
      if (current.stage === 'FULL_PARSED') {
        logger.info('[action-controller] [c] ignored — job already fully parsed', {
          jobLifecycleId: current.jobLifecycleId,
        });
        return;
      }

      logger.info('[action-controller] [c] Preparing Stage 2 parse', {
        jobLifecycleId: current.jobLifecycleId,
      });

      logger.info('[action-controller] [c] Sending webhook stage 2 ingest via UDS helper', {
        jobLifecycleId: current.jobLifecycleId,
      });

      const htmlPayload = await this.udsWriter.webhookIngest(current.jobLifecycleId);

      logger.info('[action-controller] [c] Stage 2 parse triggered successfully', {
        jobLifecycleId: current.jobLifecycleId,
        payloadSize: htmlPayload.length,
      });
    } catch (err) {
      logger.error('[action-controller] [c] Stage 2 parse failed', {
        error: String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
    }
  }

  /**
   * Action: Open URL - log to stderr with [URL] tag (GUI or headless)
   */
  private async handleOpenUrl(): Promise<void> {
    const current = getCurrentJob();

    // 1. Extract URL (safely handle possible null job)
    const url = current.job 
      ? ((current.job as unknown as Record<string, unknown>)?.url || 
         (current.job as unknown as Record<string, unknown>)?.link)
      : undefined;
      
    if (typeof url !== 'string' || !url) {
      logger.info('[URL] No URL available in job', { jobLifecycleId: current.jobLifecycleId });
      console.log('[o] No URL available for this job');
      return;
    }

    try {
      const hasGui = !!process.env.DISPLAY || !!process.env.WAYLAND_DISPLAY;
      const browser = process.env.BROWSER || 'xdg-open';
      let opened = false;

      // 1. Try explicit BROWSER env var
      if (browser) {
        try {
          spawn(browser, [url], {
            detached: true,
            stdio: 'ignore',
          }).unref();
          logger.info('[URL] Opened in GUI browser', {
            jobLifecycleId: current.jobLifecycleId,
            url,
            urlBytes: url.length,
            browser,
            mode: 'GUI',
          });
          opened = true;
        } catch (err) {
          logger.debug('[URL] Browser open failed', { error: String(err) });
        }
      }

      // 2. Try xdg-open (Linux with display)
      if (!opened && hasGui && process.platform === 'linux') {
        try {
          spawn('xdg-open', [url], {
            detached: true,
            stdio: 'ignore',
          }).unref();
          logger.info('[URL] Opened in GUI browser', {
            jobLifecycleId: current.jobLifecycleId,
            url,
            urlBytes: url.length,
            browser: 'xdg-open',
            mode: 'GUI',
          });
          opened = true;
        } catch (err) {
          logger.debug('[URL] xdg-open failed', { error: String(err) });
        }
      }

      // 3. Fallback: Log URL with job context (no screen clear)
      if (!opened) {
        const jobData = current.job as unknown as Record<string, unknown>;
        logger.info('[URL] Fallback mode - manual copy-paste', {
          jobLifecycleId: current.jobLifecycleId,
          url,
          urlBytes: url.length,
          mode: 'HEADLESS',
          hasGuiDisplay: hasGui,
          currentJobContext: {
            company: jobData?.company,
            role: jobData?.role,
            location: jobData?.location,
          },
        });
      }
    } catch (err) {
      logger.error('[URL] OpenURL failed', { error: String(err) });
    }
  }

  /**
   * Action: Toggle queue/direct mode (b key)
   * Switches between queue mode (auto-dequeue) and direct mode (manual [i] ingest).
   */
  private async handleToggleQueue(): Promise<void> {
    try {
      const newMode = !getQueueMode();
      setQueueMode(newMode);
      logger.info('[MODE] Queue mode toggled', {
        from: newMode ? 'direct' : 'queue',
        to: newMode ? 'queue' : 'direct',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('[ROUTE] Action failed', { action: 'queue', error: message });
      console.error(`[ROUTE] Queue failed: ${message}`);
    }
  }

  /**
   * Action: Trash job - send to job_trash via UDS (stderr output with [ROUTE] tag)
   */
  private async handleHelp(): Promise<void> {
    const helpText = KeyboardHandler.showHelp();

    // Show help
    console.log(helpText);

    logger.info('[action-controller] Help displayed');
  }

  private addProcessedId(id: string): void {
    this.processedJobLifecycleIds.add(id);
    if (this.processedJobLifecycleIds.size > PROCESSED_IDS_MAX_SIZE) {
      const toRemove = this.processedJobLifecycleIds.size - PROCESSED_IDS_MAX_SIZE;
      let count = 0;
      for (const existing of this.processedJobLifecycleIds) {
        if (count >= toRemove) break;
        this.processedJobLifecycleIds.delete(existing);
        count++;
      }
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
 * Standalone CLI entry point
 */
if (import.meta.url === `file://${process.argv[1]}`) {
  const controller = new ActionController({
    socketPath: process.env.UDS_SOCKET_PATH || '/run/jobs-watcher/ingest.sock',
    udsToken: process.env.INTERNAL_AUTH_TOKEN || 'temp-dev-token',
  });

  controller.start().catch((err) => {
    logger.error('[action-controller] Fatal error', { error: err });
    process.exit(1);
  });
}
