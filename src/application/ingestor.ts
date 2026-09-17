import { hybridJobFilter } from '../domain/filter/job-filter.js';
import { ProfileInfoRetriever } from '../domain/profile/index.js';
import { JobsExtractor } from '../domain/services/extractor/jobs-extractor.js';
import { LinkedInJobExtractor } from '../domain/services/extractor/linkedin-job-extractor.js';
import { flattenJob } from '../domain/services/flatten-job.js';
import { htmlToText } from '../domain/services/html-to-text.js';
import {
  JobStage,
  JobStatus,
  JobSource,
  type JobLifecycleDocument,
} from '../domain/types/job-lifecycle.js';
import type { Job } from '../domain/types/job.js';

import type { AssetProducingPort } from './ports/asset-producing.port.js';
import type { ExtractionQueuePort } from './ports/extraction-queue.port.js';
import type { IngestorPort, IngestMetadata } from './ports/inbound/ingestor.port.js';
import type { JobLifecyclePort } from './ports/job-lifecycle.port.js';
import type { LoggerPort } from './ports/logger.port.js';
import type { DaemonMetricsPort } from './ports/metrics.port.js';
import type { ParsePort } from './ports/parse.port.js';
import type { RoutePort } from './ports/route.port.js';

function generateFallbackId(prefix = 'unk'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

export class JobIngestor implements IngestorPort {
  private linkedInExtractor = new LinkedInJobExtractor();

  constructor(
    private jobLifecycleColPort: JobLifecyclePort,
    private parsePublishingPort: ParsePort,
    private routePublishingPort: RoutePort,
    private extractionQueueColPort: ExtractionQueuePort,
    private assetProducingPort: AssetProducingPort,
    private metricsRegistry: DaemonMetricsPort,
    private logger: LoggerPort,
  ) {}

  async processIngest(
    source: JobSource,
    stage: JobStage,
    rawPayload: string,
    jobLifecycleId?: string,
    metadata?: IngestMetadata,
    _receivedAt?: Date
  ): Promise<void> {
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

  async processResolution(jobLifecycleId: string, action: 'queue' | 'trash'): Promise<void> {
    if (!jobLifecycleId || !action) return;

    try {
      const existing = await this.queryWithRetry(jobLifecycleId);
      if (!existing) {
        this.logger.warn('Resolution action failed — no existing job lifecycle found', {
          jobLifecycleId,
          action,
        });
        this.metricsRegistry?.jobErrors.inc({
          stage: 's2',
          error_type: 'missing_job_during_routing',
        });
        await this.routePublishingPort.emitRouteFailed(
          jobLifecycleId,
          'No existing job lifecycle found'
        );
        return;
      }
      if (action === 'queue') {
        if (existing && existing.status !== JobStatus.ENRICHED) {
          this.logger.warn('[j] guard: rejecting queue action — job not ENRICHED', {
            jobLifecycleId: existing._id,
            status: existing.status,
          });
          return;
        }
        await this.jobLifecycleColPort.updateStage(
          existing._id,
          JobStage.FULL_PARSED,
          JobStatus.QUEUED
        );
        this.metricsRegistry?.jobStageTotal.inc({ stage: 's3', status: 'queued', source: String(existing.source ?? 'unknown') });
        if (existing?.stageTimestamp) {
          const durationSec = (Date.now() - new Date(existing.stageTimestamp).getTime()) / 1000;
          this.metricsRegistry?.jobStageDuration.observe({ stage: 's2_s3' }, durationSec);
        }
        await this.routePublishingPort.emitJobQueued(existing._id, { source: JobSource.MANUAL });
        if (this.assetProducingPort && existing) {
          const flattened = flattenJob(existing);
          const retriever = new ProfileInfoRetriever();
          await retriever.init();
          const retrieval = retriever.retrieve(flattened);
          const resolved = retriever.resolve(retrieval);
          this.assetProducingPort
            .toAsset(resolved, undefined, {
              jobId: String(existing._id),
              role: existing.role,
              company: existing.company,
              location: existing.location,
            })
            .catch((err: unknown) => {
              this.logger.warn('Asset generation failed', {
                jobLifecycleId: existing._id,
                error: err instanceof Error ? err.message : String(err),
              });
            });
        }
      } else if (action === 'trash') {
        if (
          existing &&
          (existing.status === JobStatus.QUEUED || existing.status === JobStatus.TRASHED)
        ) {
          this.logger.warn('[d] guard: rejecting trash action — job already routed (terminal state)', {
            jobLifecycleId: existing._id,
            status: existing.status,
          });
          return;
        }
        await this.jobLifecycleColPort.updateStage(
          existing._id,
          JobStage.FULL_PARSED,
          JobStatus.TRASHED
        );
        this.metricsRegistry?.jobStageTotal.inc({ stage: 's3', status: 'trashed', source: String(existing.source ?? 'unknown') });
        await this.routePublishingPort.emitJobTrashed(existing._id, 'operator:trash');
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.warn('Resolution action failed', { jobLifecycleId, action, reason });
      this.metricsRegistry?.jobErrors.inc({ stage: 'resolution', error_type: action || 'unknown' });
      await this.routePublishingPort.emitRouteFailed(jobLifecycleId, reason);
    }
  }

  private async signal1BrowserAutoXorManual(
    rawPayload: string,
    metadata?: IngestMetadata
  ): Promise<void> {
    const jobExtractor = new JobsExtractor();
    let extractedJobs: Partial<Job>[] = [];
    try {
      extractedJobs = jobExtractor.extractAllJobs(rawPayload);
    } catch (e) {
      this.logger.warn('Job extraction failed (stage1)', { error: e });
      this.metricsRegistry?.jobErrors.inc({ stage: 's1', error_type: 'extraction' });
      await this.parsePublishingPort.emitFailed(metadata?.messageId || 'unknown', {
        stage: JobStage.PARTIAL_PARSED,
        source: JobSource.BROWSER_AUTO,
        error: e instanceof Error ? e.message : String(e),
      });
      return;
    }

    if (extractedJobs.length === 0) {
      this.logger.warn('No jobs extracted from payload', {
        messageId: metadata?.messageId || 'unknown',
      });
      this.metricsRegistry?.jobErrors.inc({ stage: 's1', error_type: 'no_jobs_extracted' });
      return;
    }

    for (let idx = 0; idx < extractedJobs.length; idx++) {
      const extracted = extractedJobs[idx];
      const jobLifeCycleId = this.resolveJobLifeCycleId(metadata?.messageId || 'unknown', idx);

      const role = this.getStringField(extracted.role) || '';
      const company = this.getStringField(extracted.company) || '';
      const url = this.getStringField(extracted.url) || '';

      // Real Indeed alerts carry rc/clk redirect urls (100% of gmailmeta corpus);
      // legacy table emails carry applystart/viewjob — both enqueue for browser s2c.
      const hasUrl = /indeed\.com\/(?:applystart|viewjob)\?|indeed\.com\/rc\/clk\//i.test(url);

      const job: Job = {
        _id: jobLifeCycleId,
        company,
        role,
        location: this.getStringField(extracted.location) || '',
        description: this.getStringField(extracted.description) || '',
        salary: this.getStringField(extracted.salary) || '',
        url,
        deadline: extracted.deadline || undefined,
        easyApply: extracted.easyApply || undefined,
      };
      const doc: JobLifecycleDocument = {
        ...job,
        raw: '',
        gmailMeta: metadata
          ? {
              messageId: metadata.messageId || `msg-${Date.now()}`,
              body: rawPayload,
              threadId: metadata.threadId,
              from: metadata.from,
              to: metadata.to,
              subject: metadata.subject,
            }
          : undefined,
        stage: JobStage.PARTIAL_PARSED,
        status: JobStatus.ENRICHING,
        source: JobSource.BROWSER_AUTO,
        createdAt: new Date(),
        updatedAt: new Date(),
        stageTimestamp: new Date(),
      };

      const filterResult = hybridJobFilter(doc);
      if (!filterResult.passed) {
        // T1 reject stays daemon-side only: log + continue, no RMQ emit,
        // so TUI s3s4 is never polluted by tier-filtered s1 jobs.
        this.logger.info('Filter rejected job', {
          jobLifeCycleId,
          role,
          company,
          reasons: filterResult.reasons,
        });
        this.metricsRegistry?.jobFilterRejectTotal?.inc({
          source: String(doc.source ?? 'unknown'),
          stage: 's1',
        });
        continue;
      }

      try {
        await this.jobLifecycleColPort.upsert(doc);
      } catch (e: unknown) {
        if ((e as { code?: unknown })?.code === 11000) {
          this.logger.info('Duplicate role+company — skipping', { jobLifeCycleId, role, company });
          await this.routePublishingPort.emitJobTrashed(
            jobLifeCycleId,
            `Duplicate: ${role}/${company}`
          );
          continue;
        }
        throw e;
      }

      this.metricsRegistry?.jobsBrokered.inc({ source: JobSource.BROWSER_AUTO });
      this.metricsRegistry?.jobStageTotal.inc({ stage: 's1', status: 'enriching' });

      if (hasUrl && this.extractionQueueColPort) {
        this.logger.info('Job has url — enqueuing to extraction queue', {
          jobLifeCycleId,
          role,
          company,
          url,
        });
        await this.extractionQueueColPort.enqueue(jobLifeCycleId);
      } else {
        this.logger.info('Job has no url — emitting generated only', { jobLifeCycleId, role, company });
        await this.parsePublishingPort.emitGenerated(job, {
          stage: JobStage.PARTIAL_PARSED,
          source: JobSource.BROWSER_AUTO,
          status: doc.status,
        });
      }
    }
  }

  private async signal1BrowserAutoFallback(jobLifecycleId: string): Promise<void> {
    const existing = await this.queryWithRetry(jobLifecycleId);
    if (!existing) {
      this.logger.error('signal1BrowserAutoFallback — no existing job lifecycle found', {
        jobLifecycleId,
      });
      this.metricsRegistry?.jobErrors.inc({ stage: 's1', error_type: 'missing_job' });
      return;
    }
    const job: Job = {
      _id: existing._id,
      company: existing.company,
      role: existing.role,
      location: existing.location,
      description: existing.description,
      details: existing.details,
      salary: existing.salary,
      url: existing.url,
      deadline: existing.deadline,
      easyApply: existing.easyApply,
    };
    await this.parsePublishingPort.emitGenerated(job, {
      stage: JobStage.PARTIAL_PARSED,
      source: JobSource.BROWSER_AUTO,
      status: existing.status,
    });
  }

  private async signal2aManual(rawPayload: string, jobLifecycleId?: string): Promise<void> {
    if (!rawPayload.trim()) {
      this.metricsRegistry?.jobErrors.inc({ stage: 's2', error_type: 'empty_payload' });
      await this.parsePublishingPort.emitFailed(jobLifecycleId || generateFallbackId(), {
        stage: JobStage.FULL_PARSED,
        source: JobSource.MANUAL,
        error: 'Empty HTML payload',
      });
      return;
    }

    if (!jobLifecycleId) {
      this.logger.warn('Missing jobLifecycleId for manual signal2a — data loss prevented');
      this.metricsRegistry?.jobErrors.inc({ stage: 's2', error_type: 'missing_job_lifecycle_id' });
      return;
    }

    const stage1Partial = await this.queryWithRetry(jobLifecycleId);
    if (
      stage1Partial &&
      (stage1Partial.status === JobStatus.QUEUED ||
        stage1Partial.status === JobStatus.TRASHED ||
        stage1Partial.status === JobStatus.ENRICHED)
    ) {
      this.logger.warn('S2 enrichment skipped — job already routed or fully parsed', {
        jobLifecycleId,
        status: stage1Partial.status,
      });
      return;
    }

    if (!stage1Partial) {
      this.logger.warn('S2 enrichment skipped — no stage-1 job lifecycle found', { jobLifecycleId });
      this.metricsRegistry?.jobErrors.inc({ stage: 's2', error_type: 'missing_job' });
      return;
    }

    const doc: JobLifecycleDocument = {
      ...stage1Partial,
      _id: jobLifecycleId,
      details: htmlToText(rawPayload),
      raw: rawPayload,
      stage: JobStage.FULL_PARSED,
      status: JobStatus.ENRICHED,
      source: JobSource.MANUAL,
      updatedAt: new Date(),
      stageTimestamp: new Date(),
    };

    await this.jobLifecycleColPort.upsert(doc);
    this.metricsRegistry?.jobStageTotal.inc({ stage: 's2', status: 'enriched' });
    if (stage1Partial?.stageTimestamp) {
      const durationSec = (Date.now() - new Date(stage1Partial.stageTimestamp).getTime()) / 1000;
      this.metricsRegistry?.jobStageDuration.observe({ stage: 's1_s2' }, durationSec);
    }
    const job: Job = {
      _id: doc._id,
      company: doc.company,
      role: doc.role,
      location: doc.location,
      description: doc.description,
      details: doc.details,
      salary: doc.salary,
      url: doc.url,
      deadline: doc.deadline,
      easyApply: doc.easyApply,
    };
    await this.parsePublishingPort.emitCompleted(job, {
      stage: JobStage.FULL_PARSED,
      source: JobSource.MANUAL,
      status: doc.status,
    });
  }

  private async signal2bManual(rawPayload: string): Promise<void> {
    const extracted = this.linkedInExtractor.extract(rawPayload);
    if (!extracted) {
      this.metricsRegistry?.jobErrors.inc({ stage: 's2', error_type: 'parse_failed' });
      await this.parsePublishingPort.emitFailed(generateFallbackId('clip'), {
        stage: JobStage.FULL_PARSED,
        source: JobSource.MANUAL,
        error: 'HTML parse failed',
      });
      return;
    }

    const job: Job = {
      _id: generateFallbackId('clip'),
      company: this.getStringField(extracted.company) || 'Unknown',
      role: this.getStringField(extracted.role) || 'Unknown',
      location: this.getStringField(extracted.location) || '',
      description: '',
      details: extracted.details,
      salary: this.getStringField(extracted.salary) || '',
      url: this.getStringField(extracted.url) || '',
      deadline: extracted.deadline || undefined,
      easyApply: extracted.easyApply || undefined,
    };
    const doc: JobLifecycleDocument = {
      ...job,
      raw: rawPayload,
      stage: JobStage.FULL_PARSED,
      status: JobStatus.ENRICHED,
      source: JobSource.MANUAL,
      createdAt: new Date(),
      updatedAt: new Date(),
      stageTimestamp: new Date(),
    };

    try {
      await this.jobLifecycleColPort.upsert(doc);
    } catch (e: unknown) {
      if ((e as { code?: unknown })?.code === 11000) {
        this.logger.warn('Duplicate role+company — skipping', {
          role: doc.role,
          company: doc.company,
        });
        return;
      }
      throw e;
    }

    this.metricsRegistry?.jobsBrokered.inc({ source: JobSource.MANUAL });
    this.metricsRegistry?.jobStageTotal.inc({ stage: 's2', status: 'enriched' });
    await this.parsePublishingPort.emitCompleted(job, {
      stage: JobStage.FULL_PARSED,
      source: JobSource.MANUAL,
      status: doc.status,
    });
  }

  private async signal2cBrowserAuto(rawPayload: string, jobLifecycleId?: string): Promise<void> {
    const stage1Partial = jobLifecycleId ? await this.queryWithRetry(jobLifecycleId) : null;

    if (
      stage1Partial &&
      (stage1Partial.status === JobStatus.QUEUED || stage1Partial.status === JobStatus.TRASHED)
    ) {
      this.logger.warn('signal2cBrowserAuto skipped — job already routed', {
        jobLifecycleId,
        status: stage1Partial.status,
      });
      return;
    }

    // found(id) precondition: without a stage-1 doc there is nothing to enrich.
    if (!stage1Partial) {
      this.logger.warn('signal2cBrowserAuto skipped — no stage-1 job lifecycle found', {
        jobLifecycleId,
      });
      this.metricsRegistry?.jobErrors.inc({ stage: 's2', error_type: 'missing_job' });
      return;
    }

    const s1Doc: JobLifecycleDocument = {
      ...stage1Partial,
      updatedAt: new Date(),
      stageTimestamp: new Date(),
    };

    const s1Job: Job = {
      _id: s1Doc._id,
      company: s1Doc.company,
      role: s1Doc.role,
      location: s1Doc.location,
      description: s1Doc.description,
      details: s1Doc.details,
      salary: s1Doc.salary,
      url: s1Doc.url,
      deadline: s1Doc.deadline,
      easyApply: s1Doc.easyApply,
    };
    await this.parsePublishingPort.emitGenerated(s1Job, {
      stage: JobStage.PARTIAL_PARSED,
      source: JobSource.BROWSER_AUTO,
      status: s1Doc.status,
    });

    const doc: JobLifecycleDocument = {
      ...(stage1Partial || {}),
      _id: jobLifecycleId || s1Doc._id || generateFallbackId('browser-auto'),
      raw: rawPayload,
      gmailMeta: stage1Partial?.gmailMeta,
      role: stage1Partial?.role || 'Unknown',
      company: stage1Partial?.company || 'Unknown',
      description: stage1Partial?.description || '',
      salary: stage1Partial?.salary || '',
      location: stage1Partial?.location || '',
      url: stage1Partial?.url || '',
      details: htmlToText(rawPayload),
      deadline: stage1Partial?.deadline,
      easyApply: stage1Partial?.easyApply,
      stage: JobStage.FULL_PARSED,
      status: JobStatus.ENRICHED,
      source: JobSource.BROWSER_AUTO,
      updatedAt: new Date(),
      stageTimestamp: new Date(),
      createdAt: stage1Partial?.createdAt || new Date(),
    };

    const passed = hybridJobFilter(doc, { sinceTier: 2 });

    if (!passed.passed) {
      this.logger.info('Filter rejected job at stage 2', { jobLifecycleId, reasons: passed.reasons });
      this.metricsRegistry?.jobErrors.inc({ stage: 's2', error_type: 'filter_rejected' });
      this.metricsRegistry?.jobFilterRejectTotal?.inc({
        source: String(doc.source ?? 'unknown'),
        stage: 's2',
      });
      // T2 reject persists terminal status on the s1 doc (was stale enriching),
      // then still emits trash so TUI drains it via s34.
      await this.jobLifecycleColPort.upsert({
        _id: jobLifecycleId || s1Doc._id!,
        status: JobStatus.TRASHED,
        updatedAt: new Date(),
        stageTimestamp: new Date(),
      });
      await this.routePublishingPort.emitJobTrashed(
        jobLifecycleId || s1Doc._id!,
        `Filter rejected at stage 2: ${passed.reasons.join('; ')}`
      );
      return;
    }

    await this.jobLifecycleColPort.upsert(doc);
    this.metricsRegistry?.jobStageTotal.inc({ stage: 's2', status: 'enriched' });
    if (stage1Partial?.stageTimestamp) {
      const durationSec = (Date.now() - new Date(stage1Partial.stageTimestamp).getTime()) / 1000;
      this.metricsRegistry?.jobStageDuration.observe({ stage: 's1_s2' }, durationSec);
    }
    const job: Job = {
      _id: doc._id,
      company: doc.company,
      role: doc.role,
      location: doc.location,
      description: doc.description,
      details: doc.details,
      salary: doc.salary,
      url: doc.url,
      deadline: doc.deadline,
      easyApply: doc.easyApply,
    };
    await this.parsePublishingPort.emitCompleted(job, {
      stage: JobStage.FULL_PARSED,
      source: JobSource.BROWSER_AUTO,
      status: doc.status,
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
        const doc = await this.jobLifecycleColPort.findById(jobLifecycleId);
        if (doc) return doc;
      } catch (e) {
        this.logger.warn('job_lifecycle query failed', { jobLifecycleId, attempt, error: e });
      }
      if (attempt < config.maxRetries - 1) {
        await this.sleep(
          Math.min(config.initialBackoffMs * Math.pow(2, attempt), config.maxBackoffMs)
        );
      }
    }
    return null;
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise((r) => setTimeout(r, ms));
  }
}
