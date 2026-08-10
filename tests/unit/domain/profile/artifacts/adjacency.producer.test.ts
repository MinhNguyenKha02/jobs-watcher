import { describe, it, expect } from 'vitest';
import { AdjacencyProducer } from '../../../../../src/domain/profile/artifacts/producers/adjacency.producer.js';
import type { RelationsSource } from '../../../../../src/domain/profile/source/source.types.js';
import type { AnchorId } from '../../../../../src/domain/profile/types/retrieval.types.js';

describe('AdjacencyProducer', () => {
  const validAnchors = new Set<AnchorId>([
    'cap.language.Go' as AnchorId,
    'cap.language.TypeScript' as AnchorId,
    'tech.framework.React' as AnchorId,
  ]);

  it('GIVEN AdjacencyProducer input "validAnchors" WHEN AdjacencyProducer evaluates THEN builds adjacency edges from relations', () => {
    const relations: RelationsSource = {
      cap: {
        language: {
          Go: {
            adjacent: ['TypeScript', 'React'],
            recruiter_surfaces: { en: ['Go'], vi: ['Go'] },
            retrieval_associations: [],
          },
        },
      },
    };

    const producer = new AdjacencyProducer(validAnchors);
    const graph = producer.produce(relations);

    expect(graph.size).toBe(1);
    const edges = graph.get('cap.language.Go' as AnchorId);
    expect(edges).toHaveLength(2);
    expect(edges![0]).toEqual({
      from: 'cap.language.Go',
      to: 'cap.language.TypeScript',
      weight: 0.35,
    });
    expect(edges![1]).toEqual({
      from: 'cap.language.Go',
      to: 'tech.framework.React',
      weight: 0.35,
    });
  });

  it('GIVEN AdjacencyProducer input "validAnchors" WHEN AdjacencyProducer evaluates THEN returns empty array for anchors with no adjacent entries', () => {
    const relations: RelationsSource = {
      cap: {
        language: {
          Go: {
            adjacent: [],
            recruiter_surfaces: { en: ['Go'], vi: ['Go'] },
            retrieval_associations: [],
          },
        },
      },
    };

    const producer = new AdjacencyProducer(validAnchors);
    const graph = producer.produce(relations);

    const edges = graph.get('cap.language.Go' as AnchorId);
    expect(edges).toEqual([]);
  });

  it('GIVEN AdjacencyProducer input "validAnchors" WHEN AdjacencyProducer evaluates THEN skips unresolvable adjacent targets', () => {
    const relations: RelationsSource = {
      cap: {
        language: {
          Go: {
            adjacent: ['COBOL'],
            recruiter_surfaces: { en: ['Go'], vi: ['Go'] },
            retrieval_associations: [],
          },
        },
      },
    };

    const producer = new AdjacencyProducer(validAnchors);
    const graph = producer.produce(relations);

    const edges = graph.get('cap.language.Go' as AnchorId);
    expect(edges).toEqual([]);
  });

  it('GIVEN AdjacencyProducer input "validAnchors" WHEN AdjacencyProducer evaluates THEN handles empty relations', () => {
    const producer = new AdjacencyProducer(validAnchors);
    const graph = producer.produce({});
    expect(graph.size).toBe(0);
  });
});
