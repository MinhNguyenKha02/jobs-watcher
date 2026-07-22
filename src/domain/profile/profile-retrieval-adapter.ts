import fs from 'node:fs';
import { flattenJob } from '../../infrastructure/outbound/flatten-job.js';
import { bootstrapRetrieval } from './retrieval/retrieval-engine.js';
import { ResumeResolver } from './resume/resolve/resume-resolver.js';
import { ArtifactRegistry } from './artifacts/loaders/artifact-cache.js';
import { buildArtifacts } from './artifacts/builders/artifact.builder.js';
import { ARTIFACT_OUTPUT_DIR } from './artifacts/constants/artifact.constants.js';
import { toAsset } from '../../infrastructure/outbound/asset-builder/adapter.js';
import { renderPdf } from '../../infrastructure/outbound/asset-builder/pdf-renderer.js';
import { profileSource } from './source/profile.source.js';
import type { ProfileRetrievalPort } from '../../application/ports/profile-retrieval.port.js';
import type { JobLifecycleDocument } from '../types/job-lifecycle.js';
import type { ProfileRetrievalEngine } from './retrieval/profile-retrieval-engine.js';
import type { HydratedArtifactBundle } from './artifacts/types/artifact.types.js';

export class ProfileRetrievalAdapter implements ProfileRetrievalPort {
  private engine: ProfileRetrievalEngine | null = null;
  private artifacts: HydratedArtifactBundle | null = null;
  private resolver: ResumeResolver | null = null;

  constructor(private outputDir: string) {}

  async retrieve(job: JobLifecycleDocument): Promise<string> {
    if (!this.engine || !this.artifacts || !this.resolver) {
      await this.initialize();
    }

    const jobText = flattenJob(job);
    const retrieval = this.engine!.retrieve(jobText);
    const resolved = this.resolver!.resolve(retrieval, this.artifacts!, job._id);

    const identity = {
      name: profileSource.name,
      email: profileSource.email,
      phone: profileSource.phone || '',
      location: profileSource.location || '',
      title: '',
      summary: '',
      skills: [],
      experience: [],
      education: (profileSource.education || []).map(e => ({
        institution: e.institution,
        degree: e.degree,
        field: '',
        startDate: e.startDate,
        endDate: e.endDate || '',
        grade: e.grade,
      })),
      links: profileSource.links || {},
    };

    const asset = toAsset(resolved, identity, job);
    const pdfPath = await renderPdf(asset, this.outputDir);

    return pdfPath;
  }

  private async initialize(): Promise<void> {
    if (!fs.existsSync(ARTIFACT_OUTPUT_DIR)) {
      await buildArtifacts();
    }
    ArtifactRegistry.clearCache();
    this.engine = await bootstrapRetrieval();
    this.artifacts = await ArtifactRegistry.getInstance().getArtifacts();
    this.resolver = new ResumeResolver();
  }
}
