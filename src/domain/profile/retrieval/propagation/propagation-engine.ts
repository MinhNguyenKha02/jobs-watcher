import {
  AdjacencyMap,
  AnchorId,
  MatchSignal,
} from '../../types/retrieval.types.js';

import {
  RetrievalPolicy,
  retrievalPolicy
} from '../policies/retrieval.policy.js';

import {
  MatchSignalBuilder,
} from '../scoring/match-signal.builder.js';

interface PropagationWalkState {
  origin: AnchorId;

  current: AnchorId;

  depth: number;

  score: number;

  expanded: Map<AnchorId, MatchSignal>;

  visited: Set<string>;
}

export class PropagationEngine {

  constructor(
    private readonly policy:
      RetrievalPolicy,

    private readonly adjacency:
      AdjacencyMap,

    private readonly builder =
      new MatchSignalBuilder(retrievalPolicy),
  ) {}

  propagate(
    direct:
      Map<
        AnchorId,
        MatchSignal
      >,
  ) {

    const expanded =
      new Map<
        AnchorId,
        MatchSignal
      >(direct);

    for (
      const [
        anchorId,
        signal,
      ]
      of direct
    ) {

      this.walk({
        origin: anchorId,

        current: anchorId,

        depth: 0,

        score: signal.score,

        expanded,
        visited: new Set(),
      });
    }

    return expanded;
  }

  private walk({
    origin,
    current,
    depth,
    score,
    expanded,
    visited,
  }: PropagationWalkState) {

    if (
      depth >=
      this.policy.propagation.maxDepth
    ) {

      return;
    }

    const edges =
      this.adjacency.get(
        current,
      ) ?? [];

    for (
      const edge
      of edges
    ) {
      
      const key =
      `${origin}:${edge.to}:${depth}`;

      if (visited.has(key)) {
        continue;
      }

      visited.add(key);

      const kind =
      edge.to.split('.')[0];

      if (
        this.policy.propagation.blockedKinds.includes(kind)
      ) {
        continue;
      }

      if (
        expanded.size >=
        this.policy.propagation.maxExpandedAnchors
      ) {
        return;
      }

      if (
        edge.weight <
        this.policy.propagation.minEdgeWeight
      ) {

        continue;
      }

      const propagated =
        score *
        edge.weight *
        this.policy.propagation.decayFactor;

      if (
        propagated <
        this.policy.direct.minScore
      ) {

        continue;
      }

      let signal =
        expanded.get(
          edge.to,
        );

      if (!signal) {

        signal =
          this.builder.create(
            edge.to,
          );

        expanded.set(
          edge.to,
          signal,
        );
      }

      this.builder.appendPropagation({
        signal,

        from: origin,

        weight: propagated,
      });

      this.walk({
        origin,

        current: edge.to,

        depth: depth + 1,

        score: propagated,

        expanded,
        visited: new Set(),
      });
    }
  }
}