#!/usr/bin/env tsx

/**
 * Enhanced TUI for Manual Job Enrichment
 *
 * Features:
 * - Import from clipboard with validation
 * - Edit job fields interactively
 * - URL validation
 * - Real-time scoring preview
 * - Batch operations
 * - Rich formatting and help
 */

import readline from 'readline';

import clipboardy from 'clipboardy';
import { MongoClient, ObjectId } from 'mongodb';

import { config } from '../config.js';
import { getLogger } from '../services/logger.js';
import { HtmlJobParser } from '../services/parsers/html-job-parser.js';

const logger = getLogger();

interface PendingJob {
  _id: ObjectId;
  messageId: string;
  jobTitle?: string;
  company?: string;
  url?: string;
  description?: string;
  location?: string;
  currentScore?: number;
  currentSkills?: string[];
  missingFields?: string[];
  warnings?: string[];
  retryCount?: number;
}

interface DraftJob {
  position: string;
  company: string;
  url: string;
  location: string;
  profileNarrative: string;
  matchScore: number;
  matchedProfileSkills: string[];
  requirements: string[];
}

export type TerminalRoute = 'job_queue' | 'job_trash';
export type TerminalAction = 'manual_validate_to_queue' | 'manual_reject_to_trash';

export function getTerminalRouteForAction(action: TerminalAction): TerminalRoute {
  return action === 'manual_validate_to_queue' ? 'job_queue' : 'job_trash';
}

export function buildTuiActionLogEntry(
  messageId: string,
  action: string,
  details: Record<string, unknown>
): Record<string, unknown> {
  return {
    timestamp: new Date().toISOString(),
    messageId,
    action,
    source: 'enhanced_tui',
    details,
  };
}

class EnhancedTUI {
  private rl: readline.Interface;
  private mongo!: MongoClient;

  constructor() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
  }

  private ask(question: string): Promise<string> {
    return new Promise((resolve) => this.rl.question(question, (answer) => resolve(answer.trim())));
  }

  private clearScreen() {
    console.clear();
    console.log('╔════════════════════════════════════════════════════════════════════╗');
    console.log('║          📝 Jobs Watcher - Manual Enrichment TUI                  ║');
    console.log('╚════════════════════════════════════════════════════════════════════╝\n');
  }

  private printHelp() {
    console.log('\n📖 Available Commands:');
    console.log('─────────────────────────────────────────────────────────────────────');
    console.log('  e  - Edit job fields (position, company, score, skills, etc.)');
    console.log('  u  - Update URL');
    console.log('  p  - Paste from clipboard (auto-parse job HTML)');
    console.log('  v  - Validate current draft');
    console.log('  k  - Queue job (after validation)');
    console.log('  s  - Skip this job');
    console.log('  h  - Show this help');
    console.log('  q  - Quit TUI');
    console.log('─────────────────────────────────────────────────────────────────────\n');
  }

  private validateUrl(url: string): { valid: boolean; message?: string } {
    if (!url) return { valid: true }; // URL is optional

    if (!/^https?:\/\//i.test(url)) {
      return { valid: false, message: 'URL must start with http:// or https://' };
    }

    // Check for common job platforms
    const knownPlatforms = [
      'linkedin.com',
      'indeed.com',
      'glassdoor.com',
      'monster.com',
      'ziprecruiter.com',
      'careers.',
      'jobs.',
    ];

    const isKnownPlatform = knownPlatforms.some((platform) => url.toLowerCase().includes(platform));
    if (!isKnownPlatform) {
      return {
        valid: true,
        message: '⚠️  Warning: URL is not from a known job platform',
      };
    }

    return { valid: true };
  }

  private validateDraft(draft: DraftJob): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!draft.position || draft.position === 'Unknown') {
      errors.push('Position/title is required');
    }
    if (!draft.company || draft.company === 'Unknown') {
      errors.push('Company is required');
    }
    if (!draft.profileNarrative) {
      errors.push('Profile narrative is required');
    }
    if (!Array.isArray(draft.matchedProfileSkills) || draft.matchedProfileSkills.length === 0) {
      errors.push('At least one matched skill is required');
    }
    if (typeof draft.matchScore !== 'number' || Number.isNaN(draft.matchScore)) {
      errors.push('Match score must be a valid number');
    }
    if (draft.matchScore < 0 || draft.matchScore > 100) {
      errors.push('Match score must be between 0 and 100');
    }

    const urlValidation = this.validateUrl(draft.url);
    if (!urlValidation.valid) {
      errors.push(urlValidation.message || 'Invalid URL');
    }

    return { valid: errors.length === 0, errors };
  }

  private printDraft(draft: DraftJob) {
    console.log('\n📋 Current Draft:');
    console.log('─────────────────────────────────────────────────────────────────────');
    console.log(`  Position:     ${draft.position}`);
    console.log(`  Company:      ${draft.company}`);
    console.log(`  Location:     ${draft.location || 'N/A'}`);
    console.log(`  URL:          ${draft.url || 'N/A'}`);
    console.log(`  Match Score:  ${draft.matchScore}%`);
    console.log(`  Skills:       ${draft.matchedProfileSkills.join(', ') || 'None'}`);
    console.log(`  Requirements: ${draft.requirements.length} items`);
    console.log('─────────────────────────────────────────────────────────────────────');

    const validation = this.validateDraft(draft);
    if (!validation.valid) {
      console.log('\n⚠️  Validation Issues:');
      validation.errors.forEach((err) => console.log(`   • ${err}`));
    } else {
      console.log('\n✅ Draft is valid and ready to queue');
    }
  }

  private async importFromClipboard(draft: DraftJob): Promise<DraftJob> {
    try {
      const html = (await clipboardy.read()).trim();
      if (!html) {
        console.log('⚠️  Clipboard is empty');
        return draft;
      }

      console.log('🔍 Parsing clipboard content...');
      const parser = new HtmlJobParser();
      const parsed = parser.parseJobFromHtml(html);

      if (!parsed) {
        console.log('⚠️  Could not parse clipboard content as job HTML');
        return draft;
      }

      const parsedJob = parsed as {
        title?: string;
        company?: string;
        location?: string;
        url?: string;
        requirements?: string[];
      };
      const updated: DraftJob = {
        ...draft,
        position: parsedJob.title || draft.position,
        company: parsedJob.company || draft.company,
        location: parsedJob.location || draft.location,
        url: parsedJob.url || draft.url,
        requirements:
          Array.isArray(parsedJob.requirements) && parsedJob.requirements.length > 0
            ? parsedJob.requirements
            : draft.requirements,
      };

      console.log('✅ Successfully imported from clipboard');
      const urlValidation = this.validateUrl(updated.url);
      if (urlValidation.message) {
        console.log(`   ${urlValidation.message}`);
      }

      return updated;
    } catch (error) {
      console.log(
        `❌ Clipboard import failed: ${error instanceof Error ? error.message : String(error)}`
      );
      return draft;
    }
  }

  private parseList(value: string): string[] {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  private async editDraft(draft: DraftJob): Promise<DraftJob> {
    console.log('\n📝 Edit Mode (press Enter to keep current value):\n');

    const position = await this.ask(`Position [${draft.position}]: `);
    const company = await this.ask(`Company [${draft.company}]: `);
    const location = await this.ask(`Location [${draft.location || 'N/A'}]: `);
    const url = await this.ask(`URL [${draft.url || 'N/A'}]: `);
    const narrative = await this.ask(`Profile narrative [${draft.profileNarrative}]: `);
    const scoreRaw = await this.ask(`Match score (0-100) [${draft.matchScore}]: `);
    const skillsRaw = await this.ask(
      `Matched skills (comma-separated) [${draft.matchedProfileSkills.join(', ')}]: `
    );
    const reqsRaw = await this.ask(
      `Requirements (comma-separated) [${draft.requirements.join(', ')}]: `
    );

    return {
      position: position || draft.position,
      company: company || draft.company,
      location: location || draft.location,
      url: url || draft.url,
      profileNarrative: narrative || draft.profileNarrative,
      matchScore: scoreRaw ? Number(scoreRaw) : draft.matchScore,
      matchedProfileSkills: skillsRaw ? this.parseList(skillsRaw) : draft.matchedProfileSkills,
      requirements: reqsRaw ? this.parseList(reqsRaw) : draft.requirements,
    };
  }

  private async processJob(pending: PendingJob): Promise<boolean> {
    this.clearScreen();

    console.log('📥 Pending Job:');
    console.log('─────────────────────────────────────────────────────────────────────');
    console.log(`  Message ID:   ${pending.messageId}`);
    console.log(`  Title:        ${pending.jobTitle || 'Unknown'}`);
    console.log(`  Company:      ${pending.company || 'Unknown'}`);
    console.log(`  Current URL:  ${pending.url || 'N/A'}`);
    if (pending.missingFields?.length) {
      console.log(`  Missing:      ${pending.missingFields.join(', ')}`);
    }
    if (pending.warnings?.length) {
      console.log(`  Warnings:     ${pending.warnings.join(', ')}`);
    }
    console.log('─────────────────────────────────────────────────────────────────────');

    let draft: DraftJob = {
      position: pending.jobTitle || 'Unknown',
      company: pending.company || 'Unknown',
      location: pending.location || '',
      url: pending.url || '',
      profileNarrative: 'Manually validated by operator',
      matchScore: typeof pending.currentScore === 'number' ? pending.currentScore : 0,
      matchedProfileSkills: Array.isArray(pending.currentSkills) ? pending.currentSkills : [],
      requirements: [],
    };

    this.printHelp();

    for (;;) {
      this.printDraft(draft);
      const action = (await this.ask('\n🎯 Action [e/u/p/v/k/s/h/q]: ')).toLowerCase();

      if (action === 'q') {
        // Restore pending status
        const db = this.mongo.db(config.mongodb.dbName);
        await db
          .collection('needs_enrichment')
          .updateOne({ _id: pending._id }, { $set: { status: 'pending', updatedAt: new Date() } });
        throw new Error('__TUI_QUIT__');
      }

      if (action === 's') {
        const db = this.mongo.db(config.mongodb.dbName);
        const rejectReasonInput = await this.ask('Reject reason [operator_skipped]: ');
        const rejectReason = rejectReasonInput || 'operator_skipped';

        await db.collection('job_trash').insertOne({
          messageId: pending.messageId,
          reason: rejectReason,
          phase: 'manual_enrichment',
          source: 'manual_enrichment_tui',
          original: {
            messageId: pending.messageId,
            jobTitle: pending.jobTitle,
            company: pending.company,
            location: pending.location,
            url: pending.url,
            currentScore: pending.currentScore,
            currentSkills: pending.currentSkills,
            missingFields: pending.missingFields,
            warnings: pending.warnings,
          },
          createdAt: new Date(),
        });

        await db.collection('needs_enrichment').updateOne(
          { _id: pending._id },
          {
            $set: {
              status: 'skipped',
              updatedAt: new Date(),
              enrichmentNotes: `Skipped by operator: ${rejectReason}`,
              finalRoute: 'job_trash',
              finalReason: rejectReason,
            },
          }
        );
        const route = getTerminalRouteForAction('manual_reject_to_trash');
        await this.logRouteAction(pending.messageId, 'manual_reject_to_trash', {
          route,
          reason: rejectReason,
        });
        console.log('⏭️  Job skipped');
        await this.sleep(1000);
        return true;
      }

      if (action === 'h') {
        this.printHelp();
        continue;
      }

      if (action === 'u') {
        const newUrl = await this.ask(`Enter URL: `);
        if (newUrl) {
          draft.url = newUrl;
          const validation = this.validateUrl(newUrl);
          if (validation.message) {
            console.log(`   ${validation.message}`);
          }
        }
        continue;
      }

      if (action === 'p') {
        draft = await this.importFromClipboard(draft);
        continue;
      }

      if (action === 'e') {
        draft = await this.editDraft(draft);
        continue;
      }

      if (action === 'v') {
        const validation = this.validateDraft(draft);
        if (validation.valid) {
          console.log('✅ Validation passed - ready to queue');
        } else {
          console.log('❌ Validation failed:');
          validation.errors.forEach((err) => console.log(`   • ${err}`));
        }
        await this.sleep(2000);
        continue;
      }

      if (action === 'k') {
        const validation = this.validateDraft(draft);
        if (!validation.valid) {
          console.log('❌ Cannot queue - validation failed:');
          validation.errors.forEach((err) => console.log(`   • ${err}`));
          await this.sleep(2000);
          continue;
        }

        const db = this.mongo.db(config.mongodb.dbName);
        const manualJob = {
          messageId: pending.messageId,
          position: draft.position,
          company: draft.company,
          location: draft.location,
          url: draft.url,
          profileNarrative: draft.profileNarrative,
          matchScore: draft.matchScore,
          matchedProfileSkills: draft.matchedProfileSkills,
          requirements: draft.requirements,
          status: 'queued',
          enqueuedAt: new Date(),
          source: 'manual_enrichment_tui',
          manuallyValidated: true,
          manuallyValidatedAt: new Date(),
          finalRoute: 'job_queue',
        };

        await db
          .collection('job_queue')
          .updateOne(
            { messageId: pending.messageId },
            { $set: manualJob, $setOnInsert: { createdAt: new Date() } },
            { upsert: true }
          );

        await db.collection('needs_enrichment').updateOne(
          { _id: pending._id },
          {
            $set: {
              status: 'completed',
              updatedAt: new Date(),
              enrichedAt: new Date(),
              enrichmentSource: 'manual_tui',
              enrichmentNotes: 'Validated and queued via enhanced TUI',
              finalRoute: 'job_queue',
              manuallyValidated: true,
              manuallyValidatedAt: new Date(),
            },
          }
        );
        const route = getTerminalRouteForAction('manual_validate_to_queue');
        await this.logRouteAction(pending.messageId, 'manual_validate_to_queue', {
          route,
          matchScore: draft.matchScore,
          skills: draft.matchedProfileSkills,
        });

        console.log('✅ Job queued successfully!');
        await this.sleep(1000);
        return true;
      }

      console.log('❌ Unknown command. Press "h" for help.');
      await this.sleep(1000);
    }
  }

  private async getNextPending(): Promise<PendingJob | null> {
    const db = this.mongo.db(config.mongodb.dbName);
    const next = await db.collection('needs_enrichment').findOneAndUpdate(
      {
        $and: [
          { $or: [{ status: 'pending' }, { status: 'retry_requested' }] },
          {
            $or: [
              { nextRetryAt: { $exists: false } },
              { nextRetryAt: null },
              { nextRetryAt: { $lte: new Date() } },
            ],
          },
        ],
      },
      {
        $set: {
          status: 'in_progress',
          updatedAt: new Date(),
          enrichmentSource: 'manual_tui',
        },
      },
      { sort: { updatedAt: 1 }, returnDocument: 'after' }
    );

    if (next) {
      await this.logRouteAction((next as PendingJob).messageId, 'manual_dequeue', {
        route: 'needs_enrichment_in_progress',
      });
    }

    return next as PendingJob | null;
  }

  private async logRouteAction(
    messageId: string,
    action: string,
    details: Record<string, unknown>
  ): Promise<void> {
    const db = this.mongo.db(config.mongodb.dbName);
    await db.collection('action_log').insertOne(buildTuiActionLogEntry(messageId, action, details));
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async start(pollMs = 5000): Promise<void> {
    this.mongo = new MongoClient(config.mongodb.uri);
    await this.mongo.connect();
    logger.info('🎯 Enhanced TUI started');

    try {
      for (;;) {
        const pending = await this.getNextPending();

        if (!pending) {
          this.clearScreen();
          console.log('⏳ No pending jobs. Waiting...\n');
          console.log('   Press Ctrl+C to exit\n');
          await this.sleep(pollMs);
          continue;
        }

        await this.processJob(pending);
      }
    } catch (error) {
      if (error instanceof Error && error.message === '__TUI_QUIT__') {
        console.log('\n👋 Exiting TUI...');
      } else {
        throw error;
      }
    } finally {
      this.rl.close();
      await this.mongo.close();
    }
  }
}

async function main() {
  const pollArg = process.argv.find((arg) => arg.startsWith('--poll-ms='));
  const pollMs = pollArg ? Number.parseInt(pollArg.split('=')[1], 10) : 5000;

  await startEnhancedTui(Number.isNaN(pollMs) ? 5000 : pollMs);
}

export async function startEnhancedTui(pollMs = 5000): Promise<void> {
  const safePollMs = Number.isNaN(pollMs) ? 5000 : pollMs;

  const tui = new EnhancedTUI();
  await tui.start(safePollMs);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    logger.error(`Enhanced TUI failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
