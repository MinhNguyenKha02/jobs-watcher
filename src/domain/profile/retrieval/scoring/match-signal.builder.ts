import {
  AnchorId,
  MatchOccurrence,
  MatchSignal,
  MatchSource,
} from '../../types/retrieval.types.js';

import { RetrievalPolicy } from '../policies/retrieval.policy.js';

export class MatchSignalBuilder {
  constructor(private readonly policy: RetrievalPolicy) {}
  create(anchorId: AnchorId): MatchSignal {
    return {
      anchorId,

      score: 0,

      confidence: 0,

      occurrences: 0,

      stages: new Set(),

      evidenceIds: new Set(),

      matchedPatterns: [],

      occurrencesDetail: [],

      sources: new Set(),

      trace: [],
    };
  }
  finalize(
  signal: MatchSignal,
) {
  signal.confidence =
    Math.min(
      1,
      (
        signal.score * 0.6 +
        signal.occurrences * 0.15 +
        signal.sources.size * 0.25
      ) / 5,
    );
}
  appendLexicalHit({
    signal,
    pattern,
    source,
    weight,
    start,
    end,
  }: {
    signal: MatchSignal;

    pattern: string;

    source: MatchSource;

    weight: number;

    start: number;

    end: number;
  }) {
    signal.occurrences += 1;

    const weighted =
      weight * this.policy.direct.sourceWeights[source] * this.policy.direct.stageWeights.lexical;

    const saturation = Math.min(1, signal.occurrences / this.policy.direct.occurrenceSaturation);

    const effective = weighted * (1 - saturation * 0.45);

    signal.score += effective;

    signal.sources.add(source);

    signal.stages.add('lexical');

    signal.matchedPatterns.push(pattern);

    const occurrence: MatchOccurrence = {
      pattern,
      source,
      weight,
      start,
      end,
    };

    signal.occurrencesDetail.push(occurrence);

    signal.trace.push({
      type: 'lexical-hit',

      scoreDelta: weight,

      reason: `Matched "${pattern}" from ${source}`,
    });
  }

  appendPropagation({
    signal,
    from,
    weight,
  }: {
    signal: MatchSignal;

    from: AnchorId;

    weight: number;
  }) {
    signal.score += weight;

    signal.stages.add('propagation');

    signal.trace.push({
      type: 'propagation',

      from,

      to: signal.anchorId,

      scoreDelta: weight,

      reason: `Propagated from ${from}`,
    });
  }
}
