import { AdjacencyEdge, AnchorId } from '../../types/retrieval.types.js';

import { RelationNode, RelationsSource } from '../../source/source.types.js';

export class AdjacencyProducer {
  constructor(private readonly validAnchors: Set<AnchorId>) {}

  produce(relations: RelationsSource) {
    const graph = new Map<AnchorId, AdjacencyEdge[]>();

    for (const [kind, categories] of Object.entries(relations)) {
      for (const [category, entries] of Object.entries(categories as object)) {
        for (const [anchor, config] of Object.entries(entries as object)) {
          const from = `${kind}.${category}.${anchor}` as AnchorId;

          graph.set(from, this.edges(from, kind, category, config as RelationNode));
        }
      }
    }

    return graph;
  }

  private resolveTarget(kind: string, category: string, adjacent: string): AnchorId | null {
    const sameCat = `${kind}.${category}.${adjacent}` as AnchorId;
    if (this.validAnchors.has(sameCat)) return sameCat;

    for (const anchorId of this.validAnchors) {
      if (anchorId.startsWith(`${kind}.`) && anchorId.endsWith(`.${adjacent}`)) {
        return anchorId as AnchorId;
      }
    }

    for (const anchorId of this.validAnchors) {
      if (anchorId.endsWith(`.${adjacent}`)) {
        return anchorId as AnchorId;
      }
    }

    return null;
  }

  private edges(from: AnchorId, kind: string, category: string, config: RelationNode) {
    return (config.adjacent ?? [])
      .map((adjacent: string): AdjacencyEdge | null => {
        const to = this.resolveTarget(kind, category, adjacent);
        if (!to) return null;
        return { from, to, weight: 0.35 };
      })
      .filter((e): e is AdjacencyEdge => e !== null);
  }
}
