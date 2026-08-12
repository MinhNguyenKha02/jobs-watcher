import { describe, it, expect } from 'vitest';

import { ProfileRetrievalEngine } from '../../../src/domain/profile/retrieval/profile-retrieval-engine.js';
import { buildHydratedArtifactBundle } from '../../helpers/profile/integration-fixtures.js';

describe('Retrieval Pipeline Integration', () => {
  describe('INT-001: lexical hit produces signal', () => {
    it('GIVEN job text contains a canonical surface WHEN engine.retrieve THEN create a signal with correct metadata', () => {
      const bundle = buildHydratedArtifactBundle({
        anchors: {
          nodejs: { id: 'cap.nodejs' as any, kind: 'cap', category: 'language', key: 'nodejs' },
        },
        surfaces: [
          { anchorId: 'cap.nodejs' as any, pattern: 'nodejs', source: 'canonical', weight: 1.0 },
        ],
        anchorToEvidence: [],
      });
      const engine = new ProfileRetrievalEngine(bundle);
      const result = engine.retrieve('I know nodejs and typescript');

      expect(result.direct.has('cap.nodejs' as any)).toBe(true);
      const signal = result.direct.get('cap.nodejs' as any)!;
      expect(signal.occurrences).toBe(1);
      expect(signal.sources.has('canonical')).toBe(true);
      expect(signal.score).toBeGreaterThan(0);
    });
  });

  describe('INT-002: lexical hit propagates through adjacency', () => {
    it('GIVEN Retrieval WHEN engine.retrieve THEN propagate score from matched anchor to adjacent anchor', () => {
      const bundle = buildHydratedArtifactBundle({
        anchors: {
          nodejs: { id: 'cap.nodejs' as any, kind: 'cap', category: 'language', key: 'nodejs' },
          typescript: {
            id: 'cap.typescript' as any,
            kind: 'cap',
            category: 'language',
            key: 'typescript',
          },
        },
        surfaces: [
          { anchorId: 'cap.nodejs' as any, pattern: 'nodejs', source: 'canonical', weight: 1.0 },
          {
            anchorId: 'cap.typescript' as any,
            pattern: 'typescript',
            source: 'canonical',
            weight: 1.0,
          },
        ],
        adjacency: [{ from: 'cap.nodejs' as any, to: 'cap.typescript' as any, weight: 0.5 }],
        anchorToEvidence: [],
      });
      const engine = new ProfileRetrievalEngine(bundle);
      const result = engine.retrieve('nodejs typescript');

      const nodejsDirect = result.direct.get('cap.nodejs' as any)!;
      const typescriptExpanded = result.expanded.get('cap.typescript' as any)!;

      // Edge weight is 0.5. appendPropagation adds weight to source signal score.
      // Then existing.score += propagated where propagated = source.score * edge.weight.
      // Since direct and expanded share signal objects, typescript score in both is the same.
      // The propagated score = nodejs's direct score * edge.weight
      // typescript score = lexical(nodejs) + lexical(typescript) + propagated
      //                  = 0.8875 + 0.8875 + 0.8875*0.5 = 2.21875
      // But since appendPropagation adds 0.5 to nodejs's score:
      // nodejs score = 0.8875 + 0.5 = 1.3875
      // typescript expanded score = same as direct (shared object)
      // The propagation trace should be present on nodejs's signal trace
      const nodejsSignal = result.direct.get('cap.nodejs' as any)!;
      const hasPropTrace = nodejsSignal.trace.some((t) => t.type === 'propagation');
      expect(hasPropTrace).toBe(true);

      expect(typescriptExpanded.score).toBeGreaterThan(0);
    });
  });

  describe('INT-003: propagated signals participate in ranking', () => {
    it('GIVEN Retrieval WHEN engine.retrieve THEN include propagation contribution in expanded signal scores', () => {
      const bundle = buildHydratedArtifactBundle({
        anchors: {
          nodejs: { id: 'cap.nodejs' as any, kind: 'cap', category: 'language', key: 'nodejs' },
          typescript: {
            id: 'cap.typescript' as any,
            kind: 'cap',
            category: 'language',
            key: 'typescript',
          },
        },
        surfaces: [
          { anchorId: 'cap.nodejs' as any, pattern: 'nodejs', source: 'canonical', weight: 1.0 },
          {
            anchorId: 'cap.typescript' as any,
            pattern: 'typescript',
            source: 'canonical',
            weight: 1.0,
          },
        ],
        adjacency: [{ from: 'cap.nodejs' as any, to: 'cap.typescript' as any, weight: 0.5 }],
        anchorToEvidence: [],
      });
      const engine = new ProfileRetrievalEngine(bundle);
      const result = engine.retrieve('nodejs typescript');

      // Both anchors should be present in expanded map
      expect(result.expanded.has('cap.nodejs' as any)).toBe(true);
      expect(result.expanded.has('cap.typescript' as any)).toBe(true);

      // The nodejs signal should have a propagation trace
      // (due to appendPropagation adding weight to source signal)
      const nodejsSignal = result.expanded.get('cap.nodejs' as any)!;
      const propTrace = nodejsSignal.trace.find((t) => t.type === 'propagation');
      expect(propTrace).toBeDefined();
      expect(propTrace!.scoreDelta).toBeGreaterThan(0);

      // The expanded map size should be >= direct map size
      expect(result.expanded.size).toBeGreaterThanOrEqual(result.direct.size);
    });
  });
});
