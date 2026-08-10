import type { AnchorKind, MatchSource, RetrievalStage } from '../../types/retrieval.types.js';

export interface RetrievalPolicy {
  direct: {
    minScore: number;

    sourceWeights: Record<MatchSource, number>;

    stageWeights: Record<RetrievalStage, number>;

    occurrenceSaturation: number;
  };

  propagation: {
    enabled: boolean;

    maxDepth: number;

    minEdgeWeight: number;

    decayFactor: number;

    maxExpandedAnchors: number;

    blockedKinds: string[];
  };

  resolver: {
    minAcceptedScore: number;

    maxSkills: number;

    maxProjects: number;

    maxExperience: number;

    requireEvidenceForSkills: boolean;
  };

  /**
   * ATS visibility policy defining how different anchor kinds should be exposed
   * in resume skill sections.
   */
  visibility: {
    [kind in AnchorKind]: 'primary' | 'secondary' | 'hidden';
  };

  /**
   * Resolution strength classification for signals.
   * Used for gap analysis, recruiter fit scoring, and learning loops.
   */
  resolution: {
    /**
     * Score threshold for strong resolution (direct evidence + high score)
     */
    strongThreshold: number;

    /**
     * Score threshold for partial resolution (good lexical match but limited evidence)
     */
    partialThreshold: number;

    /**
     * Score threshold for weak resolution (propagation-only or vendor-only)
     */
    weakThreshold: number;

    /**
     * Below this is considered missing (required but absent)
     */
    missingThreshold: number;
  };
}

export const retrievalPolicy: RetrievalPolicy = {
  direct: {
    minScore: 0.2,

    occurrenceSaturation: 4,

    sourceWeights: {
      canonical: 1,
      adjacent: 0.55,
      vendor: 0.35,
      template: 0.8,
    },

    stageWeights: {
      lexical: 1,
      propagation: 0.65,
    },
  },

  propagation: {
    enabled: true,

    maxDepth: 2,

    minEdgeWeight: 0.2,

    decayFactor: 0.72,

    maxExpandedAnchors: 32,

    blockedKinds: ['beh'],
  },

  resolver: {
    minAcceptedScore: 0.55,

    maxSkills: 18,

    maxProjects: 2,

    maxExperience: 2,

    requireEvidenceForSkills: true,
  },

  /**
   * Defines how different anchor kinds should be exposed in ATS skill sections.
   * - tech (technology): primary visibility (only kind exposed in ATS skills)
   * - cap, comp, beh: hidden (used for scoring/ranking only, not in skill sections)
   */
  visibility: {
    cap: 'hidden',
    tech: 'primary',
    comp: 'hidden',
    beh: 'hidden',
  },

  /**
   * Resolution strength classification thresholds.
   * Used for gap analysis, recruiter fit scoring, and learning loops.
   */
  resolution: {
    strongThreshold: 0.7, // direct evidence + high score
    partialThreshold: 0.4, // good lexical match but limited evidence
    weakThreshold: 0.2, // propagation-only or vendor-only
    missingThreshold: 0.0, // below this is considered missing
  },
};
