// src/services/profile/retrieval/evidence/evidence-ranking-policy.ts

/**
 * Policy for ranking evidence features and their weights.
 */
export interface EvidenceRankingPolicy {
  operationalWeight: number;
  architectureWeight: number;
  ownershipWeight: number;
  quantifiedWeight: number;
}

/**
 * Default evidence ranking policy weights.
 * The sum of weights should be 1.0 for a normalized score, but we allow flexibility.
 */
export const evidenceRankingPolicy: EvidenceRankingPolicy = {
  operationalWeight: 0.3,
  architectureWeight: 0.3,
  ownershipWeight: 0.2,
  quantifiedWeight: 0.2,
};
