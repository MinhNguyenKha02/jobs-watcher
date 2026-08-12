import { RetrievalEvidenceScore } from '../../artifacts/types/artifact.types.js';
import { AnchorId, MatchSignal } from '../../types/retrieval.types.js';

export interface RetrievalOutput {
  direct: Map<AnchorId, MatchSignal>;

  expanded: Map<AnchorId, MatchSignal>;

  evidences: RetrievalEvidenceScore[];
}
