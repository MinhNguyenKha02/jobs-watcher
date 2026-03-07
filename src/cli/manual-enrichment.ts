import 'dotenv/config';

import { getLogger } from '../services/logger.js';

import { startEnhancedTui } from './enhanced-tui.js';

const logger = getLogger();

export function resolveManualEnrichmentPollMs(argv: string[], fallbackMs = 5000): number {
  const pollArg = argv.find((arg) => arg.startsWith('--poll-ms='));
  if (!pollArg) return fallbackMs;

  const parsed = Number.parseInt(pollArg.split('=')[1], 10);
  return Number.isNaN(parsed) ? fallbackMs : parsed;
}

async function runManualEnrichment(): Promise<void> {
  const pollMs = resolveManualEnrichmentPollMs(process.argv, 5000);

  logger.info('🎯 Manual enrichment uses enhanced TUI. Press Ctrl+C to stop.');
  await startEnhancedTui(pollMs);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runManualEnrichment().catch((error) => {
    logger.error(
      `Manual enrichment failed: ${error instanceof Error ? error.message : String(error)}`
    );
    process.exit(1);
  });
}
