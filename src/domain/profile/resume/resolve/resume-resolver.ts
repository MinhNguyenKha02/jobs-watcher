import {
  RetrievalEvidenceScore,
  HydratedArtifactBundle,
} from '../../artifacts/types/artifact.types.js';
import { RetrievalOutput } from '../../retrieval/contracts/retrieval.types.js';
import { EvidenceRanker } from '../../retrieval/evidence/evidence-ranker.js';
import { RetrievalLogger } from '../../retrieval/logging/retrieval-logger.js';
import { retrievalPolicy } from '../../retrieval/policies/retrieval.policy.js';
import { RetrievalRanker, RankedSignal } from '../../retrieval/ranking/retrieval-ranker.js';
import { classifyResolutionStrength } from '../../retrieval/resolution/resolution-strength.js';
import { RetrievalAcceptanceResolver } from '../../retrieval/resolver/retrieval-acceptance.resolver.js';
import { EvidenceAttachmentValidator } from '../../retrieval/validation/evidence-attachment.validator.js';
import { ResolveOutput } from '../../types/resolve.types.js';
import {
  MatchSignal,
  AnchorNode,
  AnchorId,
  ResolutionStrength,
} from '../../types/retrieval.types.js';
import { AtsSkillGroupCompiler } from '../compiler/ats-skill-group.compiler.js';
import type { AtsSkillSection } from '../compiler/ats-skill-group.compiler.js';
import { SkillKeyNormalizer } from '../normalization/skill-key-normalizer.js';

export class ResumeResolver {
  private readonly acceptance = new RetrievalAcceptanceResolver(retrievalPolicy);

  private readonly skillCompiler = new AtsSkillGroupCompiler();

  private readonly attachmentValidator = new EvidenceAttachmentValidator();

  private readonly logger = RetrievalLogger.getInstance();

  private readonly ranker = new RetrievalRanker();

  resolve(
    retrieval: RetrievalOutput,
    artifacts: HydratedArtifactBundle,
    jobId: string = 'unknown'
  ): ResolveOutput {
    const { direct, expanded, evidences } = retrieval;

    // Rank each signal in the expanded map.
    const rankedSignals: RankedSignal[] = [];
    for (const [anchorId, signal] of expanded.entries()) {
      const rankedSignal = this.ranker.rank(signal, direct, expanded, artifacts.evidences);
      rankedSignals.push(rankedSignal);
    }

    // Filter the ranked signals by acceptance (using the final score) and validate evidence attachment.
    const acceptedRankedSignals = rankedSignals.filter((rankedSignal) => {
      // Validate evidence attachment for skills that require evidence
      const validationResult = this.attachmentValidator.validate(
        rankedSignal.signal,
        artifacts,
        jobId
      );
      if (!validationResult.valid) {
        // Log the evidence attachment missing event
        this.logger.logEvidenceAttachmentMissing(jobId, rankedSignal.signal.anchorId);
        return false; // Reject the signal
      }

      const acceptance = this.acceptance.accept(rankedSignal.signal, rankedSignal.finalScore);
      return acceptance.accepted;
    });

    // Sort the accepted ranked signals by final score (descending).
    acceptedRankedSignals.sort((a, b) => b.finalScore - a.finalScore);

    // Log acceptance decisions
    for (const rankedSignal of acceptedRankedSignals) {
      this.logger.logAcceptance(
        jobId,
        rankedSignal.signal.anchorId,
        true,
        'accepted',
        rankedSignal.finalScore,
        rankedSignal.signal.confidence
      );
    }

    // Log ATS exposure decisions
    for (const rankedSignal of acceptedRankedSignals) {
      const anchorNode = artifacts.anchors.get(rankedSignal.signal.anchorId);
      if (anchorNode) {
        const skillName = SkillKeyNormalizer.normalizeSkillName(anchorNode.key);
        const visibility =
          retrievalPolicy.visibility[anchorNode.kind as keyof typeof retrievalPolicy.visibility];
        const shown = visibility !== 'hidden';

        this.logger.logAtsExposure(
          jobId,
          rankedSignal.signal.anchorId,
          anchorNode.kind,
          skillName,
          visibility,
          shown
        );
      }
    }

    // Enumerate unmatched tech anchors (those not in expanded, only tech kind)
    const matchedAnchorIds = new Set(expanded.keys());
    const unmatchedRankedSignals: RankedSignal[] = [];
    for (const [anchorId, anchorNode] of artifacts.anchors) {
      if (anchorNode.kind !== 'tech') continue;
      if (matchedAnchorIds.has(anchorId)) continue;

      const evidenceIds = artifacts.anchorToEvidence.get(anchorId);
      if (!evidenceIds || evidenceIds.size === 0) continue;

      // Compute evidence count and base score
      const evidenceCount = evidenceIds.size;
      let maxEvidenceBaseScore = 0;
      for (const evidenceId of evidenceIds) {
        const evidence = artifacts.evidences.get(evidenceId);
        if (evidence) {
          const baseScore = EvidenceRanker.scoreEvidence(evidence);
          maxEvidenceBaseScore = Math.max(maxEvidenceBaseScore, baseScore);
        }
      }

      // Unmatched score: evidenceCount × 0.6 + evidenceBaseScore × 0.4
      const normalizedCount = Math.min(evidenceCount / 2, 1);
      const finalScore = normalizedCount * 0.6 + maxEvidenceBaseScore * 0.4;

      // Create minimal signal for acceptance check
      const signal: MatchSignal = {
        anchorId,
        score: finalScore,
        confidence: 0,
        occurrences: 0,
        stages: new Set(),
        evidenceIds,
        matchedPatterns: [],
        occurrencesDetail: [],
        sources: new Set(),
        trace: [],
      };

      const acceptance = this.acceptance.accept(signal, finalScore);
      if (acceptance.accepted) {
        unmatchedRankedSignals.push({
          signal,
          finalScore,
          resolutionStrength: 'missing' as ResolutionStrength,
        });
      }
    }

    // Sort unmatched by final score descending
    unmatchedRankedSignals.sort((a, b) => b.finalScore - a.finalScore);

    return {
      skills: this.skills(acceptedRankedSignals, unmatchedRankedSignals, artifacts.anchors),

      experiences: this.experiences(evidences),

      projects: this.projects(evidences),

      traces: acceptedRankedSignals.map((rankedSignal) => {
        // Update the trace of the original signal to have the resolutionStrength set to the ranked signal's resolutionStrength.
        const originalTrace = rankedSignal.signal.trace;
        const updatedTrace = originalTrace.map((t) => ({
          ...t,
          resolutionStrength: rankedSignal.resolutionStrength,
        }));

        return {
          anchorId: rankedSignal.signal.anchorId,
          score: rankedSignal.finalScore,
          trace: updatedTrace,
        };
      }),
    };
  }

  private skills(
    acceptedRankedSignals: RankedSignal[],
    unmatchedRankedSignals: RankedSignal[],
    anchorMap: Map<string, AnchorNode>
  ): AtsSkillSection {
    const matchedSignals = acceptedRankedSignals.map((rs) => rs.signal);
    const unmatchedSignals = unmatchedRankedSignals.map((rs) => rs.signal);
    return this.skillCompiler.compile(matchedSignals, unmatchedSignals, anchorMap);
  }

  private experiences(evidences: RetrievalEvidenceScore[]) {
    return evidences
      .filter((item) => item.evidence?.type === 'experience' && item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, retrievalPolicy.resolver.maxExperience);
  }

  private projects(evidences: RetrievalEvidenceScore[]) {
    return evidences
      .filter((item) => item.evidence?.type === 'project' && item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, retrievalPolicy.resolver.maxProjects);
  }
}
