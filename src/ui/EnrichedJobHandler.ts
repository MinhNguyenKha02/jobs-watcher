/**
 * Enriched Job Handler - CLI-based (non-React) TUI interaction
 * Handles job navigation, HTML enrichment, and metadata capture
 * Works with standard stdin/stdout for piping and user input
 */

import readline from 'readline';
import { spawnSync } from 'child_process';
import { promises as fs } from 'fs';
import { Readable } from 'stream';
import { getLogger } from '../services/logger.js';
import { enrichJobFromHtml } from './services/htmlEnricher.js';
import { openBrowser } from '../services/tui-input-handler.js';
import type { Job } from '../types.js';

const logger = getLogger();

// Persistent readline interface created once and reused
let rl: readline.Interface | null = null;
const lineQueue: string[] = [];
let lineResolver: ((line: string) => void) | null = null;

function ensureReadline(): readline.Interface {
  if (!rl) {
    rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false,
    });

    rl.on('line', (line: string) => {
      if (lineResolver) {
        lineResolver(line);
        lineResolver = null;
      } else {
        lineQueue.push(line);
      }
    });
  }
  return rl;
}

function readLine(): Promise<string> {
  return new Promise((resolve) => {
    ensureReadline();
    
    if (lineQueue.length > 0) {
      resolve(lineQueue.shift()!);
    } else {
      lineResolver = resolve;
    }
  });
}

function readClipboardText(): string | null {
  const clipboardCommands: Array<{ cmd: string; args: string[] }> = [
    { cmd: 'wl-paste', args: ['--no-newline'] },
    { cmd: 'xclip', args: ['-selection', 'clipboard', '-o'] },
    { cmd: 'xsel', args: ['--clipboard', '--output'] },
    { cmd: 'pbpaste', args: [] },
  ];

  for (const { cmd, args } of clipboardCommands) {
    const result = spawnSync(cmd, args, { encoding: 'utf8' });
    if (result.status === 0 && typeof result.stdout === 'string' && result.stdout.trim()) {
      return result.stdout;
    }
  }

  return null;
}

export interface EnrichedJobResult {
  action: 'next' | 'skip' | 'quit' | 'paste';
  originalJob?: Job;
  enrichedJob?: Job;
  pastedHtml?: string;
}

/**
 * Display job header in terminal
 */
function displayJobHeader(jobNumber: number, job: Job): void {
  const meta = [job.company, job.location].filter(Boolean).join(' • ');
  logger.info(`\n   JOB #${jobNumber} — ${job.position}`);
  if (meta) {
    logger.info(`   ${meta}`);
  }
  logger.info(`   score: ${job.matchScore || 0}`);
}

/**
 * Display action menu
 */
function displayActionMenu(): void {
  logger.info(`\n   [p] paste   [n] next   [s] skip   [q] quit`);
  logger.info(``);
}

/**
 * Wait for single character input from user
 */
async function promptAction(): Promise<string> {
  while (true) {
    process.stdout.write(`   > `);

    if (lineQueue.length > 0) {
      const action = lineQueue.shift()!;
      const trimmed = action.trim().toLowerCase();
      if (!trimmed) {
        continue;
      }
      return trimmed;
    }

    const timeout = setTimeout(() => {
      // Timeout without resolving - we'll just proceed with next
    }, 30000);

    const input = await readLine();
    clearTimeout(timeout);
    const trimmed = input.trim().toLowerCase();
    if (!trimmed) {
      continue;
    }
    return trimmed;
  }
}

/**
 * Wait for HTML paste from user
 */
async function waitForHtmlInput(): Promise<string | null> {
  logger.info(`\n   ${'─'.repeat(76)}`);
  logger.info(`   📄 PASTE HTML MODE`);
  logger.info(`   ${'─'.repeat(76)}`);
  logger.info(`   1. Copy HTML from browser (Ctrl+A, Ctrl+C)`);
  logger.info(`   2. Right-click to paste below`);
  logger.info(`   3. Type END on a new line when done (recommended)`);
  logger.info(`   4. Or type file:/abs/path/to.html (or @/abs/path/to.html) as the first line`);
  logger.info(`   5. Or type clipboard to read from system clipboard`);
  logger.info(`   (Type 'skip' to cancel)\n`);

  const allLines: string[] = [];

  const clipboardAuto = readClipboardText();
  if (clipboardAuto && /<\w[\s\S]*?>/.test(clipboardAuto) && clipboardAuto.length > 2000) {
    logger.info(`   📋 Clipboard HTML detected (${clipboardAuto.length} chars). Using it now.`);
    logger.info(`   ✅ Paste buffer is bypassed. Type 'clipboard' to re-read if needed.\n`);
    return clipboardAuto;
  }

  // Process all queued lines first (from paste buffer)
  while (lineQueue.length > 0) {
    const line = lineQueue.shift()!;
    const trimmed = line.trim().toLowerCase();

    if (trimmed === 'skip') {
      return null;
    }
    if (trimmed === 'clipboard') {
      const clipboard = readClipboardText();
      if (clipboard) {
        return clipboard;
      }
      logger.warn(`   ⚠️  Clipboard read failed (install wl-clipboard or xclip)
`);
      return null;
    }
    if (allLines.length === 0 && (trimmed.startsWith('file:') || trimmed.startsWith('@'))) {
      const path = trimmed.startsWith('@') ? trimmed.slice(1).trim() : trimmed.replace(/^file:/, '').trim();
      if (path) {
        try {
          return await fs.readFile(path, 'utf8');
        } catch (error) {
          logger.warn(`   ⚠️  Failed to read file: ${path}`);
          return null;
        }
      }
    }
    if (trimmed === 'end' || trimmed === 'eof' || trimmed === 'done') {
      return allLines.join('\n');
    }

    allLines.push(line);
    process.stdout.write(`   > \n`);
  }

  // Continue reading until we get an explicit END/EOF/DONE marker
  while (true) {
    process.stdout.write(`   > `);
    const line = await readLine();

    const trimmed = line.trim().toLowerCase();
    if (trimmed === 'skip') {
      return null;
    }
    if (trimmed === 'clipboard') {
      const clipboard = readClipboardText();
      if (clipboard) {
        return clipboard;
      }
      logger.warn(`   ⚠️  Clipboard read failed (install wl-clipboard or xclip)
`);
      return null;
    }
    if (allLines.length === 0 && (trimmed.startsWith('file:') || trimmed.startsWith('@'))) {
      const path = trimmed.startsWith('@') ? trimmed.slice(1).trim() : trimmed.replace(/^file:/, '').trim();
      if (path) {
        try {
          return await fs.readFile(path, 'utf8');
        } catch (error) {
          logger.warn(`   ⚠️  Failed to read file: ${path}`);
          return null;
        }
      }
    }
    if (trimmed === 'end' || trimmed === 'eof' || trimmed === 'done') {
      return allLines.join('\n');
    }

    allLines.push(line);

    if (trimmed === '' && allLines.length > 10) {
      const lastNonEmpty = [...allLines].reverse().find(l => l.trim() !== '') || '';
      if (/(<\/html>|<\/body>)\s*$/i.test(lastNonEmpty)) {
        return allLines.join('\n').trimEnd();
      }
    }
  }
}


/**
 * Display enrichment results
 */
function displayEnrichmentResults(original: Job, enriched: any): void {
  logger.info(`\n   ${'═'.repeat(76)}`);
  logger.info(`   ✨ ENRICHMENT RESULTS`);
  logger.info(`   ${'═'.repeat(76)}\n`);

  logger.info(`   🔄 FIELD CHANGES:`);
  logger.info(`   ${'─'.repeat(76)}`);

  let hasChanges = false;

  if (enriched.position && enriched.position !== original.position) {
    logger.info(`      Position:   "${original.position}" → "${enriched.position}"`);
    hasChanges = true;
  }
  if (enriched.company && enriched.company !== original.company) {
    logger.info(`      Company:    "${original.company}" → "${enriched.company}"`);
    hasChanges = true;
  }
  if (enriched.location && enriched.location !== original.location) {
    logger.info(`      Location:   "${original.location || 'N/A'}" → "${enriched.location}"`);
    hasChanges = true;
  }
  if (enriched.description) {
    logger.info(`      Description: Added ${enriched.description.length} characters`);
    hasChanges = true;
  }

  if (!hasChanges) {
    logger.info(`      (no field changes)`);
  }
  logger.info(``);

  logger.info(`   📊 MATCH SCORE:`);
  logger.info(`   ${'─'.repeat(76)}`);
  logger.info(`      Before: ${original.matchScore || 0} skills`);
  logger.info(`      After:  ${enriched.matchScore || 0} skills`);
  logger.info(``);
  logger.info(`   ${'═'.repeat(76)}\n`);
}

/**
 * Process a single job with user interaction
 */
export async function processEnrichedJob(
  jobNumber: number,
  job: Job,
  openBrowserOnStart: boolean = true
): Promise<EnrichedJobResult> {
  const originalJob: Job = { ...job };
  // Display job
  displayJobHeader(jobNumber, job);

  if (job.url) {
    logger.info(`   URL: ${job.url}`);
  }

  // Auto-open browser
  if (openBrowserOnStart && job.url) {
    const opened = await openBrowser(job.url);
    if (opened) {
      logger.info(`   🌐 Browser opened automatically\n`);
    }
  }

  let enrichedData: any = null;
  let pastedHtml: string | null = null;

  // Interactive loop
  let done = false;
  while (!done) {
    displayActionMenu();
    const action = await promptAction();

    switch (action) {
      case 'p': {
        // Paste HTML and enrich
        const html = await waitForHtmlInput();

        if (html && html.length > 50) {
          logger.info(`   ⏳ Enriching from HTML...\n`);

          try {
            const enriched = await enrichJobFromHtml(html, job, (newJob) => {
              job.position = newJob.position;
              job.company = newJob.company;
              job.location = newJob.location;
              job.description = newJob.description;
            }, (newScore) => {
              job.matchScore = newScore;
            });

            if (enriched) {
              enrichedData = enriched;
              pastedHtml = html;
              displayEnrichmentResults(job, enriched);
              logger.info(`   ✅ Job enriched and ready to save\n`);
              done = true;
              return { action: 'paste', originalJob, enrichedJob: enrichedData, pastedHtml };
            } else {
              logger.warn(`   ❌ Failed to parse HTML - please try again\n`);
            }
          } catch (error) {
            logger.error(`   ❌ Enrichment error: ${error instanceof Error ? error.message : String(error)}\n`);
          }
        } else {
          logger.warn(`   ⚠️  HTML too short or skipped\n`);
        }
        break;
      }

      case 'n':
        logger.info(`   → Moving to next job...\n`);
        done = true;
        return { action: 'next' };

      case 's':
        logger.info(`   → Skipped this job\n`);
        done = true;
        return { action: 'skip' };

      case 'q':
        logger.info(`   → Quitting data testing mode\n`);
        done = true;
        return { action: 'quit' };

      default:
        logger.warn(`   ⚠️  Unknown action. Try again.\n`);
    }
  }

  return { action: 'next' };
}

export { enrichJobFromHtml };
