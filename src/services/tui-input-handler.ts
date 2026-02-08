/**
 * Data Testing TUI Input Handler
 * Manages keyboard input, browser opening, HTML pasting, and job navigation
 */

import readline from 'readline';
import { exec } from 'child_process';
import { promisify } from 'util';
import { getLogger } from './logger.js';

const execAsync = promisify(exec);
const logger = getLogger();
let browserOpened = false;
let lastBrowserUrl = '';

export type JobAction = 'paste' | 'next' | 'skip' | 'quit';

/**
 * Open URL in browser (cross-platform)
 */
export async function openBrowser(url: string): Promise<boolean> {
  try {
    const reuseBrowser = process.env.TUI_BROWSER_REUSE === '1';
    if (reuseBrowser && browserOpened) {
      if (lastBrowserUrl !== url) {
        logger.info(`   🔗 Browser reuse enabled. URL updated (not opening new tab):\n      ${url}`);
        lastBrowserUrl = url;
      }
      return false;
    }

    const isWindows = process.platform === 'win32';
    const isMac = process.platform === 'darwin';

    let command = '';
    if (isWindows) {
      command = `start "${url}"`;
    } else if (isMac) {
      command = `open "${url}"`;
    } else {
      command = `xdg-open "${url}"`;
    }

    await execAsync(command);
    browserOpened = true;
    lastBrowserUrl = url;
    return true;
  } catch (error) {
    logger.warn(`   ⚠️  Could not open browser: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

/**
 * Prompt user for action with keyboard input
 * Returns: 'paste' (p), 'next' (n), 'skip' (s), 'quit' (q)
 */
export async function promptJobAction(): Promise<JobAction> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false,
    });

    logger.info(`\n   ${'─'.repeat(76)}`);
    logger.info(`   ⌨️  JOB ACTIONS:`);
    logger.info(`   ${'─'.repeat(76)}`);
    logger.info(`      (p) Paste HTML to enrich`);
    logger.info(`      (n) Next job`);
    logger.info(`      (s) Skip this job`);
    logger.info(`      (q) Quit\n`);

    process.stdout.write(`   > `);

    rl.once('line', (input) => {
      rl.close();
      const action = input.trim().toLowerCase();

      switch (action) {
        case 'p':
          resolve('paste');
          break;
        case 'n':
          resolve('next');
          break;
        case 's':
          resolve('skip');
          break;
        case 'q':
          resolve('quit');
          break;
        default:
          logger.warn(`   ⚠️  Unknown action. Using 'next'.`);
          resolve('next');
      }
    });
  });
}

/**
 * Wait for HTML paste from user
 * Expects multi-line input terminated by empty line or 'done'
 */
export async function waitForHtmlPaste(): Promise<string | null> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false,
    });

    logger.info(`\n   ${'─'.repeat(76)}`);
    logger.info(`   📄 READY FOR HTML PASTE`);
    logger.info(`   ${'─'.repeat(76)}`);
    logger.info(`   1. Copy HTML from browser (Ctrl+A, Ctrl+C)`);
    logger.info(`   2. Paste below (right-click or Ctrl+V)`);
    logger.info(`   3. Press Enter twice when done`);
    logger.info(`   (or type 'skip' to cancel)\n`);

    const lines: string[] = [];
    let emptyCount = 0;

    process.stdout.write(`   > `);

    rl.on('line', (line: string) => {
      if (line.toLowerCase().trim() === 'skip') {
        rl.close();
        resolve(null);
        return;
      }

      if (line.trim() === '') {
        emptyCount++;
        if (emptyCount >= 2) {
          rl.close();
          resolve(lines.join('\n'));
          return;
        }
      } else {
        emptyCount = 0;
        lines.push(line);
      }

      if (emptyCount === 0 && line.trim() !== '') {
        process.stdout.write(`   > `);
      }
    });

    rl.on('close', () => {
      if (lines.length > 0) {
        resolve(lines.join('\n'));
      } else {
        resolve(null);
      }
    });
  });
}

/**
 * Display job information header
 */
export function displayJobHeader(jobNumber: number, position: string, company: string, matchScore: number): void {
  logger.info(`\n   ${'═'.repeat(76)}`);
  logger.info(`   📌 JOB #${jobNumber}`);
  logger.info(`   ${'═'.repeat(76)}`);
  logger.info(`   Position:      ${position}`);
  logger.info(`   Company:       ${company}`);
  logger.info(`   Match Score:   ${matchScore} skills`);
  logger.info(`   ${'═'.repeat(76)}`);
}

/**
 * Display enrichment comparison header
 */
export function displayEnrichmentHeader(): void {
  logger.info(`\n   ${'═'.repeat(76)}`);
  logger.info(`   ✨ ENRICHMENT PROCESSING`);
  logger.info(`   ${'═'.repeat(76)}\n`);
}

/**
 * Display parsed HTML fields
 */
export function displayParsedFields(parsed: {
  title?: string;
  company?: string;
  location?: string;
  description?: string;
}): void {
  logger.info(`   🔍 PARSED FROM BROWSER HTML:`);
  logger.info(`   ${'─'.repeat(76)}`);
  logger.info(`      Title:        ${parsed.title || 'N/A'}`);
  logger.info(`      Company:      ${parsed.company || 'N/A'}`);
  logger.info(`      Location:     ${parsed.location || 'N/A'}`);
  logger.info(`      Description:  ${parsed.description ? `${parsed.description.length} chars` : 'None'}\n`);
}

/**
 * Display field changes
 */
export function displayFieldChanges(changes: Array<{ field: string; before: string; after: string }>): void {
  logger.info(`   ✅ FIELD CHANGES:`);
  logger.info(`   ${'─'.repeat(76)}`);

  if (changes.length === 0) {
    logger.info(`      (no field changes)`);
  } else {
    for (const change of changes) {
      logger.info(`      ${change.field}: "${change.before}" → "${change.after}"`);
    }
  }
  logger.info(``);
}

/**
 * Display match score calculation
 */
export function displayScoreCalculation(
  profileSkills: number,
  matchedSkills: number,
  matched: string[],
  scoreChange: { from: number; to: number }
): void {
  logger.info(`   📊 MATCH SCORE RECALCULATION:`);
  logger.info(`   ${'─'.repeat(76)}`);
  logger.info(`      Profile Skills: ${profileSkills}`);
  logger.info(`      Matched Skills: ${matchedSkills}`);
  if (matched && matched.length > 0) {
    logger.info(
      `      Found:          ${matched.slice(0, 6).join(', ')}${matched.length > 6 ? '...' : ''}`
    );
  }
  logger.info(`      Score Change:   ${scoreChange.from} → ${scoreChange.to}\n`);
}

/**
 * Display enriched job metadata
 */
export function displayEnrichedMetadata(metadata: {
  position: string;
  company: string;
  location?: string;
  platform: string;
  matchScore: number;
  fieldsChanged: string[];
}): void {
  logger.info(`   💾 ENRICHED JOB METADATA:`);
  logger.info(`   ${'═'.repeat(76)}`);
  logger.info(`      Position:        ${metadata.position}`);
  logger.info(`      Company:         ${metadata.company}`);
  logger.info(`      Location:        ${metadata.location || 'N/A'}`);
  logger.info(`      Platform:        ${metadata.platform}`);
  logger.info(`      Match Score:     ${metadata.matchScore}`);
  logger.info(`      Fields Changed:  ${metadata.fieldsChanged.length}`);
  if (metadata.fieldsChanged.length > 0) {
    logger.info(`      Changed Fields:  ${metadata.fieldsChanged.join(', ')}`);
  }
  logger.info(`   ${'═'.repeat(76)}\n`);
}

/**
 * Display summary statistics
 */
export function displaySummary(stats: {
  totalJobs: number;
  totalProcessed: number;
  totalPassed: number;
  totalFiltered: number;
  totalEnriched: number;
}): void {
  logger.info('\n📊 DATA TESTING SUMMARY:');
  logger.info(`   ${'━'.repeat(72)}`);
  logger.info(`   Total Jobs Processed:  ${stats.totalJobs}`);
  logger.info(`   Emails processed:      ${stats.totalProcessed}`);
  logger.info(`   Jobs passed:           ${stats.totalPassed}`);
  logger.info(`   Emails filtered:       ${stats.totalFiltered}`);
  logger.info(`   Jobs enriched:         ${stats.totalEnriched}`);
  logger.info(`   ${'━'.repeat(72)}`);
}
