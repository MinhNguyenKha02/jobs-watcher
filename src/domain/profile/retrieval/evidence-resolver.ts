// src/services/profile/retrieval/evidence-resolver.ts

import { RetrievalEvidenceScore } from '../artifacts/types/artifact.types.js';
import {
  AnchorId,
  AnchorToEvidenceMap,
  EvidenceId,
  EvidenceNode,
  MatchSignal,
} from '../types/retrieval.types.js';

export class EvidenceResolver {
  constructor(
    private readonly evidences: Map<EvidenceId, EvidenceNode>,

    private readonly anchorToEvidence: AnchorToEvidenceMap
  ) {}

  resolve(signals: Map<AnchorId, MatchSignal>) {
    const scored = new Map<EvidenceId, RetrievalEvidenceScore>();

    for (const signal of signals.values()) {
      const evidenceIds = this.anchorToEvidence.get(signal.anchorId) ?? new Set();

      signal.evidenceIds = evidenceIds;

      for (const evidenceId of evidenceIds) {
        const evidence = this.evidences.get(evidenceId);

        if (!evidence) {
          continue;
        }

        const current = scored.get(evidenceId);

        const nextScore = (current?.score ?? 0) + signal.score;

        scored.set(evidenceId, {
          score: nextScore,

          evidence,
        });
      }
    }

    return [...scored.values()].sort((a, b) => b.score - a.score);
  }
}
