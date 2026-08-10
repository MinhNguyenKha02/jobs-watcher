import { describe, it, expect } from 'vitest';
import { RetrievalAcceptanceResolver } from '../../../src/domain/profile/retrieval/resolver/retrieval-acceptance.resolver.js';
import { retrievalPolicy } from '../../../src/domain/profile/retrieval/policies/retrieval.policy.js';
import { makeSignal } from '../../helpers/profile/integration-fixtures.js';
import { MatchSignal } from '../../../src/domain/profile/types/retrieval.types.js';

describe('Acceptance Validation Integration', () => {
  const resolver = new RetrievalAcceptanceResolver(retrievalPolicy);

  describe('INT-004: ranking threshold enforced', () => {
    it('GIVEN Acceptance WHEN resolver.accept THEN reject signals below minAcceptedScore and accept those above', () => {
      const lowSignal = makeSignal('cap.test' as any, {
        score: 0.1,
        evidenceIds: new Set(['ev.1' as any]),
      });
      const highSignal = makeSignal('cap.test' as any, {
        score: 0.6,
        evidenceIds: new Set(['ev.1' as any]),
      });

      const lowResult = resolver.accept(lowSignal);
      const highResult = resolver.accept(highSignal);

      expect(lowResult.accepted).toBe(false);
      expect(lowResult.reason).toBe('below-min-score');
      expect(highResult.accepted).toBe(true);
      expect(highResult.reason).toBe('accepted');
    });
  });

  describe('INT-005: accepted signal without evidence rejected', () => {
    it('GIVEN signal has no evidence IDs and is not propagation WHEN resolver.accept THEN reject', () => {
      const signal = makeSignal('cap.test' as any, {
        score: 0.6,
        evidenceIds: new Set(),
        stages: new Set(['lexical']),
      });

      const result = resolver.accept(signal);
      expect(result.accepted).toBe(false);
      expect(result.reason).toBe('missing-evidence');
    });
  });

  describe('INT-006: accepted signal with evidence is accepted', () => {
    it('GIVEN signal has evidence IDs WHEN resolver.accept THEN accept', () => {
      const signal = makeSignal('cap.test' as any, {
        score: 0.6,
        evidenceIds: new Set(['ev.1' as any]),
        stages: new Set(['lexical']),
      });

      const result = resolver.accept(signal);
      expect(result.accepted).toBe(true);
      expect(result.reason).toBe('accepted');
    });
  });
});
