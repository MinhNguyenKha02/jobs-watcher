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

import { config } from '../config.js';
import { EventDrivenWebhook } from '../services/event-webhook.js';
import { GmailService } from '../services/gmail.js';
import { getLogger } from '../services/logger.js';
import { MongoClient } from 'mongodb';
import { MetricsRecorder } from '../services/metrics/metrics-recorder.js';
import { MongoJobQueue } from '../services/storage/job-queue-adapter.js';
import { hybridJobFilter } from '../filter/job-filter.js';
import { clipboardGetter } from './clipboard-getter.js';
import { createHash } from 'crypto';
// parseJobFromEvent is not exported; fallback to stub or implement as needed

const logger = getLogger();

// Extract envelope metadata (messageId/from/subject) from different adapter input shapes
function extractEnvelope(src: any) {
  if (!src || typeof src !== 'object') return { messageId: undefined, from: undefined, subject: undefined };
  let messageId = src.messageId || src.emailId || src.id || (src._id ? String(src._id) : undefined) || undefined;
  // Pub/Sub / Gmail payload headers
  if (!messageId && src.payload && Array.isArray(src.payload.headers)) {
    const mid = src.payload.headers.find((h: any) => h.name === 'Message-ID' || h.name === 'Message-Id' || h.name === 'MessageId');
    if (mid) messageId = mid.value;
  }
  // Top-level headers
  const subject = src.subject || (src.payload && Array.isArray(src.payload.headers) && (src.payload.headers.find((h: any) => h.name === 'Subject') || {}).value) || undefined;
  const from = src.from || (src.payload && Array.isArray(src.payload.headers) && (src.payload.headers.find((h: any) => h.name === 'From') || {}).value) || undefined;
  return { messageId, from, subject };
}

// Ensure top-level envelope fields exist on a job/input object.
function ensureEnvelope(src: any) {
  const out: any = (src && typeof src === 'object') ? { ...src } : { body: src };
  // Pull from known fields
  out.messageId = out.messageId || out.emailId || out.id || (out._id ? String(out._id) : undefined);
  // Try to read from payload headers
  if (!out.messageId && out.payload && Array.isArray(out.payload.headers)) {
    const mid = out.payload.headers.find((h: any) => /message-id/i.test(h.name));
    if (mid && mid.value) out.messageId = mid.value;
  }
  // Map headers to subject/from
  if ((!out.subject || !out.from) && out.payload && Array.isArray(out.payload.headers)) {
    const h = out.payload.headers;
    const subj = h.find((x: any) => String(x.name).toLowerCase() === 'subject');
    const from = h.find((x: any) => String(x.name).toLowerCase() === 'from');
    if (subj && subj.value && !out.subject) out.subject = String(subj.value);
    if (from && from.value && !out.from) out.from = String(from.value);
  }
  // For clipboard sources, envelope fields (subject/from) are optional
  // Only set defaults if not already present and not a clipboard/manual source
  if (!out.subject && !out.synthesized) out.subject = 'no-subject';
  if (!out.from && !out.synthesized) out.from = 'unknown@local';
  // Generate a deterministic messageId if none found using sha256(title + company + url).slice(0,16)
  if (!out.messageId) {
    const title = out.title || out.position || 'unknown';
    const company = out.company || 'unknown';
    const url = out.url || '';
    const hash = createHash('sha256').update(`${title}${company}${url}`).digest('hex').slice(0, 16);
    out.messageId = `syn-${hash}`;
    out.synthesized = true;
  } else {
    out.synthesized = false;
  }
  return out;
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
    error: error ? { code: error.code || 'UNKNOWN', message: error.message || String(error) } : undefined,
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

  await needsEnrichment.updateOne({ messageId }, {
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
  }, { upsert: true });
}

function getEnrichmentReasonFromFilter(result: { missingFields?: string[]; warnings?: string[] }):
  'missing_skills' | 'incomplete_description' | 'unverified_platform' | 'filter_warning' {
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

export type EmailSourceMode = 'data-testing' | 'data-listening';

export interface EmailSourceAdapter {
  name: string;
  mode: EmailSourceMode;
  run(): Promise<void>;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
}


// --- Refactored Core Loop for Testability and Manual Enrichment ---
export type JobFilterFn = (job: any, profile: any) => {
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
      summary: Array.isArray(jobProfile.summary) ? jobProfile.summary.join('\n') : jobProfile.summary,
      skills: Array.isArray(jobProfile.normalizedSkills) ? jobProfile.normalizedSkills.map((s: any) => s.name) : [],
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
    const jobs: any[] = Array.isArray(clipboardJobs) ? clipboardJobs : (clipboardJobs ? [clipboardJobs] : []);
    const { canonicalProfile } = await import('../db/json.js');
    const { ProfileParser } = await import('../services/profile/profile-parser.js');
    const { HtmlJobParser } = await import('../services/parsers/html-job-parser.js');
    const jobProfile = ProfileParser.parse(canonicalProfile);
    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) throw new Error('Missing MONGODB_URI');
    const mongo = new MongoClient(mongoUri);
    await mongo.connect();
    const jobQueue = new MongoJobQueue(mongo);
    const metrics = new MetricsRecorder(mongoUri, config.mongodb.dbName);
    
    const htmlParser = new HtmlJobParser();
    
    for (const job of jobs) {
      const inputId = ensureEnvelope(typeof job === 'string' ? { body: job } : job).messageId || 'unknown';
      
      // Log parse attempt at entry (before any parsing)
      await logParseAttempt(
        mongo,
        inputId,
        'JOB_DETAIL',
        false, // will update to true if successful
        null,
        null,
        0
      );
      
      // Treat input as raw HTML string and parse with HtmlJobParser directly
      const html = typeof job === 'string' ? job : (job.body || (job.payload && job.payload.body && job.payload.body.data ? Buffer.from(job.payload.body.data, 'base64').toString('utf-8') : ''));
      const parsed = htmlParser.parseJobFromHtml(html);
      
      if (!parsed) {
        const db = mongo.db(config.mongodb.dbName);
        const recordOriginal = ensureEnvelope(typeof job === 'string' ? { body: job } : job);
        
        // Don't require envelope fields for clipboard HTML sources
        const syntheticId = recordOriginal.messageId || 'clip-unknown-' + Date.now();
        
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
        const raw = typeof job === 'string' ? job : (job?.body || '');
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
      
      // Ensure envelope on parsed job with deterministic messageId
      const normalizedEnvelope = ensureEnvelope(parsed);
      const parsed_with_envelope = { ...parsed, ...normalizedEnvelope };
      
      // --- Filtering ---
      const filterProfile = {
        ...jobProfile,
        summary: Array.isArray(jobProfile.summary) ? jobProfile.summary.join('\n') : jobProfile.summary,
        skills: Array.isArray(jobProfile.normalizedSkills) ? jobProfile.normalizedSkills.map((s: any) => s.name) : [],
      };
      const filterResult = this.filterFn(parsed_with_envelope, filterProfile);
      if (filterResult) {
        logger.info('[Filter] Hybrid filter result', { reasons: filterResult.reasons, warnings: filterResult.warnings, missingFields: filterResult.missingFields, matchedProfile: filterResult.matchedProfile });
        if (!filterResult.passed) {
          const db = mongo.db(config.mongodb.dbName);
          const messageId = parsed_with_envelope.messageId || 'unknown';

          const hardReject = isHardRejectFilterResult(filterResult);

          await logParseAttempt(
            mongo,
            messageId,
            'JOB_DETAIL',
            true,
            {
              title: parsed_with_envelope.title || parsed_with_envelope.position,
              company: parsed_with_envelope.company,
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
              parsed_with_envelope.title || parsed_with_envelope.position || 'Unknown',
              parsed_with_envelope.company || 'Unknown',
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
            parsed: parsed_with_envelope,
            filterReasons: filterResult.reasons,
            missingFields: filterResult.missingFields,
            reason: 'filtered_by_hybrid',
            strictFields: Array.isArray(filterResult.strictFields) ? filterResult.strictFields : Object.keys(filterResult.strictFields || {}),
            relaxedFields: Array.isArray(filterResult.relaxedFields) ? filterResult.relaxedFields : Object.keys(filterResult.relaxedFields || {}),
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
            parsed_with_envelope.messageId || 'unknown',
            parsed_with_envelope.title || parsed_with_envelope.position || 'Unknown',
            parsed_with_envelope.company || 'Unknown',
            getEnrichmentReasonFromFilter(filterResult),
            filterResult.missingFields || [],
            0,
            [],
            filterResult.warnings || []
          );
        }
      }
      
      // --- Enrichment (with optional manual/simulated step) ---
      let enrichedJob = this.enrichFn(parsed_with_envelope, jobProfile);
      if (enrichedJob instanceof Promise) {
        enrichedJob = await enrichedJob;
      }
      
      // Apply manual enrichment if provided (returns partial merge object)
      if (this.manualEnrichFn) {
        const manualMerge = await this.manualEnrichFn(enrichedJob);
        enrichedJob = { ...enrichedJob, ...manualMerge };
      }
      
      // Ensure envelope present on enriched job
      const finalEnriched = ensureEnvelope(enrichedJob);
      
      // Validate enrichment (messageId no longer hard-required for clipboard sources)
      const targetedMessageId = finalEnriched.messageId || finalEnriched.emailId || finalEnriched.id || (finalEnriched._id ? String(finalEnriched._id) : undefined);
      const missingEnrichment =
        typeof finalEnriched.matchScore === 'undefined' || typeof finalEnriched.profileNarrative === 'undefined' || typeof finalEnriched.matchedProfileSkills === 'undefined' || typeof finalEnriched.requirements === 'undefined';
      if (missingEnrichment) { // removed: || !targetedMessageId
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
          finalEnriched.title || finalEnriched.position || parsed_with_envelope.title || parsed_with_envelope.position || 'Unknown',
          finalEnriched.company || parsed_with_envelope.company || 'Unknown',
          'missing_enrichment',
          missingFields,
          typeof finalEnriched.matchScore === 'number' ? finalEnriched.matchScore : 0,
          Array.isArray(finalEnriched.matchedProfileSkills) ? finalEnriched.matchedProfileSkills : []
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
      const db = mongo.db(config.mongodb.dbName);
      const jobQueue = await db.collection('job_queue').find({}).toArray();
      const jobTrash = await db.collection('job_trash').find({}).toArray();
      const needsEnrichment = await db.collection('needs_enrichment').find({}).toArray();
      const fs = await import('fs');
      // Create export directory if it doesn't exist
      const outputDir = `${process.cwd()}/src/db/e2e-output`;
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }
      fs.writeFileSync(`${outputDir}/e2e-job-queue.json`, JSON.stringify(jobQueue, null, 2));
      fs.writeFileSync(`${outputDir}/e2e-job-trash.json`, JSON.stringify(jobTrash, null, 2));
      fs.writeFileSync(`${outputDir}/e2e-needs-enrichment.json`, JSON.stringify(needsEnrichment, null, 2));
      logger.info(`[E2E] Exported job_queue, job_trash, and needs_enrichment to ${outputDir}/`);
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

  async run(): Promise<void> {
    // Fixture-driven: simulate webhook events using EmailAlert and DetailPage HTML samples
    logger.info('🚀 Starting Gmail webhook adapter (fixture-driven test mode)...');
    const { indeedEmailAlert, topCVEmailAlert, indeedPlatformPageHtml1, topCVDetailPageHTML } = await import('../../tests/__fixtures__/emails.js');
    // Simulate both alert and detail page flows
    const jobs: any[] = [
      indeedEmailAlert,
      topCVEmailAlert,
      indeedPlatformPageHtml1,
      topCVDetailPageHTML,
    ];
    const { canonicalProfile } = await import('../db/json.js');
    const { ProfileParser } = await import('../services/profile/profile-parser.js');
    const { EmailParser } = await import('../services/parsers/email-parser.js');
    const { HtmlJobParser } = await import('../services/parsers/html-job-parser.js');
    const jobProfile = ProfileParser.parse(canonicalProfile);
    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) throw new Error('Missing MONGODB_URI');
    const mongo = new MongoClient(mongoUri);
    await mongo.connect();
    const jobQueue = new MongoJobQueue(mongo);
    const metrics = new MetricsRecorder(mongoUri, config.mongodb.dbName);
    
    const emailParser = new EmailParser();
    const htmlParser = new HtmlJobParser();
    
    for (const job of jobs) {
      // If job is an EmailAlert, parse as email; if detail page HTML, parse as HTML
      let emailParsed;
      let htmlParsed;
      let parseInput;
      
      if (job && job.payload && job.payload.body && job.payload.body.data) {
        // EmailAlert: decode base64 body
        const html = Buffer.from(job.payload.body.data, 'base64').toString('utf-8');
        parseInput = { body: html, subject: job.payload.headers.find((h: { name: string; value: string }) => h.name === 'Subject')?.value || '', from: job.payload.headers.find((h: { name: string; value: string }) => h.name === 'From')?.value || '', emailId: job.id || '', receivedAt: new Date() };
        
        // Parse with EmailParser (handles alert structure)
        const emailResult = emailParser.parseWithValidation(parseInput);
        emailParsed = emailResult.success ? emailResult.data : null;
        
        // Also parse raw HTML for fallback enrichment
        htmlParsed = htmlParser.parseJobFromHtml(html);
      } else {
        // DetailPage HTML
        parseInput = { body: job, subject: '', from: '', emailId: '', receivedAt: new Date() };
        
        // Parse with HtmlJobParser directly
        htmlParsed = htmlParser.parseJobFromHtml(job);
        emailParsed = null;
      }
      
      // Normalize envelope fields from job + parseInput
      const envelopeNorm = ensureEnvelope(Object.assign({}, job || {}, parseInput || {}));
      parseInput.subject = envelopeNorm.subject || parseInput.subject;
      parseInput.from = envelopeNorm.from || parseInput.from;
      parseInput.emailId = envelopeNorm.messageId || parseInput.emailId;
      
      // Merge email parser output with html parser output
      // EmailParser output takes precedence for envelope fields, HtmlJobParser provides detailed job data
      const parsed = {
        ...(htmlParsed || {}),
        ...(emailParsed || {}),
        messageId: envelopeNorm.messageId,
        synthesized: envelopeNorm.synthesized,
      };
      
      if (!parsed || Object.keys(parsed).length === 0) {
        const db = mongo.db(config.mongodb.dbName);
        const recordOriginal = ensureEnvelope(Object.assign({}, job || {}, parseInput || {}));
        await logParseAttempt(
          mongo,
          recordOriginal.messageId || 'unknown',
          'JOB_DETAIL',
          false,
          null,
          { message: 'Both EmailParser and HtmlJobParser failed' },
          0
        );
        await db.collection('job_trash').insertOne({
          original: sanitizeJobForTrash(recordOriginal),
          parseErrors: ['Both EmailParser and HtmlJobParser failed'],
          enriched: null,
          reason: 'parse_failed_or_filtered',
          other: {},
          createdAt: new Date(),
          phase: 'draft',
        });
        continue;
      }
      
      // --- Filtering ---
      const filterProfile = {
        ...jobProfile,
        summary: Array.isArray(jobProfile.summary) ? jobProfile.summary.join('\n') : jobProfile.summary,
        skills: Array.isArray(jobProfile.normalizedSkills) ? jobProfile.normalizedSkills.map((s: any) => s.name) : [],
      };
      const filterResult = parsed ? hybridJobFilter(parsed, filterProfile) : undefined;
      if (filterResult) {
        logger.info('[Filter] Hybrid filter result', { reasons: filterResult.reasons, warnings: filterResult.warnings, missingFields: filterResult.missingFields, matchedProfile: filterResult.matchedProfile });
        if (!filterResult.passed) {
          const db = mongo.db(config.mongodb.dbName);
          const messageId = parsed.messageId || parsed.emailId || 'unknown';

          const hardReject = isHardRejectFilterResult(filterResult);

          await logParseAttempt(
            mongo,
            messageId,
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
            original: job,
            parsed,
            filterReasons: filterResult.reasons,
            missingFields: filterResult.missingFields,
            reason: 'filtered_by_hybrid',
            strictFields: Array.isArray(filterResult.strictFields) ? filterResult.strictFields : Object.keys(filterResult.strictFields || {}),
            relaxedFields: Array.isArray(filterResult.relaxedFields) ? filterResult.relaxedFields : Object.keys(filterResult.relaxedFields || {}),
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
            parsed.messageId || parsed.emailId || (parsed as any).id || 'unknown',
            parsed.title || parsed.position || 'Unknown',
            parsed.company || 'Unknown',
            getEnrichmentReasonFromFilter(filterResult),
            filterResult.missingFields || [],
            0,
            [],
            filterResult.warnings || []
          );
        }
      }
      // --- Enrichment ---
      const { SmartGenerator } = await import('../services/generators/smart-generator.js');
      const generator = new SmartGenerator({
        ...jobProfile,
        summary: Array.isArray(jobProfile.summary) ? jobProfile.summary.join('\n') : jobProfile.summary,
        skills: Array.isArray(jobProfile.normalizedSkills) ? jobProfile.normalizedSkills.map((s: any) => s.name) : [],
      });
      
      // Ensure parsed has required fields before passing to generator
      const parsedWithDefaults = {
        ...parsed,
        platform: parsed.platform || 'Unknown',
        company: parsed.company || 'Unknown',
        position: parsed.position || 'Unknown',
      };
      
      const requirements = parsed ? generator.extractJobRequirements({
        ...parsedWithDefaults,
        location: parsedWithDefaults.location || '',
        description: parsedWithDefaults.description || '',
        salary: parsedWithDefaults.salary || '',
      }) : undefined;
      const matching = parsed && requirements ? generator.matchProfileWithJob(parsedWithDefaults, requirements) : undefined;
      let messageId = parsed && (parsed as any).messageId || parsed && (parsed as any).emailId || parsed && (parsed as any).id || (parsed && (parsed as any)._id ? String((parsed as any)._id) : undefined);
      if (!messageId) messageId = parseInput.emailId || '';
      // Ensure enriched job has envelope
      const preEnriched = {
        ...parsedWithDefaults,
        profileNarrative: jobProfile.summary,
        matchScore: matching ? matching.matchScore : undefined,
        matchedProfileSkills: matching ? matching.matchedSkills : undefined,
        missingProfileSkills: matching ? matching.missingSkills : undefined,
        relevantExperience: matching ? matching.relevantExperience : undefined,
        requirements,
        messageId,
      };
      const enrichedJob = ensureEnvelope(preEnriched);
      // Validate enrichment
      const targetedMessageId = enrichedJob.messageId;
      const missingEnrichment =
        typeof enrichedJob.matchScore === 'undefined' || typeof enrichedJob.profileNarrative === 'undefined' || typeof enrichedJob.matchedProfileSkills === 'undefined' || typeof enrichedJob.requirements === 'undefined';
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
          enrichedJob.title || enrichedJob.position || parsedWithDefaults.title || parsedWithDefaults.position || 'Unknown',
          enrichedJob.company || parsedWithDefaults.company || 'Unknown',
          'missing_enrichment',
          missingFields,
          typeof enrichedJob.matchScore === 'number' ? enrichedJob.matchScore : 0,
          Array.isArray(enrichedJob.matchedProfileSkills) ? enrichedJob.matchedProfileSkills : []
        );
        continue;
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
    if (process.env.EXPORT_E2E_OUTPUT === '1') {
      const db = mongo.db(config.mongodb.dbName);
      const jobQueue = await db.collection('job_queue').find({}).toArray();
      const jobTrash = await db.collection('job_trash').find({}).toArray();
      const needsEnrichment = await db.collection('needs_enrichment').find({}).toArray();
      const fs = await import('fs');
      // Create export directory if it doesn't exist
      const outputDir = `${process.cwd()}/src/db/e2e-output`;
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }
      fs.writeFileSync(`${outputDir}/e2e-job-queue.json`, JSON.stringify(jobQueue, null, 2));
      fs.writeFileSync(`${outputDir}/e2e-job-trash.json`, JSON.stringify(jobTrash, null, 2));
      fs.writeFileSync(`${outputDir}/e2e-needs-enrichment.json`, JSON.stringify(needsEnrichment, null, 2));
      logger.info(`[E2E] Exported job_queue, job_trash, and needs_enrichment to ${outputDir}/`);
    }
    await mongo.close();
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
      summary: Array.isArray(jobProfile.summary) ? jobProfile.summary.join('\n') : jobProfile.summary,
      skills: Array.isArray(jobProfile.normalizedSkills)
        ? jobProfile.normalizedSkills.map((s) => s.name)
        : [],
    };
    const filterResult = hybridJobFilter(job, filterProfile);
    logger.info('[Filter] Hybrid filter result', { reasons: filterResult.reasons, warnings: filterResult.warnings, missingFields: filterResult.missingFields, matchedProfile: filterResult.matchedProfile });
    if (!filterResult.passed) {
      const mongoUri = process.env.MONGODB_URI;
      if (!mongoUri) throw new Error('Missing MONGODB_URI');
      const mongo = new MongoClient(mongoUri);
      await mongo.connect();
      const db = mongo.db(config.mongodb.dbName);
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
        strictFields: Array.isArray(filterResult.strictFields) ? filterResult.strictFields : Object.keys(filterResult.strictFields || {}),
        relaxedFields: Array.isArray(filterResult.relaxedFields) ? filterResult.relaxedFields : Object.keys(filterResult.relaxedFields || {}),
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
      typeof enrichedJob.matchScore === 'undefined' || typeof enrichedJob.profileNarrative === 'undefined' || typeof enrichedJob.matchedProfileSkills === 'undefined' || typeof enrichedJob.requirements === 'undefined';
    const db = mongo.db(config.mongodb.dbName);
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
      const db = mongo.db(config.mongodb.dbName);
      const jobQueue = await db.collection('job_queue').find({}).toArray();
      const jobTrash = await db.collection('job_trash').find({}).toArray();
      const needsEnrichment = await db.collection('needs_enrichment').find({}).toArray();
      const fs = await import('fs');
      // Create export directory if it doesn't exist
      const outputDir = `${process.cwd()}/src/db/e2e-output`;
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }
      fs.writeFileSync(`${outputDir}/e2e-job-queue.json`, JSON.stringify(jobQueue, null, 2));
      fs.writeFileSync(`${outputDir}/e2e-job-trash.json`, JSON.stringify(jobTrash, null, 2));
      fs.writeFileSync(`${outputDir}/e2e-needs-enrichment.json`, JSON.stringify(needsEnrichment, null, 2));
      logger.info(`[E2E] Exported job_queue, job_trash, and needs_enrichment to ${outputDir}/`);
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
    // Fixture-driven: simulate API fetch using EmailAlert and DetailPage HTML samples
    logger.info('🚀 Starting Gmail API fallback adapter (fixture-driven test mode)...');
    const { indeedEmailAlert, topCVEmailAlert, indeedPlatformPageHtml1, topCVDetailPageHTML } = await import('../../tests/__fixtures__/emails.js');
    // Simulate both alert and detail page flows
    const jobs: any[] = [
      indeedEmailAlert,
      topCVEmailAlert,
      indeedPlatformPageHtml1,
      topCVDetailPageHTML,
    ];
    const { canonicalProfile } = await import('../db/json.js');
    const { ProfileParser } = await import('../services/profile/profile-parser.js');
    const { EmailParser } = await import('../services/parsers/email-parser.js');
    const { HtmlJobParser } = await import('../services/parsers/html-job-parser.js');
    const jobProfile = ProfileParser.parse(canonicalProfile);
    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) throw new Error('Missing MONGODB_URI');
    const mongo = new MongoClient(mongoUri);
    await mongo.connect();
    const jobQueue = new MongoJobQueue(mongo);
    const metrics = new MetricsRecorder(mongoUri, config.mongodb.dbName);
    
    const emailParser = new EmailParser();
    const htmlParser = new HtmlJobParser();
    
    for (const job of jobs) {
      // If job is an EmailAlert, parse as email; if detail page HTML, parse as HTML
      let emailParsed;
      let htmlParsed;
      let parseInput;
      
      if (job && job.payload && job.payload.body && job.payload.body.data) {
        // EmailAlert: decode base64 body
        const html = Buffer.from(job.payload.body.data, 'base64').toString('utf-8');
        parseInput = { body: html, subject: job.payload.headers.find((h: { name: string; value: string }) => h.name === 'Subject')?.value || '', from: job.payload.headers.find((h: { name: string; value: string }) => h.name === 'From')?.value || '', emailId: job.id || '', receivedAt: new Date() };
        
        // Parse with EmailParser (handles alert structure)
        const emailResult = emailParser.parseWithValidation(parseInput);
        emailParsed = emailResult.success ? emailResult.data : null;
        
        // Also parse raw HTML for fallback enrichment
        htmlParsed = htmlParser.parseJobFromHtml(html);
      } else {
        // DetailPage HTML
        parseInput = { body: job, subject: '', from: '', emailId: '', receivedAt: new Date() };
        
        // Parse with HtmlJobParser directly
        htmlParsed = htmlParser.parseJobFromHtml(job);
        emailParsed = null;
      }
      
      // Merge email parser output with html parser output
      const envelopeNorm = ensureEnvelope(Object.assign({}, job || {}, parseInput || {}));
      const parsed = {
        ...(htmlParsed || {}),
        ...(emailParsed || {}),
        messageId: envelopeNorm.messageId,
        synthesized: envelopeNorm.synthesized,
      };
      
      if (!parsed || Object.keys(parsed).length === 0) {
        const db = mongo.db(config.mongodb.dbName);
        const recordOriginal = ensureEnvelope(Object.assign({}, job || {}, parseInput || {}));
        await logParseAttempt(
          mongo,
          recordOriginal.messageId || 'unknown',
          'JOB_DETAIL',
          false,
          null,
          { message: 'Both EmailParser and HtmlJobParser failed' },
          0
        );
        await db.collection('job_trash').insertOne({
          original: sanitizeJobForTrash(recordOriginal),
          parseErrors: ['Both EmailParser and HtmlJobParser failed'],
          enriched: null,
          reason: 'parse_failed_or_filtered',
          other: {},
          createdAt: new Date(),
          phase: 'draft',
        });
        continue;
      }
      
      // --- Filtering ---
      const filterProfile = {
        ...jobProfile,
        summary: Array.isArray(jobProfile.summary) ? jobProfile.summary.join('\n') : jobProfile.summary,
        skills: Array.isArray(jobProfile.normalizedSkills) ? jobProfile.normalizedSkills.map((s: any) => s.name) : [],
      };
      const filterResult = parsed ? hybridJobFilter(parsed, filterProfile) : undefined;
      if (filterResult) {
        if (filterResult) {
          logger.info('[Filter] Hybrid filter result', { reasons: filterResult.reasons, warnings: filterResult.warnings, missingFields: filterResult.missingFields, matchedProfile: filterResult.matchedProfile });
          if (!filterResult.passed) {
            const db = mongo.db(config.mongodb.dbName);
            const messageId = parsed.messageId || parsed.emailId || 'unknown';

            const hardReject = isHardRejectFilterResult(filterResult);

            await logParseAttempt(
              mongo,
              messageId,
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
              original: sanitizeJobForTrash(job),
              parsed,
              filterReasons: filterResult.reasons,
              missingFields: filterResult.missingFields,
              reason: 'filtered_by_hybrid',
              strictFields: filterResult.strictFields,
              relaxedFields: filterResult.relaxedFields,
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
              parsed.messageId || parsed.emailId || (parsed as any).id || 'unknown',
              parsed.title || parsed.position || 'Unknown',
              parsed.company || 'Unknown',
              getEnrichmentReasonFromFilter(filterResult),
              filterResult.missingFields || [],
              0,
              [],
              filterResult.warnings || []
            );
          }
        }
      }
      // --- Enrichment ---
      const { SmartGenerator } = await import('../services/generators/smart-generator.js');
      const generator = new SmartGenerator({
        ...jobProfile,
        summary: Array.isArray(jobProfile.summary) ? jobProfile.summary.join('\n') : jobProfile.summary,
        skills: Array.isArray(jobProfile.normalizedSkills) ? jobProfile.normalizedSkills.map((s: any) => s.name) : [],
      });
      
      // Ensure parsed has required fields before passing to generator
      const parsedWithDefaults = {
        ...parsed,
        platform: parsed.platform || 'Unknown',
        company: parsed.company || 'Unknown',
        position: parsed.position || 'Unknown',
      };
      
      const requirements = parsed ? generator.extractJobRequirements({
        ...parsedWithDefaults,
        location: parsedWithDefaults.location || '',
        description: parsedWithDefaults.description || '',
      }) : undefined;
      const matching = parsed && requirements ? generator.matchProfileWithJob(parsedWithDefaults, requirements) : undefined;
      let messageId = parsed && (parsed as any).messageId || parsed && (parsed as any).emailId || parsed && (parsed as any).id || (parsed && (parsed as any)._id ? String((parsed as any)._id) : undefined);
      if (!messageId) messageId = parseInput.emailId || '';
      const preEnriched = {
        ...parsedWithDefaults,
        profileNarrative: jobProfile.summary,
        matchScore: matching ? matching.matchScore : undefined,
        matchedProfileSkills: matching ? matching.matchedSkills : undefined,
        missingProfileSkills: matching ? matching.missingSkills : undefined,
        relevantExperience: matching ? matching.relevantExperience : undefined,
        requirements,
        messageId,
      };
      const enrichedJob = ensureEnvelope(preEnriched);
      // Validate enrichment
      const targetedMessageId = enrichedJob.messageId;
      const missingEnrichment =
        typeof enrichedJob.matchScore === 'undefined' || typeof enrichedJob.profileNarrative === 'undefined' || typeof enrichedJob.matchedProfileSkills === 'undefined' || typeof enrichedJob.requirements === 'undefined';
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
          enrichedJob.title || enrichedJob.position || parsedWithDefaults.title || parsedWithDefaults.position || 'Unknown',
          enrichedJob.company || parsedWithDefaults.company || 'Unknown',
          'missing_enrichment',
          missingFields,
          typeof enrichedJob.matchScore === 'number' ? enrichedJob.matchScore : 0,
          Array.isArray(enrichedJob.matchedProfileSkills) ? enrichedJob.matchedProfileSkills : []
        );
        continue;
      }
      
      // Success: Log parse success
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
    if (process.env.EXPORT_E2E_OUTPUT === '1') {
      const db = mongo.db(config.mongodb.dbName);
      const jobQueue = await db.collection('job_queue').find({}).toArray();
      const jobTrash = await db.collection('job_trash').find({}).toArray();
      const needsEnrichment = await db.collection('needs_enrichment').find({}).toArray();
      const fs = await import('fs');
      const outputDir = `${process.cwd()}/src/db/e2e-output`;
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }
      fs.writeFileSync(`${outputDir}/e2e-job-queue.json`, JSON.stringify(jobQueue, null, 2));
      fs.writeFileSync(`${outputDir}/e2e-job-trash.json`, JSON.stringify(jobTrash, null, 2));
      fs.writeFileSync(`${outputDir}/e2e-needs-enrichment.json`, JSON.stringify(needsEnrichment, null, 2));
      logger.info(`[E2E] Exported job_queue, job_trash, and needs_enrichment to ${outputDir}/`);
    }
    await mongo.close();
  }
}
