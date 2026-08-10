// src/services/profile/retrieval/validation/evidence-attachment.validator.ts

import { MatchSignal } from '../../types/retrieval.types.js';
import { HydratedArtifactBundle } from '../../artifacts/types/artifact.types.js';
import { RetrievalLogger } from '../logging/retrieval-logger.js';

export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

export class EvidenceAttachmentValidator {
  private readonly logger = RetrievalLogger.getInstance();

  validate(
    signal: MatchSignal,
    artifacts: HydratedArtifactBundle,
    jobId: string
  ): ValidationResult {
    // Check if the anchor exists
    const anchorNode = artifacts.anchors.get(signal.anchorId);
    if (!anchorNode) {
      this.logger.logEvidenceAttachmentMissing(jobId, signal.anchorId);
      return {
        valid: false,
        reason: `Anchor not found: ${signal.anchorId}`,
      };
    }

    // Check if the anchor has evidence mappings
    const evidenceIdsForAnchor = artifacts.anchorToEvidence.get(anchorNode.id);
    if (!evidenceIdsForAnchor || evidenceIdsForAnchor.size === 0) {
      this.logger.logEvidenceAttachmentMissing(jobId, signal.anchorId);
      return {
        valid: false,
        reason: `No evidence mappings found for anchor: ${signal.anchorId}`,
      };
    }

    // Check if at least one of the evidenceIds in the signal exists in the evidences map
    let validEvidenceFound = false;
    for (const evidenceId of signal.evidenceIds) {
      if (artifacts.evidences.has(evidenceId)) {
        validEvidenceFound = true;
        break;
      }
    }

    if (!validEvidenceFound) {
      this.logger.logEvidenceAttachmentMissing(jobId, signal.anchorId);
      return {
        valid: false,
        reason: `No valid evidence found for anchor: ${signal.anchorId}. Evidence IDs: ${Array.from(signal.evidenceIds).join(', ')}`,
      };
    }

    // All checks passed
    return {
      valid: true,
    };
  }
}
