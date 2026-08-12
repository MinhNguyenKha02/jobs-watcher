import { HydratedArtifactBundle } from '../artifacts/types/artifact.types.js';

import { RetrievalOutput } from './contracts/retrieval.types.js';
import { EvidenceResolver } from './evidence-resolver.js';
import { ExpansionResolver } from './expansion-resolver.js';
import { NormalizationPipeline } from './normalization.pipeline.js';

export class ProfileRetrievalEngine {
  private readonly normalizer = new NormalizationPipeline();

  constructor(private readonly artifacts: HydratedArtifactBundle) {}

  private detectLanguage(text: string): 'en' | 'vi' {
    return /[\u0102\u0103\u0110\u0111\u01A0\u01A1\u01AF\u01B0\u1EA0-\u1EF9]/.test(text)
      ? 'vi'
      : 'en';
  }

  retrieve(jobText: string): RetrievalOutput {
    const normalized = this.normalizer.prepare(jobText);

    const lang = this.detectLanguage(jobText);

    const direct = this.artifacts.aho[lang].traverse(normalized);

    const expanded = new ExpansionResolver().expand(
      direct,

      this.artifacts.adjacency
    );

    const evidences = new EvidenceResolver(
      this.artifacts.evidences,
      this.artifacts.anchorToEvidence
    ).resolve(expanded);

    return {
      direct,
      expanded,
      evidences,
    };
  }
}
