// Utility to sanitize job objects before storing in job_trash
function sanitizeJobForTrash(job: any): any {
  if (!job || typeof job !== 'object') return job;
  const clone = JSON.parse(JSON.stringify(job));
  // Remove or summarize large/raw fields
  if (clone.payload && clone.payload.body && clone.payload.body.data) {
    // If base64 and very large, replace with summary
    const data = clone.payload.body.data;
    if (typeof data === 'string' && data.length > 200) {
      clone.payload.body.data = `[base64 string, length=${data.length}]`;
    }
  }
  if (clone.body && typeof clone.body === 'string' && clone.body.length > 200) {
    clone.body = `[html string, length=${clone.body.length}]`;
  }
  // Remove Buffer fields if present
  Object.keys(clone).forEach((k) => {
    if (clone[k] && typeof clone[k] === 'object' && clone[k]._isBuffer) {
      clone[k] = '[Buffer]';
    }
  });
  return clone;
}
/**
 * Email source adapter (CLI layer only)
 * - data-testing: DB snapshot runner
 * - data-listening: Gmail webhook runner
 */

import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';

import { MongoClient } from 'mongodb';

import { config } from '../config.js';
import { hybridJobFilter } from '../filter/job-filter.js';
import { EventDrivenWebhook } from '../services/event-webhook.js';
import { GmailService } from '../services/gmail.js';
import { extractAllJobs } from '../services/job-extraction.js';
import { getLogger } from '../services/logger.js';
import { MetricsRecorder } from '../services/metrics/metrics-recorder.js';
import { MongoJobQueue } from '../services/storage/job-queue-adapter.js';
import { ensureE2EOutputDir, getE2EOutputDirRelativeToRoot } from '../utils/e2e-output-path.js';
// parseJobFromEvent is not exported; fallback to stub or implement as needed

const logger = getLogger();

type RawIngestSource = 'GMAIL_WEBHOOK' | 'GMAIL_MANUAL' | 'HTML_ONLY';

function isIngressFixtureModeEnabled(): boolean {
  return process.env.INGRESS_FIXTURE_MODE === '1';
}

async function loadFixtureEmails() {
  return import('../../tests/__fixtures__/emails.js');
}

function decodeBase64Maybe(value: string): string {
  try {
    return Buffer.from(value, 'base64').toString('utf-8');
  } catch {
    return value;
  }
}

function extractRawContent(input: any): string {
  if (typeof input === 'string') return input;
  if (!input || typeof input !== 'object') return String(input);
  if (typeof input.body === 'string') return input.body;
  if (input.payload?.body?.data && typeof input.payload.body.data === 'string') {
    return decodeBase64Maybe(input.payload.body.data);
  }
  try {
    return JSON.stringify(input);
  } catch {
    return String(input);
  }
}

async function ensureCoreCollections(mongo: MongoClient): Promise<void> {
  const db = mongo.db(config.mongodb.dbName);
  await Promise.all([
    db
      .collection('raw_ingest')
      .createIndex(
        { source: 1, ingestedAt: -1 },
        { name: 'idx_source_ingested', background: true }
      ),
    db
      .collection('raw_ingest')
      .createIndex(
        { 'gmailMeta.messageId': 1 },
        { name: 'idx_gmail_meta_message_id', sparse: true, background: true }
      ),
    db
      .collection('parse_log')
      .createIndex(
        { rawIngestId: 1, stage: 1, timestamp: -1 },
        { name: 'idx_parse_raw_stage_time', background: true }
      ),
    db
      .collection('needs_enrichment')
      .createIndex(
        { status: 1, updatedAt: -1 },
        { name: 'idx_enrichment_status_updated', background: true }
      ),
    db
      .collection('needs_enrichment')
      .createIndex(
        { messageId: 1 },
        { name: 'idx_enrichment_message_id', unique: true, background: true }
      ),
    db
      .collection('job_queue')
      .createIndex(
        { status: 1, enqueuedAt: -1 },
        { name: 'idx_job_queue_status_enqueued', background: true }
      ),
    db
      .collection('job_queue')
      .createIndex(
        { messageId: 1 },
        { name: 'idx_job_queue_message_id', sparse: true, background: true }
      ),
    db
      .collection('job_trash')
      .createIndex({ createdAt: -1 }, { name: 'idx_job_trash_created', background: true }),
  ]);
}

async function saveRawIngest(
  mongo: MongoClient,
  input: any,
  source: RawIngestSource,
  mode: 'production' | 'testing' | 'manual'
): Promise<string> {
  const db = mongo.db(config.mongodb.dbName);
  const messageId = getMessageId(input);
  const document = {
    source,
    mode,
    rawContent: extractRawContent(input),
    gmailMeta:
      source !== 'HTML_ONLY'
        ? {
            messageId,
            from: getFrom(input),
            subject: getSubject(input),
          }
        : undefined,
    htmlMeta:
      source === 'HTML_ONLY'
        ? {
            title: input?.title || input?.position,
            description: input?.description,
            url: input?.url,
          }
        : undefined,
    ingestedAt: new Date(),
    createdAt: new Date(),
  };

  if (source !== 'HTML_ONLY' && messageId) {
    await db
      .collection('raw_ingest')
      .updateOne(
        { 'gmailMeta.messageId': messageId },
        { $setOnInsert: document },
        { upsert: true }
      );
    return messageId;
  }

  const result = await db.collection('raw_ingest').insertOne(document);
  return result.insertedId.toString();
}

function getHeaderValue(input: any, headerName: string): string | undefined {
  const headers = input?.payload?.headers;
  if (!Array.isArray(headers)) return undefined;
  const hit = headers.find(
    (h: any) => String(h?.name || '').toLowerCase() === headerName.toLowerCase()
  );
  return hit?.value ? String(hit.value) : undefined;
}

function buildSyntheticMessageId(input: any, prefix = 'syn'): string {
  const title = input?.title || input?.position || 'unknown';
  const company = input?.company || 'unknown';
  const url = input?.url || '';
  const body = typeof input?.body === 'string' ? input.body.slice(0, 256) : '';
  const hash = createHash('sha256')
    .update(`${title}|${company}|${url}|${body}`)
    .digest('hex')
    .slice(0, 16);
  return `${prefix}-${hash}`;
}

function getMessageId(input: any, prefix = 'syn'): string {
  return (
    input?.messageId ||
    input?.emailId ||
    input?.id ||
    (input?._id ? String(input._id) : undefined) ||
    getHeaderValue(input, 'message-id') ||
    buildSyntheticMessageId(input, prefix)
  );
}

function getSubject(input: any): string | undefined {
  return input?.subject || getHeaderValue(input, 'subject');
}

function getFrom(input: any): string | undefined {
  return input?.from || getHeaderValue(input, 'from');
}

// Helper to log parse attempts to parse_log collection
async function logParseAttempt(
  mongo: MongoClient,
  rawIngestId: string,
  stage: 'METADATA' | 'JOB_DETAIL',
  success: boolean,
  extracted: any = null,
  error: any = null,
  executionMs: number = 0
): Promise<void> {
  const db = mongo.db(config.mongodb.dbName);
  const parseLog = db.collection('parse_log');

  await parseLog.insertOne({
    rawIngestId,
    stage,
    success,
    extracted: success ? extracted : undefined,
    error: error
      ? { code: error.code || 'UNKNOWN', message: error.message || String(error) }
      : undefined,
    executionMs,
    timestamp: new Date(),
    parserVersion: 'v1',
  });
}

// Helper to track jobs needing enrichment
async function trackNeedsEnrichment(
  mongo: MongoClient,
  messageId: string,
  jobTitle: string,
  company: string,
  reason:
    | 'missing_skills'
    | 'incomplete_description'
    | 'low_match_score'
    | 'unverified_platform'
    | 'missing_enrichment'
    | 'filter_warning'
    | 'user_requested',
  missingFields: string[] = [],
  currentScore: number = 0,
  currentSkills: string[] = [],
  warnings: string[] = []
): Promise<void> {
  const db = mongo.db(config.mongodb.dbName);
  const needsEnrichment = db.collection('needs_enrichment');

  await needsEnrichment.updateOne(
    { messageId },
    {
      $set: {
        messageId,
        jobTitle,
        company,
        reason,
        missingFields: missingFields.length > 0 ? missingFields : undefined,
        currentScore,
        currentSkills: currentSkills.length > 0 ? currentSkills : undefined,
        warnings: warnings.length > 0 ? warnings : undefined,
        status: 'pending',
        updatedAt: new Date(),
        enrichmentSource: 'unknown',
      },
      $setOnInsert: {
        createdAt: new Date(),
      },
    },
    { upsert: true }
  );
}

function getEnrichmentReasonFromFilter(result: {
  missingFields?: string[];
  warnings?: string[];
}): 'missing_skills' | 'incomplete_description' | 'unverified_platform' | 'filter_warning' {
  if (result.missingFields?.includes('skills')) return 'missing_skills';
  if (result.missingFields?.includes('description')) return 'incomplete_description';
  if (result.warnings?.includes('unknown_platform')) return 'unverified_platform';
  return 'filter_warning';
}

function isHardRejectFilterResult(result: { reasons?: string[]; hardReject?: boolean }): boolean {
  if (result.hardReject) return true;
  const reasons = result.reasons || [];
  return reasons.some((reason) => /non-software role|blocked platform/i.test(reason));
}

async function exportE2EOutput(mongo: MongoClient): Promise<void> {
  const db = mongo.db(config.mongodb.dbName);
  const [rawIngest, jobQueue, jobTrash, needsEnrichment, parseLog] = await Promise.all([
    db.collection('raw_ingest').find({}).toArray(),
    db.collection('job_queue').find({}).toArray(),
    db.collection('job_trash').find({}).toArray(),
    db.collection('needs_enrichment').find({}).toArray(),
    db.collection('parse_log').find({}).toArray(),
  ]);

  const outputDir = ensureE2EOutputDir();
  fs.writeFileSync(path.join(outputDir, 'e2e-raw-ingest.json'), JSON.stringify(rawIngest, null, 2));
  fs.writeFileSync(path.join(outputDir, 'e2e-job-queue.json'), JSON.stringify(jobQueue, null, 2));
  fs.writeFileSync(path.join(outputDir, 'e2e-job-trash.json'), JSON.stringify(jobTrash, null, 2));
  fs.writeFileSync(
    path.join(outputDir, 'e2e-needs-enrichment.json'),
    JSON.stringify(needsEnrichment, null, 2)
  );
  fs.writeFileSync(path.join(outputDir, 'e2e-parse-log.json'), JSON.stringify(parseLog, null, 2));

  logger.info(
    `[E2E] Exported raw_ingest, job_queue, job_trash, needs_enrichment, and parse_log to ${getE2EOutputDirRelativeToRoot()}`
  );
}

export type EmailSourceMode = 'data-testing' | 'data-listening';

export interface EmailSourceAdapter {
  name: string;
  mode: EmailSourceMode;
  run(): Promise<void>;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
}

// --- Refactored Core Loop for Testability and Manual Enrichment ---
export type JobFilterFn = (
  job: any,
  profile: any
) => {
  passed: boolean;
  reasons: string[];
  warnings?: string[];
  missingFields?: string[];
  hardReject?: boolean;
  strictFields?: any;
  relaxedFields?: any;
  matchedProfile?: any;
};
export type JobEnrichmentFn = (job: any, profile: any) => any;
export type ManualEnrichmentFn = (job: any) => Promise<any>;

export interface ClipboardOnlyAdapterOptions {
  clipboardGetter: () => Promise<any[]>;
  filterFn?: JobFilterFn;
  enrichFn?: JobEnrichmentFn;
  manualEnrichFn?: ManualEnrichmentFn;
}

export class ClipboardOnlyAdapter implements EmailSourceAdapter {
  name = 'clipboardOnly';
  mode: EmailSourceMode = 'data-testing';
  private filterFn: JobFilterFn;
  private enrichFn: JobEnrichmentFn;
  private manualEnrichFn?: ManualEnrichmentFn;

  constructor(private opts: ClipboardOnlyAdapterOptions) {
    this.filterFn = opts.filterFn || hybridJobFilter;
    this.enrichFn = opts.enrichFn || ClipboardOnlyAdapter.defaultEnrichFn;
    this.manualEnrichFn = opts.manualEnrichFn;
  }

  static async defaultEnrichFn(job: any, jobProfile: any) {
    const { SmartGenerator } = await import('../services/generators/smart-generator.js');
    const generator = new SmartGenerator({
      ...jobProfile,
      summary: Array.isArray(jobProfile.summary)
        ? jobProfile.summary.join('\n')
        : jobProfile.summary,
      skills: Array.isArray(jobProfile.normalizedSkills)
        ? jobProfile.normalizedSkills.map((s: any) => s.name)
        : [],
    });
    const requirements = generator.extractJobRequirements(job);
    const matching = generator.matchProfileWithJob(job, requirements);
    return {
      ...job,
      profileNarrative: jobProfile.summary,
      matchScore: matching.matchScore,
      matchedProfileSkills: matching.matchedSkills,
      missingProfileSkills: matching.missingSkills,
      relevantExperience: matching.relevantExperience,
      requirements,
    };
  }

  async run(): Promise<void> {
    // Get jobs from clipboardGetter - supports both HTML strings and objects with HTML in payload
    const clipboardJobs = await this.opts.clipboardGetter();
    const jobs: any[] = Array.isArray(clipboardJobs)
      ? clipboardJobs
      : clipboardJobs
        ? [clipboardJobs]
        : [];
    const { canonicalProfile } = await import('../db/json.js');
    const { ProfileParser } = await import('../services/profile/profile-parser.js');
    const { HtmlJobParser } = await import('../services/parsers/html-job-parser.js');
    const jobProfile = ProfileParser.parse(canonicalProfile);
    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) throw new Error('Missing MONGODB_URI');
    const mongo = new MongoClient(mongoUri);
    await mongo.connect();
    await ensureCoreCollections(mongo);
    const jobQueue = new MongoJobQueue(mongo);
    const metrics = new MetricsRecorder(mongoUri, config.mongodb.dbName);

    const htmlParser = new HtmlJobParser();

    for (const job of jobs) {
      const rawIngestId = await saveRawIngest(
        mongo,
        typeof job === 'string' ? { body: job } : job,
        'HTML_ONLY',
        'manual'
      );

      // Log parse attempt at entry (before any parsing)
      await logParseAttempt(
        mongo,
        rawIngestId,
        'JOB_DETAIL',
        false, // will update to true if successful
        null,
        null,
        0
      );

      // Treat input as raw HTML string and parse with HtmlJobParser directly
      const html =
        typeof job === 'string'
          ? job
          : job.body ||
            (job.payload && job.payload.body && job.payload.body.data
              ? Buffer.from(job.payload.body.data, 'base64').toString('utf-8')
              : '');
      const parsed = htmlParser.parseJobFromHtml(html);

      if (!parsed) {
        const db = mongo.db(config.mongodb.dbName);
        const recordOriginal = typeof job === 'string' ? { body: job } : job;

        // Don't require envelope fields for clipboard HTML sources
        const syntheticId = getMessageId(recordOriginal, 'clip');

        await logParseAttempt(
          mongo,
          syntheticId,
          'JOB_DETAIL',
          false,
          null,
          { message: 'HtmlJobParser failed to parse job data' },
          0
        );

        // Route to needs_enrichment if HTML-like, otherwise trash
        const raw = typeof job === 'string' ? job : job?.body || '';
        const isHtmlLike = /<html|<body|<div/i.test(raw);

        if (isHtmlLike) {
          await trackNeedsEnrichment(
            mongo,
            syntheticId,
            'Unknown',
            'Unknown',
            'missing_enrichment',
            ['title', 'company'],
            0,
            [],
            ['html_structure_not_recognized']
          );
          continue;
        }

        // Only trash if not recoverable HTML
        await db.collection('job_trash').insertOne({
          original: sanitizeJobForTrash(recordOriginal),
          parseErrors: ['HtmlJobParser failed to parse job data'],
          enriched: null,
          reason: 'parse_failed_or_filtered',
          other: {},
          createdAt: new Date(),
          phase: 'draft',
        });
        continue;
      }

      const parsedJob: Record<string, unknown> = {
        ...parsed,
        position: (parsed as Record<string, unknown>).position || parsed.title,
        messageId: getMessageId(parsed, 'clip'),
      };

      // --- Filtering ---
      const filterProfile = {
        ...jobProfile,
        summary: Array.isArray(jobProfile.summary)
          ? jobProfile.summary.join('\n')
          : jobProfile.summary,
        skills: Array.isArray(jobProfile.normalizedSkills)
          ? jobProfile.normalizedSkills.map((s: any) => s.name)
          : [],
      };
      const filterResult = this.filterFn(parsedJob, filterProfile);
      if (filterResult) {
        logger.info('[Filter] Hybrid filter result', {
          reasons: filterResult.reasons,
          warnings: filterResult.warnings,
          missingFields: filterResult.missingFields,
          matchedProfile: filterResult.matchedProfile,
        });
        if (!filterResult.passed) {
          const db = mongo.db(config.mongodb.dbName);
          const messageId = String(parsedJob.messageId || 'unknown');

          const hardReject = isHardRejectFilterResult(filterResult);

          await logParseAttempt(
            mongo,
            messageId,
            'JOB_DETAIL',
            true,
            {
              title: parsedJob.title || parsedJob.position,
              company: parsedJob.company,
              filterRejected: true,
              hardReject,
              filterReasons: filterResult.reasons,
            },
            null,
            0
          );

          if (!hardReject) {
            await trackNeedsEnrichment(
              mongo,
              messageId,
              String(parsedJob.title || parsedJob.position || 'Unknown'),
              String(parsedJob.company || 'Unknown'),
              getEnrichmentReasonFromFilter(filterResult),
              filterResult.missingFields,
              0,
              [],
              filterResult.warnings || []
            );
            continue;
          }

          await db.collection('job_trash').insertOne({
            original: sanitizeJobForTrash(typeof job === 'string' ? { body: job } : job),
            parsed: parsedJob,
            filterReasons: filterResult.reasons,
            missingFields: filterResult.missingFields,
            reason: 'filtered_by_hybrid',
            strictFields: Array.isArray(filterResult.strictFields)
              ? filterResult.strictFields
              : Object.keys(filterResult.strictFields || {}),
            relaxedFields: Array.isArray(filterResult.relaxedFields)
              ? filterResult.relaxedFields
              : Object.keys(filterResult.relaxedFields || {}),
            matchedProfile: filterResult.matchedProfile,
            createdAt: new Date(),
            phase: 'draft',
          });
          continue;
        }

        const hasWarnings = (filterResult.warnings?.length || 0) > 0;
        const hasMissing = (filterResult.missingFields?.length || 0) > 0;
        if (hasWarnings || hasMissing) {
          await trackNeedsEnrichment(
            mongo,
            String(parsedJob.messageId || 'unknown'),
            String(parsedJob.title || parsedJob.position || 'Unknown'),
            String(parsedJob.company || 'Unknown'),
            getEnrichmentReasonFromFilter(filterResult),
            filterResult.missingFields || [],
            0,
            [],
            filterResult.warnings || []
          );
        }
      }

      // --- Enrichment (with optional manual/simulated step) ---
      let enrichedJob = this.enrichFn(parsedJob, jobProfile);
      if (enrichedJob instanceof Promise) {
        enrichedJob = await enrichedJob;
      }

      // Apply manual enrichment if provided (returns partial merge object)
      if (this.manualEnrichFn) {
        const manualMerge = await this.manualEnrichFn(enrichedJob);
        enrichedJob = { ...enrichedJob, ...manualMerge };
      }

      const finalEnriched = {
        ...enrichedJob,
        messageId: getMessageId(enrichedJob, 'clip'),
      };

      // Validate enrichment (messageId no longer hard-required for clipboard sources)
      const targetedMessageId =
        finalEnriched.messageId ||
        finalEnriched.emailId ||
        finalEnriched.id ||
        (finalEnriched._id ? String(finalEnriched._id) : undefined);
      const missingEnrichment =
        typeof finalEnriched.matchScore === 'undefined' ||
        typeof finalEnriched.profileNarrative === 'undefined' ||
        typeof finalEnriched.matchedProfileSkills === 'undefined' ||
        typeof finalEnriched.requirements === 'undefined';
      if (missingEnrichment) {
        // removed: || !targetedMessageId
        const messageId = targetedMessageId || 'clipboard-unknown';
        const missingFields = [
          typeof finalEnriched.matchScore === 'undefined' ? 'matchScore' : null,
          typeof finalEnriched.profileNarrative === 'undefined' ? 'profileNarrative' : null,
          typeof finalEnriched.matchedProfileSkills === 'undefined' ? 'matchedProfileSkills' : null,
          typeof finalEnriched.requirements === 'undefined' ? 'requirements' : null,
        ].filter(Boolean) as string[];

        // Log enrichment failure
        await logParseAttempt(
          mongo,
          messageId,
          'JOB_DETAIL',
          false,
          null,
          { message: missingEnrichment ? 'Missing enrichment fields' : 'Missing messageId' },
          0
        );

        await trackNeedsEnrichment(
          mongo,
          messageId,
          finalEnriched.title ||
            finalEnriched.position ||
            parsedJob.title ||
            parsedJob.position ||
            'Unknown',
          finalEnriched.company || parsedJob.company || 'Unknown',
          'missing_enrichment',
          missingFields,
          typeof finalEnriched.matchScore === 'number' ? finalEnriched.matchScore : 0,
          Array.isArray(finalEnriched.matchedProfileSkills)
            ? finalEnriched.matchedProfileSkills
            : []
        );
        continue;
      }

      // Success: Queue job and log parse success
      await logParseAttempt(
        mongo,
        targetedMessageId || 'clipboard-unknown',
        'JOB_DETAIL',
        true,
        {
          title: finalEnriched.title || finalEnriched.position,
          company: finalEnriched.company,
          matchScore: finalEnriched.matchScore,
        },
        null,
        0
      );

      await jobQueue.enqueue(finalEnriched);
      await metrics.record({
        jobId: String(targetedMessageId || 'clipboard-unknown'),
        profileHash: '',
        event: 'queued',
        jobFitScore: finalEnriched.matchScore || 0,
        profileGaps: finalEnriched.missingProfileSkills || [],
        timestamp: new Date(),
        version: 'v1',
      });
    }
    if (process.env.EXPORT_E2E_OUTPUT === '1') {
      await exportE2EOutput(mongo);
    }
    await mongo.close();
  }

  async connect(): Promise<void> {
    // Clipboard adapter has no persistent connections
  }

  async disconnect(): Promise<void> {
    // Clipboard adapter cleanup is a no-op
  }
}

function parseEmailAlertToCandidates(job: any, emailParser: any): Array<Record<string, any>> {
  const html = Buffer.from(job.payload.body.data, 'base64').toString('utf-8');
  const emailId = getMessageId(job, 'gmail');
  const parseInput = {
    body: html,
    subject: getSubject(job) || '',
    from: getFrom(job) || '',
    emailId,
    receivedAt: new Date(),
  };

  const emailResult = emailParser.parseWithValidation(parseInput);
  const metadataJobs = extractAllJobs(html);

  if (metadataJobs.length > 0) {
    return metadataJobs.map((metadata, index) => ({
      ...metadata,
      sourceBody: html,
      sourceEmailId: emailId,
      sourceSubject: parseInput.subject,
      sourceFrom: parseInput.from,
      messageId: `${emailId}-${index + 1}`,
      platform:
        metadata.source ||
        (emailResult.success ? emailResult.data?.platform : undefined) ||
        'Unknown',
    }));
  }

  if (emailResult.success && emailResult.data) {
    return [
      {
        ...emailResult.data,
        sourceBody: html,
        sourceEmailId: emailId,
        sourceSubject: parseInput.subject,
        sourceFrom: parseInput.from,
        messageId: `${emailId}-1`,
      },
    ];
  }

  return [];
}

function parseDetailHtmlToCandidates(job: string, htmlParser: any): Array<Record<string, any>> {
  const parsed = htmlParser.parseJobFromHtml(job);
  if (!parsed) return [];
  return [{ ...parsed, messageId: getMessageId(parsed, 'detail') }];
}

async function processGmailFixtureRun(adapterName: string, jobs: any[]): Promise<void> {
  logger.info(`🚀 Starting ${adapterName} adapter (fixture-driven test mode)...`);
  const { canonicalProfile } = await import('../db/json.js');
  const { ProfileParser } = await import('../services/profile/profile-parser.js');
  const { EmailParser } = await import('../services/parsers/email-parser.js');
  const { HtmlJobParser } = await import('../services/parsers/html-job-parser.js');
  const { SmartGenerator } = await import('../services/generators/smart-generator.js');

  const jobProfile = ProfileParser.parse(canonicalProfile);
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) throw new Error('Missing MONGODB_URI');

  const mongo = new MongoClient(mongoUri);
  await mongo.connect();
  await ensureCoreCollections(mongo);

  const db = mongo.db(config.mongodb.dbName);
  const jobQueue = new MongoJobQueue(mongo);
  const metrics = new MetricsRecorder(mongoUri, config.mongodb.dbName);
  const emailParser = new EmailParser();
  const htmlParser = new HtmlJobParser();

  const filterProfile = {
    ...jobProfile,
    summary: Array.isArray(jobProfile.summary) ? jobProfile.summary.join('\n') : jobProfile.summary,
    skills: Array.isArray(jobProfile.normalizedSkills)
      ? jobProfile.normalizedSkills.map((s: any) => s.name)
      : [],
  };

  const generator = new SmartGenerator(filterProfile);

  for (const rawJob of jobs) {
    const rawIngestId = await saveRawIngest(mongo, rawJob, 'GMAIL_MANUAL', 'testing');
    const candidates = rawJob?.payload?.body?.data
      ? parseEmailAlertToCandidates(rawJob, emailParser)
      : parseDetailHtmlToCandidates(rawJob, htmlParser);

    if (candidates.length === 0) {
      await logParseAttempt(
        mongo,
        rawIngestId,
        'JOB_DETAIL',
        false,
        null,
        { message: 'No candidate jobs extracted from fixture input' },
        0
      );
      await db.collection('job_trash').insertOne({
        original: sanitizeJobForTrash(rawJob),
        parseErrors: ['No candidate jobs extracted from fixture input'],
        enriched: null,
        reason: 'parse_failed_or_filtered',
        other: {},
        createdAt: new Date(),
        phase: 'draft',
      });
      continue;
    }

    for (const parsedCandidate of candidates) {
      const parsed: Record<string, any> = {
        ...parsedCandidate,
        messageId: getMessageId(parsedCandidate, 'gmail'),
      };

      const filterResult = hybridJobFilter(parsed, filterProfile);
      logger.info('[Filter] Hybrid filter result', {
        reasons: filterResult.reasons,
        warnings: filterResult.warnings,
        missingFields: filterResult.missingFields,
        matchedProfile: filterResult.matchedProfile,
      });

      if (!filterResult.passed) {
        const messageId = parsed.messageId || 'unknown';
        const hardReject = isHardRejectFilterResult(filterResult);

        await logParseAttempt(
          mongo,
          rawIngestId,
          'JOB_DETAIL',
          true,
          {
            title: parsed.title || parsed.position,
            company: parsed.company,
            filterRejected: true,
            hardReject,
            filterReasons: filterResult.reasons,
          },
          null,
          0
        );

        if (!hardReject) {
          await trackNeedsEnrichment(
            mongo,
            messageId,
            parsed.title || parsed.position || 'Unknown',
            parsed.company || 'Unknown',
            getEnrichmentReasonFromFilter(filterResult),
            filterResult.missingFields,
            0,
            [],
            filterResult.warnings || []
          );
          continue;
        }

        await db.collection('job_trash').insertOne({
          original: sanitizeJobForTrash(rawJob),
          parsed,
          filterReasons: filterResult.reasons,
          missingFields: filterResult.missingFields,
          reason: 'filtered_by_hybrid',
          strictFields: Array.isArray(filterResult.strictFields)
            ? filterResult.strictFields
            : Object.keys(filterResult.strictFields || {}),
          relaxedFields: Array.isArray(filterResult.relaxedFields)
            ? filterResult.relaxedFields
            : Object.keys(filterResult.relaxedFields || {}),
          matchedProfile: filterResult.matchedProfile,
          createdAt: new Date(),
          phase: 'draft',
        });
        continue;
      }

      const hasWarnings = (filterResult.warnings?.length || 0) > 0;
      const hasMissing = (filterResult.missingFields?.length || 0) > 0;
      if (hasWarnings || hasMissing) {
        await trackNeedsEnrichment(
          mongo,
          parsed.messageId || 'unknown',
          parsed.title || parsed.position || 'Unknown',
          parsed.company || 'Unknown',
          getEnrichmentReasonFromFilter(filterResult),
          filterResult.missingFields || [],
          0,
          [],
          filterResult.warnings || []
        );
      }

      const parsedWithDefaults = {
        ...parsed,
        messageId: parsed.messageId,
        title: parsed.title || parsed.position || 'Unknown',
        platform: parsed.platform || 'Unknown',
        company: parsed.company || 'Unknown',
        position: parsed.position || parsed.title || 'Unknown',
        description: parsed.description || '',
        location: parsed.location || '',
        salary: parsed.salary || '',
      };

      const requirements = generator.extractJobRequirements(parsedWithDefaults);
      const matching = generator.matchProfileWithJob(parsedWithDefaults, requirements);

      const enrichedJob = {
        ...parsedWithDefaults,
        profileNarrative: filterProfile.summary,
        matchScore: matching ? matching.matchScore : undefined,
        matchedProfileSkills: matching ? matching.matchedSkills : undefined,
        missingProfileSkills: matching ? matching.missingSkills : undefined,
        relevantExperience: matching ? matching.relevantExperience : undefined,
        requirements,
        messageId: parsedWithDefaults.messageId,
      };

      const targetedMessageId = enrichedJob.messageId;
      const missingEnrichment =
        typeof enrichedJob.matchScore === 'undefined' ||
        typeof enrichedJob.profileNarrative === 'undefined' ||
        typeof enrichedJob.matchedProfileSkills === 'undefined' ||
        typeof enrichedJob.requirements === 'undefined';

      if (!targetedMessageId || missingEnrichment) {
        const missingFields = [
          typeof enrichedJob.matchScore === 'undefined' ? 'matchScore' : null,
          typeof enrichedJob.profileNarrative === 'undefined' ? 'profileNarrative' : null,
          typeof enrichedJob.matchedProfileSkills === 'undefined' ? 'matchedProfileSkills' : null,
          typeof enrichedJob.requirements === 'undefined' ? 'requirements' : null,
        ].filter(Boolean) as string[];

        await logParseAttempt(
          mongo,
          rawIngestId,
          'JOB_DETAIL',
          false,
          null,
          { message: missingEnrichment ? 'Missing enrichment fields' : 'Missing messageId' },
          0
        );

        await trackNeedsEnrichment(
          mongo,
          targetedMessageId || getMessageId(parsedWithDefaults, 'gmail'),
          enrichedJob.title || enrichedJob.position || 'Unknown',
          enrichedJob.company || 'Unknown',
          'missing_enrichment',
          missingFields,
          typeof enrichedJob.matchScore === 'number' ? enrichedJob.matchScore : 0,
          Array.isArray(enrichedJob.matchedProfileSkills) ? enrichedJob.matchedProfileSkills : []
        );
        continue;
      }

      await logParseAttempt(
        mongo,
        rawIngestId,
        'JOB_DETAIL',
        true,
        {
          title: enrichedJob.title || enrichedJob.position,
          company: enrichedJob.company,
          matchScore: enrichedJob.matchScore,
        },
        null,
        0
      );

      await jobQueue.enqueue(enrichedJob);
      await metrics.record({
        jobId: String(targetedMessageId),
        profileHash: '',
        event: 'queued',
        jobFitScore: enrichedJob.matchScore || 0,
        profileGaps: enrichedJob.missingProfileSkills || [],
        timestamp: new Date(),
        version: 'v1',
      });
    }
  }

  if (process.env.EXPORT_E2E_OUTPUT === '1') {
    await exportE2EOutput(mongo);
  }
  await mongo.close();
}

// Renamed below, see GmailWebhookAdapter

export class GmailWebhookAdapter implements EmailSourceAdapter {
  name = 'gmail-webhook';
  mode: EmailSourceMode = 'data-listening';
  private webhook: EventDrivenWebhook | null = null;

  constructor(private options?: { port?: number }) {}

  async connect(): Promise<void> {
    if (!config.gmail.clientId || !config.gmail.clientSecret) {
      throw new Error('Gmail credentials not configured. Run: npm run setup');
    }
    const gmailService = new GmailService();
    await gmailService.authenticate();
    this.webhook = new EventDrivenWebhook(gmailService);
    await this.webhook.connect();
  }

  async disconnect(): Promise<void> {
    if (this.webhook) {
      await this.webhook.disconnect();
    }
  }

  isConnected(): boolean {
    return this.webhook !== null;
  }

  async processMessageById(messageId: string): Promise<void> {
    if (!this.webhook) {
      throw new Error('GmailWebhookAdapter is not connected');
    }

    const payload = Buffer.from(JSON.stringify({ messageId }), 'utf-8').toString('base64');
    await this.webhook.processJobNotification({
      message: {
        data: payload,
      },
    });
  }

  async run(): Promise<void> {
    if (!isIngressFixtureModeEnabled()) {
      logger.info(
        '[gmail-webhook] Fixture run is disabled (INGRESS_FIXTURE_MODE!=1). Listener mode uses webhook events only.'
      );
      return;
    }

    const { indeedEmailAlert, topCVEmailAlert, topCVDetailPageHTML, indeedDetailPageHTML } =
      await loadFixtureEmails();
    const jobs = [topCVEmailAlert, indeedEmailAlert, topCVDetailPageHTML, indeedDetailPageHTML];
    await processGmailFixtureRun('gmail-webhook', jobs);
  }

  async handleGmailWebhookEvent(event: any): Promise<void> {
    // Normalize incoming event to ensure envelope fields are present
    const job = { ...(event || {}) };
    try {
      // If event has `email` wrapper (from Pub/Sub payload), unwrap it
      if (job.message && job.message.data) {
        try {
          const decoded = JSON.parse(Buffer.from(job.message.data, 'base64').toString('utf-8'));
          if (decoded.email) Object.assign(job, decoded.email);
          if (decoded.messageId) job.messageId = decoded.messageId;
          if (decoded.historyId) job.historyId = decoded.historyId;
        } catch (e) {
          // ignore
        }
      }
      // If headers present, map common header names to top-level fields
      if (job.payload && Array.isArray(job.payload.headers)) {
        const h = job.payload.headers;
        const subj = h.find((x: any) => String(x.name).toLowerCase() === 'subject');
        const from = h.find((x: any) => String(x.name).toLowerCase() === 'from');
        if (subj && subj.value && !job.subject) job.subject = String(subj.value);
        if (from && from.value && !job.from) job.from = String(from.value);
      }
      // Map legacy id fields
      if (!job.messageId && job.id) job.messageId = job.id;
    } catch (err) {
      // noop normalization
    }
    const { canonicalProfile } = await import('../db/json.js');
    const { ProfileParser } = await import('../services/profile/profile-parser.js');
    const jobProfile = ProfileParser.parse(canonicalProfile);
    const filterProfile = {
      ...jobProfile,
      summary: Array.isArray(jobProfile.summary)
        ? jobProfile.summary.join('\n')
        : jobProfile.summary,
      skills: Array.isArray(jobProfile.normalizedSkills)
        ? jobProfile.normalizedSkills.map((s) => s.name)
        : [],
    };
    const filterResult = hybridJobFilter(job, filterProfile);
    logger.info('[Filter] Hybrid filter result', {
      reasons: filterResult.reasons,
      warnings: filterResult.warnings,
      missingFields: filterResult.missingFields,
      matchedProfile: filterResult.matchedProfile,
    });
    if (!filterResult.passed) {
      const mongoUri = process.env.MONGODB_URI;
      if (!mongoUri) throw new Error('Missing MONGODB_URI');
      const mongo = new MongoClient(mongoUri);
      await mongo.connect();
      await ensureCoreCollections(mongo);
      const db = mongo.db(config.mongodb.dbName);
      await saveRawIngest(mongo, job, 'GMAIL_WEBHOOK', 'production');
      const messageId = job.messageId || job.id || (job._id ? String(job._id) : 'unknown');

      const hardReject = isHardRejectFilterResult(filterResult);

      await logParseAttempt(
        mongo,
        messageId,
        'JOB_DETAIL',
        true,
        {
          title: job.title || job.position,
          company: job.company,
          filterRejected: true,
          hardReject,
          filterReasons: filterResult.reasons,
        },
        null,
        0
      );

      if (!hardReject) {
        await trackNeedsEnrichment(
          mongo,
          messageId,
          job.title || job.position || 'Unknown',
          job.company || 'Unknown',
          getEnrichmentReasonFromFilter(filterResult),
          filterResult.missingFields || [],
          typeof job.matchScore === 'number' ? job.matchScore : 0,
          Array.isArray(job.matchedProfileSkills) ? job.matchedProfileSkills : [],
          filterResult.warnings || []
        );
        await mongo.close();
        return;
      }

      await db.collection('job_trash').insertOne({
        original: sanitizeJobForTrash(job),
        filterReasons: filterResult.reasons,
        missingFields: filterResult.missingFields,
        reason: 'filtered_by_hybrid',
        strictFields: Array.isArray(filterResult.strictFields)
          ? filterResult.strictFields
          : Object.keys(filterResult.strictFields || {}),
        relaxedFields: Array.isArray(filterResult.relaxedFields)
          ? filterResult.relaxedFields
          : Object.keys(filterResult.relaxedFields || {}),
        matchedProfile: filterResult.matchedProfile,
        createdAt: new Date(),
        phase: 'draft',
      });
      await mongo.close();
      return;
    }
    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) throw new Error('Missing MONGODB_URI');
    const mongo = new MongoClient(mongoUri);
    await mongo.connect();
    await ensureCoreCollections(mongo);
    await saveRawIngest(mongo, job, 'GMAIL_WEBHOOK', 'production');
    const jobQueue = new MongoJobQueue(mongo);
    const hasWarnings = (filterResult.warnings?.length || 0) > 0;
    const hasMissing = (filterResult.missingFields?.length || 0) > 0;
    if (hasWarnings || hasMissing) {
      await trackNeedsEnrichment(
        mongo,
        job.messageId || job.id || (job._id ? String(job._id) : 'unknown'),
        job.title || job.position || 'Unknown',
        job.company || 'Unknown',
        getEnrichmentReasonFromFilter(filterResult),
        filterResult.missingFields || [],
        typeof job.matchScore === 'number' ? job.matchScore : 0,
        Array.isArray(job.matchedProfileSkills) ? job.matchedProfileSkills : [],
        filterResult.warnings || []
      );
    }
    // Ensure messageId exists and enrichment fields present; webhook events may be partial
    const targetedMessageId = job.messageId || job.id || (job._id ? String(job._id) : undefined);
    const enrichedJob = { ...job };
    const missingEnrichment =
      typeof enrichedJob.matchScore === 'undefined' ||
      typeof enrichedJob.profileNarrative === 'undefined' ||
      typeof enrichedJob.matchedProfileSkills === 'undefined' ||
      typeof enrichedJob.requirements === 'undefined';
    if (!targetedMessageId || missingEnrichment) {
      const missingFields = [
        typeof enrichedJob.matchScore === 'undefined' ? 'matchScore' : null,
        typeof enrichedJob.profileNarrative === 'undefined' ? 'profileNarrative' : null,
        typeof enrichedJob.matchedProfileSkills === 'undefined' ? 'matchedProfileSkills' : null,
        typeof enrichedJob.requirements === 'undefined' ? 'requirements' : null,
      ].filter(Boolean) as string[];
      await logParseAttempt(
        mongo,
        targetedMessageId || 'unknown',
        'JOB_DETAIL',
        false,
        null,
        { message: missingEnrichment ? 'Missing enrichment fields' : 'Missing messageId' },
        0
      );
      await trackNeedsEnrichment(
        mongo,
        targetedMessageId || 'unknown',
        enrichedJob.title || enrichedJob.position || 'Unknown',
        enrichedJob.company || 'Unknown',
        'missing_enrichment',
        missingFields,
        typeof enrichedJob.matchScore === 'number' ? enrichedJob.matchScore : 0,
        Array.isArray(enrichedJob.matchedProfileSkills) ? enrichedJob.matchedProfileSkills : []
      );
      await mongo.close();
      return;
    }

    await logParseAttempt(
      mongo,
      targetedMessageId,
      'JOB_DETAIL',
      true,
      {
        title: enrichedJob.title || enrichedJob.position,
        company: enrichedJob.company,
        matchScore: enrichedJob.matchScore,
      },
      null,
      0
    );

    await jobQueue.enqueue(enrichedJob);
    // record enqueue metric
    const metrics = new MetricsRecorder(mongoUri, config.mongodb.dbName);
    await metrics.record({
      jobId: String(targetedMessageId),
      profileHash: '',
      event: 'queued',
      jobFitScore: enrichedJob.matchScore || 0,
      profileGaps: enrichedJob.missingProfileSkills || [],
      timestamp: new Date(),
      version: 'v1',
    });
    // Optionally export diagnostics for E2E/mongosh analysis
    if (process.env.EXPORT_E2E_OUTPUT === '1') {
      await exportE2EOutput(mongo);
    }
    await mongo.close();
  }
}

// GmailApiAdapter: fallback for Gmail API fetch/analyze (raw email ingestion)
// Modes:
//   - One-time fetch: fetch/process once, then exit (default, used in E2E tests)
//   - Scheduled batch: fetch/process every X seconds/minutes/hours if --schedule/--interval flag is set (long-running)
//   - Not persistent: does not listen for new mail in real-time
export class GmailApiAdapter implements EmailSourceAdapter {
  name = 'gmail-api';
  mode: EmailSourceMode = 'data-listening';

  async connect(): Promise<void> {
    // No persistent connection needed for batch fetch
  }

  async disconnect(): Promise<void> {
    // No persistent connection needed for batch fetch
  }

  async run(): Promise<void> {
    if (!isIngressFixtureModeEnabled()) {
      logger.info(
        '[gmail-api] Fixture run is disabled (INGRESS_FIXTURE_MODE!=1). Real Gmail API fetch flow is expected in live ingress mode.'
      );
      return;
    }

    const { indeedEmailAlert, topCVEmailAlert, topCVDetailPageHTML, indeedDetailPageHTML } =
      await loadFixtureEmails();
    const jobs = [topCVEmailAlert, indeedEmailAlert, topCVDetailPageHTML, indeedDetailPageHTML];
    await processGmailFixtureRun('gmail-api', jobs);
  }
}
