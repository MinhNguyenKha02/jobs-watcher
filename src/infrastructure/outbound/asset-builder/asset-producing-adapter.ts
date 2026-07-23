import path from 'node:path';
import { createLogger } from '../logging/logger.js';
import type { AssetProducingPort } from '../../../application/ports/asset-producing.port.js';
import type { JobLifecycleDocument } from '../persistence/schemas.js';
import { renderPdf } from './pdf-renderer.js';

const logger = createLogger('AssetProducer');

export class AssetProducingAdapter implements AssetProducingPort {
  private outputDir: string;

  constructor(outputDir?: string) {
    this.outputDir = outputDir || '/tmp/assets';
  }

  async toAsset(job: Partial<JobLifecycleDocument>): Promise<string> {
    const id = job._id || 'unknown';
    const company = job.company || 'Unknown';
    const role = job.role || 'Unknown';

    const asset = {
      jobId: id,
      jobTitle: role,
      company,
      sections: [],
      matchedSkills: [],
      skillGroups: [],
      skillGaps: [],
      relevanceScore: 0,
      evidenceMappings: [],
      draftedAt: new Date().toISOString(),
      profileHash: '',
      experience: [],
      education: [],
      projects: [],
      firstName: '',
      lastName: '',
      email: '',
      phone: '',
      location: '',
      linkedin: '',
      github: '',
    };

    const pdfPath = await renderPdf(asset, this.outputDir, { format: 'A4' });
    logger.info('Generated PDF asset', { id, pdfPath });
    return pdfPath;
  }
}
