import { describe, it, expect } from 'vitest';
import { EvidenceAttachmentValidator } from '../../../src/domain/profile/retrieval/validation/evidence-attachment.validator.js';
import { ExpansionResolver } from '../../../src/domain/profile/retrieval/expansion-resolver.js';
import {
  makeSignal,
  buildHydratedArtifactBundle,
} from '../../helpers/profile/integration-fixtures.js';
import { RetrievalLogger } from '../../../src/domain/profile/retrieval/logging/retrieval-logger.js';

describe('Artifact Integrity Integration', () => {
  describe('INT-014: propagation to non-existent anchor is skipped', () => {
    it('GIVEN Artifact WHEN directMatches.set THEN not propagate to an anchor without a direct match', () => {
      const bundle = buildHydratedArtifactBundle({
        anchors: {
          skillA: {
            id: 'cap.skill-a' as any,
            kind: 'cap' as any,
            category: 'tech',
            key: 'skill-a',
          },
          export: { id: 'cap.export' as any, kind: 'cap' as any, category: 'tech', key: 'export' },
        },
        surfaces: [
          { anchorId: 'cap.skill-a' as any, pattern: 'skill a', source: 'canonical', weight: 1.0 },
        ],
        adjacency: [{ from: 'cap.skill-a' as any, to: 'cap.export' as any, weight: 0.5 }],
        anchorToEvidence: [],
      });

      // Direct matches only contain skill-a (export has no matching surface)
      const directMatches = new Map();
      directMatches.set('cap.skill-a' as any, makeSignal('cap.skill-a' as any, { score: 0.9 }));

      const resolver = new ExpansionResolver();
      const expanded = resolver.expand(directMatches, bundle.adjacency);

      // cap.export should NOT be in expanded because it wasn't a direct match
      expect(expanded.has('cap.export' as any)).toBe(false);
      expect(expanded.has('cap.skill-a' as any)).toBe(true);
    });
  });

  describe('INT-015: invalid evidence mapping is rejected', () => {
    it('GIVEN anchorToEvidence maps to non-existent evidence WHEN validator.validate THEN reject signal', () => {
      const bundle = buildHydratedArtifactBundle({
        anchors: {
          skillA: {
            id: 'cap.skill-a' as any,
            kind: 'cap' as any,
            category: 'tech',
            key: 'skill-a',
          },
        },
        surfaces: [
          { anchorId: 'cap.skill-a' as any, pattern: 'skill a', source: 'canonical', weight: 1.0 },
        ],
        evidenceList: [],
        anchorToEvidence: [
          ['cap.skill-a' as any, ['ev.nonexistent' as any]], // points to evidence that doesn't exist
        ],
      });

      const signal = makeSignal('cap.skill-a' as any, {
        evidenceIds: new Set(['ev.nonexistent' as any]),
      });

      const validator = new EvidenceAttachmentValidator();
      const result = validator.validate(signal, bundle, 'test-job');

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('No valid evidence');
    });
  });
});
