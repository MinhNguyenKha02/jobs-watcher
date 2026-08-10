export type * from '../types/asset.js';

import fs from 'node:fs';
import { bootstrapRetrieval } from '../../../src/domain/profile/retrieval/retrieval-engine.js';
import { ResumeResolver } from '../../../src/domain/profile/resume/resolve/resume-resolver.js';
import { ArtifactRegistry } from '../../../src/domain/profile/artifacts/loaders/artifact-cache.js';
import { buildArtifacts } from '../../../src/domain/profile/artifacts/builders/artifact.builder.js';
import { ARTIFACT_OUTPUT_DIR } from '../../../src/domain/profile/artifacts/constants/artifact.constants.js';
import type { ProfileRetrievalEngine } from '../../../src/domain/profile/retrieval/profile-retrieval-engine.js';
import type { HydratedArtifactBundle } from '../../../src/domain/profile/artifacts/types/artifact.types.js';
import type { RetrievalOutput } from '../../../src/domain/profile/retrieval/contracts/retrieval.types.js';
import {
  captureDebug,
  type DebugSnapshot,
} from '../../../src/domain/profile/retrieval/retrieval-debugger.js';
import { ResolveOutput } from './types/resolve.types.js';

export class ProfileInfoRetriever {
  private engine: ProfileRetrievalEngine | null = null;
  private artifacts: HydratedArtifactBundle | null = null;
  private resolver: ResumeResolver | null = null;

  constructor() {}

  async init(): Promise<void> {
    // Auto-generate artifacts if the output directory doesn't exist
    if (!fs.existsSync(ARTIFACT_OUTPUT_DIR)) {
      console.log('Generating artifacts (output directory not found)...');
      await buildArtifacts();
    }
    ArtifactRegistry.clearCache();
    this.engine = await bootstrapRetrieval();
    this.artifacts = await ArtifactRegistry.getInstance().getArtifacts();
    this.resolver = new ResumeResolver();
  }

  ensureInitialized(): void {
    if (!this.engine || !this.artifacts || !this.resolver) {
      throw new Error('ProfileInfoRetriever not initialized. Call init() first.');
    }
  }

  retrieve(jobText: string): RetrievalOutput {
    this.ensureInitialized();
    return this.engine!.retrieve(jobText);
  }

  resolve(retrieval: RetrievalOutput): ResolveOutput {
    this.ensureInitialized();
    return this.resolver!.resolve(retrieval, this.artifacts!);
  }
}
