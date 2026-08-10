import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RetrievalRanker } from '../../../../src/domain/profile/retrieval/ranking/retrieval-ranker.js';

import { RankingFeaturesExtractor } from '../../../../src/domain/profile/retrieval/ranking/ranking-features.js';
import { rankingPolicy } from '../../../../src/domain/profile/retrieval/ranking/ranking-policy.js';
import { retrievalPolicy } from '../../../../src/domain/profile/retrieval/policies/retrieval.policy.js';
import { MatchSignal } from '../../../../src/domain/profile/types/retrieval.types.js';

describe('RetrievalRanker', () => {
  let ranker: RetrievalRanker;
  let signal: MatchSignal;
  let directSignals: Map<string, MatchSignal>;
  let expandedSignals: Map<string, MatchSignal>;
  let evidences: Map<string, any>;
  let extractSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    extractSpy = vi.spyOn(RankingFeaturesExtractor, 'extract').mockReturnValue({
      lexicalScore: 0,
      propagationScore: 0,
      evidenceScore: 0,
      sourceDiversity: 0,
      occurrenceScore: 0,
      adjacencyConfidence: 0,
      atsVisibilityWeight: 0,
    });

    ranker = new RetrievalRanker();
    directSignals = new Map();
    expandedSignals = new Map();
    evidences = new Map();

    // Create a basic signal for testing
    signal = {
      anchorId: 'cap.test',
      score: 0.5,
      confidence: 0.8,
      occurrences: 2,
      stages: new Set(['lexical']),
      evidenceIds: new Set(),
      matchedPatterns: ['test pattern'],
      occurrencesDetail: [],
      sources: new Set(['canonical']),
      trace: [],
    } as MatchSignal;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Rank-001: lexical only', () => {
    it('GIVEN RetrievalRanker WHEN RetrievalRanker evaluates THEN derive score only from lexical weight', () => {
      // Arrange: Mock the extractor to return only lexical score
      const mockFeatures = {
        lexicalScore: 1.0,
        propagationScore: 0.0,
        evidenceScore: 0.0,
        sourceDiversity: 0.0,
        occurrenceScore: 0.0,
        adjacencyConfidence: 0.0,
        atsVisibilityWeight: 0.0,
      };
      extractSpy.mockReturnValue(mockFeatures);

      // Mock the ranking policy to have lexicalWeight = 2.0, others 0
      (rankingPolicy as any).lexicalWeight = 2.0;
      (rankingPolicy as any).propagationWeight = 0.0;
      (rankingPolicy as any).evidenceWeight = 0.0;
      (rankingPolicy as any).sourceDiversityWeight = 0.0;
      (rankingPolicy as any).occurrenceWeight = 0.0;
      (rankingPolicy as any).adjacencyConfidenceWeight = 0.0;
      (rankingPolicy as any).atsVisibilityWeight = 0.0;

      // Mock the retrievalPolicy to have the thresholds we want for classification (we don't care about the strength for this test, but we need to set it to avoid using the real thresholds)
      (retrievalPolicy as any).resolution = {
        strongThreshold: 0.7,
        partialThreshold: 0.4,
        weakThreshold: 0.2,
      };

      // Act
      const result = ranker.rank(signal, directSignals, expandedSignals, evidences);

      // Assert
      expect(result.finalScore).toBe(2.0); // 1.0 * 2.0
      // We don't check the resolutionStrength because it depends on the thresholds and the signal's stages.
      // But we can check that it is one of the expected values.
      expect(['strong', 'partial', 'weak', 'missing']).toContain(result.resolutionStrength);
    });
  });

  describe('Rank-002: lexical + evidence', () => {
    it('GIVEN RetrievalRanker WHEN RetrievalRanker evaluates THEN give higher score than lexical-only', () => {
      // Arrange: Mock the extractor to return lexical and evidence scores
      const mockFeatures = {
        lexicalScore: 1.0,
        propagationScore: 0.0,
        evidenceScore: 1.0,
        sourceDiversity: 0.0,
        occurrenceScore: 0.0,
        adjacencyConfidence: 0.0,
        atsVisibilityWeight: 0.0,
      };
      extractSpy.mockReturnValue(mockFeatures);

      // Mock the ranking policy to have lexicalWeight = 1.0, evidenceWeight = 1.0
      (rankingPolicy as any).lexicalWeight = 1.0;
      (rankingPolicy as any).propagationWeight = 0.0;
      (rankingPolicy as any).evidenceWeight = 1.0;
      (rankingPolicy as any).sourceDiversityWeight = 0.0;
      (rankingPolicy as any).occurrenceWeight = 0.0;
      (rankingPolicy as any).adjacencyConfidenceWeight = 0.0;
      (rankingPolicy as any).atsVisibilityWeight = 0.0;

      // Mock the retrievalPolicy to have the thresholds we want
      (retrievalPolicy as any).resolution = {
        strongThreshold: 0.7,
        partialThreshold: 0.4,
        weakThreshold: 0.2,
      };

      // Act
      const result = ranker.rank(signal, directSignals, expandedSignals, evidences);

      // Assert
      expect(result.finalScore).toBe(2.0); // 1.0*1.0 + 1.0*1.0
      // Now test lexical-only scenario for comparison
      (rankingPolicy as any).evidenceWeight = 0.0;
      const lexicalOnlyResult = ranker.rank(signal, directSignals, expandedSignals, evidences);
      expect(lexicalOnlyResult.finalScore).toBe(1.0); // 1.0*1.0
      expect(result.finalScore).toBeGreaterThan(lexicalOnlyResult.finalScore);
    });
  });

  describe('Rank-003: propagation only', () => {
    it('GIVEN RetrievalRanker WHEN RetrievalRanker evaluates THEN have lexical score = 0 and propagation score > 0', () => {
      // Arrange: Mock the extractor to return propagation score only
      const mockFeatures = {
        lexicalScore: 0.0,
        propagationScore: 1.5,
        evidenceScore: 0.0,
        sourceDiversity: 0.0,
        occurrenceScore: 0.0,
        adjacencyConfidence: 0.0,
        atsVisibilityWeight: 0.0,
      };
      extractSpy.mockReturnValue(mockFeatures);

      // Mock the ranking policy to have propagationWeight = 1.0
      (rankingPolicy as any).lexicalWeight = 0.0;
      (rankingPolicy as any).propagationWeight = 1.0;
      (rankingPolicy as any).evidenceWeight = 0.0;
      (rankingPolicy as any).sourceDiversityWeight = 0.0;
      (rankingPolicy as any).occurrenceWeight = 0.0;
      (rankingPolicy as any).adjacencyConfidenceWeight = 0.0;
      (rankingPolicy as any).atsVisibilityWeight = 0.0;

      // Mock the retrievalPolicy to have the thresholds we want
      (retrievalPolicy as any).resolution = {
        strongThreshold: 0.7,
        partialThreshold: 0.4,
        weakThreshold: 0.2,
      };

      // Act
      const result = ranker.rank(signal, directSignals, expandedSignals, evidences);

      // Assert
      expect(result.finalScore).toBe(1.5); // 1.5 * 1.0
      // We don't check the resolutionStrength because it depends on the thresholds and the signal's stages.
      // But we can check that it is one of the expected values.
      expect(['strong', 'partial', 'weak', 'missing']).toContain(result.resolutionStrength);
    });
  });

  describe('Rank-004: negative feature values', () => {
    it('GIVEN RetrievalRanker WHEN RetrievalRanker evaluates THEN ensure finalScore >= 0', () => {
      // Arrange: Mock the extractor to return negative scores
      const mockFeatures = {
        lexicalScore: -1.0,
        propagationScore: -2.0,
        evidenceScore: -0.5,
        sourceDiversity: -0.1,
        occurrenceScore: -0.3,
        adjacencyConfidence: -0.2,
        atsVisibilityWeight: -0.4,
      };
      extractSpy.mockReturnValue(mockFeatures);

      // Mock the ranking policy to have positive weights
      (rankingPolicy as any).lexicalWeight = 1.0;
      (rankingPolicy as any).propagationWeight = 1.0;
      (rankingPolicy as any).evidenceWeight = 1.0;
      (rankingPolicy as any).sourceDiversityWeight = 1.0;
      (rankingPolicy as any).occurrenceWeight = 1.0;
      (rankingPolicy as any).adjacencyConfidenceWeight = 1.0;
      (rankingPolicy as any).atsVisibilityWeight = 1.0;

      // Mock the retrievalPolicy to have the thresholds we want
      (retrievalPolicy as any).resolution = {
        strongThreshold: 0.7,
        partialThreshold: 0.4,
        weakThreshold: 0.2,
      };

      // Act
      const result = ranker.rank(signal, directSignals, expandedSignals, evidences);

      // Assert
      // The raw sum would be negative, but the ranker ensures finalScore >= 0
      expect(result.finalScore).toBeGreaterThanOrEqual(0);
      // We don't check the resolutionStrength because it depends on the thresholds and the signal's stages.
      // But we can check that it is one of the expected values.
      expect(['strong', 'partial', 'weak', 'missing']).toContain(result.resolutionStrength);
    });
  });

  describe('Rank-005: boundary validation', () => {
    it('GIVEN RetrievalRanker WHEN RetrievalRanker evaluates THEN classify correctly based on finalScore and evidence', () => {
      // We need to mock the retrievalPolicy to return the thresholds from the sprint document.
      (retrievalPolicy as any).resolution = {
        strongThreshold: 0.7,
        partialThreshold: 0.4,
        weakThreshold: 0.2,
      };

      // Now we'll test each threshold by setting the finalScore to a specific value and checking the classification.

      // We'll mock the extractor to return a known set of features, and the policies to produce a known finalScore.
      // We'll set the lexical weight to 1.0, others 0 to get finalScore = 1.0 * lexicalScore
      (rankingPolicy as any).lexicalWeight = 1.0;
      (rankingPolicy as any).propagationWeight = 0.0;
      (rankingPolicy as any).evidenceWeight = 0.0;
      (rankingPolicy as any).sourceDiversityWeight = 0.0;
      (rankingPolicy as any).occurrenceWeight = 0.0;
      (rankingPolicy as any).adjacencyConfidenceWeight = 0.0;
      (rankingPolicy as any).atsVisibilityWeight = 0.0;

      // We also need to mock the extractor to return a lexicalScore that will give us the desired finalScore.
      // We'll do this for each threshold.

      // Test strong threshold: finalScore >= 0.70 -> strong
      // We'll set lexicalScore to 0.70
      // We also need the signal to have direct evidence (lexical stage without propagation-only) for strong classification
      // According to the classification logic: hasDirectEvidence = signal.stages.has('lexical') &&
      //   (!signal.stages.has('propagation') || signal.stages.size > 1)
      const mockFeaturesStrong = {
        lexicalScore: 0.7,
        propagationScore: 0.0,
        evidenceScore: 0.0,
        sourceDiversity: 0.0,
        occurrenceScore: 0.0,
        adjacencyConfidence: 0.0,
        atsVisibilityWeight: 0.0,
      };
      extractSpy.mockReturnValue(mockFeaturesStrong);
      signal.stages = new Set(['lexical']); // has lexical, not propagation -> hasDirectEvidence = true
      const resultStrong = ranker.rank(signal, directSignals, expandedSignals, evidences);
      expect(resultStrong.finalScore).toBeCloseTo(0.7);
      expect(resultStrong.resolutionStrength).toBe('strong');

      // Test partial threshold: finalScore >= 0.40 and < 0.70 -> partial
      // We'll set lexicalScore to 0.40
      // For partial, we only need the score to be >= partialThreshold (regardless of evidence type)
      const mockFeaturesPartial = {
        lexicalScore: 0.4,
        propagationScore: 0.0,
        evidenceScore: 0.0,
        sourceDiversity: 0.0,
        occurrenceScore: 0.0,
        adjacencyConfidence: 0.0,
        atsVisibilityWeight: 0.0,
      };
      extractSpy.mockReturnValue(mockFeaturesPartial);
      signal.stages = new Set(['lexical']); // still has lexical stage
      const resultPartial = ranker.rank(signal, directSignals, expandedSignals, evidences);
      expect(resultPartial.finalScore).toBeCloseTo(0.4);
      expect(resultPartial.resolutionStrength).toBe('partial');

      // Test weak threshold: finalScore >= 0.20 and < 0.40 -> weak
      // We'll set lexicalScore to 0.20
      const mockFeaturesWeak = {
        lexicalScore: 0.2,
        propagationScore: 0.0,
        evidenceScore: 0.0,
        sourceDiversity: 0.0,
        occurrenceScore: 0.0,
        adjacencyConfidence: 0.0,
        atsVisibilityWeight: 0.0,
      };
      extractSpy.mockReturnValue(mockFeaturesWeak);
      signal.stages = new Set(['lexical']); // still has lexical stage
      const resultWeak = ranker.rank(signal, directSignals, expandedSignals, evidences);
      expect(resultWeak.finalScore).toBeCloseTo(0.2);
      expect(resultWeak.resolutionStrength).toBe('weak');

      // Test missing: finalScore < 0.20 -> missing
      // We'll set lexicalScore to 0.19
      const mockFeaturesMissing = {
        lexicalScore: 0.19,
        propagationScore: 0.0,
        evidenceScore: 0.0,
        sourceDiversity: 0.0,
        occurrenceScore: 0.0,
        adjacencyConfidence: 0.0,
        atsVisibilityWeight: 0.0,
      };
      extractSpy.mockReturnValue(mockFeaturesMissing);
      signal.stages = new Set(['lexical']); // still has lexical stage
      const resultMissing = ranker.rank(signal, directSignals, expandedSignals, evidences);
      expect(resultMissing.finalScore).toBeCloseTo(0.19);
      expect(resultMissing.resolutionStrength).toBe('missing');
    });
  });
});
