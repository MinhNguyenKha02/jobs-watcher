import type { ProfileSource } from '../../domain/profile/source/source.types.js';
import { ResolveOutput } from '../../domain/profile/types/resolve.types.js';

export type { ProfileSource };

export interface BuildResult {
  pdfPath?: string;
}

export interface AssetProducingPort {
  toAsset(
    resolved: ResolveOutput,
    outputDir?: string,
    meta?: { jobId: string; role?: string; company?: string; location?: string }
  ): Promise<BuildResult>;
}
