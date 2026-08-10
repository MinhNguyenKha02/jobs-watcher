import { AhoCorasick } from '../../../src/domain/profile/retrieval/aho-corasick.js';
import { HydratedArtifactBundle } from '../../../src/domain/profile/artifacts/types/artifact.types.js';
import {
  AdjacencyEdge,
  AdjacencyMap,
  AnchorId,
  AnchorNode,
  AnchorToEvidenceMap,
  EvidenceId,
  EvidenceNode,
  LexicalSurface,
  MatchSignal,
  RetrievalAcceptance,
  RetrievalEvidenceScore,
} from '../../../src/domain/profile/types/retrieval.types.js';

export type AnchorIdStr = `cap.${string}` | `comp.${string}` | `beh.${string}` | `tech.${string}`;

export interface FixtureAnchors {
  [key: string]: {
    id: AnchorId;
    kind: 'cap' | 'comp' | 'beh' | 'tech';
    category: string;
    key: string;
  };
}

export interface FixtureSurfaces {
  anchorId: AnchorId;
  pattern: string;
  source: 'canonical' | 'adjacent' | 'vendor' | 'template';
  weight: number;
  language?: 'en' | 'vi';
}

export interface FixtureEvidence {
  id: EvidenceId;
  type: 'project' | 'experience';
  title: string;
  summary?: string;
  bullets: { text: string; kind: 'responsibility' | 'outcome' }[];
  anchorIds: AnchorId[];
}

export function buildAhoCorasick(surfaces: FixtureSurfaces[]): AhoCorasick {
  const aho = new AhoCorasick();
  for (const s of surfaces) {
    aho.insert({ anchorId: s.anchorId, pattern: s.pattern, weight: s.weight, source: s.source });
  }
  aho.buildFallbackLinks();
  return aho;
}

export function buildAnchorMap(anchors: FixtureAnchors): Map<AnchorId, AnchorNode> {
  const map = new Map<AnchorId, AnchorNode>();
  for (const [key, a] of Object.entries(anchors)) {
    map.set(a.id, { id: a.id, kind: a.kind, category: a.category, key: a.key });
  }
  return map;
}

export function buildEvidenceMap(evidences: FixtureEvidence[]): Map<EvidenceId, EvidenceNode> {
  const map = new Map<EvidenceId, EvidenceNode>();
  for (const e of evidences) {
    map.set(e.id, {
      id: e.id,
      type: e.type,
      title: e.title,
      summary: e.summary,
      bullets: e.bullets,
      anchorIds: e.anchorIds,
    });
  }
  return map;
}

export function buildAnchorToEvidence(
  anchorEvidences: [AnchorId, EvidenceId[]][]
): AnchorToEvidenceMap {
  const map = new Map<AnchorId, Set<EvidenceId>>();
  for (const [anchorId, evIds] of anchorEvidences) {
    map.set(anchorId, new Set(evIds));
  }
  return map;
}

export function buildAdjacencyMap(
  edges: { from: AnchorId; to: AnchorId; weight: number }[]
): AdjacencyMap {
  const map = new Map<AnchorId, AdjacencyEdge[]>();
  for (const edge of edges) {
    const existing = map.get(edge.from) ?? [];
    existing.push({ from: edge.from, to: edge.to, weight: edge.weight });
    map.set(edge.from, existing);
  }
  return map;
}

export function buildHydratedArtifactBundle(opts: {
  anchors: FixtureAnchors;
  surfaces: FixtureSurfaces[];
  evidenceList?: FixtureEvidence[];
  anchorToEvidence?: [AnchorId, EvidenceId[]][];
  adjacency?: { from: AnchorId; to: AnchorId; weight: number }[];
}): HydratedArtifactBundle {
  const enSurfaces: LexicalSurface[] = opts.surfaces
    .filter((s) => (s.language ?? 'en') !== 'vi')
    .map((s) => ({
      pattern: s.pattern,
      anchorId: s.anchorId,
      language: 'en' as const,
      source: s.source,
      weight: s.weight,
    }));

  const viSurfaces: LexicalSurface[] = opts.surfaces
    .filter((s) => s.language === 'vi')
    .map((s) => ({
      pattern: s.pattern,
      anchorId: s.anchorId,
      language: 'vi' as const,
      source: s.source,
      weight: s.weight,
    }));

  const enAho = buildAhoCorasick(opts.surfaces.filter((s) => (s.language ?? 'en') !== 'vi'));

  const viAho = buildAhoCorasick(opts.surfaces.filter((s) => s.language === 'vi'));

  const anchors = buildAnchorMap(opts.anchors);
  const evidences = buildEvidenceMap(opts.evidenceList ?? []);
  const anchorToEvidence = buildAnchorToEvidence(opts.anchorToEvidence ?? []);

  return {
    aho: { en: enAho, vi: viAho },
    anchors,
    enSurfaces,
    viSurfaces,
    adjacency: opts.adjacency ? buildAdjacencyMap(opts.adjacency) : new Map(),
    anchorToEvidence,
    evidences,
  };
}

export function makeSignal(id: AnchorId, overrides: Partial<MatchSignal> = {}): MatchSignal {
  return {
    anchorId: id,
    score: 0.5,
    confidence: 0.8,
    occurrences: 2,
    stages: new Set(['lexical']),
    evidenceIds: new Set(),
    matchedPatterns: [],
    occurrencesDetail: [],
    sources: new Set(['canonical']),
    trace: [],
    ...overrides,
  };
}

export function makeEvidenceScore(score: number, evidence?: EvidenceNode): RetrievalEvidenceScore {
  return { score, evidence };
}

export function makeAcceptance(
  accepted: boolean,
  score: number,
  reason: string
): RetrievalAcceptance {
  return { accepted, score, reason };
}
