import { describe, it, expect } from 'vitest';
import { classifyResolutionStrength, isSignalViable, getResolutionStrengthDescription } from '../../../src/domain/profile/retrieval/resolution/resolution-strength.js' ;
import { MatchSignal } from '../../../src/domain/profile/types/retrieval.types.js' ;

const defaultPolicy = {
  resolution: {
    strongThreshold: 0.7,
    partialThreshold: 0.4,
    weakThreshold: 0.2,
    missingThreshold: 0
  }
};

function makeSignal(overrides: Partial<MatchSignal> = {}): MatchSignal {
  return {
    anchorId: 'cap.test',
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

describe('ResolutionStrength', () => {
  describe('Res-001: strong classification', () => {
    it('should classify as strong when score >= strongThreshold and has direct evidence', () => {
      const signal = makeSignal({ stages: new Set(['lexical']) });
      const result = classifyResolutionStrength(0.8, signal, defaultPolicy as any);
      expect(result).toBe('strong');
    });
  });

  describe('Res-002: partial classification', () => {
    it('should classify as partial when score >= partialThreshold but < strongThreshold', () => {
      const signal = makeSignal({ stages: new Set(['lexical']) });
      const result = classifyResolutionStrength(0.5, signal, defaultPolicy as any);
      expect(result).toBe('partial');
    });
  });

  describe('Res-003: weak classification', () => {
    it('should classify as weak when score >= weakThreshold but < partialThreshold', () => {
      const signal = makeSignal({ stages: new Set(['lexical']) });
      const result = classifyResolutionStrength(0.3, signal, defaultPolicy as any);
      expect(result).toBe('weak');
    });
  });

  describe('Res-004: missing classification', () => {
    it('should classify as missing when score < weakThreshold', () => {
      const signal = makeSignal({ stages: new Set(['lexical']) });
      const result = classifyResolutionStrength(0.1, signal, defaultPolicy as any);
      expect(result).toBe('missing');
    });
  });

  describe('Res-005: propagation-only not strong', () => {
    it('should not classify as strong even with high score if propagation-only', () => {
      const signal = makeSignal({ stages: new Set(['propagation']) });
      const result = classifyResolutionStrength(0.9, signal, defaultPolicy as any);
      expect(result).not.toBe('strong');
    });
  });

  describe('Res-006: isSignalViable', () => {
    it('should return true when score >= weakThreshold', () => {
      const signal = makeSignal({ score: 0.3 });
      expect(isSignalViable(signal, defaultPolicy as any)).toBe(true);
    });

    it('should return false when score < weakThreshold', () => {
      const signal = makeSignal({ score: 0.1 });
      expect(isSignalViable(signal, defaultPolicy as any)).toBe(false);
    });
  });

  describe('Res-007: getResolutionStrengthDescription', () => {
    it('should return human-readable descriptions', () => {
      expect(getResolutionStrengthDescription('strong')).toBe('Direct evidence with high confidence score');
      expect(getResolutionStrengthDescription('partial')).toBe('Good lexical match with limited direct evidence');
      expect(getResolutionStrengthDescription('weak')).toBe('Propagation-derived or vendor-only match');
      expect(getResolutionStrengthDescription('missing')).toBe('Required signal not found in retrieval');
    });
  });
});