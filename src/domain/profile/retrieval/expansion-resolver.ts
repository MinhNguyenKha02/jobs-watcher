import { AnchorId, AdjacencyMap, MatchSignal } from '../types/retrieval.types.js';

import { retrievalPolicy } from './policies/retrieval.policy.js';
import { MatchSignalBuilder } from './scoring/match-signal.builder.js';

export class ExpansionResolver {
  private readonly builder = new MatchSignalBuilder(retrievalPolicy);

  expand(
    matches: Map<AnchorId, MatchSignal>,

    adjacency: AdjacencyMap
  ) {
    const expanded = new Map(matches);

    for (const [anchorId, signal] of matches) {
      const related = adjacency.get(anchorId);

      if (!related) {
        continue;
      }

      for (const edge of related) {
        const propagated = signal.score * edge.weight;

        const existing = expanded.get(edge.to);

        if (!existing) {
          continue;
        }

        this.builder.appendPropagation({
          signal,
          from: anchorId,
          weight: edge.weight,
        });

        existing.score += propagated;

        existing.occurrences += 1;

        existing.sources.add('adjacent');
      }
    }

    return expanded;
  }
}
