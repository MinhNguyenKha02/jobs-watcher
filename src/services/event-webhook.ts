import fs, { promises as fsPromises } from 'fs';
import path from 'path';

import express, { Request, Response } from 'express';

import {
  JobProcessor,
  type JobPresenter,
  type JobActionHandler,
} from '../application/job-processor.js';
import { config } from '../config.js';
import type { Job, Profile, Features } from '../types.js';
import { type EnrichedJobData, type ActionType } from '../ui/JobPopup.js';

import { SmartGenerator } from './generators/smart-generator.js';
import { GmailService } from './gmail.js';
import { getLogger } from './logger.js';
import { notifyUser } from './notifications.js';
import { EmailParser } from './parsers/email-parser.js';
import { calculateJobScore, DEFAULT_SCORING_CONFIG } from './scoring/score-matcher.js';
import { createMongoDBStorageAdapter, type MongoDBStorageAdapter } from './storage/index.js';

const logger = getLogger();

/**
 * Timeout wrapper for long-running operations
 * Returns null if timeout exceeded
 */
async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  operationName: string
): Promise<T | null> {
  return Promise.race([
    promise,
    new Promise<null>((_, reject) =>
      setTimeout(
        () => reject(new Error(`Timeout: ${operationName} exceeded ${timeoutMs}ms`)),
        timeoutMs
      )
    ),
  ]).catch((err) => {
    logger.warn(`⏱️  ${err.message}`);
    return null;
  });
}

/**
 * Simple circuit breaker for resilience
 * Tracks consecutive failures and opens after threshold
 */
class CircuitBreaker {
  private failureCount = 0;
  private successCount = 0;
  private isOpen = false;
  private lastFailureTime = 0;
  readonly failureThreshold = 5;
  readonly successThreshold = 3;
  readonly resetTimeMs = 60000; // 1 minute

  async execute<T>(fn: () => Promise<T>, operationName: string): Promise<T | null> {
    // Auto-reset if enough time has passed
    if (this.isOpen && Date.now() - this.lastFailureTime > this.resetTimeMs) {
      logger.info(`🔄 Circuit breaker reset for ${operationName}`);
      this.isOpen = false;
      this.failureCount = 0;
      this.successCount = 0;
    }

    if (this.isOpen) {
      logger.warn(`⚠️  Circuit breaker open for ${operationName} - returning null`);
      return null;
    }

    try {
      const result = await fn();
      this.successCount++;
      if (this.successCount >= this.successThreshold) {
        this.failureCount = 0;
        this.successCount = 0;
      }
      return result;
    } catch (err) {
      this.failureCount++;
      this.lastFailureTime = Date.now();
      if (this.failureCount >= this.failureThreshold) {
        this.isOpen = true;
        logger.error(`🔴 Circuit breaker OPEN for ${operationName} - too many failures`);
      }
      throw err;
    }
  }
}

/**
 * Action handler abstraction
 * Allows pluggable job action implementations
 */
export interface ActionHandler extends JobActionHandler<ActionType, EnrichedJobData> {}

/**
 * Default action handler
 */
class DefaultActionHandler implements ActionHandler {
  constructor(
    private smartGenerator: SmartGenerator,
    private notify: typeof notifyUser,
    private features: Features
  ) {}

  async handle(job: Job, action: ActionType, enrichedData?: EnrichedJobData): Promise<void> {
    // Merge enriched data into job
    const enrichedJob: Job = {
      ...job,
    };

    // Log action with enrichment metadata
    await this.logAction(enrichedJob, action, enrichedData);

    if (action.startsWith('apply')) {
      const outputDir = await this.smartGenerator.generateForJob(enrichedJob);
      logger.info(`✅ Materials generated: ${outputDir}`);

      if (action === 'apply-edit') {
        logger.info('📝 Opening materials for editing...');
        // TODO: Open editor with generated files
      } else if (action === 'apply-custom') {
        logger.info('🎨 Manual application mode - materials ready for review');
      }

      if (this.features.notifications) {
        await this.notify({
          title: `✓ Applied to ${job.company}`,
          message: `${job.position} - Check generated/ folder`,
        });
      }
    } else if (action === 'queue') {
      logger.info(`⏰ Queued ${job.company} - review later`);

      if (this.features.notifications) {
        await this.notify({
          title: `📋 Queued: ${job.company}`,
          message: `${job.position}`,
        });
      }
    }
  }

  private async logAction(
    job: Job,
    action: ActionType,
    enrichedData?: EnrichedJobData
  ): Promise<void> {
    const logEntry = {
      timestamp: new Date().toISOString(),
      messageId: job.messageId,
      action,
      company: job.company,
      position: job.position,
      url: job.url,
      enriched: Boolean(enrichedData?.htmlContent),
      urlOpened: enrichedData?.urlOpened,
      matchScore: job.matchScore,
    };

    const logDir = path.join(process.cwd(), 'logs');
    const logFile = path.join(logDir, 'filtered-jobs.json');

    try {
      await fsPromises.mkdir(logDir, { recursive: true });

      // Append to JSONL format
      const logLine = JSON.stringify(logEntry) + '\n';
      await fsPromises.appendFile(logFile, logLine, 'utf-8');
    } catch (error: any) {
      logger.warn(`Failed to log action: ${error.message}`);
    }
  }
}

/**
 * Event-driven webhook server
 * Processes jobs on-demand from Pub/Sub, configurable via features
 */
export class EventDrivenWebhook {
  private app: express.Application;
  private gmailService: GmailService;
  private parser: EmailParser;
  private profile: Profile;
  private processedJobs = new Set<string>(); // In-memory dedup during runtime
  private smartGenerator: SmartGenerator;
  private notify: typeof notifyUser;
  private actionHandler: ActionHandler;
  public jobProcessor?: JobProcessor<ActionType, EnrichedJobData>;
  private storage: MongoDBStorageAdapter | null = null;
  private server: any = null;
  private parserCircuitBreaker = new CircuitBreaker();
  private generatorCircuitBreaker = new CircuitBreaker();
  private rawEmailBaseDir = path.join(config.logsPath, 'raw-emails');
  public _presenterInit?: () => Promise<void>;

  /**
   * Backward compatibility for tests: connect storage
   */
  public async connectStorage(): Promise<void> {
    await this.connect();
  }

  /**
   * Backward compatibility for tests: disconnect storage
   */
  public async disconnectStorage(): Promise<void> {
    await this.disconnect();
  }

  /**
   * Public method for E2E tests to process a Pub/Sub notification
   */
  public async processJobNotification(body: any) {
    return this.handleJobNotification(body);
  }

  constructor(
    gmailService: GmailService,
    options?: {
      parser?: EmailParser;
      profile?: Profile;
      smartGenerator?: SmartGenerator;
      presenter?: JobPresenter<ActionType, EnrichedJobData>;
      notifyFn?: typeof notifyUser;
      actionHandler?: ActionHandler;
      storage?: MongoDBStorageAdapter;
    }
  ) {
    this.app = express();
    this.gmailService = gmailService;
    this.parser = options?.parser || new EmailParser();
    this.profile = options?.profile || this.loadProfile();
    this.smartGenerator = options?.smartGenerator || new SmartGenerator(this.profile);
    this.notify = options?.notifyFn || notifyUser;
    this.actionHandler =
      options?.actionHandler ||
      new DefaultActionHandler(this.smartGenerator, this.notify, config.features);
    let presenter = options?.presenter;
    this._presenterInit = async () => {
      if (!presenter) {
        // Only import TuiJobPresenter if not in test/headless context
        // Use dynamic import for ESM compatibility
        const module = await import('../ui/TuiJobPresenter.js');
        const { TuiJobPresenter } = module;
        presenter = new TuiJobPresenter();
      }
      this.jobProcessor = new JobProcessor(presenter!, this.actionHandler);
    };
    // Call this._presenterInit() in connectStorage or test setup

    // Initialize MongoDB storage adapter
    this.storage =
      options?.storage ||
      createMongoDBStorageAdapter(config.mongodb.uri, config.mongodb.dbName, logger);

    this.setupRoutes();
  }

  private loadProfile(): Profile {
    const profilePath = path.join(config.resourcesPath, 'profile.json');
    if (!fs.existsSync(profilePath)) {
      throw new Error('profile.json not found in resources/');
    }
    return JSON.parse(fs.readFileSync(profilePath, 'utf-8'));
  }

  private setupRoutes() {
    this.app.use(express.json());

    // Health check endpoint
    this.app.get('/health', (req: Request, res: Response) => {
      try {
        // Basic health check
        const memoryUsageMB = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
        const uptime = Math.round(process.uptime());

        res.json({
          status: 'ok',
          timestamp: new Date().toISOString(),
          uptime,
          memory_mb: memoryUsageMB,
          webhook_path: config.webhook.path,
        });
      } catch (err) {
        res.status(500).json({
          status: 'error',
          message: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    });

    // Gmail Pub/Sub webhook
    this.app.post(config.webhook.path, async (req: Request, res: Response) => {
      try {
        // Acknowledge immediately to Pub/Sub
        res.status(200).send('OK');

        // Process in background
        this.handleJobNotification(req.body).catch((error) => {
          logger.error(`Error processing job: ${error.message}`);
        });
      } catch (error: any) {
        logger.error(`Webhook error: ${error.message}`);
        res.status(500).send('Error');
      }
    });

    // Health check
    this.app.get('/health', (req: Request, res: Response) => {
      res.json({ status: 'ok', service: 'jobs-watcher-event-driven' });
    });
  }

  private async handleJobNotification(body: any) {
    try {
      const message = body.message;
      if (!message?.data) return;

      // Fire-and-forget job processing (don't await)
      // This allows webhook to respond immediately to Pub/Sub
      // while job processing (including TUI) happens in the background
      this._processNotificationWithCircuitBreaker(message).catch((err) => {
        logger.error(
          `🔥 Background job processing error: ${err instanceof Error ? err.message : String(err)}`
        );
        if (err instanceof Error && err.stack) {
          logger.debug(`Stack trace: ${err.stack}`);
        }
      });
    } catch (error: any) {
      logger.error(`Error handling notification: ${error.message}`);
    }
  }

  private async _processNotificationWithCircuitBreaker(message: any) {
    // Decode Pub/Sub message
    const data = JSON.parse(Buffer.from(message.data, 'base64').toString());
    const historyId: string | undefined = data.historyId;
    const messageId: string | undefined = data.messageId;

    if (config.features.logging) {
      logger.info('📬 New job alert received');
    }

    // If direct messageId provided (e.g., from simulate-webhook), use it
    if (messageId) {
      if (this.processedJobs.has(messageId)) {
        logger.info(`ℹ️  Message ${messageId} already processed, skipping`);
        return;
      }
      await this.processJobWithCircuitBreaker(messageId);
      this.processedJobs.add(messageId);
      return;
    }

    // Prefer precise message IDs from Gmail History API when available
    const labelId = await this.gmailService.getLabelId(config.gmail.labelName);
    let messageIds: string[] = [];
    if (historyId) {
      messageIds = await (this.gmailService as any).getMessagesSinceHistory(historyId, labelId);
    } else {
      const messages = await this.getRecentMessages(labelId);
      messageIds = (messages || []).map((m: any) => m.id).filter(Boolean);
    }

    for (const id of messageIds) {
      // Skip if already processed in this session
      if (this.processedJobs.has(id)) continue;

      await this.processJobWithCircuitBreaker(id);
      this.processedJobs.add(id);

      // Clean up old processed jobs (keep last 100 in memory)
      if (this.processedJobs.size > 100) {
        const arr = Array.from(this.processedJobs);
        this.processedJobs = new Set(arr.slice(-100));
      }
    }
  }

  private async processJobWithCircuitBreaker(messageId: string) {
    // Use circuit breaker to prevent cascading failures
    const result = await this.parserCircuitBreaker.execute(
      () => this.processJob(messageId),
      'processJob'
    );

    if (result === null) {
      logger.warn(
        `⚠️  Circuit breaker blocked processing of ${messageId} - will retry on next message`
      );
    }
  }

  private async getRecentMessages(labelId: string) {
    // Use GmailService method instead of direct API call
    const messages = await this.gmailService.listMessagesByLabel(labelId, 5);
    // listMessagesByLabel returns message objects with 'id' field
    return messages || [];
  }
  private async processJob(messageId: string) {
    try {
      if (config.features.logging) {
        logger.info(`🔍 Processing job from email: ${messageId}`);
      }

      // Fetch and parse email
      const message = await this.gmailService.getMessage(messageId);
      const subject = this.gmailService.extractHeader(message, 'Subject');
      const from = this.gmailService.extractHeader(message, 'From');
      const to = this.gmailService.extractHeader(message, 'To');
      const date = this.gmailService.extractHeader(message, 'Date');
      const body = this.gmailService.extractBody(message);

      // Log detailed email information
      if (config.features.logging) {
        logger.info(`📧 Email Details:`);
        logger.info(`   From: ${from}`);
        logger.info(`   To: ${to}`);
        logger.info(`   Subject: ${subject}`);
        logger.info(`   Date: ${date}`);
        logger.info(`   Body Length: ${body.length} characters`);
      }

      // Persist raw email content for later parsing/experimentation
      await this.logRawEmailSafe({
        messageId,
        subject,
        from,
        body,
      });

      // Save raw email to MongoDB (immutable storage)
      let rawIngestId: string | undefined;
      try {
        if (this.storage) {
          logger.info(`💾 Saving raw email to MongoDB...`);
          rawIngestId = await this.storage.saveRawIngest({
            source: 'GMAIL_WEBHOOK',
            mode: 'production',
            rawContent: body,
            gmailMeta: {
              messageId,
              threadId: message.threadId,
              labelIds: message.labelIds,
              snippet: message.snippet,
              internalDate: parseInt(message.internalDate || '0'),
              from,
              to,
              subject,
            },
            ingestedAt: new Date(),
            createdAt: new Date(),
          });
          logger.info(`✅ Raw email saved to MongoDB with ID: ${rawIngestId}`);
        } else {
          logger.warn(`⚠️  Storage adapter not initialized - skipping MongoDB save`);
        }
      } catch (error: any) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : '';
        logger.error(`❌ Failed to save raw email to MongoDB: ${errorMsg}`);
        if (errorStack) {
          logger.debug(`Error stack: ${errorStack}`);
        }
      }

      // Stage 1: Parse metadata
      const metadataStartTime = Date.now();
      const metadataResult = this.parser.parseMetadata({
        emailId: messageId,
        subject,
        from,
        body,
        receivedAt: new Date(parseInt(message.internalDate || '0')),
      });
      const metadataEndTime = Date.now();

      // Log metadata parse attempt to MongoDB
      if (rawIngestId && this.storage) {
        try {
          const metadataSuccess = !metadataResult.errors.some((e) => !e.includes('HTML parsing'));
          await this.storage.logParseAttempt({
            rawIngestId,
            stage: 'METADATA',
            success: metadataSuccess,
            extracted: metadataSuccess
              ? {
                  company: metadataResult.company,
                  position: metadataResult.position,
                  salary: metadataResult.salary,
                  location: metadataResult.location,
                }
              : undefined,
            error: !metadataSuccess
              ? {
                  code: 'METADATA_PARSE_FAILED',
                  message: metadataResult.errors.join('; '),
                }
              : undefined,
            executionMs: metadataEndTime - metadataStartTime,
            timestamp: new Date(),
          });
          logger.debug(`📊 METADATA stage: ${metadataSuccess ? 'SUCCESS' : 'FAILED'}`, {
            company: metadataResult.company,
            position: metadataResult.position,
            errors: metadataResult.errors,
          });
        } catch (error: any) {
          logger.warn(`Failed to log METADATA parse attempt: ${error.message}`);
        }
      }

      // Stage 2: Parse job details
      const detailStartTime = Date.now();
      const detailResult = this.parser.parseJobDetail({
        emailId: messageId,
        subject,
        from,
        body,
        receivedAt: new Date(parseInt(message.internalDate || '0')),
      });
      const detailEndTime = Date.now();

      // Log job detail parse attempt to MongoDB
      if (rawIngestId && this.storage) {
        try {
          const detailSuccess = !detailResult.errors.some((e) => !e.includes('HTML parsing'));
          await this.storage.logParseAttempt({
            rawIngestId,
            stage: 'JOB_DETAIL',
            success: detailSuccess,
            extracted: detailSuccess
              ? {
                  url: detailResult.url,
                  description: detailResult.description
                    ? detailResult.description.substring(0, 500)
                    : undefined,
                }
              : undefined,
            error: !detailSuccess
              ? {
                  code: 'DETAIL_PARSE_FAILED',
                  message: detailResult.errors.join('; '),
                }
              : undefined,
            executionMs: detailEndTime - detailStartTime,
            timestamp: new Date(),
          });
          logger.debug(`📊 JOB_DETAIL stage: ${detailSuccess ? 'SUCCESS' : 'FAILED'}`, {
            url: detailResult.url,
            hasDescription: !!detailResult.description,
            errors: detailResult.errors,
          });
        } catch (error: any) {
          logger.warn(`Failed to log JOB_DETAIL parse attempt: ${error.message}`);
        }
      }

      // Merge both stages for job creation
      const parsed = this.parser.parse({
        emailId: messageId,
        subject,
        from,
        body,
        receivedAt: new Date(parseInt(message.internalDate || '0')),
      });

      if (!parsed) {
        if (config.features.logging) {
          logger.warn('⚠️  Could not parse job details');
        }
        return;
      }

      // Create in-memory job object
      const job: Job = {
        id: messageId,
        emailId: messageId,
        subject: parsed.subject,
        from: parsed.from,
        platform: parsed.platform,
        company: parsed.company || 'Unknown',
        position: parsed.position || 'Unknown',
        location: parsed.location,
        description: parsed.description,
        url: parsed.url,
        rawContent: parsed.rawContent,
        receivedAt: parsed.receivedAt,
        status: 'queued',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      if (config.features.logging) {
        logger.info(`🏢 ${job.company} - ${job.position}`);
        logger.info(`📍 ${job.location || 'Remote'} • ${job.platform}`);
      }

      // Stage 3: Calculate match score using profile
      const scoringStartTime = Date.now();
      const scoreBreakdown = calculateJobScore(job, this.profile, DEFAULT_SCORING_CONFIG);
      const scoringEndTime = Date.now();

      // Attach score to job object
      job.matchScore = scoreBreakdown.finalScore;
      job.matchedSkills = scoreBreakdown.details.jobSkillsFound;

      // Log scoring to MongoDB
      if (rawIngestId && this.storage) {
        try {
          await this.storage.logParseAttempt({
            rawIngestId,
            stage: 'JOB_DETAIL', // Only valid stages: 'METADATA', 'JOB_DETAIL'
            success: true,
            extracted: {
              finalScore: String(scoreBreakdown.finalScore),
              skillsScore: String(scoreBreakdown.skillsScore),
              salaryScore: String(scoreBreakdown.salaryScore),
              locationScore: String(scoreBreakdown.locationScore),
              matchedSkills: Array.isArray(scoreBreakdown.details.jobSkillsFound)
                ? scoreBreakdown.details.jobSkillsFound.join(',')
                : String(scoreBreakdown.details.jobSkillsFound),
              details: JSON.stringify({
                userSkills: scoreBreakdown.details.userSkills,
                jobSkillsFound: scoreBreakdown.details.jobSkillsFound.slice(0, 10),
                userSalaryRange: scoreBreakdown.details.userSalaryRange,
                jobSalary: scoreBreakdown.details.jobSalary,
                userLocations: scoreBreakdown.details.userLocations,
                jobLocation: scoreBreakdown.details.jobLocation,
              }),
            },
            executionMs: scoringEndTime - scoringStartTime,
            timestamp: new Date(),
          });
          if (config.features.logging) {
            logger.info(
              `✨ Match Score: ${scoreBreakdown.finalScore}% (Skills: ${scoreBreakdown.skillsScore}%, Salary: ${scoreBreakdown.salaryScore}%, Location: ${scoreBreakdown.locationScore}%)`
            );
          }
        } catch (error: any) {
          logger.warn(`Failed to log SCORING stage: ${error.message}`);
        }
      }

      // Show TUI popup and get user action (only if TUI is enabled)
      if (config.features.tui) {
        await this.jobProcessor?.process(job);
      } else {
        // Default to queue if TUI is disabled
        await this.actionHandler.handle(job, 'queue');
      }
    } catch (error: any) {
      logger.error(`Error processing job: ${error.message}`);
    }
  }

  /**
   * Connect to MongoDB for audit trail storage
   */
  async connect(): Promise<void> {
    if (this.storage) {
      try {
        await this.storage.connect();
        if (config.features.logging) {
          logger.info('✅ MongoDB storage connected');
        }
      } catch (error: any) {
        logger.error(`Failed to connect MongoDB: ${error.message}`);
        throw error;
      }
    }
  }

  /**
   * Disconnect from MongoDB
   */
  async disconnect(): Promise<void> {
    if (this.storage) {
      try {
        await this.storage.disconnect();
        if (config.features.logging) {
          logger.info('🔌 MongoDB storage disconnected');
        }
      } catch (error: any) {
        logger.error(`Failed to disconnect MongoDB: ${error.message}`);
      }
    }
  }

  async start(port: number): Promise<void> {
    return new Promise((resolve) => {
      this.server = this.app.listen(port, '127.0.0.1', () => {
        if (config.features.logging) {
          logger.info(`🌐 Event-driven webhook listening on port ${port}`);
          logger.info(`📡 Endpoint: http://localhost:${port}${config.webhook.path}`);
        }
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.server) {
        this.server.close((err: any) => {
          if (err) reject(err);
          else resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * Best-effort raw email logger: writes JSONL rows to logs/raw-emails/YYYY-MM-DD/{messageId}.jsonl
   * Useful for offline parsing experiments without blocking the flow.
   */
  private async logRawEmailSafe(opts: {
    messageId: string;
    subject: string;
    from: string;
    body: string;
  }): Promise<void> {
    const dateKey = new Date().toISOString().split('T')[0];
    const dir = path.join(this.rawEmailBaseDir, dateKey);
    const file = path.join(dir, `${opts.messageId}.jsonl`);
    const entry = {
      timestamp: new Date().toISOString(),
      gmail_message_id: opts.messageId,
      from: opts.from,
      subject: opts.subject,
      body: opts.body,
    };

    try {
      await fsPromises.mkdir(dir, { recursive: true });
      await fsPromises.appendFile(file, JSON.stringify(entry) + '\n', 'utf-8');
    } catch (err) {
      logger.warn(
        `Could not log raw email ${opts.messageId}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
}
