// src/services/profile/retrieval/ranking/ranking-policy.ts

import type { MatchSource, RetrievalStage } from '../../types/retrieval.types.js';

/**
 * Policy for ranking features and their weights.
 */
export interface RankingPolicy {
  lexicalWeight: number;
  propagationWeight: number;
  evidenceWeight: number;
  sourceDiversityWeight: number;
  occurrenceWeight: number;
  adjacencyConfidenceWeight: number;
  atsVisibilityWeight: number;
}

/**
 * Default ranking policy weights.
 * These weights are used to compute the final score from individual features.
 * The sum of weights should be 1.0 for a normalized score, but we allow flexibility.
 */
export const rankingPolicy: RankingPolicy = {
  lexicalWeight: 0.35,
  propagationWeight: 0.25,
  evidenceWeight: 0.2,
  sourceDiversityWeight: 0.1,
  occurrenceWeight: 0.05,
  adjacencyConfidenceWeight: 0.03,
  atsVisibilityWeight: 0.02,
};