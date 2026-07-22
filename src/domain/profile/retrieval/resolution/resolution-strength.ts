// src/services/profile/retrieval/resolution/resolution-strength.ts

/**
 * Resolution strength classifier for retrieval signals.
 * Implements the strong/weak/partial/missing classification system
 * for gap analysis, recruiter fit scoring, and learning loops.
 */

import { RetrievalPolicy } from '../policies/retrieval.policy.js';
import { MatchSignal } from '../../types/retrieval.types.js';

/**
 * Enum representing the resolution strength of a signal.
 * Used for gap analysis, recruiter fit scoring, and automatic refinement.
 */
export type ResolutionStrength =
  | 'strong'
  | 'partial'
  | 'weak'
  | 'missing';

/**
 * Classifies a match signal into a resolution strength category based on the final score and signal characteristics.
 * 
 * Classification logic:
 * - strong: direct evidence + high score (>= strongThreshold)
 * - partial: good lexical match but limited evidence (>= partialThreshold)
 * - weak: propagation-only or vendor-only (>= weakThreshold)
 * - missing: required but absent (< weakThreshold)
 * 
 * @param finalScore - The final score from ranking
 * @param signal - The match signal to classify (for stages and other metadata)
 * @param policy - Retrieval policy containing thresholds
 * @returns Resolution strength classification
 */
export function classifyResolutionStrength(
   finalScore: number,
   signal: MatchSignal,
   policy: RetrievalPolicy = require('../policies/retrieval.policy.js').retrievalPolicy
): ResolutionStrength {
   const { resolution } = policy;
   
   // Check if signal has direct evidence (lexical stage without propagation-only)
   const hasDirectEvidence = signal.stages.has('lexical') && 
                            (!signal.stages.has('propagation') || 
                             signal.stages.size > 1);
   
   // Apply classification logic based on final score and evidence type
   if (finalScore >= resolution.strongThreshold && hasDirectEvidence) {
     return 'strong';
   } else if (finalScore >= resolution.partialThreshold) {
     return 'partial';
   } else if (finalScore >= resolution.weakThreshold) {
     return 'weak';
   } else {
     return 'missing';
   }
}

/**
 * Determines if a signal meets the minimum threshold for consideration.
 * 
 * @param signal - The match signal to check
 * @param policy - Retrieval policy containing thresholds
 * @returns True if signal is at least 'weak' strength
 */
export function isSignalViable(
  signal: MatchSignal,
  policy: RetrievalPolicy = require('../policies/retrieval.policy.js').retrievalPolicy
): boolean {
  return signal.score >= policy.resolution.weakThreshold;
}

/**
 * Gets the resolution strength description for debugging and logging.
 * 
 * @param strength - The resolution strength to describe
 * @returns Human-readable description of the strength
 */
export function getResolutionStrengthDescription(
  strength: ResolutionStrength
): string {
  const descriptions: Record<ResolutionStrength, string> = {
    strong: 'Direct evidence with high confidence score',
    partial: 'Good lexical match with limited direct evidence',
    weak: 'Propagation-derived or vendor-only match',
    missing: 'Required signal not found in retrieval'
  };
  
  return descriptions[strength];
}