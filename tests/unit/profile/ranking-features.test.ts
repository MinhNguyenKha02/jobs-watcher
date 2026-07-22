import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RankingFeaturesExtractor } from '../../../src/domain/profile/retrieval/ranking/ranking-features.js' ;
import { MatchSignal } from '../../../src/domain/profile/types/retrieval.types.js' ;

vi.mock('../../../src/services/profile/retrieval/evidence/evidence-ranker.js');

import { EvidenceRanker } from '../../../src/domain/profile/retrieval/evidence/evidence-ranker.js' ;

function makeSignal(id: string, overrides: Partial<MatchSignal> = {}): MatchSignal {
  return {
    anchorId: id,
    score: 0.5,
    confidence: 0.8,
    occurrences: 2,
    stages: new Set(['lexical']),
    evidenceIds: new Set(),
    matchedPatterns: [],
    occurrencesDetail: [],
    sources: new Set(['canonical']),
    trace: [],
    ...overrides
  };
}

describe('RankingFeaturesExtractor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Feat-001: lexical score from direct signal', () => {
    it('should use direct signal score when direct signal exists', () => {
      const signal = makeSignal('cap.test');
      const direct = new Map([['cap.test', makeSignal('cap.test', { score: 0.8 })]]);
      const expanded = new Map();
      const evidences = new Map();

      const result = RankingFeaturesExtractor.extract(signal, direct, expanded, evidences);
      expect(result.lexicalScore).toBe(0.8);
    });
  });

  describe('Feat-002: no direct signal yields lexical score 0', () => {
    it('should return lexical score 0 when no direct signal exists', () => {
      const signal = makeSignal('cap.test');
      const direct = new Map();
      const expanded = new Map();
      const evidences = new Map();

      const result = RankingFeaturesExtractor.extract(signal, direct, expanded, evidences);
      expect(result.lexicalScore).toBe(0);
    });
  });

  describe('Feat-003: propagation score with both direct and expanded', () => {
    it('should compute propagation score as expanded minus direct', () => {
      const signal = makeSignal('cap.test');
      const direct = new Map([['cap.test', makeSignal('cap.test', { score: 0.3 })]]);
      const expanded = new Map([['cap.test', makeSignal('cap.test', { score: 0.9 })]]);
      const evidences = new Map();

      const result = RankingFeaturesExtractor.extract(signal, direct, expanded, evidences);
      expect(result.propagationScore).toBeCloseTo(0.6);
      expect(result.lexicalScore).toBe(0.3);
    });
  });

  describe('Feat-004: propagation-only signal', () => {
    it('should treat expanded score as propagation and lexical as 0', () => {
      const signal = makeSignal('cap.test');
      const direct = new Map();
      const expanded = new Map([['cap.test', makeSignal('cap.test', { score: 0.7 })]]);
      const evidences = new Map();

      const result = RankingFeaturesExtractor.extract(signal, direct, expanded, evidences);
      expect(result.propagationScore).toBe(0.7);
      expect(result.lexicalScore).toBe(0);
    });
  });

  describe('Feat-005: source diversity', () => {
    it('should return number of unique sources', () => {
      const signal = makeSignal('cap.test', { sources: new Set(['canonical', 'vendor']) });
      const direct = new Map();
      const expanded = new Map();
      const evidences = new Map();

      const result = RankingFeaturesExtractor.extract(signal, direct, expanded, evidences);
      expect(result.sourceDiversity).toBe(2);
    });
  });
});