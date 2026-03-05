import 'dotenv/config';

import { getLogger } from '../services/logger.js';

import { startEnhancedTui } from './enhanced-tui.js';

const logger = getLogger();

async function runManualEnrichment(): Promise<void> {
  const pollArg = process.argv.find((arg) => arg.startsWith('--poll-ms='));
  const pollMs = pollArg ? Number.parseInt(pollArg.split('=')[1], 10) : 5000;

  logger.info('🎯 Manual enrichment uses enhanced TUI. Press Ctrl+C to stop.');
  await startEnhancedTui(Number.isNaN(pollMs) ? 5000 : pollMs);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runManualEnrichment().catch((error) => {
    logger.error(
      `Manual enrichment failed: ${error instanceof Error ? error.message : String(error)}`
    );
    process.exit(1);
  });
}
