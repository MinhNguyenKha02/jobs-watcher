export type AnchorKind =
  | 'cap'
  | 'comp'
  | 'beh'
  | 'tech';

export type ResolutionStrength =
  | 'strong'
  | 'partial'
  | 'weak'
  | 'missing';

export type AnchorId =
  | `cap.${string}`
  | `comp.${string}`
  | `beh.${string}`
  | `tech.${string}`;

export type EvidenceId =
  | `ev.${string}`;

/* =========================
 * Anchor
 * ========================= */

export interface AnchorNode {
  id: AnchorId;

  kind: AnchorKind;

  category: string;

  key: string;
}

/* =========================
 * Evidence
 * ========================= */

export interface EvidenceNode {
  id: EvidenceId;

  anchorIds: AnchorId[];

  type:
    | 'project'
    | 'experience';

  title: string;

  position?: string;

  organization?: string;

  startDate?: string;

  endDate?: string;

  period?: string;

  summary?: string;

  bullets: EvidenceBullet[];

  techStack?: Record<string, string[]>;

  links?: Record<string, string[]>;
}
export interface EvidenceBullet {
  text: string;

  kind:
    | 'responsibility'
    | 'outcome';

  weight?: number;
}
/**
 * Backward-compatible alias
 */
export type Evidence =
  EvidenceNode;

/* =========================
 * Lexical
 * ========================= */

export interface LexicalSurface {
  pattern: string;

  anchorId: AnchorId;

  language:
    | 'en'
    | 'vi';

  source:
    | 'canonical'
    | 'adjacent'
    | 'vendor'
    | 'template';

  weight: number;
}

/* =========================
 * Adjacency
 * ========================= */

export interface AdjacencyEdge {
  from: AnchorId;

  to: AnchorId;

  weight: number;
}

export type AdjacencyMap =
  Map<
    AnchorId,
    AdjacencyEdge[]
  >;

/* =========================
 * Evidence Linking
 * ========================= */

export type AnchorToEvidenceMap =
  Map<
    AnchorId,
    Set<EvidenceId>
  >;

/* =========================
 * Retrieval Artifact Bundle
 * ========================= */

export interface RetrievalArtifacts {
  anchors: Map<
    AnchorId,
    AnchorNode
  >;

  evidences: Map<
    EvidenceId,
    EvidenceNode
  >;

  surfaces: LexicalSurface[];

  adjacency: AdjacencyMap;

  anchorToEvidence:
    AnchorToEvidenceMap;
}
export type MatchSource =
  | 'canonical'
  | 'adjacent'
  | 'vendor'
  | 'template';

export type RetrievalStage =
  | 'lexical'
  | 'propagation';

export interface MatchOccurrence {
  pattern: string;

  source: MatchSource;

  weight: number;

  start: number;

  end: number;
}

export interface MatchTrace {
  type:
    | 'lexical-hit'
    | 'propagation'
    | 'resolver-accepted'
    | 'resolver-rejected';

  from?: AnchorId;
  to?: AnchorId;

  scoreDelta: number;

  reason: string;

  /**
   * Resolution strength classification for gap analysis and learning loops.
   * Added in Sprint 3 for resolution strength tracking.
   */
  resolutionStrength?: ResolutionStrength;
}

export interface MatchSignal {
  anchorId: AnchorId;

  score: number;

  confidence: number;

  occurrences: number;

  stages:
    Set<RetrievalStage>;

  evidenceIds:
    Set<EvidenceId>;

  matchedPatterns:
    string[];

  occurrencesDetail:
    MatchOccurrence[];

  sources:
    Set<MatchSource>;

  trace: MatchTrace[];
}

export interface RetrievalAcceptance {
  accepted: boolean;

  reason: string;

  score: number;
}