// src/services/profile/retrieval/ranking/retrieval-ranker.ts

import { MatchSignal, EvidenceNode } from '../../types/retrieval.types.js';
import { RankingFeatures, RankingFeaturesExtractor } from './ranking-features.js';
import { rankingPolicy } from './ranking-policy.js';
import { classifyResolutionStrength } from '../resolution/resolution-strength.js';
import { ResolutionStrength } from '../../types/retrieval.types.js';
import { retrievalPolicy } from '../policies/retrieval.policy.js';

/**
 * Represents a signal after ranking, with a final score and resolution strength.
 */
export interface RankedSignal {
  signal: MatchSignal;
  finalScore: number;
  resolutionStrength: ResolutionStrength;
}

/**
 * RetrievalRanker centralizes the ranking of match signals.
 * It computes a final score based on various features and classifies resolution strength.
 */
export class RetrievalRanker {
  private readonly featuresExtractor = new RankingFeaturesExtractor();
  private readonly rankingPolicy = rankingPolicy;
  private readonly retrievalPolicy = retrievalPolicy;

  /**
   * Ranks a match signal by computing a final score and determining resolution strength.
   * 
   * @param signal The match signal to rank.
   * @param directSignals Map of direct (lexical) signals for reference.
   * @param expandedSignals Map of expanded (after propagation) signals for reference.
   * @param evidences Map of evidence ID to evidence node for computing evidence score.
   * @returns The ranked signal with final score and resolution strength.
   */
  rank(signal: MatchSignal, directSignals: Map<string, MatchSignal>, expandedSignals: Map<string, MatchSignal>, evidences: Map<string, EvidenceNode>): RankedSignal {
    // Extract features from the signal using the direct and expanded signals and evidences.
    const features = RankingFeaturesExtractor.extract(signal, directSignals, expandedSignals, evidences);

    // Compute the weighted sum.
    let finalScore = 
      features.lexicalScore * this.rankingPolicy.lexicalWeight +
      features.propagationScore * this.rankingPolicy.propagationWeight +
      features.evidenceScore * this.rankingPolicy.evidenceWeight +
      features.sourceDiversity * this.rankingPolicy.sourceDiversityWeight +
      features.occurrenceScore * this.rankingPolicy.occurrenceWeight +
      features.adjacencyConfidence * this.rankingPolicy.adjacencyConfidenceWeight +
      features.atsVisibilityWeight * this.rankingPolicy.atsVisibilityWeight;

    // We might want to normalize the score to [0, 1] if needed, but we'll leave it as is for now.
    // We'll just make sure it doesn't go below 0.
    finalScore = Math.max(0, finalScore);

     // Classify resolution strength using the retrieval policy thresholds.
     const resolutionStrength = classifyResolutionStrength(finalScore, signal, this.retrievalPolicy);

    return {
      signal,
      finalScore,
      resolutionStrength
    };
  }
}