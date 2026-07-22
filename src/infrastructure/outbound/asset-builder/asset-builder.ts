import type { Profile, Job } from '../../../domain/types/job.js';
import type { ApplicationAsset } from '../../../domain/types/profile-normalized.js';
import { toAsset, type ResolveOutput } from './adapter.js';
import { renderAts } from './md-renderer.js';
import { renderCoverLetter } from './cover-letter-renderer.js';
import { renderPdf } from './pdf-renderer.js';

export interface BuildResult {
  atsPath?: string;
  coverLetterPath?: string;
  pdfPath?: string;
}

export class AssetBuilder {
  async build(profile: Profile, resolved: ResolveOutput, job: Job): Promise<BuildResult> {
    const asset = toAsset(resolved, profile, job);
    return this.buildFromAsset(asset);
  }

  async buildFromAsset(asset: ApplicationAsset): Promise<BuildResult> {
    const result: BuildResult = {};
    const outputDir = `generated/${asset.jobId || Date.now()}`;

    result.atsPath = renderAts(asset, outputDir);
    result.coverLetterPath = renderCoverLetter(asset, outputDir);
    result.pdfPath = await renderPdf(asset, outputDir);

    return result;
  }
}
