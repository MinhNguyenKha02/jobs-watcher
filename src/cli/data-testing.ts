/**
 * Data testing mode runner
 * Processes emails from DB instead of real-time webhook
 * Validates parser, constraints, and TUI without live Gmail integration
 */

import fs from 'fs';
import path from 'path';
import { EmailParser } from '../services/parsers/email-parser.js';
import { processEnrichedJob } from '../ui/EnrichedJobHandler.js';
import { filterJobCompatibility, loadProfile } from '../services/constraints.js';
import { HtmlJobParser } from '../services/parsers/html-job-parser.js';
import { getLogger } from '../services/logger.js';
import { config } from '../config.js';
import type { Job, ParsedEmail } from '../types.js';
import type { ActionType } from '../ui/JobPopup.js';
import { EnrichedStorage, type EnrichedJobRecord } from '../services/storage/enriched-storage.js';
import { openBrowser, displaySummary } from '../services/tui-input-handler.js';

const logger = getLogger();

interface RawEmailMetadata {
  timestamp: string;
  messageId: string;
  from: string;
  subject: string;
}

interface FilteredJobsFile {
  dateProcessed: string;
  totalEmails: number;
  totalJobsParsed: number;
  passedJobs: number;
  filteredJobs: number;
  jobs: Array<{
    messageId: string;
    from: string;
    subject: string;
    platform: string;
    title: string;
    company: string;
    location: string;
    salary: string;
    url: string;
    filtered: boolean;
    matchedSkills?: string[];
  }>;
}


function loadFilteredJobs(dayPath: string): Job[] | null {
  const filteredPath = path.join(dayPath, 'filtered-jobs.json');
  if (!fs.existsSync(filteredPath)) {
    return null;
  }

  try {
    const raw = fs.readFileSync(filteredPath, 'utf-8');
    const data = JSON.parse(raw) as FilteredJobsFile;
    if (!Array.isArray(data.jobs)) {
      return null;
    }

    return data.jobs
      .filter(job => !job.filtered)
      .map(job => ({
        messageId: job.messageId,
        company: job.company,
        position: job.title,
        location: job.location,
        salary: job.salary || '',
        url: job.url,
        description: '',
        platform: job.platform || 'unknown',
        matchScore: job.matchedSkills?.length || 0,
      }));
  } catch (error) {
    logger.warn(`⚠️  Failed to read filtered-jobs.json in ${dayPath}`);
    return null;
  }
}

/**
 * Enrich job with pasted HTML and show comparison
 * Returns complete enriched job record with metadata ready for storage
 */
/**
 * Extract all jobs from email HTML (handles TopCV multi-job format)
 */
function extractAllJobs(html: string, parser: HtmlJobParser, metadata: RawEmailMetadata): Job[] {
  const jobs: Job[] = [];

  // Check if TopCV multi-job format
  if (html.includes('job-item') && html.includes('topcv')) {
    const jobPattern = /<a[^>]*class="[^"]*job-item-link[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    const matches = [...html.matchAll(jobPattern)];
    
    for (const match of matches) {
      const url = match[1] || '';
      const jobBlock = match[2] || '';
      
      const titleMatch = jobBlock.match(/<div[^>]*class="[^"]*title[^"]*"[^>]*>[\s\n]*<span[^>]*>([^<]+)<\/span>/);
      const companyMatch = jobBlock.match(/<div[^>]*class="[^"]*company[^"]*"[^>]*>[\s\n]*<span[^>]*>([^<]+)<\/span>/);
      const locationMatch = jobBlock.match(/>\s*(Hà Nội|Hồ Chí Minh|Đà Nẵng|TP\.HCM|Ho Chi Minh|Ha Noi|Da Nang)\s*</i);
      const salaryMatch = jobBlock.match(/<div[^>]*class="[^"]*text-primary[^"]*"[^>]*>[\s\n]*<b[^>]*>([^<]+)<\/b>/);
      
      const title = titleMatch?.[1]?.trim() || '';
      const company = companyMatch?.[1]?.trim() || '';
      const location = locationMatch?.[1]?.trim() || '';
      const salary = salaryMatch?.[1]?.trim();
      
      if (title && company) {
        // Apply constraints
        const mockEmail: ParsedEmail = {
          emailId: `${metadata.messageId}-${jobs.length}`,
          subject: metadata.subject,
          from: metadata.from,
          platform: 'topcv',
          body: jobBlock,
          receivedAt: new Date(metadata.timestamp),
          jobTitle: title,
          company,
          location,
          salary: salary || '',
          description: '',
          applyUrl: url,
          source: 'topcv',
        };

        const profile = loadProfile();
        const filterResult = filterJobCompatibility(mockEmail, profile);

        if (filterResult.passed) {
          jobs.push({
            messageId: mockEmail.emailId,
            company,
            position: title,
            location,
            salary: salary || '',
            url,
            description: '',
            platform: 'topcv',
            matchScore: filterResult.matchedSkills?.length || 0,
          });
        }
      }
    }
    
    if (jobs.length > 0) {
      return jobs;
    }
  }
  
  // Fall back to single-job parsing
  const parsed = parser.parseJobFromHtml(html);
  if (parsed && parsed.title) {
    const mockEmail: ParsedEmail = {
      emailId: metadata.messageId,
      subject: metadata.subject,
      from: metadata.from,
      platform: parsed.source || 'unknown',
      body: html,
      receivedAt: new Date(metadata.timestamp),
      jobTitle: parsed.title,
      company: parsed.company || 'Unknown',
      location: parsed.location || '',
      salary: parsed.salary || '',
      description: parsed.description || '',
      applyUrl: parsed.url || '',
      source: parsed.source || 'unknown',
    };

    const profile = loadProfile();
    const filterResult = filterJobCompatibility(mockEmail, profile);

    if (filterResult.passed) {
      jobs.push({
        messageId: mockEmail.emailId,
        company: parsed.company || 'Unknown',
        position: parsed.title,
        location: parsed.location,
        salary: parsed.salary,
        url: parsed.url,
        description: parsed.description,
        platform: parsed.source || 'unknown',
        matchScore: filterResult.matchedSkills?.length || 0,
      });
    }
  }
  
  return jobs;
}

/**
 * Process emails from DB with TUI interaction
 */
async function processEmailsFromDB(
  dbPath: string,
  batchSize: number,
  enrichedStorage: EnrichedStorage
): Promise<void> {
  logger.info('🔬 Data Testing Mode - Processing emails from DB');
  logger.info(`📂 DB Path: ${dbPath}`);
  logger.info(`📦 Batch Size: ${batchSize}`);

  const htmlParser = new HtmlJobParser();
  const profile = loadProfile();
  let totalProcessed = 0;
  let totalPassed = 0;
  let totalFiltered = 0;
  let jobCounter = 0;

  // Find all YYYY-MM directories
  if (!fs.existsSync(dbPath)) {
    logger.error(`❌ DB path not found: ${dbPath}`);
    logger.info(`💡 Run: npm run fetch:raw-emails to populate DB`);
    return;
  }

  const monthDirs = fs.readdirSync(dbPath).filter(d => /^\d{4}-\d{2}$/.test(d));
  
  for (const monthDir of monthDirs) {
    const monthPath = path.join(dbPath, monthDir);
    const dayDirs = fs.readdirSync(monthPath).filter(d => /^\d{2}$/.test(d));
    
    for (const dayDir of dayDirs) {
      const dayPath = path.join(monthPath, dayDir);
      logger.info(`\n📅 Processing: ${monthDir}/${dayDir}`);

      const filteredJobs = loadFilteredJobs(dayPath);
      if (filteredJobs && filteredJobs.length > 0) {
        totalProcessed += filteredJobs.length;
        totalPassed += filteredJobs.length;

        for (const job of filteredJobs) {
          jobCounter++;
          process.stdout.write('\x1Bc');

          // Display job header
          logger.info(`\n   ${'═'.repeat(76)}`);
          logger.info(`   📌 JOB #${jobCounter}`);
          logger.info(`   ${'═'.repeat(76)}`);
          logger.info(`   Position:      ${job.position}`);
          logger.info(`   Company:       ${job.company}`);
          logger.info(`   Match Score:   ${job.matchScore} skills`);
          logger.info(`   ${'═'.repeat(76)}`);

          if (job.url) {
            logger.info(`   URL: ${job.url}`);
          }

          if (config.features.tui) {
            try {
              let openBrowserOnStart = true;
              let moveNext = false;

              while (!moveNext) {
                const result = await processEnrichedJob(jobCounter, job, openBrowserOnStart);
                openBrowserOnStart = false;

                switch (result.action) {
                  case 'next':
                    moveNext = true;
                    break;

                  case 'skip':
                    moveNext = true;
                    break;

                  case 'quit':
                    logger.info(`   → Quitting data testing mode\n`);
                    return;

                  case 'paste': {
                    if (result.pastedHtml && result.enrichedJob) {
                      try {
                        const originalJob = result.originalJob || job;
                        const fieldsChanged: string[] = [];
                        if (result.enrichedJob.position !== originalJob.position) fieldsChanged.push('position');
                        if (result.enrichedJob.company !== originalJob.company) fieldsChanged.push('company');
                        if (result.enrichedJob.location !== originalJob.location) fieldsChanged.push('location');
                        if ((result.enrichedJob.description || '') !== (originalJob.description || '')) fieldsChanged.push('description');
                        if (result.enrichedJob.details && result.enrichedJob.details !== originalJob.details) fieldsChanged.push('details');

                        const enrichedRecord: EnrichedJobRecord = {
                          metadata: {
                            messageId: job.messageId ?? job.id ?? 'unknown',
                            timestamp: new Date().toISOString(),
                            jobTitle: job.position,
                            company: job.company,
                            matchScore: job.matchScore || 0,
                            location: job.location,
                            platform: job.platform,
                            url: job.url,
                            action: 'queue',
                            enrichedAt: new Date().toISOString(),
                          },
                          original: {
                            position: originalJob.position,
                            company: originalJob.company,
                            location: originalJob.location,
                            platform: originalJob.platform,
                            matchScore: originalJob.matchScore || 0,
                            details: originalJob.details,
                          },
                          enriched: {
                            position: result.enrichedJob.position,
                            company: result.enrichedJob.company,
                            location: result.enrichedJob.location,
                            description: result.enrichedJob.description || '',
                            details: result.enrichedJob.details,
                            matchScore: result.enrichedJob.matchScore || 0,
                            fieldsChanged,
                          },
                          htmlInput: result.pastedHtml,
                        };

                        const saved = await enrichedStorage.saveEnrichedJob(enrichedRecord);
                        logger.info(`   ✅ Enriched job saved to database at:\n       ${saved.dirPath}\n`);
                      } catch (error) {
                        logger.error(
                          `   ❌ Failed to save enriched job: ${error instanceof Error ? error.message : String(error)}`
                        );
                      }
                    }
                    break;
                  }
                }

                await logActionToFile(job, 'queue');
              }
            } catch (err) {
              logger.error(`   TUI error: ${err instanceof Error ? err.message : String(err)}`);
            }
          } else {
            logger.info('   TUI disabled - skipping interaction\n');
          }
        }

        continue;
      }

      const jsonlFile = path.join(dayPath, 'raw-emails.jsonl');
      
      if (!fs.existsSync(jsonlFile)) {
        continue;
      }

      const lines = fs.readFileSync(jsonlFile, 'utf-8').trim().split('\n');
      const metadata: RawEmailMetadata[] = lines.map(line => JSON.parse(line));
      
      for (const entry of metadata.slice(0, batchSize)) {
        const bodyFile = path.join(dayPath, `${entry.messageId}.body.txt`);
        
        if (!fs.existsSync(bodyFile)) {
          logger.warn(`⚠️  Missing body file: ${entry.messageId}`);
          continue;
        }

        const html = fs.readFileSync(bodyFile, 'utf-8');
        const jobs = extractAllJobs(html, htmlParser, entry);
        
        totalProcessed++;
        
        if (jobs.length === 0) {
          logger.debug(`⊘ No passing jobs in ${entry.messageId}`);
          totalFiltered++;
          continue;
        }

        totalPassed += jobs.length;
        
        // Show TUI for each passing job
        for (const job of jobs) {
          jobCounter++;
          process.stdout.write('\x1Bc');

          // Display job header
          logger.info(`\n   ${'═'.repeat(76)}`);
          logger.info(`   📌 JOB #${jobCounter}`);
          logger.info(`   ${'═'.repeat(76)}`);
          logger.info(`   Position:      ${job.position}`);
          logger.info(`   Company:       ${job.company}`);
          logger.info(`   Match Score:   ${job.matchScore} skills`);
          logger.info(`   ${'═'.repeat(76)}`);

          if (job.url) {
            logger.info(`   URL: ${job.url}`);
          }

          // TUI interaction using CLI handler (browser opening handled inside)
          if (config.features.tui) {
            try {
              let openBrowserOnStart = true;
              let moveNext = false;

              while (!moveNext) {
                const result = await processEnrichedJob(jobCounter, job, openBrowserOnStart);
                openBrowserOnStart = false;

                switch (result.action) {
                  case 'next':
                    moveNext = true;
                    break;

                  case 'skip':
                    moveNext = true;
                    break;

                  case 'quit':
                    logger.info(`   → Quitting data testing mode\n`);
                    return;

                  case 'paste': {
                    if (result.pastedHtml && result.enrichedJob) {
                      try {
                        const originalJob = result.originalJob || job;
                        const fieldsChanged: string[] = [];
                        if (result.enrichedJob.position !== originalJob.position) fieldsChanged.push('position');
                        if (result.enrichedJob.company !== originalJob.company) fieldsChanged.push('company');
                        if (result.enrichedJob.location !== originalJob.location) fieldsChanged.push('location');
                        if ((result.enrichedJob.description || '') !== (originalJob.description || '')) fieldsChanged.push('description');
                        if (result.enrichedJob.details && result.enrichedJob.details !== originalJob.details) fieldsChanged.push('details');

                        const enrichedRecord: EnrichedJobRecord = {
                          metadata: {
                            messageId: entry.messageId,
                            timestamp: new Date().toISOString(),
                            jobTitle: job.position,
                            company: job.company,
                            matchScore: job.matchScore || 0,
                            location: job.location,
                            platform: job.platform,
                            url: job.url,
                            action: 'queue',
                            enrichedAt: new Date().toISOString(),
                          },
                          original: {
                            position: originalJob.position,
                            company: originalJob.company,
                            location: originalJob.location,
                            platform: originalJob.platform,
                            matchScore: originalJob.matchScore || 0,
                            details: originalJob.details,
                          },
                          enriched: {
                            position: result.enrichedJob.position,
                            company: result.enrichedJob.company,
                            location: result.enrichedJob.location,
                            description: result.enrichedJob.description || '',
                            details: result.enrichedJob.details,
                            matchScore: result.enrichedJob.matchScore || 0,
                            fieldsChanged,
                          },
                          htmlInput: result.pastedHtml,
                        };

                        const saved = await enrichedStorage.saveEnrichedJob(enrichedRecord);
                        logger.info(`   ✅ Enriched job saved to database at:\n       ${saved.dirPath}\n`);
                      } catch (error) {
                        logger.error(
                          `   ❌ Failed to save enriched job: ${error instanceof Error ? error.message : String(error)}`
                        );
                      }
                    }
                    break;
                  }
                }

                await logActionToFile(job, 'queue');
              }
            } catch (err) {
              logger.error(`   TUI error: ${err instanceof Error ? err.message : String(err)}`);
            }
          } else {
            logger.info('   TUI disabled - skipping interaction\n');
          }
        }
      }
    }
  }

  // Display final summary
  displaySummary({
    totalJobs: jobCounter,
    totalProcessed,
    totalPassed,
    totalFiltered,
    totalEnriched: jobCounter - totalFiltered,
  });

  logger.info(`\n📂 Enriched jobs are stored in: db/enriched/YYYY-MM/DD/`);
  logger.info(`\n✅ Data testing complete`);
}

async function logActionToFile(job: Job, action: ActionType): Promise<void> {
  const logEntry = {
    timestamp: new Date().toISOString(),
    mode: 'data-testing',
    messageId: job.messageId,
    action,
    company: job.company,
    position: job.position,
    url: job.url,
    matchScore: job.matchScore,
  };

  const logDir = path.join(process.cwd(), 'logs');
  const logFile = path.join(logDir, 'data-testing.jsonl');

  try {
    await fs.promises.mkdir(logDir, { recursive: true });
    await fs.promises.appendFile(logFile, JSON.stringify(logEntry) + '\n', 'utf-8');
  } catch (error: any) {
    logger.warn(`Failed to log action: ${error.message}`);
  }
}

/**
 * Main entry point
 */
export async function runDataTesting(): Promise<void> {
  const dbPath = config.dataSource.dbPath || path.join(process.cwd(), 'src', 'db', 'emails');
  const batchSize = config.dataSource.batchSize || 10;
  const enrichedStorage = new EnrichedStorage(dbPath);

  try {
    await processEmailsFromDB(dbPath, batchSize, enrichedStorage);
  } catch (err) {
    logger.error(`❌ Data testing failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runDataTesting();
}
