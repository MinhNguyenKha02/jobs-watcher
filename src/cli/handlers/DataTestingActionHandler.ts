import type { JobActionHandler } from '../../application/job-processor.js';
import { getLogger } from '../../services/logger.js';
import { EnrichedStorage, type EnrichedJobRecord } from '../../services/storage/enriched-storage.js';
import type { Job } from '../../types.js';
import type { DataTestingAction, DataTestingPayload } from '../presenters/DataTestingJobPresenter.js';

const logger = getLogger();

export class DataTestingActionHandler implements JobActionHandler<DataTestingAction, DataTestingPayload> {
  constructor(private enrichedStorage: EnrichedStorage) {}

  async handle(job: Job, action: DataTestingAction, payload?: DataTestingPayload): Promise<void> {
    if (action !== 'paste' || !payload?.pastedHtml || !payload.enrichedJob) {
      return;
    }

    try {
      const originalJob = payload.originalJob || job;
      const fieldsChanged: string[] = [];
      if (payload.enrichedJob.position !== originalJob.position) fieldsChanged.push('position');
      if (payload.enrichedJob.company !== originalJob.company) fieldsChanged.push('company');
      if (payload.enrichedJob.location !== originalJob.location) fieldsChanged.push('location');
      if ((payload.enrichedJob.description || '') !== (originalJob.description || '')) fieldsChanged.push('description');
      if (payload.enrichedJob.details && payload.enrichedJob.details !== originalJob.details) fieldsChanged.push('details');

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
          position: payload.enrichedJob.position,
          company: payload.enrichedJob.company,
          location: payload.enrichedJob.location,
          description: payload.enrichedJob.description || '',
          details: payload.enrichedJob.details,
          matchScore: payload.enrichedJob.matchScore || 0,
          fieldsChanged,
        },
        htmlInput: payload.pastedHtml,
      };

      const saved = await this.enrichedStorage.saveEnrichedJob(enrichedRecord);
      logger.info(`   ✅ Enriched job saved to database at:\n       ${saved.dirPath}\n`);
    } catch (error) {
      logger.error(
        `   ❌ Failed to save enriched job: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}
