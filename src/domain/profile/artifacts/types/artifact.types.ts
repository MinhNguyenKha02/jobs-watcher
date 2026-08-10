import {
  AdjacencyMap,
  AnchorNode,
  AnchorToEvidenceMap,
  EvidenceId,
  EvidenceNode,
  LexicalSurface,
  MatchSignal,
  AnchorId,
} from '../../types/retrieval.types.js';

import { AhoCorasick } from '../../retrieval/aho-corasick.js';

export interface SerializedNestedSetEntry<K, V> extends Array<K | V[]> {
  0: K;
  1: V[];
}

export type SerializedMap<K, V> = [K, V][];

export type SerializedNestedSetMap<K, V> = SerializedNestedSetEntry<K, V>[];

export interface ArtifactMetadata {
  generatedAt: string;

  version: number;
}

export interface ArtifactBundle {
  anchors: Map<AnchorId, AnchorNode>;

  evidences: Map<EvidenceId, EvidenceNode>;

  enSurfaces: LexicalSurface[];

  viSurfaces: LexicalSurface[];

  adjacency: AdjacencyMap;

  anchorToEvidence: AnchorToEvidenceMap;
}

export interface HydratedArtifactBundle extends ArtifactBundle {
  aho: { en: AhoCorasick; vi: AhoCorasick };
}

export interface RetrievalResult {
  direct: Map<AnchorId, MatchSignal>;

  expanded: Map<AnchorId, MatchSignal>;

  evidences: RetrievalEvidenceScore[];
}

export interface RetrievalEvidenceScore {
  score: number;

  evidence?: EvidenceNode;
}
