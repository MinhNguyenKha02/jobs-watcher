import readline from 'readline';

import clipboardy from 'clipboardy';
import { MongoClient, ObjectId } from 'mongodb';

import { config } from '../config.js';
import { getLogger } from '../services/logger.js';
import { HtmlJobParser } from '../services/parsers/html-job-parser.js';

const logger = getLogger();

type LoopController = {
  stop: () => Promise<void>;
};

type PendingEnrichment = {
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
  nextRetryAt?: Date;
};

type LegacyTerminalAction = 'manual_validate_to_queue' | 'manual_reject_to_trash';
type LegacyTerminalRoute = 'job_queue' | 'job_trash';

function getLegacyTerminalRoute(action: LegacyTerminalAction): LegacyTerminalRoute {
  return action === 'manual_validate_to_queue' ? 'job_queue' : 'job_trash';
}

export function buildLegacyActionLogEntry(
  messageId: string,
  action: LegacyTerminalAction,
  details: Record<string, unknown>
): Record<string, unknown> {
  return {
    timestamp: new Date().toISOString(),
    messageId,
    action,
    source: 'legacy_manual_enrichment_loop',
    details,
  };
}

function createReadline(): readline.Interface {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

function ask(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, (answer) => resolve(answer.trim())));
}

function validateManualJob(job: {
  messageId: string;
  position: string;
  company: string;
  url?: string;
  profileNarrative: string;
  matchedProfileSkills: string[];
  requirements: string[];
  matchScore: number;
}): string[] {
  const errors: string[] = [];
  if (!job.messageId) errors.push('messageId is required');
  if (!job.position) errors.push('position is required');
  if (!job.company) errors.push('company is required');
  if (!job.profileNarrative) errors.push('profileNarrative is required');
  if (!Array.isArray(job.matchedProfileSkills))
    errors.push('matchedProfileSkills must be an array');
  if (!Array.isArray(job.requirements)) errors.push('requirements must be an array');
  if (typeof job.matchScore !== 'number' || Number.isNaN(job.matchScore))
    errors.push('matchScore must be a number');
  if (job.url && !/^https?:\/\//i.test(job.url))
    errors.push('url must start with http:// or https://');
  return errors;
}

function parseCommaList(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

async function importClipboardDraft(existing: {
  position: string;
  company: string;
  url: string;
  profileNarrative: string;
  matchScore: number;
  matchedProfileSkills: string[];
  requirements: string[];
}): Promise<typeof existing> {
  const html = (await clipboardy.read()).trim();
  if (!html) {
    logger.warn('[ManualEnrichment] Clipboard is empty');
    return existing;
  }

  const parser = new HtmlJobParser();
  const parsed = parser.parseJobFromHtml(html);
  if (!parsed) {
    logger.warn('[ManualEnrichment] Clipboard content could not be parsed as job HTML');
    return existing;
  }

  const parsedJob = parsed as unknown as {
    title?: string;
    company?: string;
    url?: string;
    requirements?: string[];
  };

  return {
    ...existing,
    position: parsedJob.title || existing.position,
    company: parsedJob.company || existing.company,
    url: parsedJob.url || existing.url,
    requirements:
      Array.isArray(parsedJob.requirements) && parsedJob.requirements.length > 0
        ? parsedJob.requirements
        : existing.requirements,
    profileNarrative: existing.profileNarrative,
    matchScore: existing.matchScore,
    matchedProfileSkills: existing.matchedProfileSkills,
  };
}

async function processNextPending(mongo: MongoClient, rl: readline.Interface): Promise<boolean> {
  const db = mongo.db(config.mongodb.dbName);
  const needsCollection = db.collection('needs_enrichment');
  const queueCollection = db.collection('job_queue');
  const trashCollection = db.collection('job_trash');
  const actionLogCollection = db.collection('action_log');

  const next = await needsCollection.findOneAndUpdate(
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
        enrichmentSource: 'manual',
      },
    },
    { sort: { updatedAt: 1 }, returnDocument: 'after' }
  );

  const pending = next as PendingEnrichment | null;
  if (!pending) {
    return false;
  }

  logger.info(`\n[ManualEnrichment] Pending: ${pending.messageId}`);
  logger.info(
    `[ManualEnrichment] Title: ${pending.jobTitle || 'Unknown'} | Company: ${pending.company || 'Unknown'}`
  );
  if (pending.missingFields?.length) {
    logger.info(`[ManualEnrichment] Missing fields: ${pending.missingFields.join(', ')}`);
  }
  if (pending.warnings?.length) {
    logger.info(`[ManualEnrichment] Warnings: ${pending.warnings.join(', ')}`);
  }
  logger.info(`[ManualEnrichment] Existing URL: ${pending.url || 'N/A'}`);

  let draft = {
    position: pending.jobTitle || 'Unknown',
    company: pending.company || 'Unknown',
    url: pending.url || '',
    profileNarrative: 'Manually validated by operator',
    matchScore: typeof pending.currentScore === 'number' ? pending.currentScore : 0,
    matchedProfileSkills: Array.isArray(pending.currentSkills) ? pending.currentSkills : [],
    requirements: [] as string[],
  };

  while (true) {
    logger.info(
      `\n[ManualEnrichment] Draft: ${draft.position} @ ${draft.company} | score=${draft.matchScore} | url=${draft.url || 'N/A'}`
    );
    const action = (
      await ask(
        rl,
        'Action [e=edit, u=url, p=paste-clipboard, v=validate, k=queue, s=skip, q=quit]: '
      )
    ).toLowerCase();

    if (action === 'q') {
      await needsCollection.updateOne(
        { _id: pending._id },
        { $set: { status: 'pending', updatedAt: new Date() } }
      );
      throw new Error('__MANUAL_ENRICHMENT_STOP__');
    }

    if (action === 's') {
      const rejectReason = 'operator_skipped_legacy';
      const route = getLegacyTerminalRoute('manual_reject_to_trash');

      await trashCollection.insertOne({
        messageId: pending.messageId,
        reason: rejectReason,
        phase: 'manual_enrichment',
        source: 'legacy_manual_enrichment_loop',
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

      await needsCollection.updateOne(
        { _id: pending._id },
        {
          $set: {
            status: 'skipped',
            updatedAt: new Date(),
            enrichmentNotes: `Skipped by operator: ${rejectReason}`,
            finalRoute: route,
            finalReason: rejectReason,
          },
        }
      );

      await actionLogCollection.insertOne(
        buildLegacyActionLogEntry(pending.messageId, 'manual_reject_to_trash', {
          route,
          reason: rejectReason,
        })
      );

      return true;
    }

    if (action === 'u') {
      const nextUrl = await ask(rl, `URL [${draft.url}]: `);
      draft.url = nextUrl || draft.url;
      continue;
    }

    if (action === 'p') {
      try {
        draft = await importClipboardDraft(draft);
        logger.info('[ManualEnrichment] Imported values from clipboard HTML');
      } catch (error) {
        logger.warn(
          `[ManualEnrichment] Clipboard import failed: ${error instanceof Error ? error.message : String(error)}`
        );
      }
      continue;
    }

    if (action === 'e') {
      const position = await ask(rl, `Position [${draft.position}]: `);
      const company = await ask(rl, `Company [${draft.company}]: `);
      const profileNarrative = await ask(rl, `Profile narrative [${draft.profileNarrative}]: `);
      const scoreRaw = await ask(rl, `Match score (0-100) [${draft.matchScore}]: `);
      const skillsRaw = await ask(
        rl,
        `Matched skills (comma-separated) [${draft.matchedProfileSkills.join(', ')}]: `
      );
      const requirementsRaw = await ask(
        rl,
        `Requirements (comma-separated) [${draft.requirements.join(', ')}]: `
      );

      if (position) draft.position = position;
      if (company) draft.company = company;
      if (profileNarrative) draft.profileNarrative = profileNarrative;
      if (scoreRaw) {
        const score = Number(scoreRaw);
        if (!Number.isNaN(score)) draft.matchScore = score;
      }
      if (skillsRaw) draft.matchedProfileSkills = parseCommaList(skillsRaw);
      if (requirementsRaw) draft.requirements = parseCommaList(requirementsRaw);
      continue;
    }

    if (action === 'v' || action === 'k') {
      const manualJob = {
        messageId: pending.messageId,
        position: draft.position,
        company: draft.company,
        url: draft.url,
        profileNarrative: draft.profileNarrative,
        matchScore: draft.matchScore,
        matchedProfileSkills: draft.matchedProfileSkills,
        requirements: draft.requirements,
        status: 'queued',
        enqueuedAt: new Date(),
        source: 'manual_enrichment',
      };

      const validationErrors = validateManualJob(manualJob);
      if (validationErrors.length > 0) {
        logger.warn(`[ManualEnrichment] Validation failed: ${validationErrors.join('; ')}`);
        await needsCollection.updateOne(
          { _id: pending._id },
          {
            $set: {
              status: 'retry_requested',
              updatedAt: new Date(),
              retryCount: (pending.retryCount || 0) + 1,
              nextRetryAt: new Date(Date.now() + 60_000),
              enrichmentNotes: `Validation failed: ${validationErrors.join('; ')}`,
            },
          }
        );
        return true;
      }

      if (action === 'v') {
        logger.info('[ManualEnrichment] Validation passed');
        continue;
      }

      await queueCollection.updateOne(
        { messageId: pending.messageId },
        { $set: manualJob, $setOnInsert: { createdAt: new Date() } },
        { upsert: true }
      );

      await needsCollection.updateOne(
        { _id: pending._id },
        {
          $set: {
            status: 'completed',
            updatedAt: new Date(),
            enrichedAt: new Date(),
            enrichmentSource: 'manual',
            enrichmentNotes: 'Validated and queued via TUI',
            finalRoute: getLegacyTerminalRoute('manual_validate_to_queue'),
            manuallyValidated: true,
            manuallyValidatedAt: new Date(),
          },
        }
      );

      await actionLogCollection.insertOne(
        buildLegacyActionLogEntry(pending.messageId, 'manual_validate_to_queue', {
          route: getLegacyTerminalRoute('manual_validate_to_queue'),
          matchScore: draft.matchScore,
          skills: draft.matchedProfileSkills,
        })
      );

      logger.info(`[ManualEnrichment] Queued validated job: ${pending.messageId}`);
      return true;
    }

    logger.warn('[ManualEnrichment] Unknown action');
  }
}

export async function startManualEnrichmentLoop(pollMs = 5000): Promise<LoopController> {
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    throw new Error('Missing MONGODB_URI');
  }

  const mongo = new MongoClient(mongoUri);
  await mongo.connect();

  const rl = createReadline();
  let stopped = false;
  let processing = false;

  const tick = async (): Promise<void> => {
    if (stopped || processing) return;
    processing = true;
    try {
      const didWork = await processNextPending(mongo, rl);
      if (!didWork) {
        logger.debug('[ManualEnrichment] No pending records');
      }
    } catch (error) {
      if (error instanceof Error && error.message === '__MANUAL_ENRICHMENT_STOP__') {
        stopped = true;
      } else {
        logger.error(
          `[ManualEnrichment] Loop error: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    } finally {
      processing = false;
    }
  };

  const timer = setInterval(() => {
    tick().catch((error) => {
      logger.error(
        `[ManualEnrichment] Interval tick failed: ${error instanceof Error ? error.message : String(error)}`
      );
    });
  }, pollMs);

  await tick();

  return {
    stop: async () => {
      stopped = true;
      clearInterval(timer);
      rl.close();
      await mongo.close();
    },
  };
}
