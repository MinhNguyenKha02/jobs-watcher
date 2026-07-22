import { getLogger } from '../infrastructure/outbound/logging/logger.js';
import { HtmlJobParser } from '../domain/services/parsing/html-job-parser.js';
import { JobExtractionService } from '../domain/services/parsing/job-extraction.js';
import { hybridJobFilter } from '../domain/filter/job-filter.js';
import type { ParsePort } from './ports/parse.port.js';
import type { RoutingPort } from './ports/routing.port.js';
import type { JobLifecyclePort } from './ports/job-lifecycle.port.js';
import type { ExtractionQueuePort } from './ports/extraction-queue.port.js';
import type { AssetProducingPort } from './ports/asset-producing.port.js';
import type { ProcessIngestCommand, ProcessResolutionCommand } from './commands.js';
import { JobStage, JobStatus, JobSource, type JobLifecycleDocument } from '../domain/types/job-lifecycle.js';

const logger = getLogger();

function generateFallbackId(prefix = 'unk'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

export class JobIngestor {
  private htmlParser = new HtmlJobParser();

  constructor(
    private jobLifecycle: JobLifecyclePort,
    private parsePort: ParsePort,
    private routingPort: RoutingPort,
    private extractionQueue?: ExtractionQueuePort,
    private assetProducingPort?: AssetProducingPort
  ) {}

  async processIngestCommand(command: ProcessIngestCommand): Promise<void> {
    const { source, stage, rawPayload, jobLifecycleId, metadata } = command;

    if (stage === JobStage.PARTIAL_PARSED) {
      if (rawPayload && rawPayload.trim().length > 0) {
        await this.signal1BrowserAutoXorManual(rawPayload, metadata);
      } else if (jobLifecycleId) {
        await this.signal1BrowserAutoFallback(jobLifecycleId);
      }
    } else if (stage === JobStage.FULL_PARSED) {
      if (source === JobSource.BROWSER_AUTO) {
        await this.signal2cBrowserAuto(rawPayload, jobLifecycleId);
      } else if (source === JobSource.MANUAL && jobLifecycleId) {
        await this.signal2aManual(rawPayload, jobLifecycleId);
      } else if (source === JobSource.MANUAL) {
        await this.signal2bManual(rawPayload);
      }
    }
  }

  async processResolutionCommand(command: ProcessResolutionCommand): Promise<void> {
    const { jobLifecycleId, action, editedKVs } = command;
    if (!jobLifecycleId || !action) return;

    try {
      const existing = await this.queryWithRetry(jobLifecycleId);
      const merged: Partial<JobLifecycleDocument> = {
        ...(existing || {}),
        ...(editedKVs || {}),
        _id: jobLifecycleId,
        updatedAt: new Date(),
      };

      if (action === 'queue') {
        if (existing && existing.status !== JobStatus.ENRICHED) {
          logger.warn('[Ingestor] [j] guard: rejecting queue action — job not ENRICHED', {
            jobLifecycleId, status: existing.status,
          });
          return;
        }
        await this.jobLifecycle.updateStage(jobLifecycleId, JobStage.FULL_PARSED, JobStatus.QUEUED);
        await this.routingPort.emitJobQueued(merged, { source: JobSource.MANUAL });
        if (this.assetProducingPort && existing) {
          this.assetProducingPort.toAsset(existing).catch((err: unknown) => {
            logger.warn('[AssetProduction] Asset generation failed', { jobLifecycleId, error: err instanceof Error ? err.message : String(err) });
          });
        }
      } else if (action === 'trash') {
        await this.jobLifecycle.updateStage(jobLifecycleId, JobStage.FULL_PARSED, JobStatus.TRASHED);
        await this.routingPort.emitJobTrashed(jobLifecycleId, 'operator:trash', { operatorEdits: editedKVs });
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      logger.warn('[Ingestor] Resolution action failed', { jobLifecycleId, action, reason });
      await this.routingPort.emitRouteFailed(jobLifecycleId, reason, { operatorEdits: editedKVs });
    }
  }

  /** BROWSER_AUTO PARTIAL_PARSED: email HTML → extract → filter → enqueue (has url) or emitGenerated (no url) */
  private async signal1BrowserAutoXorManual(
    rawPayload: string,
    metadata?: ProcessIngestCommand['metadata']
  ): Promise<void> {
    const jobExtractor = new JobExtractionService();
    let extractedJobs: any[] = [];
    try {
      extractedJobs = jobExtractor.extractAllJobs(rawPayload);
    } catch (e) {
      logger.warn('[Ingestor] Job extraction failed (stage1)', { error: e });
      await this.parsePort.emitFailed(metadata?.messageId || 'unknown', {
        stage: JobStage.PARTIAL_PARSED,
        source: JobSource.BROWSER_AUTO,
        error: e instanceof Error ? e.message : String(e),
      });
      return;
    }

    if (extractedJobs.length === 0) {
      extractedJobs = [{ role: metadata?.subject, description: rawPayload, company: 'Unknown' }];
    }

    for (let idx = 0; idx < extractedJobs.length; idx++) {
      const extracted = extractedJobs[idx];
      const jobLifeCycleId = this.resolveJobLifeCycleId(metadata?.messageId || 'unknown', idx);

      const role = this.getStringField(extracted.role) || '';
      const company = this.getStringField(extracted.company) || '';
      const url = this.getStringField(extracted.url) || '';

      const hasUrl = /indeed\.com\/(?:applystart|viewjob)\?/i.test(url);

      const doc: Partial<JobLifecycleDocument> = {
        _id: jobLifeCycleId,
        raw: rawPayload,
        gmailMeta: metadata ? {
          messageId: metadata.messageId || `msg-${Date.now()}`,
          body: rawPayload,
          threadId: metadata.threadId,
          from: metadata.from,
          to: metadata.to,
          subject: metadata.subject,
        } : undefined,
        company,
        role,
        description: this.getStringField(extracted.description) || '',
        salary: this.getStringField(extracted.salary) || '',
        location: this.getStringField(extracted.location) || '',
        url,
        deadline: extracted.deadline || undefined,
        easyApply: extracted.easyApply || undefined,
        stage: JobStage.PARTIAL_PARSED,
        status: JobStatus.ENRICHING,
        source: JobSource.BROWSER_AUTO,
        createdAt: new Date(),
        updatedAt: new Date(),
        stageTimestamp: new Date(),
      };

      const filterResult = hybridJobFilter(doc);
      if (!filterResult.passed) {
        logger.info('[Ingestor] Filter rejected job', { jobLifeCycleId, role, company, reasons: filterResult.reasons });
        await this.routingPort.emitJobTrashed(jobLifeCycleId, `Filter rejected: ${filterResult.reasons.join('; ')}`);
        continue;
      }

      try {
        await this.jobLifecycle.upsert(doc);
      } catch (e: any) {
        if (e?.code === 11000) {
          logger.info('[DEDUP] Duplicate role+company — skipping', { jobLifeCycleId, role, company });
          await this.routingPort.emitJobTrashed(jobLifeCycleId, `Duplicate: ${role}/${company}`);
          continue;
        }
        throw e;
      }

      if (hasUrl && this.extractionQueue) {
        logger.info('[Ingestor] Job has url — enqueuing to extraction queue', { jobLifeCycleId, role, company, url });
        await this.extractionQueue.enqueue(jobLifeCycleId);
      } else {
        logger.info('[Ingestor] Job has no url — emitting generated only', { jobLifeCycleId, role, company });
        await this.parsePort.emitGenerated(doc, {
          stage: JobStage.PARTIAL_PARSED,
          source: JobSource.BROWSER_AUTO,
        });
      }
    }
  }

  private async signal1BrowserAutoFallback(jobLifecycleId: string): Promise<void> {
    const existing = await this.queryWithRetry(jobLifecycleId);
    if (!existing) {
      logger.error('[Ingestor] signal1BrowserAutoFallback — no existing job lifecycle found', { jobLifecycleId });
      return;
    }
    await this.parsePort.emitGenerated(existing, {
      stage: JobStage.PARTIAL_PARSED,
      source: JobSource.BROWSER_AUTO,
    });
  }

  private async signal2aManual(rawPayload: string, jobLifecycleId?: string): Promise<void> {
    if (!rawPayload.trim()) {
      await this.parsePort.emitFailed(jobLifecycleId || generateFallbackId(), {
        stage: JobStage.FULL_PARSED,
        source: JobSource.MANUAL,
        error: 'Empty HTML payload',
      });
      return;
    }

    const parsed = this.htmlParser.parseJobFromHtml(rawPayload);
    if (!parsed) {
      await this.parsePort.emitFailed(jobLifecycleId || generateFallbackId(), {
        stage: JobStage.FULL_PARSED,
        source: JobSource.MANUAL,
        error: 'HTML parse failed',
      });
      return;
    }

    if (!jobLifecycleId) {
      logger.warn('[STAGE2] Missing jobLifecycleId for manual signal2a');
      logger.error('[Ingestor] Data loss prevented — signal2a called without jobLifecycleId');
      return;
    }

    const stage1Partial = await this.queryWithRetry(jobLifecycleId);
    if (stage1Partial && (stage1Partial.status === JobStatus.QUEUED || stage1Partial.status === JobStatus.TRASHED || stage1Partial.status === JobStatus.ENRICHED)) {
      logger.warn('[STAGE2] S2 enrichment skipped — job already routed or fully parsed', {
        jobLifecycleId, status: stage1Partial.status,
      });
      return;
    }

    const doc: Partial<JobLifecycleDocument> = {
      _id: jobLifecycleId,
      role: this.getStringField(parsed.role) || stage1Partial?.role || 'Unknown',
      company: this.getStringField(parsed.company) || stage1Partial?.company || 'Unknown',
      description: this.getStringField(parsed.description) || stage1Partial?.description || '',
      salary: this.getStringField(parsed.salary) || stage1Partial?.salary || '',
      location: this.getStringField(parsed.location) || stage1Partial?.location || '',
      url: this.getStringField(parsed.url) || stage1Partial?.url || '',
      details: parsed.details || stage1Partial?.details,
      deadline: parsed.deadline || stage1Partial?.deadline,
      easyApply: parsed.easyApply ?? stage1Partial?.easyApply,
      raw: rawPayload,
      stage: JobStage.FULL_PARSED,
      status: JobStatus.ENRICHED,
      source: JobSource.MANUAL,
      gmailMeta: stage1Partial?.gmailMeta,
      updatedAt: new Date(),
      stageTimestamp: new Date(),
      createdAt: stage1Partial?.createdAt || new Date(),
    };

    await this.jobLifecycle.upsert(doc);
    await this.parsePort.emitCompleted(jobLifecycleId, doc, {
      stage: JobStage.FULL_PARSED,
      source: JobSource.MANUAL,
    });
  }

  private async signal2bManual(rawPayload: string): Promise<void> {
    const parsed = this.htmlParser.parseJobFromHtml(rawPayload);
    if (!parsed) {
      await this.parsePort.emitFailed(generateFallbackId('clip'), {
        stage: JobStage.FULL_PARSED,
        source: JobSource.MANUAL,
        error: 'HTML parse failed',
      });
      return;
    }

    const doc: Partial<JobLifecycleDocument> = {
      _id: generateFallbackId('clip'),
      raw: rawPayload,
      role: this.getStringField(parsed.role) || 'Unknown',
      company: this.getStringField(parsed.company) || 'Unknown',
      description: this.getStringField(parsed.description) || '',
      salary: this.getStringField(parsed.salary) || '',
      location: this.getStringField(parsed.location) || '',
      url: this.getStringField(parsed.url) || '',
      details: parsed.details,
      deadline: parsed.deadline || undefined,
      easyApply: parsed.easyApply || undefined,
      stage: JobStage.FULL_PARSED,
      status: JobStatus.ENRICHED,
      source: JobSource.MANUAL,
      createdAt: new Date(),
      updatedAt: new Date(),
      stageTimestamp: new Date(),
    };

    try {
      await this.jobLifecycle.upsert(doc);
    } catch (e: any) {
      if (e?.code === 11000) {
        logger.warn('[INGEST] Duplicate role+company — skipping', {
          role: doc.role,
          company: doc.company,
        });
        return;
      }
      throw e;
    }

    await this.parsePort.emitCompleted(doc._id!, doc, {
      stage: JobStage.FULL_PARSED,
      source: JobSource.MANUAL,
    });
  }

  private async signal2cBrowserAuto(rawPayload: string, jobLifecycleId?: string): Promise<void> {
    const stage1Partial = jobLifecycleId ? await this.queryWithRetry(jobLifecycleId) : null;

    if (stage1Partial && (stage1Partial.status === JobStatus.QUEUED || stage1Partial.status === JobStatus.TRASHED)) {
      logger.warn('[STAGE2] signal2cBrowserAuto skipped — job already routed', {
        jobLifecycleId, status: stage1Partial.status,
      });
      return;
    }

    const s1Doc: Partial<JobLifecycleDocument> = {
      _id: jobLifecycleId || generateFallbackId(),
      raw: rawPayload,
      gmailMeta: stage1Partial?.gmailMeta,
      role: stage1Partial?.role || 'Unknown',
      company: stage1Partial?.company || 'Unknown',
      description: stage1Partial?.description || '',
      stage: JobStage.PARTIAL_PARSED,
      status: JobStatus.ENRICHING,
      source: JobSource.BROWSER_AUTO,
      updatedAt: new Date(),
      createdAt: stage1Partial?.createdAt || new Date(),
      stageTimestamp: new Date(),
    };

    await this.parsePort.emitGenerated(s1Doc, {
      stage: JobStage.PARTIAL_PARSED,
      source: JobSource.BROWSER_AUTO,
    });

    const parsed = this.htmlParser.parseJobFromHtml(rawPayload);
    if (!parsed) {
      await this.parsePort.emitFailed(jobLifecycleId || generateFallbackId(), {
        stage: JobStage.FULL_PARSED,
        source: JobSource.BROWSER_AUTO,
        error: 'HTML parse failed after browser extraction',
      });
      return;
    }

    const doc: Partial<JobLifecycleDocument> = {
      _id: jobLifecycleId || s1Doc._id,
      raw: rawPayload,
      gmailMeta: stage1Partial?.gmailMeta,
      role: this.getStringField(parsed.role) || stage1Partial?.role || 'Unknown',
      company: this.getStringField(parsed.company) || stage1Partial?.company || 'Unknown',
      description: this.getStringField(parsed.description) || stage1Partial?.description || '',
      salary: this.getStringField(parsed.salary) || stage1Partial?.salary || '',
      location: this.getStringField(parsed.location) || stage1Partial?.location || '',
      url: this.getStringField(parsed.url) || stage1Partial?.url || '',
      details: parsed.details || stage1Partial?.details,
      deadline: parsed.deadline || stage1Partial?.deadline,
      easyApply: parsed.easyApply ?? stage1Partial?.easyApply,
      stage: JobStage.FULL_PARSED,
      status: JobStatus.ENRICHED,
      source: JobSource.BROWSER_AUTO,
      updatedAt: new Date(),
      stageTimestamp: new Date(),
      createdAt: stage1Partial?.createdAt || new Date(),
    };

    await this.jobLifecycle.upsert(doc);
    await this.parsePort.emitCompleted(jobLifecycleId || s1Doc._id!, doc, {
      stage: JobStage.FULL_PARSED,
      source: JobSource.BROWSER_AUTO,
    });
  }

  private resolveJobLifeCycleId(messageId?: string, index?: number): string {
    return messageId ? `${messageId}-job-${index}` : generateFallbackId();
  }

  private getStringField(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
  }

  private async queryWithRetry(jobLifecycleId: string): Promise<JobLifecycleDocument | null> {
    const config = { maxRetries: 5, initialBackoffMs: 50, maxBackoffMs: 500 };
    for (let attempt = 0; attempt < config.maxRetries; attempt++) {
      try {
        const doc = await this.jobLifecycle.findById(jobLifecycleId);
        if (doc) return doc;
      } catch (e) {
        logger.warn('[Ingestor] job_lifecycle query failed', { jobLifecycleId, attempt, error: e });
      }
      if (attempt < config.maxRetries - 1) {
        await this.sleep(Math.min(config.initialBackoffMs * Math.pow(2, attempt), config.maxBackoffMs));
      }
    }
    return null;
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise((r) => setTimeout(r, ms));
  }
}
