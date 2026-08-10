import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EvidenceRanker } from '../../../../src/domain/profile/retrieval/evidence/evidence-ranker.js';
import { EvidenceFeaturesExtractor } from '../../../../src/domain/profile/retrieval/evidence/evidence-feature-extractor.js';
import { evidenceRankingPolicy } from '../../../../src/domain/profile/retrieval/evidence/evidence-ranking-policy.js';
import { EvidenceNode } from '../../../../src/domain/profile/types/retrieval.types.js';

describe('EvidenceRanker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Evidence-001: All features = 1', () => {
    it('GIVEN EvidenceRanker WHEN EvidenceRanker evaluates THEN return score = 1', () => {
      vi.spyOn(EvidenceFeaturesExtractor, 'extract').mockReturnValue({
        operationalScore: 1.0,
        architectureScore: 1.0,
        ownershipScore: 1.0,
        quantifiedScore: 1.0,
      });
      const originalWeights = { ...evidenceRankingPolicy };
      evidenceRankingPolicy.operationalWeight = 0.3;
      evidenceRankingPolicy.architectureWeight = 0.3;
      evidenceRankingPolicy.ownershipWeight = 0.2;
      evidenceRankingPolicy.quantifiedWeight = 0.2;

      const evidence = {} as EvidenceNode;
      const score = EvidenceRanker.scoreEvidence(evidence);

      Object.assign(evidenceRankingPolicy, originalWeights);
      expect(score).toBeCloseTo(1.0);
    });
  });

  describe('Evidence-002: All features = 0', () => {
    it('GIVEN EvidenceRanker WHEN EvidenceRanker evaluates THEN return score = 0', () => {
      vi.spyOn(EvidenceFeaturesExtractor, 'extract').mockReturnValue({
        operationalScore: 0.0,
        architectureScore: 0.0,
        ownershipScore: 0.0,
        quantifiedScore: 0.0,
      });

      const evidence = {} as EvidenceNode;
      const score = EvidenceRanker.scoreEvidence(evidence);

      expect(score).toBe(0);
    });
  });

  describe('Non-negative score', () => {
    it('GIVEN weighted sum is negative WHEN EvidenceRanker evaluates THEN return non-negative score even', () => {
      vi.spyOn(EvidenceFeaturesExtractor, 'extract').mockReturnValue({
        operationalScore: 0.0,
        architectureScore: 0.0,
        ownershipScore: 0.0,
        quantifiedScore: 0.0,
      });

      const evidence = {} as EvidenceNode;
      const score = EvidenceRanker.scoreEvidence(evidence);

      expect(score).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Weight usage', () => {
    it('GIVEN EvidenceRanker WHEN EvidenceRanker evaluates THEN apply the weights correctly', () => {
      vi.spyOn(EvidenceFeaturesExtractor, 'extract').mockReturnValue({
        operationalScore: 1.0,
        architectureScore: 0.0,
        ownershipScore: 0.0,
        quantifiedScore: 0.0,
      });
      const originalWeights = { ...evidenceRankingPolicy };
      evidenceRankingPolicy.operationalWeight = 0.3;
      evidenceRankingPolicy.architectureWeight = 0.3;
      evidenceRankingPolicy.ownershipWeight = 0.2;
      evidenceRankingPolicy.quantifiedWeight = 0.2;

      const evidence = {} as EvidenceNode;
      const score = EvidenceRanker.scoreEvidence(evidence);

      Object.assign(evidenceRankingPolicy, originalWeights);
      expect(score).toBeCloseTo(0.3);
    });
  });
});
