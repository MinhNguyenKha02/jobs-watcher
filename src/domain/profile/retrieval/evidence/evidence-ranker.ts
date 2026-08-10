// src/services/profile/retrieval/evidence/evidence-ranker.ts

import { EvidenceFeaturesExtractor } from './evidence-feature-extractor.js';
import { evidenceRankingPolicy } from './evidence-ranking-policy.js';
import { EvidenceNode } from '../../types/retrieval.types.js';

/**
 * Ranks an evidence node by computing a score based on its features.
 */
export class EvidenceRanker {
  /**
   * Computes a score for a single evidence node.
   * @param evidence The evidence node to score.
   * @returns A score between 0 and 1 (or higher, depending on the weights and feature values).
   */
  static scoreEvidence(evidence: EvidenceNode): number {
    const features = EvidenceFeaturesExtractor.extract(evidence);
    let score =
      features.operationalScore * evidenceRankingPolicy.operationalWeight +
      features.architectureScore * evidenceRankingPolicy.architectureWeight +
      features.ownershipScore * evidenceRankingPolicy.ownershipWeight +
      features.quantifiedScore * evidenceRankingPolicy.quantifiedWeight;
    // Ensure the score is non-negative.
    return Math.max(0, score);
  }
}
