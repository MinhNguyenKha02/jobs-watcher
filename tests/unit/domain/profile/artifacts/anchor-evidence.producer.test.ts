import { describe, it, expect } from 'vitest';
import { AnchorEvidenceProducer } from '../../../../../src/domain/profile/artifacts/producers/anchor-evidence.producer.js';
import type {
  EvidenceId,
  EvidenceNode,
} from '../../../../../src/domain/profile/types/retrieval.types.js';

describe('AnchorEvidenceProducer', () => {
  const producer = new AnchorEvidenceProducer();

  const makeEvidence = (id: string, anchorIds: string[]): [EvidenceId, EvidenceNode] => [
    id as EvidenceId,
    {
      id: id as EvidenceId,
      anchorIds: anchorIds as any[],
      type: 'project',
      title: 'Test',
      bullets: [],
    },
  ];

  it('GIVEN AnchorEvidenceProducer WHEN AnchorEvidenceProducer evaluates THEN maps evidence to their anchors', () => {
    const evidences = new Map([
      makeEvidence('ev.project.0', ['cap.language.Go', 'tech.framework.React']),
      makeEvidence('ev.project.1', ['cap.language.Go']),
    ]);

    const result = producer.produce({ evidences });

    expect(result.size).toBe(2);
    expect(result.get('cap.language.Go' as any)).toEqual(new Set(['ev.project.0', 'ev.project.1']));
    expect(result.get('tech.framework.React' as any)).toEqual(new Set(['ev.project.0']));
  });

  it('GIVEN AnchorEvidenceProducer WHEN AnchorEvidenceProducer evaluates THEN handles empty evidences', () => {
    const result = producer.produce({ evidences: new Map() });
    expect(result.size).toBe(0);
  });

  it('GIVEN AnchorEvidenceProducer WHEN AnchorEvidenceProducer evaluates THEN handles evidence with no anchors', () => {
    const evidences = new Map([makeEvidence('ev.project.0', [])]);

    const result = producer.produce({ evidences });
    expect(result.size).toBe(0);
  });

  it('GIVEN AnchorEvidenceProducer WHEN AnchorEvidenceProducer evaluates THEN groups multiple evidence IDs under same anchor', () => {
    const evidences = new Map([
      makeEvidence('ev.project.0', ['cap.language.Go']),
      makeEvidence('ev.project.1', ['cap.language.Go']),
      makeEvidence('ev.exp.2', ['cap.language.Go']),
    ]);

    const result = producer.produce({ evidences });
    expect(result.get('cap.language.Go' as any)).toEqual(
      new Set(['ev.project.0', 'ev.project.1', 'ev.exp.2'])
    );
  });
});
