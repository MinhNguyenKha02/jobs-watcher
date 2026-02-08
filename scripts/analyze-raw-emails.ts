import fs from 'fs';
import path from 'path';
import { extractAllJobs } from '../src/services/job-extraction.js';
import { filterJobCompatibility, loadProfile } from '../src/services/constraints.js';
import { getLogger } from '../src/services/logger.js';
import { notifyUser } from '../src/services/notifications.js';

const logger = getLogger();

interface ProcessedJob {
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
  filterReason?: string;
  matchedSkills?: string[];
}

interface AnalysisReport {
  dateProcessed: string;
  totalEmails: number;
  totalJobsParsed: number;
  passedJobs: number;
  filteredJobs: number;
  jobs: ProcessedJob[];
}

/**
 * Extract all jobs from an email HTML (handles TopCV multi-job format)
 * Delegates to job-extraction service
 */
function extractAllJobsFromEmail(html: string) {
  return extractAllJobs(html);
}

async function main() {
  try {
    const inputDate = process.env.DATE || new Date().toISOString().split('T')[0];
    const [year, month, day] = inputDate.split('-');
    
    const inputDir = path.join(process.cwd(), 'src', 'db', 'emails', `${year}-${month}`, day);
    const outputDir = inputDir; // Save output in same directory

    if (!fs.existsSync(inputDir)) {
      logger.error(`❌ Input directory not found: ${inputDir}`);
      logger.info(`💡 Run: FETCH_LIMIT=20 npm run fetch:raw-emails`);
      process.exit(1);
    }

    logger.info(`📂 Analyzing emails from: ${inputDir}`);

    const profile = loadProfile();
    const jsonlFile = path.join(inputDir, 'raw-emails.jsonl');

    if (!fs.existsSync(jsonlFile)) {
      logger.error(`❌ Metadata file not found: ${jsonlFile}`);
      process.exit(1);
    }

    // Read metadata
    const lines = fs.readFileSync(jsonlFile, 'utf-8').trim().split('\n');
    const metadata = lines.map(line => JSON.parse(line));

    logger.info(`📮 Found ${metadata.length} emails to analyze`);

    const processedJobs: ProcessedJob[] = [];
    let totalJobsParsed = 0;
    let passedCount = 0;
    let filteredCount = 0;

    for (const entry of metadata) {
      const bodyFile = path.join(inputDir, `${entry.messageId}.body.txt`);
      
      if (!fs.existsSync(bodyFile)) {
        logger.warn(`⚠️  Missing body file: ${entry.messageId}`);
        continue;
      }

      const html = fs.readFileSync(bodyFile, 'utf-8');
      
      // Parse HTML to extract jobs (handle multiple jobs per email for TopCV)
      const jobs = extractAllJobsFromEmail(html);
      
      if (jobs.length === 0) {
        logger.debug(`⊘ No job found in ${entry.messageId} (${entry.subject})`);
        continue;
      }

      totalJobsParsed += jobs.length;

      // Process each job from this email
      for (const parsed of jobs) {
        try {
          // Convert to ParsedEmail format for constraint filtering
          const mockEmail = {
            emailId: entry.messageId,
            subject: entry.subject,
            from: entry.from,
            body: html,
            receivedAt: new Date(entry.timestamp),
            jobTitle: parsed.title || 'Unknown',
            company: parsed.company || 'Unknown',
            location: parsed.location || '',
            salary: parsed.salary || '',
            description: parsed.description || '',
            applyUrl: parsed.url || '',
            source: parsed.source || 'unknown',
          };

          // Apply constraints filter
          const filterResult = filterJobCompatibility(mockEmail, profile);

          const processedJob: ProcessedJob = {
            messageId: entry.messageId,
            from: entry.from,
            subject: entry.subject,
            platform: parsed.source || 'unknown',
            title: parsed.title || 'Unknown',
            company: parsed.company || 'Unknown',
            location: parsed.location || '',
            salary: parsed.salary || '',
            url: parsed.url || '',
            filtered: !filterResult.passed,
            filterReason: filterResult.passed ? undefined : (filterResult.reasons?.join(', ') || 'Unknown'),
            matchedSkills: filterResult.matchedSkills || [],
          };

          processedJobs.push(processedJob);

          if (filterResult.passed) {
            passedCount++;
            logger.info(`✓ [PASS] ${parsed.title} @ ${parsed.company}`);
            if (filterResult.matchedSkills && filterResult.matchedSkills.length > 0) {
              logger.info(`  Skills: ${filterResult.matchedSkills.join(', ')}`);
            }
          } else {
            filteredCount++;
            logger.debug(`✗ [FILTER] ${parsed.title} @ ${parsed.company}: ${filterResult.reasons?.join(', ') || 'Unknown'}`);
          }
        } catch (jobErr) {
          logger.warn(`⚠️  Error processing job: ${jobErr instanceof Error ? jobErr.message : String(jobErr)}`);
        }
      }
    }

    // Generate report (JSON only, no markdown)
    const report: AnalysisReport = {
      dateProcessed: new Date().toISOString(),
      totalEmails: metadata.length,
      totalJobsParsed,
      passedJobs: passedCount,
      filteredJobs: filteredCount,
      jobs: processedJobs,
    };

    // Save JSON report only
    const jsonOutput = path.join(outputDir, 'filtered-jobs.json');
    fs.writeFileSync(jsonOutput, JSON.stringify(report, null, 2), 'utf-8');
    logger.info(`💾 Saved JSON report: ${jsonOutput}`);

    // Summary
    logger.info(`\n📊 Analysis Complete:`);
    logger.info(`   Emails analyzed: ${metadata.length}`);
    logger.info(`   Jobs parsed: ${totalJobsParsed}`);
    logger.info(`   ✓ Passed: ${passedCount} (${((passedCount / totalJobsParsed) * 100).toFixed(1)}%)`);
    logger.info(`   ✗ Filtered: ${filteredCount} (${((filteredCount / totalJobsParsed) * 100).toFixed(1)}%)`);

    // Notify if high pass rate (good job opportunities)
    if (passedCount >= 10) {
      await notifyUser({
        title: '🎯 Jobs Watcher Alert',
        message: `${passedCount} junior-level jobs found! Check filtered-jobs.json`,
        urgency: 'high',
      }).catch(() => {});
    }

    // Notify if many jobs filtered (potential misconfig or market shift)
    if (totalJobsParsed > 0 && filteredCount / totalJobsParsed > 0.8) {
      await notifyUser({
        title: '⚠️ Jobs Watcher Warning',
        message: `${filteredCount}/${totalJobsParsed} jobs filtered. Check constraints.`,
        urgency: 'normal',
      }).catch(() => {});
    }

  } catch (err) {
    logger.error(`analyze-raw-emails failed: ${err instanceof Error ? err.message : String(err)}`);
    
    // Notify on critical error
    await notifyUser({
      title: '❌ Jobs Watcher Error',
      message: `Analysis failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
      urgency: 'high',
    }).catch(() => {});
    
    process.exit(1);
  }
}

main();
