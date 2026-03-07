/**
 * Data listening mode runner
 * Uses Gmail webhook adapter (Pub/Sub notifications)
 * Listens for incoming job alerts and processes them in real-time
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';

import { config } from '../config.js';
import { GmailService } from '../services/gmail.js';
import { getLogger } from '../services/logger.js';
import { MemoryMonitor } from '../services/memory-monitor.js';
import { getE2EOutputDir, getE2EOutputDirRelativeToRoot } from '../utils/e2e-output-path.js';

import { clipboardGetter } from './clipboard-getter.js';
import {
  GmailWebhookAdapter,
  ClipboardOnlyAdapter,
  GmailApiAdapter,
} from './email-source-adapter.js';
import { startManualEnrichmentLoop } from './manual-enrichment-loop.js';

const logger = getLogger();

export function isLegacyManualEnrichmentEnabled(argv: string[]): boolean {
  return (
    argv.includes('--manual-enrichment=legacy') || argv.includes('--legacy-manual-enrichment=true')
  );
}

async function runDataListening() {
  logger.info('📋 Data Listening Service');
  logger.info('========================');
  const memoryWarningMb = Number(process.env.MEMORY_WARNING_MB || 160);
  const memoryCriticalMb = Number(process.env.MEMORY_CRITICAL_MB || 190);
  const cpuWarningPercent = Number(process.env.CPU_WARNING_PERCENT || 70);
  const cpuCriticalPercent = Number(process.env.CPU_CRITICAL_PERCENT || 90);
  const memoryMonitor = new MemoryMonitor({
    warningThresholdMb: Number.isNaN(memoryWarningMb) ? 160 : memoryWarningMb,
    criticalThresholdMb: Number.isNaN(memoryCriticalMb) ? 190 : memoryCriticalMb,
    cpuWarningThresholdPercent: Number.isNaN(cpuWarningPercent) ? 70 : cpuWarningPercent,
    cpuCriticalThresholdPercent: Number.isNaN(cpuCriticalPercent) ? 90 : cpuCriticalPercent,
  });
  let memoryInterval: NodeJS.Timeout | null = null;
  let clipboardInterval: NodeJS.Timeout | null = null;
  let fallbackGmailApiInterval: NodeJS.Timeout | null = null;
  let hybridGmailBackfillInterval: NodeJS.Timeout | null = null;
  let e2eComplianceInterval: NodeJS.Timeout | null = null;
  let manualEnrichmentController: { stop: () => Promise<void> } | null = null;
  let hybridClipboardTrigger: (() => Promise<void>) | null = null;
  let isClipboardRunInProgress = false;
  let isFallbackRunInProgress = false;
  let isHybridGmailBackfillInProgress = false;
  let clipboardFailureCount = 0;
  let fallbackFailureCount = 0;
  let hybridBackfillFailureCount = 0;
  // Parse --adapter flag (default: gmailWebhook)
  const adapterFlag = process.argv.find((arg) => arg.startsWith('--adapter='));
  const adapterType = adapterFlag ? adapterFlag.split('=')[1] : 'hybrid';
  const clipboardModeFlag = process.argv.find((arg) => arg.startsWith('--hybrid-clipboard='));
  const rawHybridClipboardMode = (
    clipboardModeFlag?.split('=')[1] ||
    process.env.HYBRID_CLIPBOARD_MODE ||
    'manual'
  ).toLowerCase();
  const hybridClipboardMode =
    rawHybridClipboardMode === 'poll' || rawHybridClipboardMode === 'polling' ? 'poll' : 'manual';
  const legacyManualEnrichmentEnabled = isLegacyManualEnrichmentEnabled(process.argv);
  const ingressFixtureModeEnabled = process.env.INGRESS_FIXTURE_MODE === '1';

  if (ingressFixtureModeEnabled) {
    logger.warn(
      '⚠️ INGRESS_FIXTURE_MODE=1 enabled; adapters may execute fixture-driven ingestion.'
    );
  }

  if (process.env.NODE_ENV === 'production' && ingressFixtureModeEnabled) {
    throw new Error(
      'INGRESS_FIXTURE_MODE=1 is not allowed in production long-living mode. Unset it to ensure real ingress only.'
    );
  }

  const parseDurationMs = (value: string | undefined, fallbackMs: number): number => {
    if (!value) return fallbackMs;
    const normalized = String(value).trim().toLowerCase();
    if (/^\d+$/.test(normalized)) return Number.parseInt(normalized, 10);
    if (/^\d+s$/.test(normalized)) return Number.parseInt(normalized.slice(0, -1), 10) * 1000;
    if (/^\d+m$/.test(normalized)) return Number.parseInt(normalized.slice(0, -1), 10) * 60 * 1000;
    if (/^\d+h$/.test(normalized)) {
      return Number.parseInt(normalized.slice(0, -1), 10) * 60 * 60 * 1000;
    }
    if (/^\d+d$/.test(normalized)) {
      return Number.parseInt(normalized.slice(0, -1), 10) * 24 * 60 * 60 * 1000;
    }
    return fallbackMs;
  };

  const hybridBackfillEnabled =
    process.env.HYBRID_GMAIL_BACKFILL_ENABLED === '1' ||
    typeof process.env.HYBRID_GMAIL_BACKFILL_INTERVAL !== 'undefined' ||
    typeof process.env.HYBRID_GMAIL_BACKFILL_INTERVAL_MS !== 'undefined';
  const hybridBackfillIntervalMs = parseDurationMs(
    process.env.HYBRID_GMAIL_BACKFILL_INTERVAL || process.env.HYBRID_GMAIL_BACKFILL_INTERVAL_MS,
    7 * 24 * 60 * 60 * 1000
  );
  const hybridBackfillLookbackHoursRaw = Number.parseInt(
    process.env.HYBRID_GMAIL_BACKFILL_LOOKBACK_HOURS || '168',
    10
  );
  const hybridBackfillLookbackHours = Number.isNaN(hybridBackfillLookbackHoursRaw)
    ? 168
    : Math.max(1, hybridBackfillLookbackHoursRaw);
  const hybridBackfillMaxMessagesRaw = Number.parseInt(
    process.env.HYBRID_GMAIL_BACKFILL_MAX_MESSAGES || '100',
    10
  );
  const hybridBackfillMaxMessages = Number.isNaN(hybridBackfillMaxMessagesRaw)
    ? 100
    : Math.max(1, hybridBackfillMaxMessagesRaw);
  const hybridBackfillConcurrencyRaw = Number.parseInt(
    process.env.HYBRID_GMAIL_BACKFILL_CONCURRENCY || '2',
    10
  );
  const hybridBackfillConcurrency = Number.isNaN(hybridBackfillConcurrencyRaw)
    ? 2
    : Math.max(1, Math.min(8, hybridBackfillConcurrencyRaw));
  const hybridBackfillRunOnStart = process.env.HYBRID_GMAIL_BACKFILL_RUN_ON_START === '1';
  // Parse --schedule or --interval flag (e.g., --schedule=1h, --interval=3600)
  const scheduleFlag =
    process.argv.find((arg) => arg.startsWith('--schedule=')) ||
    process.argv.find((arg) => arg.startsWith('--interval='));
  let scheduleMs: number | undefined;
  if (scheduleFlag) {
    const val = scheduleFlag.split('=')[1];
    // Support "1h", "30m", "3600" (seconds)
    if (/^\d+$/.test(val)) {
      scheduleMs = parseInt(val, 10) * 1000;
    } else if (/^\d+h$/.test(val)) {
      scheduleMs = parseInt(val, 10) * 60 * 60 * 1000;
    } else if (/^\d+m$/.test(val)) {
      scheduleMs = parseInt(val, 10) * 60 * 1000;
    } else {
      logger.warn(`Unrecognized schedule/interval value: ${val}`);
    }
  }
  let adapter;
  let webhookAdapter: GmailWebhookAdapter | null = null;
  let clipboardAdapter: ClipboardOnlyAdapter | null = null;
  let fallbackGmailApiAdapter: GmailApiAdapter | null = null;
  let startedInFallbackMode = false;
  const maxStreamRetries = Number.isNaN(Number(process.env.STREAM_MAX_RETRIES))
    ? 3
    : Number(process.env.STREAM_MAX_RETRIES);
  const retryDelayMs = Number.isNaN(Number(process.env.STREAM_RETRY_DELAY_MS))
    ? 1000
    : Number(process.env.STREAM_RETRY_DELAY_MS);

  const failureLogPath = path.join(process.cwd(), 'logs', 'stream-failures.jsonl');
  const servicePidPath = path.join(process.cwd(), 'logs', 'data-listening.pid');

  const writeServicePid = () => {
    try {
      fs.mkdirSync(path.dirname(servicePidPath), { recursive: true });
      fs.writeFileSync(servicePidPath, `${process.pid}\n`, 'utf-8');
    } catch {
      // noop
    }
  };

  const removeServicePid = () => {
    try {
      if (fs.existsSync(servicePidPath)) {
        fs.unlinkSync(servicePidPath);
      }
    } catch {
      // noop
    }
  };

  const appendFailureLog = (stream: string, error: unknown, retryAttempt = 0) => {
    try {
      fs.mkdirSync(path.dirname(failureLogPath), { recursive: true });
      fs.appendFileSync(
        failureLogPath,
        `${JSON.stringify({
          timestamp: new Date().toISOString(),
          stream,
          retryAttempt,
          message: error instanceof Error ? error.message : String(error),
        })}\n`
      );
    } catch {
      // noop
    }
  };

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  const runWithRetry = async (stream: string, fn: () => Promise<void>): Promise<void> => {
    for (let attempt = 0; attempt <= maxStreamRetries; attempt++) {
      try {
        await fn();
        return;
      } catch (error) {
        appendFailureLog(stream, error, attempt);
        if (attempt >= maxStreamRetries) {
          throw error;
        }
        await sleep(retryDelayMs * (attempt + 1));
      }
    }
  };

  const shouldRunE2EComplianceChecks =
    process.env.ENABLE_E2E_COMPLIANCE_CHECK === '1' || process.env.EXPORT_E2E_OUTPUT === '1';

  const checkE2EOutputCompliance = async () => {
    const outputDir = getE2EOutputDir();
    const relativeOutputDir = getE2EOutputDirRelativeToRoot();
    const requiredFiles = [
      'e2e-raw-ingest.json',
      'e2e-job-queue.json',
      'e2e-job-trash.json',
      'e2e-needs-enrichment.json',
      'e2e-parse-log.json',
    ];

    if (!fs.existsSync(outputDir)) return;
    const missing = requiredFiles.filter((name) => !fs.existsSync(path.join(outputDir, name)));
    if (missing.length > 0) {
      logger.warn(
        `E2E compliance warning: missing files in ${relativeOutputDir}: ${missing.join(', ')}`
      );
      return;
    }

    try {
      const raw = JSON.parse(
        fs.readFileSync(path.join(outputDir, 'e2e-raw-ingest.json'), 'utf-8')
      ) as any[];
      const queue = JSON.parse(
        fs.readFileSync(path.join(outputDir, 'e2e-job-queue.json'), 'utf-8')
      ) as any[];
      const trash = JSON.parse(
        fs.readFileSync(path.join(outputDir, 'e2e-job-trash.json'), 'utf-8')
      ) as any[];
      const needs = JSON.parse(
        fs.readFileSync(path.join(outputDir, 'e2e-needs-enrichment.json'), 'utf-8')
      ) as any[];
      const downstream = queue.length + trash.length + needs.length;
      if (raw.length > 0 && downstream === 0) {
        logger.warn(
          `[E2E Compliance] Potential data loss risk in ${relativeOutputDir}: raw_ingest=${raw.length}, downstream=${downstream}`
        );
      } else {
        logger.info(
          `[E2E Compliance] ${relativeOutputDir}: raw_ingest=${raw.length}, downstream=${downstream}`
        );
      }
    } catch (error) {
      logger.warn(
        `E2E compliance parse failed for ${relativeOutputDir}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  };
  if (adapterType === 'gmailWebhook') {
    logger.info('Using GmailWebhookAdapter (Pub/Sub)...');
    adapter = new GmailWebhookAdapter({ port: config.webhook.port });
    if (scheduleMs) {
      logger.warn('Schedule/interval flag ignored for persistent webhook adapter.');
    }
  } else if (adapterType === 'clipboardOnly') {
    logger.info('Using ClipboardOnlyAdapter (manual/clipboard)...');
    adapter = new ClipboardOnlyAdapter({ clipboardGetter });
  } else if (adapterType === 'gmailApi') {
    logger.info('Using GmailApiAdapter (Gmail API fallback)...');
    adapter = new GmailApiAdapter();
  } else if (adapterType === 'hybrid') {
    logger.info('Using hybrid mode (Gmail webhook + clipboard polling + manual enrichment)...');
    webhookAdapter = new GmailWebhookAdapter({ port: config.webhook.port });
    clipboardAdapter = new ClipboardOnlyAdapter({ clipboardGetter });
    fallbackGmailApiAdapter = new GmailApiAdapter();
    adapter = null;
  } else {
    logger.error(`Unknown adapter: ${adapterType}`);
    process.exit(1);
  }

  try {
    writeServicePid();

    if (adapterType === 'hybrid') {
      const startupTasks: Promise<void>[] = [
        (async () => {
          try {
            await (webhookAdapter as GmailWebhookAdapter).connect();
            logger.info('✅ Gmail webhook connected');
          } catch (error) {
            startedInFallbackMode = true;
            logger.warn(
              `⚠️ Gmail webhook connect failed, enabling Gmail API fallback polling: ${error instanceof Error ? error.message : String(error)}`
            );
          }
        })(),
        (clipboardAdapter as ClipboardOnlyAdapter).connect(),
      ];
      if (legacyManualEnrichmentEnabled) {
        startupTasks.push(
          (async () => {
            manualEnrichmentController = await startManualEnrichmentLoop(5000);
            logger.info('✅ Legacy manual enrichment loop started (explicit opt-in)');
          })()
        );
      } else {
        logger.info('ℹ️ Legacy manual enrichment loop is disabled by default');
      }
      await Promise.all(startupTasks);
    } else {
      await adapter!.connect();
    }
    await memoryMonitor.checkAndAlert('startup');
    memoryInterval = setInterval(() => {
      memoryMonitor.checkAndAlert('runtime').catch((err) => {
        logger.warn(`Memory monitor failed: ${err instanceof Error ? err.message : String(err)}`);
      });
    }, 30000);
    if (shouldRunE2EComplianceChecks) {
      const complianceEveryMs = Number.isNaN(Number(process.env.E2E_COMPLIANCE_INTERVAL_MS))
        ? 300000
        : Number(process.env.E2E_COMPLIANCE_INTERVAL_MS);
      e2eComplianceInterval = setInterval(() => {
        checkE2EOutputCompliance().catch((error) => {
          logger.warn(
            `E2E compliance check failed: ${error instanceof Error ? error.message : String(error)}`
          );
        });
      }, complianceEveryMs);
    }

    process.on('unhandledRejection', (reason) => {
      logger.error(
        `Unhandled rejection captured in long-living service: ${reason instanceof Error ? reason.message : String(reason)}`
      );
      appendFailureLog('runtime-unhandledRejection', reason);
    });

    process.on('uncaughtException', (error) => {
      logger.error(`Uncaught exception captured in long-living service: ${error.message}`);
      appendFailureLog('runtime-uncaughtException', error);
    });

    process.on('SIGINT', async () => {
      logger.info('🛑 Received SIGINT, shutting down gracefully...');
      if (memoryInterval) clearInterval(memoryInterval);
      if (clipboardInterval) clearInterval(clipboardInterval);
      if (fallbackGmailApiInterval) clearInterval(fallbackGmailApiInterval);
      if (hybridGmailBackfillInterval) clearInterval(hybridGmailBackfillInterval);
      if (e2eComplianceInterval) clearInterval(e2eComplianceInterval);
      removeServicePid();
      await manualEnrichmentController?.stop();
      if (adapterType === 'hybrid') {
        await (clipboardAdapter as ClipboardOnlyAdapter).disconnect();
        if (!startedInFallbackMode) {
          await (webhookAdapter as GmailWebhookAdapter).disconnect();
        }
      } else {
        await adapter!.disconnect();
      }
      process.exit(0);
    });
    process.on('SIGTERM', async () => {
      logger.info('🛑 Received SIGTERM, shutting down gracefully...');
      if (memoryInterval) clearInterval(memoryInterval);
      if (clipboardInterval) clearInterval(clipboardInterval);
      if (fallbackGmailApiInterval) clearInterval(fallbackGmailApiInterval);
      if (hybridGmailBackfillInterval) clearInterval(hybridGmailBackfillInterval);
      if (e2eComplianceInterval) clearInterval(e2eComplianceInterval);
      removeServicePid();
      await manualEnrichmentController?.stop();
      if (adapterType === 'hybrid') {
        await (clipboardAdapter as ClipboardOnlyAdapter).disconnect();
        if (!startedInFallbackMode) {
          await (webhookAdapter as GmailWebhookAdapter).disconnect();
        }
      } else {
        await adapter!.disconnect();
      }
      process.exit(0);
    });
    if (adapterType === 'hybrid') {
      const intakePollMs = scheduleMs || 60000;
      logger.info(
        `⏰ Hybrid mode active (clipboard=${hybridClipboardMode}, cadence=${intakePollMs / 1000}s)`
      );

      const runClipboardBatch = async () => {
        if (isClipboardRunInProgress) {
          logger.warn('Clipboard poll skipped because previous run is still in progress');
          return;
        }
        isClipboardRunInProgress = true;
        try {
          await runWithRetry('clipboard', async () => {
            await (clipboardAdapter as ClipboardOnlyAdapter).run();
          });
          clipboardFailureCount = 0;
        } catch (error) {
          clipboardFailureCount += 1;
          appendFailureLog('clipboard', error, clipboardFailureCount);
          logger.error(
            `Clipboard polling failed: ${error instanceof Error ? error.message : String(error)}`
          );
        } finally {
          isClipboardRunInProgress = false;
        }
      };

      const runFallbackBatch = async () => {
        if (!startedInFallbackMode) {
          return;
        }
        if (isFallbackRunInProgress) {
          logger.warn('Gmail API fallback poll skipped because previous run is still in progress');
          return;
        }
        isFallbackRunInProgress = true;
        try {
          await runWithRetry('gmail-fallback', async () => {
            await (fallbackGmailApiAdapter as GmailApiAdapter).run();
          });
          fallbackFailureCount = 0;
        } catch (error) {
          fallbackFailureCount += 1;
          appendFailureLog('gmail-fallback', error, fallbackFailureCount);
          logger.error(
            `Gmail API fallback batch failed: ${error instanceof Error ? error.message : String(error)}`
          );
        } finally {
          isFallbackRunInProgress = false;
        }
      };

      const runHybridGmailBackfillBatch = async () => {
        if (!hybridBackfillEnabled) return;
        if (isHybridGmailBackfillInProgress) {
          logger.warn('Hybrid Gmail backfill skipped because previous run is still in progress');
          return;
        }
        if (!(webhookAdapter as GmailWebhookAdapter).isConnected()) {
          logger.warn('Hybrid Gmail backfill skipped because webhook pipeline is not connected');
          return;
        }

        isHybridGmailBackfillInProgress = true;
        try {
          const gmail = new GmailService();
          await gmail.authenticate();
          const labelId = await gmail.getLabelId(config.gmail.labelName);
          const since = new Date(
            Date.now() - hybridBackfillLookbackHours * 60 * 60 * 1000
          ).toISOString();
          const messages = (await gmail.listMessagesByLabel(
            labelId,
            hybridBackfillMaxMessages,
            since
          )) as Array<{ id?: string }>;
          const messageIds: string[] = messages
            .map((message: { id?: string }) => message.id)
            .filter(
              (id: string | undefined): id is string => typeof id === 'string' && id.length > 0
            );

          if (messageIds.length === 0) {
            logger.info('Hybrid Gmail backfill found no messages to validate');
            hybridBackfillFailureCount = 0;
            return;
          }

          logger.info(
            `Hybrid Gmail backfill validating ${messageIds.length} messages (concurrency=${hybridBackfillConcurrency})`
          );

          for (let i = 0; i < messageIds.length; i += hybridBackfillConcurrency) {
            const chunk = messageIds.slice(i, i + hybridBackfillConcurrency);
            await Promise.all(
              chunk.map((messageId: string) =>
                runWithRetry('gmail-backfill', async () => {
                  await (webhookAdapter as GmailWebhookAdapter).processMessageById(messageId);
                })
              )
            );
          }

          hybridBackfillFailureCount = 0;
        } catch (error) {
          hybridBackfillFailureCount += 1;
          appendFailureLog('gmail-backfill', error, hybridBackfillFailureCount);
          logger.error(
            `Hybrid Gmail backfill failed: ${error instanceof Error ? error.message : String(error)}`
          );
        } finally {
          isHybridGmailBackfillInProgress = false;
        }
      };

      const triggerClipboardBatch = async (source: string) => {
        logger.info(`📎 Hybrid clipboard manual trigger received (${source})`);
        await runClipboardBatch();
      };

      hybridClipboardTrigger = async () => triggerClipboardBatch('signal');

      process.on('SIGUSR1', () => {
        if (adapterType !== 'hybrid' || hybridClipboardMode !== 'manual') return;
        if (!hybridClipboardTrigger) return;
        hybridClipboardTrigger().catch((error) => {
          logger.error(
            `Hybrid clipboard manual trigger failed: ${error instanceof Error ? error.message : String(error)}`
          );
        });
      });

      const runHybridIntakeBatch = async () => {
        await memoryMonitor.checkAndAlert('before-hybrid-intake-batch');
        const tasks: Promise<void>[] = [];
        if (hybridClipboardMode === 'poll') {
          tasks.push(runClipboardBatch());
        }
        if (startedInFallbackMode) {
          tasks.push(runFallbackBatch());
        }
        if (tasks.length === 0) return;
        await Promise.all(tasks);
        await memoryMonitor.checkAndAlert('after-hybrid-intake-batch');
      };

      if (hybridClipboardMode === 'poll') {
        await runHybridIntakeBatch();
        clipboardInterval = setInterval(() => {
          runHybridIntakeBatch().catch((error) => {
            logger.error(
              `Hybrid intake interval execution failed: ${error instanceof Error ? error.message : String(error)}`
            );
          });
        }, intakePollMs);
      } else {
        logger.info(
          '🖐️ Hybrid clipboard manual mode enabled (no passive polling). Use `npm run clipboard:trigger` to ingest clipboard on-demand.'
        );
        if (startedInFallbackMode) {
          await runFallbackBatch();
          fallbackGmailApiInterval = setInterval(() => {
            runFallbackBatch().catch((error) => {
              logger.error(
                `Gmail API fallback interval execution failed: ${error instanceof Error ? error.message : String(error)}`
              );
            });
          }, intakePollMs);
        }
      }

      if (hybridBackfillEnabled) {
        logger.info(
          `⏰ Hybrid Gmail backfill enabled: every ${Math.round(hybridBackfillIntervalMs / 1000)}s, lookback=${hybridBackfillLookbackHours}h, max=${hybridBackfillMaxMessages}`
        );

        if (hybridBackfillRunOnStart) {
          runHybridGmailBackfillBatch().catch((error) => {
            logger.error(
              `Hybrid Gmail backfill startup execution failed: ${error instanceof Error ? error.message : String(error)}`
            );
          });
        }

        hybridGmailBackfillInterval = setInterval(() => {
          runHybridGmailBackfillBatch().catch((error) => {
            logger.error(
              `Hybrid Gmail backfill interval execution failed: ${error instanceof Error ? error.message : String(error)}`
            );
          });
        }, hybridBackfillIntervalMs);
      }

      if (startedInFallbackMode) {
        logger.info(`⏰ Gmail API fallback is active and polled in parallel with clipboard intake`);
      }

      logger.info('✅ Hybrid data listening service is ready');
      return;
    }
    // Scheduled batch mode for batch adapters
    if ((adapterType === 'gmailApi' || adapterType === 'clipboardOnly') && scheduleMs) {
      logger.info(`⏰ Scheduled batch mode: running every ${scheduleMs / 1000}s`);
      const runBatch = async () => {
        logger.info('🔄 Scheduled batch fetch starting...');
        try {
          await memoryMonitor.checkAndAlert('before-batch');
          await adapter!.run();
          await memoryMonitor.checkAndAlert('after-batch');
          logger.info('✅ Batch fetch complete.');
        } catch (err) {
          logger.error(
            `❌ Batch fetch failed: ${err instanceof Error ? err.message : String(err)}`
          );
        }
      };
      await runBatch();
      const interval = setInterval(runBatch, scheduleMs);
      // Keep process alive until SIGINT/SIGTERM
      return;
    } else {
      // One-time batch mode (default)
      await memoryMonitor.checkAndAlert('before-run');
      if (adapterType !== 'gmailWebhook') {
        await adapter!.run();
      } else {
        logger.info('✅ Gmail webhook listener running (event-driven mode)');
      }
      await memoryMonitor.checkAndAlert('after-run');
      logger.info('✅ Data listening service is ready');
      if (adapterType === 'gmailApi' || adapterType === 'clipboardOnly') {
        if (memoryInterval) clearInterval(memoryInterval);
        logger.info('👋 Batch mode complete, exiting.');
        process.exit(0);
      }
    }
  } catch (err) {
    logger.error(`❌ Data listening failed: ${err instanceof Error ? err.message : String(err)}`);
    if (memoryInterval) clearInterval(memoryInterval);
    if (clipboardInterval) clearInterval(clipboardInterval);
    if (fallbackGmailApiInterval) clearInterval(fallbackGmailApiInterval);
    if (hybridGmailBackfillInterval) clearInterval(hybridGmailBackfillInterval);
    if (e2eComplianceInterval) clearInterval(e2eComplianceInterval);
    removeServicePid();
    const enrichmentController = manualEnrichmentController as { stop: () => Promise<void> } | null;
    if (enrichmentController) {
      await enrichmentController.stop();
    }
    if (adapterType === 'hybrid') {
      if (clipboardAdapter) await clipboardAdapter.disconnect();
      if (webhookAdapter) await webhookAdapter.disconnect();
    } else if (adapter) {
      await adapter.disconnect();
    }
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runDataListening();
}
