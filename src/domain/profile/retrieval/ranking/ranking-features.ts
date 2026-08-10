// src/services/profile/retrieval/ranking/ranking-features.ts

import { MatchSignal, EvidenceNode } from '../../types/retrieval.types.js';
import { EvidenceRanker } from '../evidence/evidence-ranker.js';

/**
 * Features used for ranking a match signal.
 */
export interface RankingFeatures {
  lexicalScore: number;
  propagationScore: number;
  evidenceScore: number;
  sourceDiversity: number;
  occurrenceScore: number;
  adjacencyConfidence: number;
  atsVisibilityWeight: number;
}

/**
 * Extracts ranking features from a match signal using direct and expanded signals.
 */
export class RankingFeaturesExtractor {
  /**
   * Extracts features from a match signal.
   * @param signal The match signal to extract features from.
   * @param directSignals Map of direct (lexical) signals for reference.
   * @param expandedSignals Map of expanded (after propagation) signals for reference.
   * @param evidences Map of evidence ID to evidence node for computing evidence score.
   * @returns The ranking features.
   */
  static extract(
    signal: MatchSignal,
    directSignals: Map<string, MatchSignal>,
    expandedSignals: Map<string, MatchSignal>,
    evidences: Map<string, EvidenceNode>
  ): RankingFeatures {
    // 1. Lexical score: from the direct signal (if exists) or 0 if not.
    const directSignal = directSignals.get(signal.anchorId);
    let lexicalScore = directSignal ? directSignal.score : 0;

    // 2. Propagation score: the difference between expanded and direct (if both exist), otherwise 0.
    const expandedSignal = expandedSignals.get(signal.anchorId);
    let propagationScore = 0;
    if (expandedSignal && directSignal) {
      propagationScore = expandedSignal.score - directSignal.score;
    } else if (expandedSignal && !directSignal) {
      // The signal is only in expanded, so we consider it as propagation score.
      propagationScore = expandedSignal.score;
      lexicalScore = 0; // If there's no direct signal, then the entire expanded score is from propagation.
    }
    // If there is no expanded signal, then propagationScore remains 0.

    // 3. Evidence score: compute the maximum evidence base score from the evidence nodes linked to this signal.
    let evidenceScore = 0;
    for (const evidenceId of signal.evidenceIds) {
      const evidence = evidences.get(evidenceId);
      if (evidence) {
        const evidenceBaseScore = EvidenceRanker.scoreEvidence(evidence);
        if (evidenceBaseScore > evidenceScore) {
          evidenceScore = evidenceBaseScore;
        }
      }
    }

    // 4. Source diversity: number of unique sources in the signal's sources set.
    const sourceDiversity = signal.sources.size;

    // 5. Occurrence score: number of occurrences (signal.occurrences) but we might want to normalize.
    // We'll use the raw occurrence count and then maybe apply a saturation function in the weighting.
    // For now, we'll use the raw count.
    const occurrenceScore = signal.occurrences;

    // 6. Adjacency confidence: we can use the average weight of the adjacency edges?
    // But we don't have the adjacency map in the signal. We would need to pass it in.
    // Since we don't have it, we'll set to 0 for now and note that we need the adjacency map.
    // However, note that the signal does not store adjacency information.
    // We might need to change the design to pass the adjacency map to the ranker.
    // For now, we'll leave it as 0 and note that this is a limitation.
    const adjacencyConfidence = 0;

    // 7. ATS visibility weight: we can compute a weight based on the visibility policy.
    // We don't have the anchor node here to know the kind. We would need to pass the anchor map.
    // We'll set to 0 for now and note that we need the anchor map.
    const atsVisibilityWeight = 0;

    // Now we have the features. Let's create the features object.
    return {
      lexicalScore,
      propagationScore,
      evidenceScore,
      sourceDiversity,
      occurrenceScore,
      adjacencyConfidence,
      atsVisibilityWeight,
    };
  }
}
