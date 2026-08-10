import { AnchorId, MatchSignal, RetrievalAcceptance } from '../../types/retrieval.types.js';

import { RetrievalPolicy } from '../policies/retrieval.policy.js';

export class RetrievalAcceptanceResolver {
  constructor(private readonly policy: RetrievalPolicy) {}

  accept(
    signal: MatchSignal,
    scoreToUse?: number // If provided, use this score for acceptance instead of signal.score
  ): RetrievalAcceptance {
    const score = scoreToUse ?? signal.score;

    if (score < this.policy.resolver.minAcceptedScore) {
      return {
        accepted: false,

        score: score,

        reason: 'below-min-score',
      };
    }

    if (
      this.policy.resolver.requireEvidenceForSkills &&
      signal.evidenceIds.size === 0 &&
      !signal.stages.has('propagation')
    ) {
      return {
        accepted: false,

        score: score,

        reason: 'missing-evidence',
      };
    }

    return {
      accepted: true,

      score: score,

      reason: 'accepted',
    };
  }

  sort(signals: Map<AnchorId, MatchSignal>) {
    return [...signals.values()].sort((a, b) => b.score - a.score);
  }
}
