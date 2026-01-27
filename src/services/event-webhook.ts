import express, { Request, Response } from 'express';
import { GmailService } from './gmail.js';
import { EmailParser } from './parser.js';
import { SmartGenerator } from './smart-generator.js';
import { showJobPopup } from '../ui/JobPopup.js';
import { config } from '../config.js';
import { notifyUser } from './notifications.js';
import { getLogger } from './logger.js';
import type { Job, Profile, Features } from '../types.js';
import fs from 'fs';
import path from 'path';

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
      setTimeout(() => reject(new Error(`Timeout: ${operationName} exceeded ${timeoutMs}ms`)), timeoutMs)
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
export interface ActionHandler {
  handle(job: Job, action: 'apply' | 'skip' | 'queue'): Promise<void>;
}

/**
 * Default action handler
 */
class DefaultActionHandler implements ActionHandler {
  constructor(
    private smartGenerator: SmartGenerator,
    private notify: typeof notifyUser,
    private features: Features
  ) {}

  async handle(job: Job, action: 'apply' | 'skip' | 'queue'): Promise<void> {
    if (action === 'apply') {
      const outputDir = await this.smartGenerator.generateForJob(job);
      logger.info(`✅ Materials generated: ${outputDir}`);
      
      if (this.features.notifications) {
        await this.notify({
          title: `✓ Applied to ${job.company}`,
          message: `${job.position} - Check generated/ folder`,
        });
      }
    } else if (action === 'skip') {
      logger.info(`⏭️  Skipped ${job.company}`);
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
  private showPopup: typeof showJobPopup;
  private notify: typeof notifyUser;
  private actionHandler: ActionHandler;
  private server: any = null;
  private parserCircuitBreaker = new CircuitBreaker();
  private generatorCircuitBreaker = new CircuitBreaker();

  constructor(
    gmailService: GmailService,
    options?: {
      parser?: EmailParser;
      profile?: Profile;
      smartGenerator?: SmartGenerator;
      showJobPopupFn?: typeof showJobPopup;
      notifyFn?: typeof notifyUser;
      actionHandler?: ActionHandler;
    }
  ) {
    this.app = express();
    this.gmailService = gmailService;
    this.parser = options?.parser || new EmailParser();
    this.profile = options?.profile || this.loadProfile();
    this.smartGenerator = options?.smartGenerator || new SmartGenerator(this.profile);
    this.showPopup = options?.showJobPopupFn || showJobPopup;
    this.notify = options?.notifyFn || notifyUser;
    this.actionHandler = options?.actionHandler || 
      new DefaultActionHandler(this.smartGenerator, this.notify, config.features);
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

      // Wrap in timeout (30 seconds)
      const result = await withTimeout(
        this._processNotificationWithCircuitBreaker(message),
        30000,
        'handleJobNotification'
      );

      if (result === null) {
        logger.warn('⏱️  Notification processing timeout - Pub/Sub will retry');
      }
    } catch (error: any) {
      logger.error(`Error handling notification: ${error.message}`);
    }
  }

  private async _processNotificationWithCircuitBreaker(message: any) {
    // Decode Pub/Sub message
    const data = JSON.parse(Buffer.from(message.data, 'base64').toString());
    const historyId: string | undefined = data.historyId;
    
    if (config.features.logging) {
      logger.info('📬 New job alert received');
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
      logger.warn(`⚠️  Circuit breaker blocked processing of ${messageId} - will retry on next message`);
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
      const body = this.gmailService.extractBody(message);

      // Parse job details
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

      // Show TUI popup and get user action (only if TUI is enabled)
      let action: 'apply' | 'skip' | 'queue';
      if (config.features.tui) {
        action = await this.showPopup(job);
      } else {
        // Default to queue if TUI is disabled
        action = 'queue';
      }

      // Handle action via pluggable handler
      await this.actionHandler.handle(job, action);
    } catch (error: any) {
      logger.error(`Error processing job: ${error.message}`);
    }
  }

  async start(port: number): Promise<void> {
    return new Promise((resolve) => {
      this.server = this.app.listen(port, () => {
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
}
