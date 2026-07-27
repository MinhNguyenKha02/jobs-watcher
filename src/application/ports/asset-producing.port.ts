import { ResolveOutput } from '../../domain/profile/types/resolve.types.js';

export interface BuildResult {
  pdfPath?: string;
}

export interface AssetProducingPort {
  toAsset(resolved: ResolveOutput, outputDir?: string): Promise<BuildResult>;
}
