import { describe, it, expect } from 'vitest';
import { RetrievalAcceptanceResolver } from '../../../src/domain/profile/retrieval/resolver/retrieval-acceptance.resolver.js' ;
import { RetrievalPolicy } from '../../../src/domain/profile/retrieval/policies/retrieval.policy.js';
import { MatchSignal } from '../../../src/domain/profile/types/retrieval.types.js' ;

describe('RetrievalAcceptanceResolver', () => {
  let resolver: RetrievalAcceptanceResolver;
  let policy: Partial<RetrievalPolicy>;

  beforeEach(() => {
    // Set up the policy with the values from the sprint document
    policy = {
      resolver: {
        minAcceptedScore: 0.55,
        requireEvidenceForSkills: true
      }
    };

    resolver = new RetrievalAcceptanceResolver(policy as RetrievalPolicy);
  });

  describe('Accept-001: Score below threshold', () => {
    it('should reject signal with score 0.54', () => {
      // Arrange
      const signal: MatchSignal = {
        anchorId: 'cap.test',
        score: 0.54,
        confidence: 0.8,
        occurrences: 2,
        stages: new Set(['lexical']),
        evidenceIds: new Set(['ev.123']), // Has evidence to avoid missing-evidence reason
        matchedPatterns: ['test pattern'],
        occurrencesDetail: [],
        sources: new Set(['canonical']),
        trace: []
      };

      // Act
      const acceptance = resolver.accept(signal);

      // Assert
      expect(acceptance.accepted).toBe(false);
      expect(acceptance.reason).toBe('below-min-score');
      expect(acceptance.score).toBe(0.54);
    });
  });

  describe('Accept-002: Score at threshold', () => {
    it('should accept signal with score 0.55', () => {
      // Arrange
      const signal: MatchSignal = {
        anchorId: 'cap.test',
        score: 0.55,
        confidence: 0.8,
        occurrences: 2,
        stages: new Set(['lexical']),
        evidenceIds: new Set(['ev.123']), // Has evidence to avoid missing-evidence reason
        matchedPatterns: ['test pattern'],
        occurrencesDetail: [],
        sources: new Set(['canonical']),
        trace: []
      };

      // Act
      const acceptance = resolver.accept(signal);

      // Assert
      expect(acceptance.accepted).toBe(true);
      expect(acceptance.reason).toBe('accepted');
      expect(acceptance.score).toBe(0.55);
    });
  });

  describe('Accept-003: No evidence', () => {
    it('should reject signal with no evidence (when not propagation-only)', () => {
      // Arrange
      const signal: MatchSignal = {
        anchorId: 'cap.test',
        score: 0.6, // Above threshold
        confidence: 0.8,
        occurrences: 2,
        stages: new Set(['lexical']), // NOT propagation-only
        evidenceIds: new Set(), // No evidence
        matchedPatterns: ['test pattern'],
        occurrencesDetail: [],
        sources: new Set(['canonical']),
        trace: []
      };

      // Act
      const acceptance = resolver.accept(signal);

      // Assert
      expect(acceptance.accepted).toBe(false);
      expect(acceptance.reason).toBe('missing-evidence');
      expect(acceptance.score).toBe(0.6);
    });
  });

  describe('Accept-004: Propagation-only signal', () => {
    it('should accept propagation-only signal even without evidence', () => {
      // Arrange
      const signal: MatchSignal = {
        anchorId: 'cap.test',
        score: 0.6, // Above threshold
        confidence: 0.8,
        occurrences: 2,
        stages: new Set(['propagation']), // Propagation-only
        evidenceIds: new Set(), // No evidence
        matchedPatterns: ['test pattern'],
        occurrencesDetail: [],
        sources: new Set(['canonical']),
        trace: []
      };

      // Act
      const acceptance = resolver.accept(signal);

      // Assert
      expect(acceptance.accepted).toBe(true);
      expect(acceptance.reason).toBe('accepted');
      expect(acceptance.score).toBe(0.6);
    });
  });

  // Additional test for the scoreToUse parameter
  describe('scoreToUse parameter', () => {
    it('should use the provided score instead of signal.score when scoreToUse is provided', () => {
      // Arrange
      const signal: MatchSignal = {
        anchorId: 'cap.test',
        score: 0.34, // Below threshold
        confidence: 0.8,
        occurrences: 2,
        stages: new Set(['lexical']),
        evidenceIds: new Set(['ev.123']),
        matchedPatterns: ['test pattern'],
        occurrencesDetail: [],
        sources: new Set(['canonical']),
        trace: []
      };
      const scoreToUse = 0.6; // Above threshold

      // Act
      const acceptance = resolver.accept(signal, scoreToUse);

      // Assert
      expect(acceptance.accepted).toBe(true);
      expect(acceptance.reason).toBe('accepted');
      expect(acceptance.score).toBe(0.6); // Should be the scoreToUse value
    });
  });
});