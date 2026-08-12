import { AnchorId, ResolutionStrength } from '../types/retrieval.types.js';

import type { RetrievalOutput } from './contracts/retrieval.types.js';

export interface DebugTraceEntry {
  type: string;
  scoreDelta: number;
  reason: string;
  from?: string;
  to?: string;
  resolutionStrength?: ResolutionStrength;
}

export interface Trace {
  anchorId: AnchorId;
  score: number;
  trace: {
    resolutionStrength: ResolutionStrength;
    type: 'lexical-hit' | 'propagation' | 'resolver-accepted' | 'resolver-rejected';
    from?: AnchorId;
    to?: AnchorId;
    scoreDelta: number;
    reason: string;
  }[];
}

export interface DebugSnapshot {
  matchedAnchors: {
    anchorId: string;
    matchedPatterns: string[];
    score: number;
    confidence: number;
    occurrences: number;
    sources: string[];
    trace: DebugTraceEntry[];
  }[];
  propagatedAnchors: {
    anchorId: string;
    score: number;
    confidence: number;
    sources: string[];
    trace: DebugTraceEntry[];
  }[];
  evidenceScores: {
    score: number;
    evidence: {
      type: string;
      title: string;
      company?: string;
      summary?: string;
    } | null;
  }[];
  resolvedTraces: {
    anchorId: string;
    score: number;
    resolutionStrength: string;
    trace: DebugTraceEntry[];
  }[];
}

function mapTrace(signal: {
  trace: {
    type: string;
    scoreDelta: number;
    reason: string;
    from?: string;
    to?: string;
    resolutionStrength?: ResolutionStrength;
  }[];
}): DebugTraceEntry[] {
  return signal.trace.map((t) => ({
    type: t.type,
    scoreDelta: t.scoreDelta,
    reason: t.reason,
    from: t.from,
    to: t.to,
    resolutionStrength: t.resolutionStrength,
  }));
}

export function captureDebug(
  retrieval: RetrievalOutput,
  result?: {
    traces: {
      anchorId: string;
      score: number;
      trace: {
        type: string;
        scoreDelta: number;
        reason: string;
        from?: string;
        to?: string;
        resolutionStrength?: ResolutionStrength;
      }[];
    }[];
  }
): DebugSnapshot {
  const matchedAnchors: DebugSnapshot['matchedAnchors'] = [];
  for (const [anchorId, signal] of retrieval.direct) {
    matchedAnchors.push({
      anchorId,
      matchedPatterns: signal.matchedPatterns || [],
      score: signal.score,
      confidence: signal.confidence,
      occurrences: signal.occurrences,
      sources: Array.from(signal.sources || []),
      trace: mapTrace(signal),
    });
  }
  matchedAnchors.sort((a, b) => b.score - a.score);

  const propagatedAnchors: DebugSnapshot['propagatedAnchors'] = [];
  for (const [anchorId, signal] of retrieval.expanded) {
    if (!retrieval.direct.has(anchorId)) {
      propagatedAnchors.push({
        anchorId,
        score: signal.score,
        confidence: signal.confidence,
        sources: Array.from(signal.sources || []),
        trace: mapTrace(signal),
      });
    }
  }
  propagatedAnchors.sort((a, b) => b.score - a.score);

  const evidenceScores: DebugSnapshot['evidenceScores'] = retrieval.evidences.map((es) => ({
    score: es.score,
    evidence: es.evidence
      ? {
          type: es.evidence.type,
          title: es.evidence.title || '',
          company: es.evidence.company,
          summary: es.evidence.summary,
        }
      : null,
  }));

  const resolvedTraces: DebugSnapshot['resolvedTraces'] = (result?.traces ?? []).map((t) => ({
    anchorId: t.anchorId,
    score: t.score,
    resolutionStrength: t.trace.find((tt) => tt.resolutionStrength)?.resolutionStrength || 'none',
    trace: t.trace.map((tt) => ({
      type: tt.type,
      scoreDelta: tt.scoreDelta,
      reason: tt.reason,
      from: tt.from,
      to: tt.to,
      resolutionStrength: tt.resolutionStrength,
    })),
  }));

  return { matchedAnchors, propagatedAnchors, evidenceScores, resolvedTraces };
}
